/* ============================================================
   Plate & Progress — WEEKLY REPORT ENGINE
   ------------------------------------------------------------
   Pure maths + rules (no DOM / IndexedDB). Browser: window.ReportWeekly,
   Node: module.exports.

   Compares ONE week (Mon-Sun) with the previous logged week(s) and turns
   it into advice grounded in hypertrophy research:

     - weekly hard sets per muscle group  (about 10-20 is the productive range)
     - frequency and per-session set load (spread sets, ~10 per muscle per session max)
     - proximity to failure               (RIR 0-3 for most sets)
     - progressive overload per lift      (double progression)
     - rep range                          (5-30 reps all grow muscle when close to failure)
     - push / pull and quad / hamstring balance
     - gradual volume ramps and deloads

   Every finding carries `why` (the science in one line) and `level`
   (Strong / Moderate / Practical) so the user can see how firm it is.

   ctx: { today, exercises, sets, splits, meta{weeklyGoal}, classify, muscleOf,
          identityKey, isRestDayName, ReportEngine? }
   opts: { which: 'this' | 'last' }   or   { weekStart: 'YYYY-MM-DD' }
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportWeekly = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];
  var LABEL = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', core: 'Core' };
  /* weekly hard-set targets [low, high]; arms/shoulders also get indirect work from pressing and rowing */
  var TARGET = { chest: [10, 20], back: [10, 20], shoulders: [8, 20], arms: [8, 20], legs: [10, 20], core: [0, 20] };
  var HARD_RIR = 3, REP_CEIL = 12, SESSION_CAP = 10;
  var PUSH = /pector|chest|delt|shoulder|tricep|serratus/, PULL = /lat|back|trap|rhomboid|bicep|forearm|levator|spine/;
  var QUAD = /quad/, POST = /hamstring|glute/;
  var SCORE = { alert: 4, warn: 3, info: 1, good: 0 };
  var STRONG = 'Strong evidence', MOD = 'Moderate evidence', PRAC = 'Practical guideline';

  /* the research behind the rules; printed at the end of the PDF */
  var SCIENCE = [
    { topic: 'Weekly sets per muscle', rule: 'About 10-20 hard sets per muscle per week; below ~10 grows less, beyond ~20 returns shrink.', level: STRONG, ref: 'Schoenfeld, Ogborn & Krieger 2017, J Sports Sci (dose-response of weekly volume)' },
    { topic: 'Training close to failure', rule: 'Most sets within 0-3 reps of failure; sets with 4+ reps left add little growth stimulus.', level: STRONG, ref: 'Refalo et al. 2023, Sports Med (proximity to failure meta-analysis)' },
    { topic: 'Frequency', rule: 'Hitting a muscle about twice a week is a convenient way to spread weekly sets; once volume is equal, frequency itself matters little.', level: MOD, ref: 'Schoenfeld, Grgic & Krieger 2016, Sports Med (frequency meta-analysis)' },
    { topic: 'Rep range', rule: 'Roughly 5-30 reps all build muscle if sets are taken close to failure; 6-12 for compounds and 10-20 for isolation are efficient.', level: STRONG, ref: 'Schoenfeld et al. 2017, J Strength Cond Res (low vs high load)' },
    { topic: 'Rest between sets', rule: 'Rest 2-3 minutes on heavy compound lifts so the next set keeps its quality (rest time is not tracked in this app).', level: MOD, ref: 'Schoenfeld et al. 2016, J Strength Cond Res (inter-set rest)' },
    { topic: 'Progressive overload', rule: 'Muscle grows when the load or reps you can handle keep rising; use double progression (add reps up to the top of the range, then add weight).', level: STRONG, ref: 'Core principle of resistance training; see ACSM position stand 2009' },
    { topic: 'Per-session volume and ramps', rule: 'About 10 hard sets per muscle per session is a practical ceiling; raise weekly volume gradually (a few sets at a time) and plan lighter weeks when performance drops.', level: PRAC, ref: 'Coaching consensus; evidence for exact numbers is limited' }
  ];

  /* ---------- helpers ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dnum(s) { var p = String(s).slice(0, 10).split('-'); return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function dstr(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function weekStart(n) { return n - ((n + 3) % 7); }
  function sum(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t; }
  function mean(a) { return a.length ? sum(a) / a.length : 0; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r0(v) { return Math.round(v); }
  function pctCh(a, b) { return b > 0 ? (a / b - 1) * 100 : null; }
  function sgn(v) { return (v > 0 ? '+' : '') + r0(v) + '%'; }
  function plural(n, w, ws) { return n + ' ' + (n === 1 ? w : (ws || w + 's')); }
  function defaultKey(name) { return String(name || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' '); }
  function defaultRest(n) { var s = String(n || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); return s === 'rest' || s === 'rest day' || s === 'restday' || s === 'break'; }
  function isWarm(s) { return String((s && s.setType) || 'working').toLowerCase() === 'warmup'; }
  function rirOf(s) { var v = s && s.rir; if (v == null || v === '') return null; v = Number(v); return isFinite(v) ? Math.max(0, Math.min(5, Math.round(v))) : null; }
  function counted(s) { var w = Number(s.weight), r = Number(s.reps); return (isFinite(w) && w > 0) || (isFinite(r) && r > 0); }
  function isWork(s) { return !isWarm(s) && counted(s); }
  function isPerf(s) { return !isWarm(s) && Number(s.weight) > 0 && Number(s.reps) > 0; }
  function isHard(s) { if (!isWork(s)) return false; var r = rirOf(s); return r === null || r <= HARD_RIR; }
  function epley(w, r) { return r <= 1 ? w : w * (1 + r / 30); }
  function F(o) { o.score = SCORE[o.severity] || 0; return o; }
  function uniq(a) { var m = {}, o = []; a.forEach(function (v) { if (!m[v]) { m[v] = 1; o.push(v); } }); return o; }
  function list(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function fnum(v) { return String(Math.round(v * 100) / 100); }
  function step(w) { return Math.max(1, Math.round(w * 0.03 / 2.5) * 2.5); }

  /* ---------- build ---------- */
  function build(ctx, opts) {
    opts = opts || {};
    var T = dnum(ctx.today), key = ctx.identityKey || defaultKey, restName = ctx.isRestDayName || defaultRest;
    var classify = ctx.classify || function () { return null; }, muscleOf = ctx.muscleOf || function () { return null; };
    var exById = {}; (ctx.exercises || []).forEach(function (e) { exById[e.id] = e; });
    var split = (ctx.splits || []).filter(function (s) { return !s.archivedAt; })[0] || null;

    var all = [];
    (ctx.sets || []).forEach(function (s) {
      if (!s || !s.date) return; var ex = exById[s.exerciseId]; if (!ex) return;
      var d = dnum(s.date); if (d !== d || d > T) return;
      all.push({ s: s, d: d, ex: ex, key: key(ex.name), group: classify(ex.name), muscle: muscleOf(ex.name) });
    });
    var work = all.filter(function (x) { return isWork(x.s); });

    var W0 = opts.weekStart ? weekStart(dnum(opts.weekStart)) : weekStart(T) - (opts.which === 'last' ? 7 : 0);
    var W1 = W0 + 6, E = Math.min(W1, T), partial = T < W1, spanDays = E - W0 + 1;
    var rep = {
      kind: 'weekly', today: ctx.today, weekStart: dstr(W0), weekEnd: dstr(W1), partial: partial, dayOfWeek: Math.min(7, T - W0 + 1),
      splitName: split ? split.name : null, findings: [], limits: [], insufficient: false
    };

    function inWeek(x) { return x.d >= W0 && x.d <= E; }
    var cur = work.filter(inWeek);
    if (!cur.length) {
      rep.insufficient = true; rep.priorities = []; rep.doList = []; rep.dontList = []; rep.going = []; rep.science = SCIENCE;
      rep.limits.push('No sets were logged in this week (' + rep.weekStart + ' to ' + rep.weekEnd + '). Log a workout, then build the weekly report again.');
      return rep;
    }

    /* ----- previous logged weeks ----- */
    var priorWeeks = [];
    for (var k = 1; k <= 12 && priorWeeks.length < 4; k++) {
      var s0 = W0 - 7 * k, s1 = s0 + 6, items = work.filter(function (x) { return x.d >= s0 && x.d <= s1; });
      if (items.length) priorWeeks.push({ start: s0, end: s1, items: items });
    }
    var base = priorWeeks[0] || null;
    var cmpEnd = base ? Math.min(base.end, base.start + spanDays - 1) : null;
    var baseCmp = base ? base.items.filter(function (x) { return x.d <= cmpEnd; }) : [];
    rep.compare = base ? {
      has: true, start: dstr(base.start), end: dstr(base.end), sameDays: partial, cmpEnd: dstr(cmpEnd),
      label: (base.start === W0 - 7 ? 'last week' : 'your previous logged week') + (partial ? ' (same days)' : ''), weeksUsed: priorWeeks.length
    } : { has: false, label: 'no earlier week', weeksUsed: 0 };

    /* ----- totals ----- */
    function sessionsOf(items) { return uniq(items.map(function (x) { return x.d; })).length; }
    function hardOf(items) { return items.filter(function (x) { return isHard(x.s); }).length; }
    function volOf(items) { return r0(sum(items.map(function (x) { return (Number(x.s.weight) || 0) * (Number(x.s.reps) || 0); }))); }
    function rirAvg(items) { var r = items.map(function (x) { return rirOf(x.s); }).filter(function (v) { return v !== null; }); return r.length ? mean(r) : null; }
    var plannedDays = split ? (split.days || []).filter(function (d) { return !restName(d.name); }) : [];
    var goal = (ctx.meta && ctx.meta.weeklyGoal) || (plannedDays.length ? Math.max(2, Math.min(7, plannedDays.length)) : 3);
    var T0 = {
      sessions: sessionsOf(cur), goal: goal, hardSets: hardOf(cur), volume: volOf(cur), avgRir: rirAvg(cur),
      rated: cur.filter(function (x) { return rirOf(x.s) !== null; }).length, sets: cur.length
    };
    var P0 = base ? { sessions: sessionsOf(baseCmp), hardSets: hardOf(baseCmp), volume: volOf(baseCmp), avgRir: rirAvg(baseCmp), fullSessions: sessionsOf(base.items), fullHard: hardOf(base.items) } : null;
    rep.totals = {
      cur: T0, prev: P0,
      d: P0 ? { hard: pctCh(T0.hardSets, P0.hardSets), volume: pctCh(T0.volume, P0.volume), sessions: T0.sessions - P0.sessions, rir: (T0.avgRir != null && P0.avgRir != null) ? r1(T0.avgRir - P0.avgRir) : null } : null
    };
    var avgPriorHard = priorWeeks.length ? mean(priorWeeks.map(function (w) { return hardOf(w.items); })) : null;
    rep.totals.avgPriorHard = avgPriorHard == null ? null : r1(avgPriorHard);

    /* ----- split days ----- */
    rep.days = [];
    if (split) {
      (split.days || []).forEach(function (d) {
        if (restName(d.name)) return;
        var mine = cur.filter(function (x) { return x.ex.dayId === d.id; });
        var pm = base ? base.items.filter(function (x) { return x.ex.dayId === d.id; }) : [];
        var dts = uniq(mine.map(function (x) { return x.d; })).sort(function (a, b) { return a - b; });
        rep.days.push({
          id: d.id, name: d.name, status: mine.length ? 'done' : (partial ? 'pending' : 'missed'), date: dts.length ? dstr(dts[0]) : null, times: dts.length,
          hardSets: hardOf(mine), prevHardSets: pm.length ? hardOf(pm) : null, volume: volOf(mine), prevVolume: pm.length ? volOf(pm) : null,
          avgRir: rirAvg(mine), prevAvgRir: pm.length ? rirAvg(pm) : null
        });
      });
      var other = cur.filter(function (x) { return !(split.days || []).some(function (d) { return d.id === x.ex.dayId; }); });
      if (other.length) rep.days.push({ id: 'other', name: 'Other sessions', status: 'done', date: null, times: sessionsOf(other), hardSets: hardOf(other), prevHardSets: null, volume: volOf(other), prevVolume: null, avgRir: rirAvg(other), prevAvgRir: null });
    }
    var missedDays = rep.days.filter(function (d) { return d.status === 'missed'; });
    var pendingDays = rep.days.filter(function (d) { return d.status === 'pending'; });

    /* ----- muscles ----- */
    var hardCur = cur.filter(function (x) { return isHard(x.s); });
    var hardCmp = baseCmp.filter(function (x) { return isHard(x.s); });
    var planned = {};
    if (split) (split.days || []).forEach(function (d) {
      if (restName(d.name)) return;
      (ctx.exercises || []).forEach(function (e) { if (e.archived || e.dayId !== d.id) return; var g = classify(e.name); if (g) (planned[g] = planned[g] || []).push({ name: e.name, day: d.name }); });
    });
    var M = {};
    GROUPS.forEach(function (g) {
      var mine = hardCur.filter(function (x) { return x.group === g; });
      var byDate = {}; mine.forEach(function (x) { byDate[x.d] = (byDate[x.d] || 0) + 1; });
      var maxDate = null, maxN = 0; Object.keys(byDate).forEach(function (dd) { if (byDate[dd] > maxN) { maxN = byDate[dd]; maxDate = +dd; } });
      var priorSets = priorWeeks.map(function (w) { return w.items.filter(function (x) { return x.group === g && isHard(x.s); }).length; });
      M[g] = {
        sets: mine.length, prev: hardCmp.filter(function (x) { return x.group === g; }).length, avg: priorSets.length ? r1(mean(priorSets)) : null,
        days: Object.keys(byDate).length, maxInSession: maxN, maxDate: maxDate == null ? null : dstr(maxDate), target: TARGET[g], planned: !!planned[g]
      };
      M[g].status = !M[g].target[0] ? 'na' : M[g].sets > M[g].target[1] ? 'high' : M[g].sets >= M[g].target[0] ? 'ok' : 'low';
    });
    rep.muscles = M;
    var fine = {};
    hardCur.forEach(function (x) { var m = x.muscle || (x.group ? LABEL[x.group].toLowerCase() : null); if (!m) return; fine[m] = fine[m] || { cur: 0, prev: 0 }; fine[m].cur++; });
    hardCmp.forEach(function (x) { var m = x.muscle || (x.group ? LABEL[x.group].toLowerCase() : null); if (!m) return; fine[m] = fine[m] || { cur: 0, prev: 0 }; fine[m].prev++; });
    rep.fine = Object.keys(fine).map(function (m) { return { muscle: m, sets: fine[m].cur, prev: fine[m].prev }; }).sort(function (a, b) { return b.sets - a.sets; }).slice(0, 10);

    var bal = { push: 0, pull: 0, quads: 0, post: 0 };
    hardCur.forEach(function (x) {
      var g = x.group, m = String(x.muscle || '').toLowerCase(); if (!g) return;
      var push = m ? PUSH.test(m) : (g === 'chest' || g === 'shoulders'), pull = m ? (PULL.test(m) && !PUSH.test(m)) : g === 'back';
      if (push) bal.push++; else if (pull) bal.pull++;
      if (g === 'legs') { if (m && QUAD.test(m)) bal.quads++; else if (m && POST.test(m)) bal.post++; }
    });
    rep.balance = bal;

    /* ----- effort + rep ranges ----- */
    var rated = cur.map(function (x) { return rirOf(x.s); }).filter(function (v) { return v !== null; });
    var dist = [0, 0, 0, 0, 0, 0]; rated.forEach(function (v) { dist[v]++; });
    rep.effort = { rated: rated.length, total: cur.length, coverage: cur.length ? rated.length / cur.length : 0, dist: dist, avg: rated.length ? mean(rated) : null, share0: rated.length ? dist[0] / rated.length : 0, share4: rated.length ? (dist[4] + dist[5]) / rated.length : 0, prevAvg: P0 ? P0.avgRir : null };
    var rb = [0, 0, 0, 0, 0]; // 1-4, 5-8, 9-12, 13-20, 21+
    hardCur.forEach(function (x) { var r = Number(x.s.reps) || 0; if (!r) return; rb[r <= 4 ? 0 : r <= 8 ? 1 : r <= 12 ? 2 : r <= 20 ? 3 : 4]++; });
    var rbTotal = sum(rb);
    rep.reps = { buckets: rb, labels: ['1-4', '5-8', '9-12', '13-20', '21+'], total: rbTotal };

    /* ----- lifts: this week's latest session vs the last session before the week ----- */
    function sessionOf(items) {
      var perf = items.filter(function (x) { return isPerf(x.s); }); if (!perf.length) return null;
      var topW = Math.max.apply(null, perf.map(function (x) { return Number(x.s.weight); }));
      var atTop = perf.filter(function (x) { return Number(x.s.weight) === topW; });
      var allRated = perf.every(function (x) { return rirOf(x.s) !== null; });
      return {
        date: dstr(perf[0].d), top: topW, reps: atTop.map(function (x) { return Number(x.s.reps); }), rirs: atTop.map(function (x) { return rirOf(x.s); }),
        sets: perf.length, hard: perf.filter(function (x) { return isHard(x.s); }).length, allRated: allRated, avgRir: rirAvg(perf),
        e1: function (useRir) { return Math.max.apply(null, perf.map(function (x) { var r = Number(x.s.reps) + (useRir ? (rirOf(x.s) || 0) : 0); return epley(Number(x.s.weight), r); })); }
      };
    }
    var byKey = {}; all.forEach(function (x) { if (isWork(x.s)) (byKey[x.key] = byKey[x.key] || []).push(x); });
    rep.lifts = [];
    Object.keys(byKey).forEach(function (kk) {
      var items = byKey[kk], wk = items.filter(inWeek).filter(function (x) { return isPerf(x.s); }); if (!wk.length) return;
      var lastD = Math.max.apply(null, wk.map(function (x) { return x.d; }));
      var nowS = sessionOf(items.filter(function (x) { return x.d === lastD; }));
      var before = items.filter(function (x) { return x.d < W0 && isPerf(x.s); });
      var prevS = null; if (before.length) { var pd = Math.max.apply(null, before.map(function (x) { return x.d; })); prevS = sessionOf(items.filter(function (x) { return x.d === pd; })); }
      if (!nowS) return;
      var useRir = !!(prevS && nowS.allRated && prevS.allRated);
      var ch = prevS ? pctCh(nowS.e1(useRir), prevS.e1(useRir)) : null;
      var verdict = !prevS ? 'new' : ch >= 1.5 ? 'up' : ch <= -3 ? 'down' : 'same';
      var avgReps = mean(nowS.reps), maxReps = Math.max.apply(null, nowS.reps), minReps = Math.min.apply(null, nowS.reps);
      var nowR = nowS.avgRir, target;
      if (nowR != null && nowR >= 3) target = { text: 'Same ' + fnum(nowS.top) + ' kg, push each set to 1-2 reps from failure (aim for ' + (maxReps + 1) + '+ reps).', kind: 'effort' };
      else if (minReps >= REP_CEIL && (nowR == null || nowR <= 2)) target = { text: 'Add weight: ' + fnum(nowS.top + step(nowS.top)) + ' kg for 8+ reps (you topped the ' + REP_CEIL + '-rep ceiling).', kind: 'weight', weight: nowS.top + step(nowS.top) };
      else target = { text: fnum(nowS.top) + ' kg: add 1 rep to your weakest set (beat ' + nowS.reps.join('/') + '), then add weight at ' + REP_CEIL + ' reps on every set.', kind: 'reps' };
      var ex0 = items[0].ex;
      rep.lifts.push({ key: kk, name: ex0.name, group: items[0].group, now: { date: nowS.date, top: nowS.top, reps: nowS.reps, rirs: nowS.rirs, sets: nowS.sets, hard: nowS.hard, avgRir: nowS.avgRir }, prev: prevS ? { date: prevS.date, top: prevS.top, reps: prevS.reps, rirs: prevS.rirs, sets: prevS.sets, hard: prevS.hard, avgRir: prevS.avgRir } : null, e1rmNow: r1(nowS.e1(useRir)), e1rmPrev: prevS ? r1(prevS.e1(useRir)) : null, change: ch, effortAdjusted: useRir, verdict: verdict, target: target, hardWeek: wk.filter(function (x) { return isHard(x.s); }).length });
    });
    rep.lifts.sort(function (a, b) { return b.hardWeek - a.hardWeek; });
    rep.lifts = rep.lifts.slice(0, 10);

    /* ----- records inside the week ----- */
    rep.records = [];
    try { var RE = ctx.ReportEngine || (typeof ReportEngine !== 'undefined' ? ReportEngine : null); if (RE && RE.records) rep.records = RE.records(ctx, 400).filter(function (r) { var n = dnum(r.date); return n >= W0 && n <= E; }); } catch (e) { rep.records = []; }

    /* ============ FINDINGS ============ */
    var f = rep.findings;
    // consistency
    var upCount = rep.lifts.filter(function (l) { return l.verdict === 'up'; }).length, downLifts = rep.lifts.filter(function (l) { return l.verdict === 'down'; }), sameLifts = rep.lifts.filter(function (l) { return l.verdict === 'same'; });
    var compared = rep.lifts.filter(function (l) { return l.prev; }).length;
    if (!partial && T0.sessions >= goal) f.push(F({ id: 'w-sessions-good', area: 'consistency', severity: 'good', title: 'Hit all ' + goal + ' planned sessions', evidence: T0.sessions + ' of ' + goal + ' sessions logged this week.' }));
    else if (!partial) {
      var lost = missedDays.map(function (d) { return d.name + (d.prevHardSets ? ' (about ' + d.prevHardSets + ' hard sets last time)' : ''); });
      var lostG = uniq([].concat.apply([], missedDays.map(function (d) { return (split.days || []).filter(function (x) { return x.id === d.id; }).length ? (ctx.exercises || []).filter(function (e) { return !e.archived && e.dayId === d.id; }).map(function (e) { return classify(e.name); }).filter(Boolean) : []; }))).map(function (g) { return LABEL[g]; });
      f.push(F({ id: 'w-sessions-low', area: 'consistency', severity: 'warn', title: 'Missed ' + (goal - T0.sessions) + ' of ' + goal + ' planned sessions', evidence: T0.sessions + ' of ' + goal + ' sessions logged' + (lost.length ? '. Not logged: ' + list(lost) : '') + (lostG.length ? '. That removes weekly sets from ' + list(lostG) + '.' : '.'),
        action: 'Do the missed ' + (missedDays[0] ? missedDays[0].name : 'session') + ' within the next 2-3 days instead of doubling up later; weekly sets per muscle, not any single workout, drive growth.', dont: 'Do not cram two missed days into one marathon session; set quality drops after about 10 hard sets per muscle.',
        why: 'Muscle growth tracks the number of hard sets a muscle gets per week, so skipped sessions remove stimulus directly.', level: STRONG }));
    } else if (T0.sessions >= goal) f.push(F({ id: 'w-sessions-good', area: 'consistency', severity: 'good', title: 'Weekly session goal already reached', evidence: T0.sessions + ' of ' + goal + ' sessions with ' + (7 - rep.dayOfWeek) + ' days still to go.' }));
    else f.push(F({ id: 'w-sessions-prog', area: 'consistency', severity: 'info', title: T0.sessions + ' of ' + goal + ' sessions done so far', evidence: 'Day ' + rep.dayOfWeek + ' of 7' + (pendingDays.length ? '. Still planned: ' + list(pendingDays.map(function (d) { return d.name; })) + '.' : '.') }));

    // volume per muscle
    var okG = [];
    GROUPS.forEach(function (g) {
      var m = M[g], lo = m.target[0], hi = m.target[1]; if (!lo) return;
      if (!m.sets && !m.planned && !(m.avg >= 2)) return;
      var ex = (planned[g] || [])[0], exName = ex ? ex.name : null;
      var movedFromAvg = m.avg != null ? ' Your previous weeks averaged ' + m.avg + '.' : '';
      if (m.status === 'high') f.push(F({ id: 'w-vol-high-' + g, area: 'volume', severity: 'info', title: LABEL[g] + ': ' + m.sets + ' hard sets is above the useful range', evidence: m.sets + ' hard sets ' + LABEL[g].toLowerCase() + ' this week (target ' + lo + '-' + hi + ').' + movedFromAvg, action: 'Trim ' + LABEL[g].toLowerCase() + ' to about ' + (hi - 2) + ' hard sets next week and put the effort into taking the rest closer to failure.', dont: 'Do not add more ' + LABEL[g].toLowerCase() + ' sets when you are already past ' + hi + '; the extra sets add fatigue faster than growth.', why: 'Growth per set falls off sharply past roughly 20 weekly sets while recovery cost keeps rising.', level: STRONG }));
      else if (m.status === 'low') {
        var add = Math.min(4, Math.max(2, lo - m.sets)), sev = (!partial && (m.sets === 0 || m.sets < lo * 0.6)) ? (m.sets === 0 && m.planned ? 'alert' : 'warn') : (partial ? 'info' : 'warn');
        f.push(F({ id: 'w-vol-low-' + g, area: 'volume', severity: sev, title: LABEL[g] + ': ' + m.sets + ' hard sets' + (partial ? ' so far' : ' is below the growth range'), evidence: m.sets + ' hard sets ' + LABEL[g].toLowerCase() + ' ' + (partial ? 'so far this week' : 'this week') + ' (target ' + lo + '-' + hi + ').' + movedFromAvg + (partial ? ' The week is not over, so this may still land in range.' : ''),
          action: partial ? 'Check that your remaining sessions give ' + LABEL[g].toLowerCase() + ' about ' + (lo - m.sets) + ' more hard sets.' : 'Add ' + add + ' hard sets of ' + LABEL[g].toLowerCase() + ' next week' + (exName ? ' (for example more ' + exName + ')' : '') + ', then re-check.', dont: partial ? null : 'Do not jump straight to ' + hi + ' sets; add 2-4 sets a week and keep the reps close to failure.',
          why: 'Below about 10 weekly hard sets a muscle still grows, but noticeably less than at 10-20.', level: STRONG }));
      } else okG.push(LABEL[g] + ' ' + m.sets);
    });
    if (okG.length) f.push(F({ id: 'w-vol-good', area: 'volume', severity: 'good', title: 'Weekly volume in the growth range for ' + okG.length + ' muscle group' + (okG.length === 1 ? '' : 's'), evidence: okG.join(', ') + ' hard sets (target 8-20).' }));

    // per-session cap and frequency
    GROUPS.forEach(function (g) {
      var m = M[g]; if (!m.target[0]) return;
      if (m.maxInSession > SESSION_CAP) f.push(F({ id: 'w-cap-' + g, area: 'sessions', severity: 'info', title: LABEL[g] + ': ' + m.maxInSession + ' hard sets in one session', evidence: m.maxInSession + ' hard sets for ' + LABEL[g].toLowerCase() + ' on ' + m.maxDate + ' (practical limit is about ' + SESSION_CAP + ' per session).', action: 'Move ' + (m.maxInSession - 8) + '-' + (m.maxInSession - 6) + ' of those sets to another day this week.', dont: 'Do not stack more than ' + SESSION_CAP + ' sets for one muscle in a single session.', why: 'Later sets in a very long session are done more fatigued, so each one is worth less; splitting volume keeps every set hard.', level: PRAC }));
      else if (!partial && m.sets >= 8 && m.days === 1) f.push(F({ id: 'w-freq-' + g, area: 'sessions', severity: 'info', title: LABEL[g] + ' trained on only one day', evidence: m.sets + ' hard sets ' + LABEL[g].toLowerCase() + ', all in one session.', action: 'Split ' + LABEL[g].toLowerCase() + ' across two days next week (for example ' + Math.ceil(m.sets / 2) + ' sets each).', why: 'Twice-a-week training lets you spread the same weekly sets over two fresher sessions; it matters mainly through that.', level: MOD }));
    });

    // balance
    if (bal.push + bal.pull >= 12) {
      var pp = bal.push / Math.max(1, bal.pull);
      if (pp > 1.5) f.push(F({ id: 'w-push-pull', area: 'balance', severity: 'warn', title: 'Pushing outweighs pulling: ' + bal.push + ' vs ' + bal.pull + ' hard sets', evidence: 'Push:pull is ' + r1(pp) + ' to 1 this week (about 1:1 to 1:1.5 pull-leaning is a practical aim).', action: 'Add ' + Math.min(6, Math.ceil(bal.push / 1.2 - bal.pull)) + ' sets of rows, pull-downs or rear-delt work next week.', dont: 'Do not add more pressing until pulling catches up.', why: 'Matching pulling to pressing supports shoulder health and a balanced back; the exact ratio is a coaching rule rather than a studied one.', level: PRAC }));
      else if (pp < 0.6) f.push(F({ id: 'w-pull-push', area: 'balance', severity: 'info', title: 'Pulling outweighs pushing: ' + bal.pull + ' vs ' + bal.push + ' hard sets', evidence: 'Push:pull is ' + r1(pp) + ' to 1 this week.', action: 'Add 3-4 sets of chest or shoulder pressing next week.', why: 'Balanced weekly sets keep every muscle inside its growth range.', level: PRAC }));
      else f.push(F({ id: 'w-push-pull-good', area: 'balance', severity: 'good', title: 'Push and pull are balanced', evidence: bal.push + ' push and ' + bal.pull + ' pull hard sets (' + r1(pp) + ':1).' }));
    }
    if (bal.quads + bal.post >= 6) {
      var qp = bal.quads / Math.max(1, bal.post);
      if (qp > 2) f.push(F({ id: 'w-quad-dom', area: 'balance', severity: 'info', title: 'Quads over hamstrings: ' + bal.quads + ' vs ' + bal.post + ' hard sets', evidence: 'Quad:hamstring/glute is ' + r1(qp) + ' to 1.', action: 'Add 3-4 sets of hamstring or hip-hinge work (Romanian deadlift, leg curl).', why: 'Hamstrings and glutes are separate muscles with their own volume needs; squat-type lifts do little for the hamstring.', level: PRAC }));
      else if (qp < 0.5) f.push(F({ id: 'w-post-dom', area: 'balance', severity: 'info', title: 'Hamstrings over quads: ' + bal.post + ' vs ' + bal.quads + ' hard sets', evidence: 'Hamstring/glute:quad is ' + r1(1 / qp) + ' to 1.', action: 'Add 3-4 sets of squats, leg press or leg extensions.', why: 'Quads need their own weekly volume to stay in the growth range.', level: PRAC }));
    }

    // effort
    var ef = rep.effort;
    if (ef.coverage < 0.5) f.push(F({ id: 'w-rir-cov', area: 'effort', severity: 'info', title: 'Log RIR on more sets', evidence: ef.rated + ' of ' + ef.total + ' sets have an RIR value, so effort cannot be judged properly.', action: 'Tap an RIR chip on your top sets of every lift next week; a quick guess is enough.', why: 'Effort (how close each set gets to failure) is the main thing a weight-and-reps log cannot show.', level: STRONG }));
    else {
      var pv = ef.prevAvg != null ? ' Previous week averaged ' + r1(ef.prevAvg) + '.' : '';
      if (ef.rated >= 8 && ef.share0 >= 0.6) f.push(F({ id: 'w-rir-grind', area: 'effort', severity: 'warn', title: 'Most sets taken to failure (' + r0(ef.share0 * 100) + '% at RIR 0)', evidence: 'Average RIR ' + r1(ef.avg) + ' across ' + ef.rated + ' rated sets.' + pv, action: 'Stop compound lifts at RIR 1-2 and keep true failure for the last set of isolation moves.', dont: 'Do not grind every set to failure; it adds fatigue that cuts reps and sets in the next session.', why: 'Going to failure is not clearly better than stopping 1-2 reps short for growth, but it costs more recovery.', level: STRONG }));
      else if (ef.avg >= 3.5) f.push(F({ id: 'w-rir-easy', area: 'effort', severity: 'warn', title: 'Sets look too easy (average RIR ' + r1(ef.avg) + ')', evidence: r0(ef.share4 * 100) + '% of rated sets had 4+ reps left.' + pv, action: 'Add weight or reps until most working sets finish with 0-3 reps left, with the last set of each exercise at 0-1.', dont: 'Do not stop sets with 4 or more reps in the tank; they barely count as hard sets.', why: 'Growth stimulus comes mostly from the last few reps before failure; sets stopped far from it add little.', level: STRONG }));
      else if (ef.avg >= 0.8) f.push(F({ id: 'w-rir-good', area: 'effort', severity: 'good', title: 'Effort is in the growth zone (average RIR ' + r1(ef.avg) + ')', evidence: 'Most sets finished 0-3 reps from failure.' + pv }));
    }

    // rep ranges
    if (rbTotal >= 10) {
      var low = rb[0] / rbTotal, high = rb[4] / rbTotal;
      if (low > 0.4) f.push(F({ id: 'w-rep-low', area: 'reps', severity: 'info', title: r0(low * 100) + '% of hard sets were 1-4 reps', evidence: rb[0] + ' of ' + rbTotal + ' hard sets were singles to fours.', action: 'Do most sets for 6-12 reps (compounds) and 10-20 reps (isolation); keep heavy sets for your first lift of the day.', why: 'Heavy low-rep sets build strength well, but they give less muscle growth per unit of fatigue than moderate reps.', level: STRONG }));
      else if (high > 0.4) f.push(F({ id: 'w-rep-high', area: 'reps', severity: 'info', title: r0(high * 100) + '% of hard sets were 21+ reps', evidence: rb[4] + ' of ' + rbTotal + ' hard sets were 21 reps or more.', action: 'Raise the weight on compounds so sets land at 6-15 reps; save 20+ reps for isolation moves.', why: 'High-rep sets grow muscle if close to failure, but they are slow and often stop from discomfort or breathing before the muscle is worked.', level: MOD }));
      else if ((rb[1] + rb[2] + rb[3]) / rbTotal >= 0.8) f.push(F({ id: 'w-rep-good', area: 'reps', severity: 'good', title: 'Rep ranges are in the efficient zone', evidence: r0((rb[1] + rb[2] + rb[3]) / rbTotal * 100) + '% of hard sets were 5-20 reps.' }));
    }

    // progressive overload
    if (compared) {
      if (upCount >= Math.ceil(compared / 2)) f.push(F({ id: 'w-lifts-good', area: 'progress', severity: 'good', title: 'Progress on ' + upCount + ' of ' + compared + ' lifts', evidence: rep.lifts.filter(function (l) { return l.verdict === 'up'; }).map(function (l) { return l.name + ' ' + sgn(l.change); }).slice(0, 6).join(', ') + ' (estimated 1RM vs the previous session).' }));
      if (downLifts.length) {
        var names = downLifts.map(function (l) { return l.name + ' ' + sgn(l.change); });
        var many = downLifts.length >= 3;
        f.push(F({ id: 'w-lifts-down', area: 'progress', severity: many ? 'warn' : 'info', title: downLifts.length + ' lift' + (downLifts.length === 1 ? '' : 's') + ' dropped vs the previous session', evidence: names.slice(0, 6).join(', ') + '.' + (many ? ' Several lifts falling together points to fatigue or recovery rather than one bad day.' : ' One lighter session is not a trend.'),
          action: many ? 'Take an easier week: keep the weights but do about half the sets, then resume.' : 'Repeat the same weights next session and aim to match them before adding load; check sleep and food on the day.', dont: 'Do not chase the old numbers by going to failure on every set.', why: 'Performance falling across lifts is the clearest sign of accumulated fatigue; a short lighter week lets it clear without losing muscle.', level: many ? PRAC : MOD }));
      }
      var stuck = sameLifts.filter(function (l) { return l.now.avgRir != null && l.now.avgRir >= 2.5; });
      if (stuck.length) f.push(F({ id: 'w-lifts-easy', area: 'progress', severity: 'info', title: 'Flat lifts with reps to spare: ' + list(stuck.map(function (l) { return l.name; }).slice(0, 4)), evidence: 'These lifts held the same performance but finished about ' + r1(mean(stuck.map(function (l) { return l.now.avgRir; }))) + ' reps from failure on average.', action: 'Add 1-2 reps or the smallest plate next session on ' + list(stuck.map(function (l) { return l.name; }).slice(0, 3)) + '.', why: 'Overload is only real when sets are close to failure; easy sets at the same weight do not drive new adaptation.', level: STRONG }));
    } else if (!base) f.push(F({ id: 'w-first', area: 'progress', severity: 'info', title: 'First logged week: comparisons begin next week', evidence: 'There is no earlier week to compare with yet, so lift changes are skipped.' }));

    // volume change and deload
    if (P0 && P0.hardSets >= 10 && T0.hardSets > 0) {
      var vc = pctCh(T0.hardSets, P0.hardSets);
      if (vc > 30) f.push(F({ id: 'w-vol-spike', area: 'volume', severity: 'warn', title: 'Hard sets jumped ' + sgn(vc) + ' vs ' + rep.compare.label, evidence: T0.hardSets + ' hard sets vs ' + P0.hardSets + '.', action: 'Ramp by 2-4 sets per muscle a week rather than a big jump; hold this week\'s volume next week.', dont: 'Do not raise sets and intensity in the same week.', why: 'Large volume jumps outpace recovery; gradual ramps let the body adapt.', level: PRAC }));
      else if (vc < -30 && !partial) f.push(F({ id: 'w-vol-dip', area: 'volume', severity: 'info', title: 'Hard sets fell ' + sgn(vc) + ' vs ' + rep.compare.label, evidence: T0.hardSets + ' hard sets vs ' + P0.hardSets + '.', action: 'If this was not a planned easy week, return to last week\'s set counts next week.', why: 'Less weekly volume for more than a week or two reduces growth stimulus.', level: STRONG }));
    }
    if (downLifts.length >= 2 && ((ef.avg != null && ef.avg < 1) || (P0 && pctCh(T0.hardSets, P0.hardSets) > 20))) f.push(F({ id: 'w-deload', area: 'recovery', severity: 'warn', title: 'Signs you need a lighter week', evidence: downLifts.length + ' lifts dropped' + (ef.avg != null && ef.avg < 1 ? ' while sets averaged RIR ' + r1(ef.avg) : ' after a jump in volume') + '.', action: 'Next week: keep the weights, do about 50% of the sets and stay 3+ reps from failure, then return to normal.', dont: 'Do not take the week fully off unless you are sick or sore in the joints; light training keeps momentum.', why: 'A brief lighter week after hard training clears fatigue; evidence for exact numbers is limited, but the pattern of falling lifts plus high effort is a standard trigger.', level: PRAC }));

    if (rep.records.length) f.push(F({ id: 'w-records', area: 'progress', severity: 'good', title: plural(rep.records.length, 'personal record') + ' this week', evidence: rep.records.slice(0, 5).map(function (r) { return r.name + ' (' + r.label + ')'; }).join(', ') + '.' }));

    f.sort(function (a, b) { return b.score - a.score; });

    /* ----- priorities, lists ----- */
    var cand = f.filter(function (x) { return x.severity !== 'good' && x.action && x.severity !== 'info' }).concat(f.filter(function (x) { return x.severity === 'info' && x.action; }));
    var pri = [], areas = {};
    cand.forEach(function (x) { if (pri.length < 3 && !areas[x.area]) { areas[x.area] = 1; pri.push(x); } });
    cand.forEach(function (x) { if (pri.length < 3 && pri.indexOf(x) < 0) pri.push(x); });
    rep.priorities = pri.map(function (x) { return { id: x.id, area: x.area, title: x.title, action: x.action, why: x.why, level: x.level, evidence: x.evidence, check: checkFor(x, partial) }; });
    rep.doList = uniq(f.filter(function (x) { return x.severity !== 'good' && x.action; }).map(function (x) { return x.action; })).slice(0, 10);
    rep.dontList = uniq(f.filter(function (x) { return x.dont; }).map(function (x) { return x.dont; })).slice(0, 8);
    rep.going = f.filter(function (x) { return x.severity === 'good'; }).map(function (x) { return { title: x.title, evidence: x.evidence }; });

    /* ----- checks (summary chips) ----- */
    var inRange = GROUPS.filter(function (g) { return M[g].target[0] && M[g].status === 'ok'; }).length, tracked = GROUPS.filter(function (g) { return M[g].target[0] && (M[g].sets || M[g].planned); }).length;
    rep.checks = [
      { label: 'Consistency', ok: T0.sessions >= goal, note: T0.sessions + '/' + goal + ' sessions' },
      { label: 'Volume', ok: tracked ? inRange / tracked >= 0.6 : false, note: inRange + '/' + tracked + ' muscles in range' },
      { label: 'Progress', ok: compared ? upCount >= downLifts.length && upCount > 0 : null, note: compared ? upCount + ' up, ' + downLifts.length + ' down' : 'no baseline' },
      { label: 'Effort', ok: ef.coverage >= 0.5 && ef.avg != null ? (ef.avg >= 0.8 && ef.avg < 3.5 && ef.share0 < 0.6) : null, note: ef.avg != null ? 'avg RIR ' + r1(ef.avg) : 'RIR not logged' }
    ];
    var okN = rep.checks.filter(function (c) { return c.ok === true; }).length, known = rep.checks.filter(function (c) { return c.ok !== null; }).length;
    rep.headline = partial ? 'Week in progress' : (known && okN / known >= 0.85 ? 'Strong week' : known && okN / known >= 0.6 ? 'Solid week' : known && okN / known >= 0.4 ? 'Mixed week' : 'Rough week');
    rep.checksPassed = okN; rep.checksKnown = known;

    /* ----- next week plan ----- */
    var allUp = function (g) { var ls = rep.lifts.filter(function (l) { return l.group === g && l.prev; }); return ls.length && ls.every(function (l) { return l.verdict === 'up'; }); };
    rep.plan = { muscles: [], lifts: rep.lifts.filter(function (l) { return l.target; }).slice(0, 8).map(function (l) { return { name: l.name, text: l.target.text }; }) };
    GROUPS.forEach(function (g) {
      var m = M[g], lo = m.target[0], hi = m.target[1]; if (!lo || (!m.sets && !m.planned)) return;
      var tgt, why;
      if (partial) { var base0 = m.avg != null ? Math.round(m.avg) : m.sets; tgt = Math.max(lo, Math.min(hi, base0)); why = 'keep to range'; }
      else if (m.sets > hi) { tgt = hi - 2; why = 'trim'; }
      else if (m.sets < lo) { tgt = Math.min(lo, m.sets + 3); why = 'build up'; }
      else if (allUp(g) && m.sets <= hi - 2 && (ef.avg == null || ef.avg >= 0.8)) { tgt = m.sets + 2; why = 'room to add'; }
      else { tgt = m.sets; why = 'hold'; }
      rep.plan.muscles.push({ group: g, label: LABEL[g], now: m.sets, target: tgt, note: why });
    });

    rep.science = SCIENCE;
    rep.limits = [
      'Hard sets are working sets taken to RIR 0-3, or with no RIR logged. Warm-ups never count.',
      'Weekly set targets (about 10-20 per muscle) are population averages from research; some people need less or more, so use your own progress to adjust.',
      'Muscle groups come from the exercise database or your manual overrides. Indirect work (for example triceps during pressing) is not credited.',
      'Rest time, sleep, food and stress are not recorded, so recovery advice is based only on your sets, reps and RIR.',
      'This describes your logged training. It is not medical advice.'
    ];
    return rep;
  }

  function checkFor(x, partial) {
    var id = x.id;
    if (partial && /^w-vol-low-/.test(id)) return 'Reach ' + M_lo(x) + '+ hard sets for this muscle by Sunday.';
    if (partial && /^w-sessions-prog$/.test(id)) return 'Log your remaining planned sessions by Sunday.';
    if (/^w-vol-low-/.test(id)) return 'Log ' + (M_lo(x)) + '+ hard sets for this muscle next week.';
    if (/^w-vol-high-/.test(id)) return 'Finish next week at or under 18 hard sets for this muscle.';
    if (id === 'w-sessions-low') return 'Log the missed session in the next 3 days.';
    if (/^w-cap-/.test(id)) return 'No single session above ' + SESSION_CAP + ' hard sets for this muscle.';
    if (/^w-freq-/.test(id)) return 'Train this muscle on two different days next week.';
    if (id === 'w-push-pull') return 'Get pull sets within 1.5x of push sets next week.';
    if (id === 'w-rir-grind') return 'Fewer than half of rated sets at RIR 0 next week.';
    if (id === 'w-rir-easy') return 'Average RIR between 1 and 3 next week.';
    if (id === 'w-rir-cov') return 'Log RIR on at least half of your sets next week.';
    if (id === 'w-lifts-down' || id === 'w-deload') return 'Next week\'s top sets match or beat this week\'s.';
    if (id === 'w-lifts-easy') return 'Add a rep or the smallest plate on those lifts next session.';
    if (id === 'w-vol-spike') return 'Next week\'s hard sets within 10% of this week.';
    return 'Re-run the weekly report next week and compare.';
  }
  function M_lo(x) { var m = /^w-vol-low-(.+)$/.exec(x.id); return m && TARGET[m[1]] ? TARGET[m[1]][0] : 10; }

  return { build: build, SCIENCE: SCIENCE, TARGET: TARGET, LABEL: LABEL, GROUPS: GROUPS };
}));
