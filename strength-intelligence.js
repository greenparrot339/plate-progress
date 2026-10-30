/* ============================================================
   Plate & Progress — Strength Intelligence ENGINE
   ------------------------------------------------------------
   Pure maths. No DOM, no IndexedDB, no globals except the export.
   Works in the browser (window.StrengthIntelligence) and in Node
   (module.exports) so it can be unit-tested.

   Input  : { exercises: [...], sets: [...] }   (the app's DB object)
   Weights: always kg internally. Use kgToLb / lbToKg at the UI edge.

   THE MODEL (transparent, no machine learning)
   1. Every working set gets a 1RM estimate from a rep-range-weighted
      blend of Epley, Brzycki and Lombardi (normalised so 1 rep = its weight).
   2. The headline 1RM is the recency-weighted median of per-session
      best estimates (robust to a single odd session).
   3. Personalisation: reps(w) = 1 + s * (priorReps(w / E) - 1), where
      priorReps is the inverse of the blended formula curve, E is the
      user's 1RM and s is a per-exercise "endurance factor". E and s are
      fitted to the user's own sets by maximum-a-posteriori grid search
      (squared log-rep error, recency/quality weights, an asymmetric loss
      because logged reps are a LOWER bound on capacity, and Gaussian
      priors that keep s near 1 and E near the session-median estimate).
      s is only fitted when the data can identify it (>=3 distinct loads
      spanning >=15%, >=8 sets, >=3 sessions); otherwise s = 1 and the
      curve shape comes from the formulas, and the result says so.
   4. Uncertainty comes from fit residuals shrunk toward a default,
      then from out-of-sample BACKTEST errors once available.
   5. Calibration: the backtest replays history (each top set is
      predicted using only earlier sessions). A systematic bias found
      there is applied (shrunk) to future predictions.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StrengthIntelligence = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var KG_PER_LB = 0.45359237;

  var CFG = {
    maxReps: 50,            // a logged set above this is treated as invalid
    maxWeightKg: 1000,
    halfLifeDays: 60,       // recency weighting for fitting & 1RM estimate
    recencyFloor: 0.1,      // old data is down-weighted, never discarded
    fitMaxDays: 540,
    fitMaxSets: 150,
    backoffRatio: 0.9,      // sets below 90% of the session top weight are "back-off" sets
    backoffFactor: 0.5,
    repeatFactor: 0.5,      // repeat sets at an already-used weight (fatigued) count half
    sigma0: 0.18,           // default log-rep noise
    sigmaPriorN: 6,         // pseudo-observations behind the default
    sigmaFloor: 0.07,
    sigmaCap: 0.45,
    sLogPriorSd: 0.25,
    ELogPriorSd: 0.06,
    underPredictPenalty: 1.5,
    maxLoadGapDays: 60,     // backtest: longer gap => conditions not comparable
    backtestMaxPoints: 30,
    anomalyRatio: 1.30,
    maxCapReps: 60
  };

  /* ---------- tiny helpers ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function median(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function weightedMedian(vals, ws) {
    if (!vals.length) return null;
    var idx = vals.map(function (_, i) { return i; }).sort(function (a, b) { return vals[a] - vals[b]; });
    var total = 0; idx.forEach(function (i) { total += ws[i]; });
    if (!(total > 0)) return median(vals);
    var half = total / 2, cum = 0;
    for (var k = 0; k < idx.length; k++) {
      cum += ws[idx[k]];
      if (cum >= half - 1e-12) {
        if (Math.abs(cum - half) < 1e-12 && k + 1 < idx.length) return (vals[idx[k]] + vals[idx[k + 1]]) / 2;
        return vals[idx[k]];
      }
    }
    return vals[idx[idx.length - 1]];
  }
  function dayNum(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  function todayDayNum() { return Math.floor(Date.now() / 86400000); }
  function nowDay(opts) {
    if (opts && opts.now != null) {
      var n = typeof opts.now === 'number' ? opts.now : dayNum(opts.now);
      if (n != null) return n;
    }
    return todayDayNum();
  }
  function dayToDate(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function recencyWeight(ageDays) {
    return Math.max(CFG.recencyFloor, Math.pow(0.5, Math.max(0, ageDays) / CFG.halfLifeDays));
  }
  function kgToLb(kg) { return kg / KG_PER_LB; }
  function lbToKg(lb) { return lb * KG_PER_LB; }
  function roundToIncrement(v, inc) { return inc > 0 ? Math.round(v / inc) * inc : v; }
  function fix(v, d) { var p = Math.pow(10, d); return Math.round(v * p) / p; }

  /* ---------- 1RM formulas (standard published forms) ---------- */
  function calculateEpley1RM(w, r) { return r === 1 ? w : w * (1 + r / 30); }
  function calculateBrzycki1RM(w, r) { return r >= 37 ? NaN : (r === 1 ? w : w * 36 / (37 - r)); }
  function calculateLombardi1RM(w, r) { return r === 1 ? w : w * Math.pow(r, 0.10); }

  function epleyF(r) { return 1 + r / 30; }
  function brzyckiF(r) { return r >= 37 ? Infinity : 36 / (37 - r); }
  function lombardiF(r) { return Math.pow(r, 0.10); }

  // Blend weights per rep range, interpolated linearly between anchors so
  // the curve has no jumps. Brzycki is phased out between ~12 and ~28 reps (it diverges).
  var ANCHORS = [
    { r: 3,  e: 0.35, b: 0.40, l: 0.25 },
    { r: 8,  e: 0.40, b: 0.35, l: 0.25 },
    { r: 12, e: 0.50, b: 0.20, l: 0.30 },
    { r: 20, e: 0.50, b: 0.05, l: 0.45 },
    { r: 28, e: 0.50, b: 0.00, l: 0.50 }
  ];
  function blendWeights(r) {
    var a = ANCHORS;
    if (r <= a[0].r) return { e: a[0].e, b: a[0].b, l: a[0].l };
    if (r >= a[a.length - 1].r) { var z = a[a.length - 1]; return { e: z.e, b: z.b, l: z.l }; }
    for (var i = 0; i < a.length - 1; i++) {
      if (r <= a[i + 1].r) {
        var t = (r - a[i].r) / (a[i + 1].r - a[i].r);
        t = t * t * (3 - 2 * t);
        return {
          e: a[i].e + t * (a[i + 1].e - a[i].e),
          b: a[i].b + t * (a[i + 1].b - a[i].b),
          l: a[i].l + t * (a[i + 1].l - a[i].l)
        };
      }
    }
    return { e: 0.5, b: 0, l: 0.5 };
  }
  function rawBlendF(r) {
    var w = blendWeights(r);
    return w.e * epleyF(r) + (w.b > 0 ? w.b * brzyckiF(r) : 0) + w.l * lombardiF(r);
  }
  var F1 = rawBlendF(1);
  // Normalised so a single rep equals its weight.
  function blendFactor(r) { return rawBlendF(r) / F1; }

  function blended1RM(w, r) {
    return {
      value: w * blendFactor(r),
      epley: calculateEpley1RM(w, r),
      brzycki: calculateBrzycki1RM(w, r),
      lombardi: calculateLombardi1RM(w, r),
      weights: blendWeights(r)
    };
  }

  // Lookup table: blendFactor over r in [1, maxCapReps] for fast inversion.
  var TBL_STEP = 0.05, TBL_R = [], TBL_F = [];
  (function () {
    for (var r = 1; r <= CFG.maxCapReps + 1e-9; r += TBL_STEP) { TBL_R.push(r); TBL_F.push(blendFactor(r)); }
  })();

  // Prior curve: reps you can do at fraction p of 1RM according to the formula blend.
  function repsPrior(p) {
    if (!(p > 0)) return CFG.maxCapReps;
    if (p > 1) return 0;
    var f = 1 / p;
    if (f <= 1) return 1;
    var n = TBL_F.length;
    if (f >= TBL_F[n - 1]) return CFG.maxCapReps;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (TBL_F[mid] <= f) lo = mid; else hi = mid; }
    var t = (f - TBL_F[lo]) / (TBL_F[hi] - TBL_F[lo]);
    return TBL_R[lo] + t * (TBL_R[hi] - TBL_R[lo]);
  }
  // Inverse: fraction of 1RM at which `reps` (prior-curve reps) is the limit.
  function intensityPrior(reps) {
    var r = clamp(reps, 1, CFG.maxCapReps);
    return 1 / blendFactor(r);
  }
  function userReps(p, s) {
    if (p > 1) return 0;
    var rp = repsPrior(p);
    return Math.max(1, 1 + s * (rp - 1));
  }
  function userIntensity(reps, s) {
    var rp = 1 + (reps - 1) / s;
    return intensityPrior(rp);
  }

  /* ---------- exercise identity / catalog ---------- */
  function defaultIdentityKey(name) {
    var s = String(name || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return s.split(' ').filter(Boolean).sort().join(' ');
  }
  function parseSet(s) {
    var w = Number(s && s.weight), r = Number(s && s.reps);
    var d = dayNum(s && s.date);
    if (d == null) return { ok: false, why: 'invalid' };
    var isWarm = String((s && s.setType) || 'working').toLowerCase() === 'warmup';
    if (isWarm) return { ok: false, why: 'warmup' };
    if (!isNum(w) || !isNum(r) || r <= 0) return { ok: false, why: (isNum(r) && r > 0 && (!isNum(w) || w <= 0)) ? 'bodyweight' : 'invalid' };
    if (w <= 0) return { ok: false, why: 'bodyweight' };
    if (r > CFG.maxReps || w > CFG.maxWeightKg) return { ok: false, why: 'invalid' };
    return { ok: true, w: w, r: r, day: d };
  }
  function orderValue(s, i) {
    var n = parseFloat(String(s.setNumber == null ? '' : s.setNumber));
    return isFinite(n) ? n : 1e6 + i;
  }

  function groupExercises(data, opts) {
    var idKey = (opts && opts.identityKey) || defaultIdentityKey;
    var groups = {};
    (data.exercises || []).forEach(function (ex) {
      var k = idKey(ex.name);
      if (!k) return;
      (groups[k] = groups[k] || { key: k, exerciseIds: [], names: {} });
      groups[k].exerciseIds.push(ex.id);
      groups[k].names[ex.name] = (groups[k].names[ex.name] || 0) + 1;
    });
    return groups;
  }

  // List every exercise (pooled by identity across days/splits) that has usable sets.
  function buildCatalog(data, opts) {
    var groups = groupExercises(data, opts);
    var byEx = {};
    Object.keys(groups).forEach(function (k) { groups[k].exerciseIds.forEach(function (id) { byEx[id] = k; }); });
    var acc = {};
    (data.sets || []).forEach(function (s) {
      var k = byEx[s.exerciseId]; if (!k) return;
      var a = acc[k] = acc[k] || { key: k, setCount: 0, dates: {}, last: 0, first: 1e9, bodyweight: 0 };
      var p = parseSet(s);
      if (p.ok) { a.setCount++; a.dates[s.date] = 1; a.last = Math.max(a.last, p.day); a.first = Math.min(a.first, p.day); }
      else if (p.why === 'bodyweight') a.bodyweight++;
    });
    var out = [];
    Object.keys(acc).forEach(function (k) {
      var a = acc[k]; if (!a.setCount) return;
      var names = groups[k].names;
      var name = Object.keys(names).sort(function (x, y) { return names[y] - names[x] || x.length - y.length; })[0];
      out.push({ key: k, name: name, exerciseIds: groups[k].exerciseIds, setCount: a.setCount, sessionCount: Object.keys(a.dates).length, lastDay: a.last, lastDate: dayToDate(a.last), firstDate: dayToDate(a.first), bodyweightSets: a.bodyweight });
    });
    out.sort(function (a, b) { return b.lastDay - a.lastDay || b.setCount - a.setCount; });
    return out;
  }

  /* ---------- history ---------- */
  function setE1(w, r) { return w * blendFactor(r); }

  // Build normalised sessions for one pooled exercise.
  function getExerciseHistory(data, key, opts) {
    var groups = groupExercises(data, opts);
    var g = groups[key];
    var empty = { key: key, name: key, sessions: [], excluded: { invalid: 0, warmup: 0, bodyweight: 0, anomalous: 0 }, setCount: 0 };
    if (!g) return empty;
    var ids = {}; g.exerciseIds.forEach(function (id) { ids[id] = 1; });
    var names = g.names;
    var name = Object.keys(names).sort(function (x, y) { return names[y] - names[x] || x.length - y.length; })[0];
    var byDate = {}, ex = { invalid: 0, warmup: 0, bodyweight: 0, anomalous: 0 };
    (data.sets || []).forEach(function (s, i) {
      if (!ids[s.exerciseId]) return;
      var p = parseSet(s);
      if (!p.ok) { ex[p.why] = (ex[p.why] || 0) + 1; return; }
      (byDate[s.date] = byDate[s.date] || { day: p.day, date: String(s.date).slice(0, 10), sets: [] }).sets.push({ weight: p.w, reps: p.r, ord: orderValue(s, i), created: s.createdAt || '' });
    });
    var sessions = Object.keys(byDate).map(function (d) { return byDate[d]; }).sort(function (a, b) { return a.day - b.day; });
    sessions.forEach(function (se) {
      se.sets.sort(function (a, b) { return a.ord - b.ord || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0); });
      var top = 0; se.sets.forEach(function (s) { if (s.weight > top) top = s.weight; });
      se.topWeight = top;
      se.topSet = null;
      var seenW = [];
      se.sets.forEach(function (s) {
        s.backoff = s.weight < CFG.backoffRatio * top;
        // 2nd/3rd set at a weight you already did today is fatigued, so it says less about fresh capacity
        s.repeat = seenW.some(function (w) { return Math.abs(w - s.weight) <= 0.25; });
        seenW.push(s.weight);
        if (!se.topSet && s.weight === top) se.topSet = s;
        s.e1rm = setE1(s.weight, s.reps);
      });
      // session estimate: best blended e1RM among sets <=12 reps; fall back to <=20 (flagged)
      var best = null, bestSet = null;
      se.sets.forEach(function (s) { if (s.reps <= 12 && (best == null || s.e1rm > best)) { best = s.e1rm; bestSet = s; } });
      se.lowQuality = false;
      if (best == null) {
        se.sets.forEach(function (s) { if (s.reps <= 20 && (best == null || s.e1rm > best)) { best = s.e1rm; bestSet = s; } });
        se.lowQuality = best != null;
      }
      se.e1rm = best; se.e1rmSet = bestSet; se.anomalous = false;
      se.volume = se.sets.reduce(function (a, s) { return a + s.weight * s.reps; }, 0);
    });
    flagAnomalies(sessions, ex);
    return { key: key, name: name, sessions: sessions, excluded: ex, setCount: sessions.reduce(function (a, s) { return a + s.sets.length; }, 0) };
  }

  // A session whose estimate is >30% away from the median of its neighbours is
  // treated as a probable data-entry error and given no weight in the model.
  function flagAnomalies(sessions, ex) {
    var idx = [];
    sessions.forEach(function (s, i) { if (s.e1rm != null) idx.push(i); });
    if (idx.length < 5) return;
    idx.forEach(function (si, pos) {
      var neigh = [];
      for (var d = 1; d <= 3; d++) {
        if (pos - d >= 0) neigh.push(sessions[idx[pos - d]].e1rm);
        if (pos + d < idx.length) neigh.push(sessions[idx[pos + d]].e1rm);
      }
      if (neigh.length < 3) return;
      var m = median(neigh), ratio = sessions[si].e1rm / m;
      if (ratio > CFG.anomalyRatio || ratio < 1 / CFG.anomalyRatio) { sessions[si].anomalous = true; ex.anomalous++; }
    });
  }

  function usableSessions(history, nowD) {
    return history.sessions.filter(function (s) { return s.e1rm != null && !s.anomalous && s.day <= nowD; });
  }

  /* ---------- 1RM estimate (aggregate) ---------- */
  function estimateOneRepMax(history, opts) {
    var nowD = nowDay(opts);
    var us = usableSessions(history, nowD);
    if (!us.length) return null;
    var recent = us.slice(-8);
    var vals = [], ws = [];
    recent.forEach(function (s) {
      vals.push(s.e1rm);
      ws.push(recencyWeight(nowD - s.day) * (s.lowQuality ? 0.4 : 1));
    });
    var val = weightedMedian(vals, ws);
    var devs = vals.map(function (v) { return Math.abs(Math.log(v / val)); });
    var madLog = 1.4826 * (median(devs) || 0);
    var sigmaE = clamp(Math.max(0.025, madLog) * Math.sqrt(1 + 2 / recent.length), 0.025, 0.12);
    // representative set = the session estimate closest to the aggregate
    var rep = recent.slice().sort(function (a, b) { return Math.abs(a.e1rm - val) - Math.abs(b.e1rm - val); })[0].e1rmSet;
    return {
      value: val, sigmaE: sigmaE, low: val * Math.exp(-sigmaE), high: val * Math.exp(sigmaE),
      sessionsUsed: recent.length, totalSessions: us.length,
      representativeSet: { weight: rep.weight, reps: rep.reps },
      formulas: {
        epley: calculateEpley1RM(rep.weight, rep.reps),
        brzycki: calculateBrzycki1RM(rep.weight, rep.reps),
        lombardi: calculateLombardi1RM(rep.weight, rep.reps),
        blended: rep.e1rm
      }
    };
  }

  /* ---------- personalised model ---------- */
  function collectFitSets(history, nowD) {
    var out = [];
    usableSessions(history, nowD).forEach(function (s) {
      var age = nowD - s.day;
      if (age > CFG.fitMaxDays) return;
      s.sets.forEach(function (st) {
        if (st.reps > 20) return;
        var q = repQuality(st.reps);
        var W = recencyWeight(age) * q * (st.backoff ? CFG.backoffFactor : 1) * (st.repeat ? CFG.repeatFactor : 1);
        out.push({ w: st.weight, r: st.reps, W: W, day: s.day, backoff: st.backoff });
      });
    });
    out.sort(function (a, b) { return b.day - a.day; });
    return out.slice(0, CFG.fitMaxSets);
  }
  function repQuality(r) {
    if (r === 1) return 0.8;
    if (r <= 10) return 1;
    if (r <= 12) return 0.7;
    if (r <= 15) return 0.4;
    return 0.15;
  }
  function distinctLoads(sets) {
    var m = {};
    sets.forEach(function (s) { if (s.r <= 15 && s.W > 0.005) m[Math.round(s.w * 2) / 2] = 1; });
    return Object.keys(m).map(Number);
  }

  function fitModel(history, opts) {
    opts = opts || {};
    var nowD = nowDay(opts);
    var est = estimateOneRepMax(history, { now: nowD });
    if (!est) return null;
    var us = usableSessions(history, nowD);
    var sets = collectFitSets(history, nowD);
    var loads = distinctLoads(sets);
    var spanOk = loads.length >= 3 && Math.max.apply(null, loads) / Math.min.apply(null, loads) >= 1.15;
    var fitS = sets.length >= 8 && us.length >= 3 && spanOk;
    var fitE = sets.length >= 3 && us.length >= 2;

    var E = est.value, s = 1, resid = null;
    if (fitE) {
      var lnE0 = Math.log(est.value), best = Infinity, bestE = E, bestS = 1;
      var sGrid = [];
      if (fitS) { for (var j = 0; j <= 30; j++) sGrid.push(-0.6 + 0.04 * j); } else sGrid.push(0);
      var s0sq = CFG.sigma0 * CFG.sigma0, sdS = CFG.sLogPriorSd, sdE = CFG.ELogPriorSd;
      for (var i = -15; i <= 15; i++) {
        var lnE = lnE0 + 0.01 * i, Ev = Math.exp(lnE);
        var rps = sets.map(function (st) { return st.w / Ev > 1 ? 0 : repsPrior(st.w / Ev); });
        var priorE = (lnE - lnE0) * (lnE - lnE0) / (sdE * sdE);
        for (var k = 0; k < sGrid.length; k++) {
          var sv = Math.exp(sGrid[k]), loss = priorE + sGrid[k] * sGrid[k] / (sdS * sdS);
          for (var n = 0; n < sets.length; n++) {
            var st2 = sets[n];
            var m = st2.w / Ev > 1 ? 0.3 : Math.max(0.3, 1 + sv * (rps[n] - 1));
            var e = Math.log(st2.r) - Math.log(m);
            var l = st2.W * e * e / s0sq;
            if (e > 0) l *= CFG.underPredictPenalty;
            loss += l;
          }
          if (loss < best) { best = loss; bestE = Ev; bestS = sv; }
        }
      }
      E = bestE; s = bestS;
    }
    // residual spread (log reps), in-sample
    var sumW = 0, sumSq = 0;
    sets.forEach(function (st) {
      var m = st.w / E > 1 ? 0.3 : Math.max(0.3, userReps(st.w / E, s));
      var e = Math.log(st.r) - Math.log(m);
      sumW += st.W; sumSq += st.W * e * e;
    });
    var sigmaFit = sumW > 0 ? Math.sqrt(sumSq / sumW) : CFG.sigma0;
    var nEff = Math.min(sets.length, sumW * 2);
    var sigma = Math.sqrt((nEff * sigmaFit * sigmaFit + CFG.sigmaPriorN * CFG.sigma0 * CFG.sigma0) / (nEff + CFG.sigmaPriorN));
    var bias = 0, btN = 0, sigmaBt = null;
    var cal = opts.backtest;
    if (cal && cal.points && cal.points.length) {
      btN = cal.points.length;
      var logs = cal.points.map(function (p) { return p.logError; });
      sigmaBt = Math.sqrt(logs.reduce(function (a, v) { return a + v * v; }, 0) / btN);
      sigma = Math.sqrt((2 * btN * sigmaBt * sigmaBt + nEff * sigma * sigma) / (2 * btN + nEff));
      if (btN >= 6) bias = clamp(median(logs) * btN / (btN + 8), -0.2, 0.2);
    }
    sigma = clamp(sigma, CFG.sigmaFloor, CFG.sigmaCap);

    var wts = sets.map(function (x) { return x.w; });
    return {
      version: VERSION,
      E: E, E0: est.value, s: s, sigma: sigma, sigmaE: est.sigmaE, bias: bias,
      formulaOnly: !fitE, personalizedShape: fitS,
      eLow: E * Math.exp(-est.sigmaE), eHigh: E * Math.exp(est.sigmaE),
      loadRange: wts.length ? { min: Math.min.apply(null, wts), max: Math.max.apply(null, wts) } : { min: E * 0.6, max: E * 0.9 },
      nSets: sets.length, nSessions: us.length, distinctLoads: loads.length,
      sigmaFit: sigmaFit, sigmaBacktest: sigmaBt, backtestN: btN,
      lastDay: us[us.length - 1].day, estimate: est
    };
  }

  /* ---------- predictions ---------- */
  function modelRepsExact(model, weight) {
    var p = weight / model.E;
    if (p > 1) return 0;
    return Math.max(1, userReps(p, model.s)) * Math.exp(model.bias);
  }

  function predictRepetitions(model, weightKg, opts) {
    if (!model) return { ok: false, reason: 'no-model' };
    if (!isNum(weightKg) || weightKg <= 0) return { ok: false, reason: 'bad-weight' };
    var p = weightKg / model.E, warnings = [], status = 'normal';
    var sig = model.sigma * ((opts && opts.sigmaScale) || 1);
    var exact = modelRepsExact(model, weightKg);
    var lo, hi, expected;
    if (p > 1) {
      status = 'above-max'; exact = 0; expected = 0; lo = 0; hi = 0;
      warnings.push('This weight is above your estimated 1RM (' + fix(model.E, 1) + ' kg), so no full rep is expected.');
    } else {
      expected = Math.round(exact);
      lo = Math.max(0, Math.round(exact * Math.exp(-sig)));
      hi = Math.round(exact * Math.exp(sig));
      if (exact >= CFG.maxCapReps - 1) { warnings.push('Very light for you: rep predictions above ~30 are unreliable.'); }
      else if (exact > 15) warnings.push('Above ~15 reps the strength formulas are unreliable; treat this as a rough guide.');
    }
    var lr = model.loadRange;
    if (weightKg > lr.max * 1.10) { if (status === 'normal') status = 'extrapolated-high'; warnings.push('Heavier than anything you have logged (' + fix(lr.max, 1) + ' kg) — extrapolated.'); }
    else if (weightKg < lr.min * 0.80) { if (status === 'normal') status = 'extrapolated-low'; warnings.push('Lighter than the loads you usually log (' + fix(lr.min, 1) + ' kg and up) — extrapolated.'); }
    return {
      ok: true, weight: weightKg, repsExact: exact, reps: expected, low: lo, high: hi,
      percentOf1RM: p * 100, e1rm: model.E, status: status, warnings: warnings, sigma: sig
    };
  }

  function predictWeightForReps(model, reps, opts) {
    if (!model) return { ok: false, reason: 'no-model' };
    if (!isNum(reps) || reps < 1) return { ok: false, reason: 'bad-reps' };
    var sig = model.sigma * ((opts && opts.sigmaScale) || 1), warnings = [];
    function wAt(target) {
      var modelReps = Math.max(1, target * Math.exp(-model.bias));
      return userIntensity(modelReps, model.s) * model.E;
    }
    var w = wAt(reps);
    var conservative = wAt(reps * Math.exp(sig));     // lighter: still likely to reach the reps
    var optimistic = wAt(Math.max(1, reps * Math.exp(-sig)));
    if (reps > 20) warnings.push('Above ~20 reps the formulas are unreliable; treat this as a rough guide.');
    else if (reps > 15) warnings.push('Above ~15 reps the strength formulas are less reliable.');
    var status = 'normal';
    if (w > model.loadRange.max * 1.10) { status = 'extrapolated-high'; warnings.push('This is heavier than anything you have logged (' + fix(model.loadRange.max, 1) + ' kg) — extrapolated.'); }
    else if (w < model.loadRange.min * 0.80) { status = 'extrapolated-low'; warnings.push('This is lighter than the loads you usually log — extrapolated.'); }
    return {
      ok: true, reps: reps, weight: w, conservative: Math.min(conservative, w), optimistic: Math.max(optimistic, w),
      percentOf1RM: w / model.E * 100, e1rm: model.E, status: status, warnings: warnings, sigma: sig
    };
  }

  function generateStrengthCurve(model, history, opts) {
    if (!model) return null;
    opts = opts || {};
    var pMin = intensityPrior(30 / Math.max(model.s, 0.5) + 1);
    var minW = Math.max(model.E * Math.max(pMin, 0.45), model.E * 0.4), maxW = model.E * 0.995;
    var steps = opts.steps || 48, pts = [];
    for (var i = 0; i <= steps; i++) {
      var w = minW + (maxW - minW) * i / steps;
      var pr = predictRepetitions(model, w);
      pts.push({ weight: w, reps: pr.repsExact, low: pr.repsExact * Math.exp(-pr.sigma), high: pr.repsExact * Math.exp(pr.sigma), extrapolated: pr.status !== 'normal' });
    }
    // recorded performance: best reps per distinct weight (working sets only, usable sessions)
    var byW = {};
    history.sessions.forEach(function (se) {
      if (se.anomalous) return;
      se.sets.forEach(function (st) {
        var k = Math.round(st.weight * 4) / 4;
        if (!byW[k] || st.reps > byW[k].reps || (st.reps === byW[k].reps && se.day > byW[k].day)) byW[k] = { weight: st.weight, reps: st.reps, date: se.date, day: se.day };
      });
    });
    var recorded = Object.keys(byW).map(function (k) { return byW[k]; }).sort(function (a, b) { return a.weight - b.weight; });
    return { points: pts, recorded: recorded, e1rm: model.E, recordedRange: model.loadRange };
  }

  function findClosestPerformance(history, query, nowOpts) {
    var nowD = nowDay(nowOpts), best = null, bestD = Infinity;
    history.sessions.forEach(function (se) {
      if (se.anomalous || se.day > nowD) return;
      se.sets.forEach(function (st) {
        var d = query.weight != null ? Math.abs(st.weight - query.weight) / query.weight : Math.abs(st.reps - query.reps) / query.reps;
        if (query.weight != null && st.reps > 30) return;
        var score = d + (nowD - se.day) * 1e-6;   // tie-break: more recent
        if (score < bestD) { bestD = score; best = { weight: st.weight, reps: st.reps, date: se.date, daysAgo: nowD - se.day }; }
      });
    });
    return best;
  }

  /* ---------- trend / records ---------- */
  function theilSen(xs, ys) {
    var slopes = [];
    for (var i = 0; i < xs.length; i++) for (var j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    if (!slopes.length) return null;
    var m = median(slopes);
    var b = median(ys.map(function (y, i) { return y - m * xs[i]; }));
    return { slope: m, intercept: b };
  }

  function calculateStrengthTrend(history, rangeDays, opts) {
    var nowD = nowDay(opts);
    var from = rangeDays ? nowD - rangeDays : -Infinity;
    var pts = usableSessions(history, nowD).filter(function (s) { return s.day >= from; }).map(function (s) {
      return { date: s.date, day: s.day, e1rm: s.e1rm, weight: s.topWeight, topReps: s.topSet ? s.topSet.reps : null, lowQuality: s.lowQuality };
    });
    var out = { rangeDays: rangeDays || null, points: pts, nSessions: pts.length, direction: 'insufficient', changePct: null, slopePerWeek: null };
    if (pts.length < 2) return out;
    var change, slope;
    if (pts.length === 2) {
      change = (pts[1].e1rm - pts[0].e1rm) / pts[0].e1rm * 100;
      slope = pts[1].day !== pts[0].day ? (pts[1].e1rm - pts[0].e1rm) / (pts[1].day - pts[0].day) * 7 : 0;
      out.lowConfidence = true;
    } else {
      var xs = pts.map(function (p) { return p.day; }), ys = pts.map(function (p) { return p.e1rm; });
      var ts = theilSen(xs, ys);
      if (!ts) return out;
      var y0 = ts.intercept + ts.slope * xs[0], y1 = ts.intercept + ts.slope * xs[xs.length - 1];
      change = y0 > 0 ? (y1 - y0) / y0 * 100 : 0; slope = ts.slope * 7;
    }
    out.changePct = change; out.slopePerWeek = slope;
    out.direction = Math.abs(change) < 1.5 ? 'stable' : (change > 0 ? 'up' : 'down');
    out.start = pts[0].e1rm; out.end = pts[pts.length - 1].e1rm;
    return out;
  }

  function calculateRecords(history) {
    var best = { weight: null, repsAtWeight: null, maxReps: null, bestE1RM: null };
    history.sessions.forEach(function (se) {
      if (se.anomalous) return;
      se.sets.forEach(function (st) {
        if (!best.weight || st.weight > best.weight.weight || (st.weight === best.weight.weight && st.reps > best.weight.reps)) best.weight = { weight: st.weight, reps: st.reps, date: se.date };
        if (!best.maxReps || st.reps > best.maxReps.reps) best.maxReps = { weight: st.weight, reps: st.reps, date: se.date };
      });
      if (se.e1rm != null && (!best.bestE1RM || se.e1rm > best.bestE1RM.value)) best.bestE1RM = { value: se.e1rm, weight: se.e1rmSet.weight, reps: se.e1rmSet.reps, date: se.date };
    });
    return best;
  }

  /* ---------- backtest ---------- */
  function sliceHistory(history, k) {
    return { key: history.key, name: history.name, sessions: history.sessions.slice(0, k), excluded: history.excluded };
  }

  function backtest(history) {
    var sessions = history.sessions;
    var points = [], skipped = [];
    var start = Math.max(2, sessions.length - CFG.backtestMaxPoints - 3);
    for (var k = start; k < sessions.length; k++) {
      var se = sessions[k];
      if (!se.topSet || se.anomalous || se.e1rm == null) continue;
      var prior = usableSessions(sliceHistory(history, k), se.day - 1);
      if (prior.length < 2) { skipped.push({ date: se.date, reason: 'not enough earlier sessions' }); continue; }
      var prev = prior[prior.length - 1];
      if (se.day - prev.day > CFG.maxLoadGapDays) { skipped.push({ date: se.date, reason: 'long gap since previous session' }); continue; }
      var recentTop = prior.slice(-8).map(function (s) { return s.topWeight; });
      var tmin = Math.min.apply(null, recentTop), tmax = Math.max.apply(null, recentTop);
      var w = se.topSet.weight, r = se.topSet.reps;
      if (w < tmin * 0.8 || w > tmax * 1.25) { skipped.push({ date: se.date, reason: 'weight differs materially from recent training' }); continue; }
      if (r > 20) { skipped.push({ date: se.date, reason: 'very high reps' }); continue; }
      var model = fitModel(sliceHistory(history, k), { now: se.day - 0 });
      if (!model) continue;
      // model is evaluated as of this session's date using only earlier sessions
      var uncal = Object.assign({}, model, { bias: 0 });
      var pr = predictRepetitions(uncal, w);
      if (!pr.ok || pr.status === 'above-max') { skipped.push({ date: se.date, reason: 'above estimated max' }); continue; }
      var predExact = Math.max(0.5, pr.repsExact);
      points.push({
        date: se.date, day: se.day, weight: w, actual: r, predicted: pr.reps, predictedExact: pr.repsExact, low: pr.low, high: pr.high,
        error: r - pr.reps, logError: Math.log(r) - Math.log(predExact), inRange: r >= pr.low && r <= pr.high
      });
    }
    points = points.slice(-CFG.backtestMaxPoints);
    var out = { points: points, skipped: skipped, summary: summarizeBacktest(points) };
    return out;
  }

  function summarizeBacktest(points) {
    var n = points.length;
    if (!n) return { n: 0 };
    var abs = points.map(function (p) { return Math.abs(p.error); });
    var absLog = points.map(function (p) { return Math.abs(p.logError); });
    var sum = {
      n: n,
      medianAbsRepError: median(abs),
      meanSignedRepError: points.reduce(function (a, p) { return a + p.error; }, 0) / n,
      within1Rep: points.filter(function (p) { return Math.abs(p.error) <= 1; }).length / n,
      withinRange: points.filter(function (p) { return p.inRange; }).length / n,
      medianAbsLogError: median(absLog),
      medianSignedLogError: median(points.map(function (p) { return p.logError; }))
    };
    if (n >= 8) {
      var h = Math.floor(n / 2), a = median(absLog.slice(0, h)), b = median(absLog.slice(h));
      sum.trend = b < a * 0.85 ? 'improving' : (b > a * 1.15 ? 'worsening' : 'steady');
    }
    return sum;
  }

  /* ---------- confidence ---------- */
  function calculatePredictionConfidence(history, model, bt, opts) {
    var nowD = nowDay(opts);
    if (!model) return { level: 'insufficient', label: 'Insufficient data', reasons: [{ ok: false, text: 'No usable working sets with weight and reps were found for this exercise.' }] };
    var sessions = model.nSessions, sets = model.nSets;
    var daysSince = nowD - model.lastDay;
    var recent = usableSessions(history, nowD).slice(-6).map(function (s) { return s.e1rm; });
    var cv = null;
    if (recent.length >= 3) { var mu = recent.reduce(function (a, v) { return a + v; }, 0) / recent.length; cv = Math.sqrt(recent.reduce(function (a, v) { return a + (v - mu) * (v - mu); }, 0) / recent.length) / mu; }
    var s = bt && bt.summary ? bt.summary : { n: 0 };
    var reasons = [];
    reasons.push({ ok: sessions >= 5, text: sessions + (sessions === 1 ? ' session' : ' sessions') + ' of history' + (sessions >= 5 ? '' : ' (5+ needed for a stable estimate)') });
    reasons.push({ ok: sets >= 10, text: sets + ' comparable working sets' + (sets >= 10 ? '' : ' (10+ preferred)') });
    reasons.push({ ok: model.personalizedShape, text: model.personalizedShape ? 'Curve shape fitted to your own loads (' + model.distinctLoads + ' different weights)' : 'Curve shape comes from the formulas — it personalises once your logs span about 15% in weight (e.g. a lighter and a heavier set)' });
    reasons.push({ ok: daysSince <= 45, text: daysSince <= 0 ? 'Latest session is today' : 'Latest session was ' + daysSince + ' day' + (daysSince === 1 ? '' : 's') + ' ago' + (daysSince <= 45 ? '' : ' — older data is less reliable') });
    if (cv != null) reasons.push({ ok: cv <= 0.07, text: 'Session-to-session variation ' + fix(cv * 100, 1) + '%' + (cv <= 0.07 ? '' : ' — fairly inconsistent') });
    if (s.n >= 3) reasons.push({ ok: s.medianAbsLogError <= 0.2, text: 'Back-test over ' + s.n + ' past sessions: typically ' + fix(s.medianAbsRepError, 1) + ' rep' + (s.medianAbsRepError === 1 ? '' : 's') + ' off, ' + Math.round(s.within1Rep * 100) + '% within ±1 rep' });
    else reasons.push({ ok: false, text: 'Too few past sessions to back-test the predictions yet' });
    reasons.push({ ok: null, text: 'Sets are not tagged with effort. Stopping short of failure makes predictions lean conservative.' });

    var level, label;
    if (sessions < 2 || sets < 3) { level = 'insufficient'; label = 'Insufficient data'; }
    else if (sessions >= 10 && s.n >= 8 && s.medianAbsLogError <= 0.12 && s.within1Rep >= 0.55 && daysSince <= 45 && (cv == null || cv <= 0.07)) { level = 'well-calibrated'; label = 'Well calibrated'; }
    else if (sessions >= 5 && sets >= 10 && daysSince <= 90 && s.n >= 3 && s.medianAbsLogError <= 0.25) { level = 'moderate'; label = 'Moderate'; }
    else { level = 'preliminary'; label = 'Preliminary'; }
    return { level: level, label: label, reasons: reasons, sessions: sessions, sets: sets, daysSinceLast: daysSince, variation: cv, backtest: s };
  }

  /* ---------- forecast ---------- */
  function forecastNextSession(history, model, opts) {
    if (!model) return null;
    var nowD = nowDay(opts);
    var us = usableSessions(history, nowD);
    var last = us[us.length - 1];
    if (!last || !last.topSet) return null;
    var recentUs = us.slice(-6), gaps = [];
    for (var i = 1; i < recentUs.length; i++) gaps.push(recentUs[i].day - recentUs[i - 1].day);
    var interval = clamp(gaps.length ? median(gaps) : 7, 2, 14);
    var tr = calculateStrengthTrend(history, 60, { now: nowD });
    var perSession = 0;
    if (tr.slopePerWeek != null && tr.nSessions >= 3) perSession = clamp(tr.slopePerWeek / model.E * interval / 7 * 0.5, -0.03, 0.03);
    var Enext = model.E * (1 + perSession);
    var fm = Object.assign({}, model, { E: Enext });
    var daysSince = nowD - last.day, notes = [];
    var scale = 1;
    if (daysSince > 21) { scale = 1.25; notes.push('It has been ' + daysSince + ' days since this lift — expect more variation after a break.'); }
    else if (daysSince < 2) notes.push('Your last session was very recent; fatigue is not recorded, so the forecast assumes normal recovery.');
    var w = last.topSet.weight;
    var at = predictRepetitions(fm, w, { sigmaScale: scale });
    var out = {
      basis: { date: last.date, weight: w, reps: last.topSet.reps, daysAgo: daysSince },
      atWeight: at, trendPerSessionPct: perSession * 100, expectedGapDays: interval, trend: tr, notes: notes,
      e1rmNext: Enext, sigmaScale: scale
    };
    out.suggestion = suggestWeightRange(fm, 8, 10, scale);
    notes.push('A forecast, not a prescription — recovery, sleep and effort are not recorded.');
    return out;
  }

  function suggestWeightRange(model, repLo, repHi, scale) {
    var a = predictWeightForReps(model, repHi, { sigmaScale: scale || 1 });
    var b = predictWeightForReps(model, repLo, { sigmaScale: scale || 1 });
    return { repLow: repLo, repHigh: repHi, weightLow: a.weight, weightHigh: b.weight };
  }

  /* ---------- prediction log (forecast vs. what really happened) ---------- */
  function createForecastRecord(history, forecast, nowISO) {
    if (!forecast || !forecast.atWeight || !forecast.atWeight.ok) return null;
    return {
      id: history.key + '|' + forecast.basis.date,
      key: history.key, name: history.name, basisDate: forecast.basis.date,
      weight: forecast.basis.weight, expected: forecast.atWeight.reps, low: forecast.atWeight.low, high: forecast.atWeight.high,
      createdAt: nowISO || new Date().toISOString(), status: 'pending'
    };
  }
  // Resolves pending records against later sessions. Returns a new array.
  function evaluateForecastLog(log, history) {
    return (log || []).map(function (rec) {
      if (rec.key !== history.key || rec.status !== 'pending') return rec;
      var bd = dayNum(rec.basisDate);
      var next = null;
      for (var i = 0; i < history.sessions.length; i++) if (history.sessions[i].day > bd && !history.sessions[i].anomalous) { next = history.sessions[i]; break; }
      if (!next) return rec;
      var out = Object.assign({}, rec);
      out.resolvedDate = next.date;
      if (next.day - bd > CFG.maxLoadGapDays) { out.status = 'not-comparable'; out.reason = 'long gap'; return out; }
      var match = null;
      for (var j = 0; j < next.sets.length; j++) if (Math.abs(next.sets[j].weight - rec.weight) <= rec.weight * 0.02) { match = next.sets[j]; break; }
      if (!match) { out.status = 'not-comparable'; out.reason = 'weight changed'; return out; }
      out.status = 'resolved'; out.actual = match.reps; out.error = match.reps - rec.expected; out.inRange = match.reps >= rec.low && match.reps <= rec.high;
      return out;
    });
  }

  /* ---------- insights ---------- */
  function generatePerformanceInsights(history, model, ctx, opts) {
    var nowD = nowDay(opts), out = [];
    var us = usableSessions(history, nowD);
    if (!model || us.length < 2) {
      out.push({ id: 'need-data', type: 'neutral', title: 'Not enough history yet', detail: 'Log this lift in at least 2 sessions to unlock trend insights.' });
      return out;
    }
    var name = history.name;
    var t30 = ctx && ctx.trends ? ctx.trends['30'] : calculateStrengthTrend(history, 30, { now: nowD });
    var t90 = ctx && ctx.trends ? ctx.trends['90'] : calculateStrengthTrend(history, 90, { now: nowD });
    var pct = function (v) { return (v > 0 ? '+' : '') + fix(v, 1) + '%'; };

    // 1. estimated strength trend
    if (t30.nSessions >= 3 || (t30.nSessions === 2 && t30.points[1].day - t30.points[0].day >= 10)) {
      if (t30.direction === 'up') out.push({ id: 'e1rm-up', type: 'positive', title: 'Estimated strength is rising', detail: 'Over the last 30 days your estimated 1RM moved ' + pct(t30.changePct) + ' (' + fix(t30.start, 1) + ' → ' + fix(t30.end, 1) + ' kg across ' + t30.nSessions + ' sessions).' });
      else if (t30.direction === 'down') out.push({ id: 'e1rm-down', type: 'caution', title: 'Estimated strength has dipped', detail: 'Over the last 30 days your estimated 1RM moved ' + pct(t30.changePct) + ' (' + t30.nSessions + ' sessions). One lighter session can cause this — check whether it is a pattern.' });
      else out.push({ id: 'e1rm-flat', type: 'neutral', title: 'Strength is holding steady', detail: 'Your estimated 1RM changed ' + pct(t30.changePct) + ' over ' + t30.nSessions + ' sessions in the last 30 days.' });
    } else if (t90.nSessions >= 3) {
      out.push({ id: 'e1rm-90', type: t90.direction === 'up' ? 'positive' : t90.direction === 'down' ? 'caution' : 'neutral', title: t90.direction === 'up' ? 'Rising over 90 days' : t90.direction === 'down' ? 'Down over 90 days' : 'Steady over 90 days', detail: 'Estimated 1RM ' + pct(t90.changePct) + ' across ' + t90.nSessions + ' sessions in the last 90 days.' });
    }

    // 2. same-weight rep progression (progressive overload without adding weight)
    var byW = {};
    us.filter(function (s) { return nowD - s.day <= 120; }).forEach(function (s) {
      if (!s.topSet) return;
      var k = Math.round(s.topWeight * 4) / 4;
      (byW[k] = byW[k] || []).push({ reps: s.topSet.reps, date: s.date });
    });
    var bestW = null;
    Object.keys(byW).forEach(function (k) {
      var arr = byW[k];
      if (arr.length >= 3 && (!bestW || +k > bestW.w)) bestW = { w: +k, arr: arr };
    });
    if (bestW) {
      var r = bestW.arr.map(function (x) { return x.reps; }), recentR = r.slice(-3), firstR = r.slice(0, Math.max(1, r.length - 3));
      var gain = median(recentR) - median(firstR.length ? firstR : [r[0]]);
      if (r.length >= 3 && r[r.length - 1] - r[0] >= 1 && gain >= 0.5) out.push({ id: 'same-weight-reps', type: 'positive', title: 'More reps at the same weight', detail: 'At ' + fix(bestW.w, 1) + ' kg your top set went ' + r.join(' → ') + ' reps over ' + r.length + ' sessions — progressive overload without adding load.' });
      else if (r.length >= 4 && r[r.length - 1] - r[0] <= -2) out.push({ id: 'same-weight-down', type: 'caution', title: 'Fewer reps at the same weight', detail: 'At ' + fix(bestW.w, 1) + ' kg your top set went ' + r.join(' → ') + ' reps. This can reflect fatigue, a lighter-effort day, or a real dip.' });
    }

    // 3. heavier loads
    var recentTop = us.filter(function (s) { return nowD - s.day <= 30; }).map(function (s) { return s.topWeight; });
    var priorTop = us.filter(function (s) { return nowD - s.day > 30 && nowD - s.day <= 120; }).map(function (s) { return s.topWeight; });
    if (recentTop.length >= 2 && priorTop.length >= 2) {
      var rt = Math.max.apply(null, recentTop), pt = Math.max.apply(null, priorTop);
      if (rt > pt * 1.02) out.push({ id: 'heavier', type: 'positive', title: 'Handling heavier loads', detail: 'Your top weight in the last 30 days (' + fix(rt, 1) + ' kg) is above the previous 30–120 days (' + fix(pt, 1) + ' kg).' + (t30.direction === 'down' ? ' Estimated 1RM did not rise with it, so reps likely fell.' : '') });
    }

    // 4. consistency
    var last6 = us.slice(-6).map(function (s) { return s.e1rm; });
    if (last6.length >= 4) {
      var mu = last6.reduce(function (a, v) { return a + v; }, 0) / last6.length;
      var cv = Math.sqrt(last6.reduce(function (a, v) { return a + (v - mu) * (v - mu); }, 0) / last6.length) / mu;
      // reps at one repeated weight can swing a lot while e1RM barely moves, so check that too
      var repCv = null, cnt = {};
      us.slice(-6).forEach(function (s) { if (s.topSet) { var k = Math.round(s.topWeight * 4) / 4; (cnt[k] = cnt[k] || []).push(s.topSet.reps); } });
      Object.keys(cnt).forEach(function (k) {
        var a = cnt[k]; if (a.length < 4) return;
        var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
        var c = Math.sqrt(a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / a.length) / m;
        if (repCv == null || c > repCv) repCv = c;
      });
      if (cv > 0.07 || (repCv != null && repCv > 0.25)) out.push({ id: 'inconsistent', type: 'caution', title: 'Performance is inconsistent', detail: repCv != null && repCv > 0.25 ? 'Your reps at the same weight vary a lot between sessions, which makes predictions less precise.' : 'Your estimated 1RM varied by about ' + fix(cv * 100, 0) + '% across the last ' + last6.length + ' sessions, which makes predictions less precise.' });
      else if (cv < 0.03 && t30.direction === 'stable') out.push({ id: 'consistent', type: 'neutral', title: 'Very consistent recently', detail: 'Your last ' + last6.length + ' sessions are within ' + fix(cv * 100, 1) + '% of each other — a plateau, or a deliberate maintenance phase.' });
    }

    // 5. data-quality notes
    var allSets = [], hi = 0;
    history.sessions.forEach(function (s) { s.sets.forEach(function (x) { allSets.push(x); if (x.reps > 12) hi++; }); });
    if (allSets.length >= 10 && hi / allSets.length > 0.4) out.push({ id: 'high-rep', type: 'neutral', title: 'Mostly high-rep sets', detail: Math.round(hi / allSets.length * 100) + '% of your logged sets are above 12 reps, where 1RM formulas are least accurate. Treat the 1RM as a rough guide.' });
    var daysSince = nowD - us[us.length - 1].day;
    if (daysSince > 30) out.push({ id: 'stale', type: 'caution', title: 'No recent data', detail: 'The last session for this lift was ' + daysSince + ' days ago, so predictions rely on older performance.' });
    if (history.excluded.anomalous) out.push({ id: 'anomaly', type: 'neutral', title: 'Unusual sessions ignored', detail: history.excluded.anomalous + ' session' + (history.excluded.anomalous === 1 ? '' : 's') + ' differed by more than 30% from neighbouring sessions and were left out of the model (likely a typo or a very different setup).' });
    return out;
  }

  /* ---------- high-level API used by the UI ---------- */
  function analyze(data, key, opts) {
    opts = opts || {};
    var nowD = nowDay(opts);
    var history = getExerciseHistory(data, key, opts);
    var bt = backtest(history);
    var model = fitModel(history, { now: nowD, backtest: bt });
    var trends = {};
    [7, 30, 90, 0].forEach(function (d) { trends[d === 0 ? 'all' : String(d)] = calculateStrengthTrend(history, d, { now: nowD }); });
    var confidence = calculatePredictionConfidence(history, model, bt, { now: nowD });
    var forecast = forecastNextSession(history, model, { now: nowD });
    var a = {
      version: VERSION, key: key, name: history.name, nowDay: nowD, history: history, model: model, backtest: bt,
      confidence: confidence, trends: trends, forecast: forecast, records: calculateRecords(history),
      curve: generateStrengthCurve(model, history), provisional: !model || model.nSessions < 5 || model.nSets < 8
    };
    a.insights = generatePerformanceInsights(history, model, a, { now: nowD });
    return a;
  }

  function askWeight(analysis, weightKg) {
    if (!analysis || !analysis.model) return { ok: false, reason: 'no-model' };
    var p = predictRepetitions(analysis.model, weightKg);
    if (!p.ok) return p;
    p.closest = findClosestPerformance(analysis.history, { weight: weightKg }, { now: analysis.nowDay });
    p.confidence = analysis.confidence;
    p.basis = explainBasis(analysis);
    return p;
  }
  function askReps(analysis, reps) {
    if (!analysis || !analysis.model) return { ok: false, reason: 'no-model' };
    var p = predictWeightForReps(analysis.model, reps);
    if (!p.ok) return p;
    p.closest = findClosestPerformance(analysis.history, { reps: reps }, { now: analysis.nowDay });
    p.confidence = analysis.confidence;
    p.basis = explainBasis(analysis);
    return p;
  }
  function explainBasis(a) {
    var m = a.model, parts = [];
    parts.push('Based on ' + m.nSets + ' working sets from ' + m.nSessions + ' session' + (m.nSessions === 1 ? '' : 's') + ', weighted toward recent training.');
    if (m.formulaOnly) parts.push('Not enough history to personalise: this is a formula-only estimate (Epley, Brzycki and Lombardi blended by rep range).');
    else if (m.personalizedShape) parts.push('The weight-to-reps curve was fitted to your own loads' + (Math.abs(Math.log(m.s)) > 0.1 ? (m.s > 1 ? ' — you tend to get more reps at lighter loads than the formulas assume.' : ' — you tend to get fewer reps at lighter loads than the formulas assume.') : ', and closely follows the standard formulas.'));
    else parts.push('Your 1RM is personalised, but the curve shape comes from the standard formulas because your logs cover few distinct weights.');
    if (m.backtestN >= 3) parts.push('Spread of the range is calibrated on ' + m.backtestN + ' back-tested sessions.' + (Math.abs(m.bias) > 0.02 ? ' A small correction for past under/over-prediction was applied.' : ''));
    return parts.join(' ');
  }

  return {
    VERSION: VERSION, CONFIG: CFG, KG_PER_LB: KG_PER_LB,
    kgToLb: kgToLb, lbToKg: lbToKg, roundToIncrement: roundToIncrement,
    calculateEpley1RM: calculateEpley1RM, calculateBrzycki1RM: calculateBrzycki1RM, calculateLombardi1RM: calculateLombardi1RM,
    blended1RM: blended1RM, blendFactor: blendFactor, blendWeights: blendWeights, repsPrior: repsPrior, intensityPrior: intensityPrior,
    buildCatalog: buildCatalog, getExerciseHistory: getExerciseHistory, defaultIdentityKey: defaultIdentityKey,
    estimateOneRepMax: estimateOneRepMax, fitModel: fitModel,
    predictRepetitions: predictRepetitions, predictWeightForReps: predictWeightForReps,
    generateStrengthCurve: generateStrengthCurve, findClosestPerformance: findClosestPerformance,
    calculateStrengthTrend: calculateStrengthTrend, calculateRecords: calculateRecords,
    backtest: backtest, calculatePredictionConfidence: calculatePredictionConfidence,
    forecastNextSession: forecastNextSession, suggestWeightRange: suggestWeightRange,
    createForecastRecord: createForecastRecord, evaluateForecastLog: evaluateForecastLog,
    generatePerformanceInsights: generatePerformanceInsights,
    analyze: analyze, askWeight: askWeight, askReps: askReps,
    _internal: { median: median, weightedMedian: weightedMedian, dayNum: dayNum, dayToDate: dayToDate, TBL_F: TBL_F, userReps: userReps, userIntensity: userIntensity, theilSen: theilSen }
  };
}));
