/* ============================================================
   Plate & Progress — REPORT / ADVICE ENGINE
   ------------------------------------------------------------
   Pure maths + rules. No DOM, no IndexedDB. Runs in the browser
   (window.ReportEngine) and in Node (module.exports) for tests.

   It reads the same data every graph in the app is drawn from and
   turns it into plain advice:  what is going well, what to do,
   what NOT to do, and three priorities each with a check you can pass.

   Everything is rule based and transparent. Every finding carries
   its own evidence (the numbers it was based on). Nothing here is
   medical advice; it only describes your logged training.

   Input (ctx):
     today        'YYYY-MM-DD'
     exercises, sets, splits           the app's DB arrays
     meta         { weeklyGoal? }
     classify(name)   -> chest|back|shoulders|arms|legs|core|null
     muscleOf(name)   -> finer primary muscle ('lats', 'quadriceps'...) or null
     identityKey(name)-> pooling key (same exercise on several days)
     isRestDayName(n) -> bool
     SI               optional StrengthIntelligence module
     forecastLog      optional [{status, inRange}] from the SI forecast log
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];
  var LABEL = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', core: 'Core' };
  var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var SCORE = { alert: 4, warn: 3, info: 1, good: 0 };
  var HARD_RIR = 3;

  /* ---------- tiny helpers ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dnum(s) { var p = String(s).slice(0, 10).split('-'); return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function dstr(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function weekStart(n) { return n - ((n + 3) % 7); }          // Monday-start (1970-01-01 was a Thursday)
  function weekdayIdx(n) { return (n + 3) % 7; }                // Mon = 0
  function sum(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t; }
  function mean(a) { return a.length ? sum(a) / a.length : 0; }
  function median(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); var m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r0(v) { return Math.round(v); }
  function pct(a, b) { return b > 0 ? (a / b - 1) * 100 : null; }
  function plural(n, w, ws) { return n + ' ' + (n === 1 ? w : (ws || w + 's')); }
  function chTxt(v) { return v == null ? 'n/a' : (Math.abs(v) < 0.5 ? 'flat (0%)' : signed(v) + '%'); }
  function signed(v, d) { var x = d == null ? r1(v) : v.toFixed(d); return (v > 0 ? '+' : '') + x; }
  function defaultKey(name) { return String(name || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' '); }
  function defaultRest(n) { var s = String(n || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); return s === 'rest' || s === 'rest day' || s === 'restday' || s === 'break'; }

  /* ---------- set classification ---------- */
  function isWarm(s) { return String((s && s.setType) || 'working').toLowerCase() === 'warmup'; }
  function rirOf(s) {
    if (!s || s.rir === null || s.rir === undefined || s.rir === '') return null;
    var v = Number(s.rir); return isFinite(v) && v >= 0 ? Math.min(5, Math.round(v)) : null;
  }
  function counted(s) { var w = Number(s.weight), r = Number(s.reps); return (isFinite(w) && w > 0) || (isFinite(r) && r > 0); }
  function isWork(s) { return !isWarm(s) && counted(s); }
  function isPerf(s) { return !isWarm(s) && Number(s.weight) > 0 && Number(s.reps) > 0; }
  function isHard(s) { if (!isWork(s)) return false; var r = rirOf(s); return r === null || r <= HARD_RIR; }
  function epley(w, r) { return r <= 1 ? w : w * (1 + r / 30); }

  function F(o) { o.score = (SCORE[o.severity] || 0); return o; }

  /* ============================================================
     MAIN
     ============================================================ */
  function build(ctx) {
    var T = dnum(ctx.today);
    var key = ctx.identityKey || defaultKey;
    var restName = ctx.isRestDayName || defaultRest;
    var classify = ctx.classify || function () { return null; };
    var muscleOf = ctx.muscleOf || function () { return null; };
    var exById = {}; (ctx.exercises || []).forEach(function (e) { exById[e.id] = e; });
    var split = (ctx.splits || []).filter(function (s) { return !s.archivedAt; })[0] || null;

    // enrich sets once
    var all = [];
    (ctx.sets || []).forEach(function (s) {
      if (!s || !s.date) return;
      var ex = exById[s.exerciseId]; if (!ex) return;
      var d = dnum(s.date); if (d !== d || d > T) return;
      all.push({ s: s, d: d, ex: ex, key: key(ex.name), group: classify(ex.name), muscle: muscleOf(ex.name) });
    });
    var work = all.filter(function (x) { return isWork(x.s); });
    var perf = all.filter(function (x) { return isPerf(x.s); });

    var dates = uniq(work.map(function (x) { return x.d; })).sort(function (a, b) { return a - b; });
    var rep = {
      today: ctx.today, generatedOn: ctx.today, splitName: split ? split.name : null,
      insufficient: work.length < 2, limited: dates.length < 3, findings: [], limits: []
    };
    rep.snapshot = snapshot(work, perf, dates, T, key);
    rep.records = records(perf, T, 12);
    if (rep.insufficient) {
      rep.priorities = []; rep.doList = []; rep.dontList = []; rep.going = []; rep.graphs = [];
      rep.limits.push('Only ' + plural(work.length, 'working set') + ' logged so far. Log a couple of sets and the report unlocks; a few weeks of data makes it far sharper.');
      return rep;
    }

    var C = consistency(work, dates, T, split, ctx, restName);
    var B = balance(work, T, split, exById, classify, muscleOf, restName);
    var E = effort(work, T);
    var W = weekly(work, perf, dates, T, C.goal);
    var D = days(work, T, split, restName);
    var L = lifts(perf, T, key, ctx, C);
    var S = siHealth(L, ctx);

    rep.consistency = C.data; rep.balance = B.data; rep.effort = E.data; rep.weekly = W.data; rep.dayCoverage = D.data; rep.lifts = L.data;
    rep.findings = [].concat(C.f, B.f, E.f, W.f, D.f, L.f, S.f);

    // deload suggestion needs signals from several places
    var deload = deloadFinding(C, W, L);
    if (deload) rep.findings.push(deload);

    rep.findings.forEach(addScience);
    rep.findings.sort(function (a, b) { return b.score - a.score; });
    rep.priorities = pickPriorities(rep.findings);
    rep.doList = uniqStr(rep.findings.filter(function (f) { return f.severity !== 'good' && f.action; }).map(function (f) { return f.action; })).slice(0, 10);
    rep.dontList = uniqStr(rep.findings.filter(function (f) { return f.dont; }).map(function (f) { return f.dont; })).slice(0, 8);
    rep.going = rep.findings.filter(function (f) { return f.severity === 'good'; }).map(function (f) { return { title: f.title, evidence: f.evidence }; });
    rep.graphs = graphReadings(rep, C, B, E, W, D, L, S);
    rep.limits = [
      'Hard sets are working sets taken to RIR 0-3, or with no RIR logged. Warm-ups never count.',
      'Muscle groups come from the exercise database or your manual overrides; left/right differences and small muscles are not visible.',
      'Food, sleep, stress and injuries are not recorded, so when a lift stalls these can only be flagged as possible causes.',
      'This describes your logged training. It is not medical advice.'
    ];
    return rep;
  }

  function uniq(a) { var m = {}, o = []; a.forEach(function (v) { if (!m[v]) { m[v] = 1; o.push(v); } }); return o; }
  function uniqStr(a) { return uniq(a); }

  /* ---------- snapshot ---------- */
  function snapshot(work, perf, dates, T, key) {
    var first = dates[0], last = dates[dates.length - 1];
    var inWin = function (x, a, b) { return x.d >= a && x.d <= b; };
    var vol = function (arr) { return sum(arr.map(function (x) { return Number(x.s.weight) * Number(x.s.reps); })); };
    var a = perf.filter(function (x) { return inWin(x, T - 27, T); }), b = perf.filter(function (x) { return inWin(x, T - 55, T - 28); });
    var sa = dates.filter(function (d) { return d >= T - 27; }).length, sb = dates.filter(function (d) { return d >= T - 55 && d <= T - 28; }).length;
    return {
      sessions: dates.length, firstDate: dstr(first), lastDate: dstr(last), daysSinceLast: T - last,
      weeksSpan: Math.max(1, Math.round((T - first + 1) / 7)),
      totalVolume: Math.round(vol(perf)),
      last28: { sessions: sa, volume: Math.round(vol(a)), hardSets: work.filter(function (x) { return inWin(x, T - 27, T) && isHard(x.s); }).length },
      prev28: { sessions: sb, volume: Math.round(vol(b)), hardSets: work.filter(function (x) { return inWin(x, T - 55, T - 28) && isHard(x.s); }).length },
      volumeChangePct: pct(vol(a), vol(b))
    };
  }

  /* ---------- records (also used by the Home screen) ---------- */
  function records(perf, T, limit) {
    var byKey = {};
    perf.forEach(function (x) { (byKey[x.key] = byKey[x.key] || { name: x.ex.name, dates: {} }); (byKey[x.key].dates[x.d] = byKey[x.key].dates[x.d] || []).push(x.s); });
    var out = [];
    Object.keys(byKey).forEach(function (k) {
      var L = byKey[k], ds = Object.keys(L.dates).map(Number).sort(function (a, b) { return a - b; });
      var bestE = 0, bestW = 0, seen = 0;
      ds.forEach(function (d) {
        var ss = L.dates[d].filter(function (s) { return !isWarm(s); });
        var topE = 0, topSet = null, topW = 0, topWSet = null;
        ss.forEach(function (s) {
          var w = Number(s.weight), r = Number(s.reps);
          if (r <= 12 && epley(w, r) > topE) { topE = epley(w, r); topSet = s; }
          if (w > topW || (w === topW && topWSet && r > Number(topWSet.reps))) { topW = w; topWSet = s; }
        });
        if (seen >= 1) {
          if (topW > bestW && Number(topWSet.reps) >= 2) out.push({ date: dstr(d), day: d, name: L.name, type: 'weight', weight: topW, reps: Number(topWSet.reps), rir: rirOf(topWSet), label: 'Heaviest set yet' });
          else if (topE > bestE * 1.005 && topSet) out.push({ date: dstr(d), day: d, name: L.name, type: 'e1rm', weight: Number(topSet.weight), reps: Number(topSet.reps), rir: rirOf(topSet), e1rm: topE, label: 'Best estimated 1RM' });
        }
        if (topE > bestE) bestE = topE;
        if (topW > bestW) bestW = topW;
        seen++;
      });
    });
    out.sort(function (a, b) { return b.day - a.day || (b.weight - a.weight); });
    return out.slice(0, limit || 12);
  }

  /* ---------- consistency ---------- */
  function consistency(work, dates, T, split, ctx, restName) {
    var f = [];
    var goal = ctx.meta && ctx.meta.weeklyGoal ? Number(ctx.meta.weeklyGoal) : 0;
    if (!goal && split) goal = Math.max(2, Math.min(7, (split.days || []).filter(function (d) { return !restName(d.name); }).length));
    if (!goal) goal = 3;
    var W0 = weekStart(T), firstWeek = weekStart(dates[0]);
    var weeks = [];
    for (var i = 5; i >= 0; i--) {
      var ws = W0 - 7 * i;
      weeks.push({ start: dstr(ws), n: dates.filter(function (d) { return d >= ws && d <= ws + 6; }).length, partial: i === 0, beforeStart: ws + 6 < firstWeek });
    }
    var complete = weeks.filter(function (w) { return !w.partial && !w.beforeStart; }).slice(-4);
    var avg4 = complete.length ? mean(complete.map(function (w) { return w.n; })) : null;
    var hits = complete.filter(function (w) { return w.n >= goal; }).length;
    var streak = 0;
    for (var j = weeks.length - 2; j >= 0 && !weeks[j].beforeStart && weeks[j].n >= goal; j--) streak++;
    if (weeks[weeks.length - 1].n >= goal) streak++;
    var last = dates[dates.length - 1], daysSince = T - last;
    var recent = dates.filter(function (d) { return d >= T - 55; });
    var gaps = []; for (var k = 1; k < recent.length; k++) gaps.push(recent[k] - recent[k - 1]);
    var longestGap = gaps.length ? Math.max.apply(null, gaps) : 0;
    var wd = [0, 0, 0, 0, 0, 0, 0]; recent.forEach(function (d) { wd[weekdayIdx(d)]++; });
    var data = { goal: goal, weeks: weeks, avg4: avg4, hits: hits, completeWeeks: complete.length, streakWeeks: streak, daysSinceLast: daysSince, longestGap: longestGap, weekdayCounts: wd, thisWeek: weeks[weeks.length - 1].n };

    if (avg4 != null && complete.length >= 2) {
      if (avg4 >= goal * 0.9) f.push(F({ id: 'consistency-good', area: 'consistency', severity: 'good', title: 'Consistent training', evidence: 'You averaged ' + r1(avg4) + ' sessions a week over the last ' + complete.length + ' full weeks (goal ' + goal + ').', action: null }));
      else if (avg4 < goal * 0.7) f.push(F({ id: 'consistency-low', area: 'consistency', severity: 'warn', title: 'Below your weekly goal', evidence: 'You averaged ' + r1(avg4) + ' sessions a week over the last ' + complete.length + ' full weeks; your goal is ' + goal + '. You hit it in ' + hits + ' of ' + complete.length + ' weeks.',
        action: 'Fix your training days in advance. When time is short, do a shorter session instead of skipping it.', dont: 'Do not double up two sessions in one day to "make up" a missed one.', check: 'Log ' + goal + ' sessions in the next 7 days.' }));
      else f.push(F({ id: 'consistency-near', area: 'consistency', severity: 'info', title: 'Close to your weekly goal', evidence: 'You averaged ' + r1(avg4) + ' sessions a week against a goal of ' + goal + '.', action: 'Protect the one session that tends to slip; consistency is what drives long-term progress.', check: 'Hit ' + goal + ' sessions this week.' }));
    }
    if (daysSince >= 7) f.push(F({ id: 'time-off', area: 'consistency', severity: daysSince >= 14 ? 'warn' : 'info', title: plural(daysSince, 'day') + ' since your last session', evidence: 'Last logged session: ' + dstr(last) + '.',
      action: daysSince >= 14 ? 'Ease back in: start your first session at about 80-90% of your usual weights and add back over 1-2 weeks.' : 'Book your next session now; momentum fades quickly after a week off.',
      dont: daysSince >= 14 ? 'Do not jump straight back to your old top weights after more than two weeks off.' : null, check: 'Log a session in the next 2 days.' }));
    if (longestGap >= 10 && daysSince < 14) f.push(F({ id: 'gap', area: 'consistency', severity: 'info', title: 'A long gap in the last 8 weeks', evidence: 'Your longest break between sessions was ' + longestGap + ' days.', action: 'If the gap was planned recovery, fine. If not, look at what got in the way and plan around it.' }));
    return { f: f, data: data, goal: goal };
  }

  /* ---------- muscle balance ---------- */
  var PUSH = /pector|chest|delt|shoulder|tricep|serratus/, PULL = /lat|back|trap|rhomboid|bicep|forearm|levator|spine/;
  var QUAD = /quad/, POST = /hamstring|glute/, CALF = /calf|calves/;
  function balance(work, T, split, exById, classify, muscleOf, restName) {
    var f = [], hardA = work.filter(function (x) { return x.d >= T - 27 && isHard(x.s); }), hardB = work.filter(function (x) { return x.d >= T - 55 && x.d <= T - 28 && isHard(x.s); });
    var data = { perGroup: {}, window: 28, totalHard: hardA.length, push: 0, pull: 0, quads: 0, posterior: 0, upper: 0, lower: 0, daysPerWeek: {} };
    GROUPS.forEach(function (g) { data.perGroup[g] = { sets: 0, perWeek: 0, prevSets: 0, days: 0, planned: false, weekSets: 0 }; });
    var dayset = {}; GROUPS.forEach(function (g) { dayset[g] = {}; });
    hardA.forEach(function (x) {
      var g = x.group; if (!g || !data.perGroup[g]) return;
      data.perGroup[g].sets++; dayset[g][x.d] = 1;
      if (x.d >= weekStart(T)) data.perGroup[g].weekSets++;
      var m = String(x.muscle || '').toLowerCase();
      var push = m ? PUSH.test(m) : (g === 'chest' || g === 'shoulders');
      var pull = m ? (PULL.test(m) && !PUSH.test(m)) : g === 'back';
      if (push) data.push++; else if (pull) data.pull++;
      if (g === 'legs') {
        if (m && QUAD.test(m)) data.quads++; else if (m && POST.test(m)) data.posterior++;
      }
      if (g === 'legs') data.lower++; else if (g !== 'core') data.upper++;
    });
    hardB.forEach(function (x) { if (x.group && data.perGroup[x.group]) data.perGroup[x.group].prevSets++; });
    GROUPS.forEach(function (g) { data.perGroup[g].perWeek = r1(data.perGroup[g].sets / 4); data.perGroup[g].days = Object.keys(dayset[g]).length; data.daysPerWeek[g] = r1(Object.keys(dayset[g]).length / 4); });
    // planned groups & a concrete exercise to extend
    var planned = {};
    if (split) (split.days || []).forEach(function (d) {
      if (restName(d.name)) return;
      (exById && Object.keys(exById) || []).forEach(function (id) {
        var e = exById[id]; if (e.archived || e.dayId !== d.id) return;
        var g = classify(e.name); if (!g) return;
        (planned[g] = planned[g] || []).push({ name: e.name, day: d.name });
      });
    });
    GROUPS.forEach(function (g) { data.perGroup[g].planned = !!planned[g]; });
    data.planned = planned;

    if (data.totalHard < 12) return { f: f, data: data };
    var inRange = 0;
    GROUPS.forEach(function (g) {
      var p = data.perGroup[g], label = LABEL[g];
      var ex = planned[g] ? planned[g][0] : null;
      if (g !== 'core') {
        if (p.planned && p.perWeek < 4 && data.totalHard >= 20) f.push(F({ id: 'under-' + g, area: 'balance', severity: p.perWeek < 2 ? 'warn' : 'info', title: label + ' is under-trained for your plan', evidence: 'Only ' + p.perWeek + ' hard sets a week for ' + label.toLowerCase() + ' over the last 4 weeks (about 8-16 is a common target for growth).', action: 'Add 2-3 hard sets a week for ' + label.toLowerCase() + (ex ? ', for example +2 sets of ' + ex.name + ' on ' + ex.day : '') + '.', check: 'Log at least ' + Math.max(8, r0(p.perWeek) + 3) + ' hard ' + label.toLowerCase() + ' sets this week.' }));
        else if (!p.planned && p.sets === 0 && data.totalHard >= 20) f.push(F({ id: 'missing-' + g, area: 'balance', severity: g === 'legs' ? 'alert' : 'warn', title: 'No ' + label.toLowerCase() + ' work in the last 4 weeks', evidence: 'None of your logged hard sets in the last 28 days were classified as ' + label.toLowerCase() + ', and your current split has none planned.', action: 'Add at least one ' + label.toLowerCase() + ' exercise to your split (2-3 hard sets per session, twice a week).', check: 'Add a ' + label.toLowerCase() + ' exercise to a day this week.' }));
      }
      if (p.perWeek > 25) f.push(F({ id: 'over-' + g, area: 'balance', severity: 'warn', title: label + ' volume is very high', evidence: p.perWeek + ' hard sets a week for ' + label.toLowerCase() + '.', action: 'Cut ' + label.toLowerCase() + ' back toward 15-20 hard sets a week unless your recovery is clearly keeping up.', dont: 'Do not keep adding volume for ' + label.toLowerCase() + ' when your lifts there have stopped improving.', check: 'Keep ' + label.toLowerCase() + ' under 20 hard sets this week.' }));
      if (p.perWeek >= 8 && p.perWeek <= 20) inRange++;
      if (p.prevSets >= 8 && p.sets < p.prevSets * 0.6) f.push(F({ id: 'dropped-' + g, area: 'balance', severity: 'info', title: label + ' volume dropped', evidence: label + ' went from ' + r1(p.prevSets / 4) + ' to ' + p.perWeek + ' hard sets a week versus the 4 weeks before.', action: 'If that was not deliberate, bring ' + label.toLowerCase() + ' back to where it was.' }));
      if (p.perWeek >= 8 && p.days <= 4) f.push(F({ id: 'freq-' + g, area: 'balance', severity: 'info', title: label + ' is only trained about once a week', evidence: p.perWeek + ' hard sets a week, but spread over just ' + p.days + ' day' + (p.days === 1 ? '' : 's') + ' in 4 weeks.', action: 'Split the same ' + label.toLowerCase() + ' sets over two days; hitting a muscle twice a week usually works better than one big session.' }));
    });
    if (inRange >= 4) f.push(F({ id: 'balance-good', area: 'balance', severity: 'good', title: 'Most muscle groups get a solid weekly dose', evidence: inRange + ' of 6 muscle groups sit in the 8-20 hard sets a week range.' }));

    var pp = data.push, pl = data.pull;
    if (pp + pl >= 20) {
      var ratio = pl > 0 ? pp / pl : Infinity;
      data.pushPullRatio = pl > 0 ? r1(ratio) : null;
      if (pl === 0 || ratio > 1.5) f.push(F({ id: 'push-pull', area: 'balance', severity: pl === 0 ? 'alert' : 'warn', title: 'You push much more than you pull', evidence: pp + ' pushing sets vs ' + pl + ' pulling sets over 4 weeks' + (pl > 0 ? ' (about ' + r1(ratio) + ' : 1)' : '') + '.', action: 'Add 3-4 hard sets a week of rows, pull-downs or face pulls until pulling is about equal to pushing.', dont: 'Do not add more pressing volume until pulling catches up.', check: 'Log at least ' + (r0(pl / 4) + 4) + ' hard pulling sets this week (you averaged ' + r0(pl / 4) + ').' }));
      else if (ratio < 0.67) f.push(F({ id: 'pull-push', area: 'balance', severity: 'info', title: 'You pull more than you push', evidence: pl + ' pulling sets vs ' + pp + ' pushing sets over 4 weeks.', action: 'Add a little pressing volume so chest and shoulders keep pace.' }));
      else f.push(F({ id: 'push-pull-good', area: 'balance', severity: 'good', title: 'Push and pull are balanced', evidence: pp + ' pushing vs ' + pl + ' pulling sets over 4 weeks.' }));
    }
    if (data.quads + data.posterior >= 12) {
      var qr = data.posterior > 0 ? data.quads / data.posterior : Infinity;
      if (qr > 2.2) f.push(F({ id: 'quad-dominant', area: 'balance', severity: 'warn', title: 'Legs are quad-dominant', evidence: data.quads + ' quad sets vs ' + data.posterior + ' hamstring/glute sets over 4 weeks.', action: 'Add 3-4 sets a week of hip hinges or leg curls (Romanian deadlift, leg curl, hip thrust).', check: 'Log at least 4 hamstring or glute sets this week.' }));
      else if (data.quads > 0 && data.posterior / data.quads > 2) f.push(F({ id: 'post-dominant', area: 'balance', severity: 'info', title: 'Legs lean posterior', evidence: data.posterior + ' hamstring/glute sets vs ' + data.quads + ' quad sets.', action: 'Add a little squat or leg-press volume to balance the front of the leg.' }));
    }
    if (data.lower === 0 && data.upper >= 20) f.push(F({ id: 'no-legs', area: 'balance', severity: 'alert', title: 'No leg training in 4 weeks', evidence: data.upper + ' upper-body hard sets and none for legs.', action: 'Add a leg day (squat or leg press, a hinge, and a curl) at least once a week.', dont: 'Do not keep skipping legs; it limits total strength and hormonal and metabolic benefit.', check: 'Log a full leg session this week.' }));
    else if (data.lower + data.upper >= 24 && data.lower / (data.lower + data.upper) < 0.2) f.push(F({ id: 'legs-lag', area: 'balance', severity: 'warn', title: 'Legs get a small share of your volume', evidence: 'Only ' + r0(data.lower / (data.lower + data.upper) * 100) + '% of your hard sets are for legs.', action: 'Raise leg volume toward 25-30% of the total: add 3-4 hard sets a week.', check: 'Log 8+ hard leg sets this week.' }));
    return { f: f, data: data };
  }

  /* ---------- effort (RIR) ---------- */
  function effort(work, T) {
    var f = [], A = work.filter(function (x) { return x.d >= T - 27; });
    var rated = A.filter(function (x) { return rirOf(x.s) !== null && !isWarm(x.s); });
    var dist = [0, 0, 0, 0, 0, 0]; rated.forEach(function (x) { dist[rirOf(x.s)]++; });
    var cov = A.length ? rated.length / A.length : 0;
    var avg = rated.length ? mean(rated.map(function (x) { return rirOf(x.s); })) : null;
    var data = { working: A.length, rated: rated.length, coverage: cov, avgRir: avg, distribution: dist };
    if (A.length >= 12) {
      if (cov < 0.3) f.push(F({ id: 'rir-coverage', area: 'effort', severity: 'info', title: 'Log RIR on more sets', evidence: 'Only ' + r0(cov * 100) + '% of your recent working sets have an RIR value.', action: 'Tap an RIR chip on at least your main working sets; it sharpens 1RM, stall and volume numbers.', check: 'Log RIR on every working set of your first lift next session.' }));
      else if (rated.length >= 12 && avg >= 3.5) f.push(F({ id: 'rir-easy', area: 'effort', severity: 'warn', title: 'Most sets stop far from failure', evidence: 'Average RIR is ' + r1(avg) + ' over ' + rated.length + ' rated sets, and ' + r0((dist[4] + dist[5]) / rated.length * 100) + '% were RIR 4+.', action: 'Take your main working sets to RIR 1-3: add a rep or a little weight until the last rep is genuinely hard.', dont: 'Do not count sets that finish with 4+ reps in the tank as hard sets; they add fatigue-free but also growth-light volume.', check: 'Finish your top set of each main lift at RIR 1-2 next session.' }));
      else if (rated.length >= 15 && avg <= 0.8) f.push(F({ id: 'rir-grind', area: 'effort', severity: 'warn', title: 'Nearly every set goes to failure', evidence: 'Average RIR is ' + r1(avg) + ' over ' + rated.length + ' rated sets.', action: 'Keep 1-3 reps in reserve on compound lifts and save true failure for the last set of an isolation exercise.', dont: 'Do not train every set to failure; recovery and progress both suffer.', check: 'Stop at least two sets per big lift at RIR 1-2 next session.' }));
      else if (rated.length >= 12) f.push(F({ id: 'rir-good', area: 'effort', severity: 'good', title: 'Effort is in a productive range', evidence: 'Average RIR is ' + r1(avg) + ' over ' + rated.length + ' rated sets.' }));
    }
    return { f: f, data: data };
  }

  /* ---------- weekly volume (the split charts) ---------- */
  function weekly(work, perf, dates, T, goal) {
    var f = [], W0 = weekStart(T), rows = [];
    for (var i = 7; i >= 0; i--) {
      var ws = W0 - 7 * i, we = ws + 6;
      var p = perf.filter(function (x) { return x.d >= ws && x.d <= we; });
      rows.push({ start: dstr(ws), volume: Math.round(sum(p.map(function (x) { return Number(x.s.weight) * Number(x.s.reps); }))), hardSets: work.filter(function (x) { return x.d >= ws && x.d <= we && isHard(x.s); }).length, sessions: dates.filter(function (d) { return d >= ws && d <= we; }).length, partial: i === 0 });
    }
    var comp = rows.filter(function (r) { return !r.partial; });
    var last = comp[comp.length - 1], prior = comp.slice(-4, -1).filter(function (r) { return r.volume > 0; });
    var data = { weeks: rows };
    if (last && prior.length >= 2) {
      var base = mean(prior.map(function (r) { return r.volume; }));
      var ch = pct(last.volume, base);
      data.lastWeekChangePct = ch;
      if (ch > 30) f.push(F({ id: 'volume-spike', area: 'weekly', severity: 'warn', title: 'Weekly volume jumped quickly', evidence: 'Last week\'s volume (' + last.volume.toLocaleString('en-US') + ' kg) was ' + r0(ch) + '% above your previous 3-week average (' + r0(base).toLocaleString('en-US') + ' kg).', action: 'Hold volume steady this week or add no more than about 10%.', dont: 'Do not raise weights, sets and frequency all in the same week.', check: 'Keep this week within 10% of last week\'s volume.' }));
      else if (ch < -40 && last.sessions < goal) f.push(F({ id: 'volume-dip', area: 'weekly', severity: 'info', title: 'Weekly volume dipped', evidence: 'Last week\'s volume was ' + r0(-ch) + '% below your previous 3-week average, with ' + plural(last.sessions, 'session') + '.', action: 'If this was a planned lighter week, good. If not, aim to return to your usual volume this week.' }));
      else if (Math.abs(ch) <= 15) f.push(F({ id: 'volume-steady', area: 'weekly', severity: 'good', title: 'Weekly volume is steady', evidence: 'Last week was within ' + Math.max(1, r0(Math.abs(ch))) + '% of your recent average.' }));
    }
    return { f: f, data: data };
  }

  /* ---------- split days (day mode) ---------- */
  function days(work, T, split, restName) {
    var f = [], data = { perDay: [] };
    if (!split) return { f: f, data: data };
    var exDay = {}; // exercise id -> day id handled via ex.dayId on enriched sets
    (split.days || []).forEach(function (d) {
      if (restName(d.name)) return;
      var ds = work.filter(function (x) { return x.ex.dayId === d.id; }).map(function (x) { return x.d; });
      var lastD = ds.length ? Math.max.apply(null, ds) : null;
      data.perDay.push({ id: d.id, name: d.name, last: lastD != null ? dstr(lastD) : null, daysAgo: lastD != null ? T - lastD : null, sessions28: uniq(ds.filter(function (x) { return x >= T - 27; })).length });
    });
    var anyRecent = data.perDay.some(function (d) { return d.daysAgo != null && d.daysAgo <= 7; });
    data.perDay.forEach(function (d) {
      if (d.daysAgo != null && d.daysAgo >= 14 && anyRecent) f.push(F({ id: 'skipped-' + d.id, area: 'days', severity: 'warn', title: d.name + ' has not been trained in ' + d.daysAgo + ' days', evidence: 'Your other days were trained recently, but ' + d.name + ' was last logged on ' + d.last + '.', action: 'Do ' + d.name + ' next, before repeating a day you trained more recently.', dont: 'Do not let one day of your split quietly drop out; its muscles slip first.', check: 'Log ' + d.name + ' this week.' }));
    });
    return { f: f, data: data };
  }

  /* ---------- lifts (progress graphs) ---------- */
  function lifts(perf, T, key, ctx, C) {
    var f = [], out = [], byKey = {};
    perf.forEach(function (x) { var b = byKey[x.key] = byKey[x.key] || { key: x.key, name: x.ex.name, days: {}, sets: [] }; b.sets.push(x); b.days[x.d] = 1; });
    var cands = Object.keys(byKey).map(function (k) { var b = byKey[k]; b.sessions = Object.keys(b.days).length; b.last = Math.max.apply(null, Object.keys(b.days).map(Number)); return b; })
      .filter(function (b) { return b.sessions >= 3 && T - b.last <= 90; })
      .sort(function (a, b) { return b.sessions - a.sessions; }).slice(0, 5);
    var SI = ctx.SI;
    var data = { exercises: ctx.exercises, sets: ctx.sets };
    cands.forEach(function (b) {
      var L = { key: b.key, name: b.name, sessionsAll: b.sessions, daysSince: T - b.last };
      // per-session series (same definition the Progress charts use when SI is present)
      var series = null, a = null;
      if (SI && SI.analyze) {
        try { a = SI.analyze(data, b.key, { now: T, identityKey: key }); } catch (e) { a = null; }
        if (a && a.history) series = a.history.sessions.filter(function (s) { return !s.anomalous && s.e1rm != null; }).map(function (s) { return { day: s.day, date: s.date, e1rm: s.e1rm, top: s.topWeight, topReps: s.topSet ? s.topSet.reps : null, volume: s.volume }; });
      }
      if (!series) series = ownSeries(b);
      L.series = series;
      var inN = series.filter(function (s) { return s.day >= T - 90; });
      L.sessions90 = inN.length;
      if (a) { L.e1rm = a.model && a.model.estimate ? a.model.estimate.value : null; L.confidence = a.confidence ? a.confidence.label : null; L.confLevel = a.confidence ? a.confidence.level : null; L.forecast = a.forecast && a.forecast.atWeight && a.forecast.atWeight.ok ? { weight: a.forecast.basis.weight, reps: a.forecast.atWeight.reps, low: a.forecast.atWeight.low, high: a.forecast.atWeight.high } : null; L.t30 = a.trends['30']; L.t90 = a.trends['90']; L.insights = a.insights || []; }
      else { L.e1rm = inN.length ? inN[inN.length - 1].e1rm : null; }
      var t = a ? { d: a.trends['90'].direction, ch: a.trends['90'].changePct, n: a.trends['90'].nSessions } : trendOf(inN);
      L.trend90 = t;
      // stall: last 3 sessions don't beat the 3 before, across 3+ weeks
      var u = series.slice(-6);
      var stalled = false, regress = false;
      if (u.length >= 6) {
        var rec = u.slice(-3), pri = u.slice(0, 3);
        var bestRec = Math.max.apply(null, rec.map(function (s) { return s.e1rm; })), bestPri = Math.max.apply(null, pri.map(function (s) { return s.e1rm; }));
        var spanDays = u[u.length - 1].day - u[0].day;
        if (spanDays >= 21 && bestRec <= bestPri * 1.005) stalled = true;
        var medRec = median(rec.map(function (s) { return s.e1rm; })), medPri = median(pri.map(function (s) { return s.e1rm; }));
        if (medRec < medPri * 0.96) { regress = true; stalled = false; }
      }
      L.stalled = stalled; L.regress = regress;
      // rep ranges & effort & frequency for this lift (last 28d)
      var recent = b.sets.filter(function (x) { return x.d >= T - 27; });
      L.medianReps = recent.length ? median(recent.map(function (x) { return Number(x.s.reps); })) : null;
      var rated = recent.filter(function (x) { return rirOf(x.s) !== null; });
      L.avgRir = rated.length >= 4 ? mean(rated.map(function (x) { return rirOf(x.s); })) : null;
      L.hardSetsPerWeek = recent.filter(function (x) { return isHard(x.s); }).length / 4;
      var ds = uniq(recent.map(function (x) { return x.d; })).sort(function (p, q) { return p - q; }); var gp = []; for (var i = 1; i < ds.length; i++) gp.push(ds[i] - ds[i - 1]);
      L.medianGap = gp.length ? median(gp) : null;
      // session volume jump
      if (series.length >= 4) { var lv = series[series.length - 1].volume, pv = mean(series.slice(-4, -1).map(function (s) { return s.volume; })); L.volumeJumpPct = pct(lv, pv); }
      out.push(L);

      var nm = b.name;
      if (L.regress) f.push(F({ id: 'regress-' + b.key, area: 'lifts', severity: 'warn', title: nm + ' is trending down', evidence: 'Your last 3 sessions of ' + nm + ' average ' + r0(100 - (median(u.slice(-3).map(function (s) { return s.e1rm; })) / median(u.slice(0, 3).map(function (s) { return s.e1rm; }))) * 100) + '% below the 3 before (estimated 1RM).', action: 'Take a lighter week for ' + nm + ': cut sets by about 40% and weight by about 10%, then rebuild.', dont: 'Do not push through with more volume when the numbers are falling; check sleep, food and stress first.', check: 'Do one lighter ' + nm + ' session, then re-test.' }));
      else if (L.stalled) {
        var cause = stallCause(L), ft = L.forecast;
        f.push(F({ id: 'stall-' + b.key, area: 'lifts', severity: 'warn', title: nm + ' has stalled', evidence: 'No new best in the last ' + (u[u.length - 1].day - u[0].day) + ' days across ' + u.length + ' sessions. Most likely cause: ' + cause.name + '.',
          action: cause.action, dont: 'Do not add weight just to add weight; earn it with an extra rep on every set first.', check: cause.check }));
      } else if (t.d === 'up' && t.ch >= 2) f.push(F({ id: 'up-' + b.key, area: 'lifts', severity: 'good', title: nm + ' is progressing', evidence: 'Estimated 1RM ' + chTxt(t.ch) + ' over ' + plural(t.n, 'session') + ' in the last 90 days.' }));
      if (f.length && f[f.length - 1].id === 'stall-' + b.key) f[f.length - 1].lift = nm;
      if (L.volumeJumpPct != null && L.volumeJumpPct > 40 && series.length >= 5) f.push(F({ id: 'jump-' + b.key, area: 'lifts', severity: 'info', title: nm + ' volume spiked last session', evidence: 'Last session\'s volume was ' + r0(L.volumeJumpPct) + '% above your previous 3 sessions.', action: 'Do not repeat that jump next session; keep increases gradual.' }));
      if (L.medianReps != null && L.medianReps >= 15) f.push(F({ id: 'highrep-' + b.key, area: 'lifts', severity: 'info', title: nm + ' is mostly high-rep', evidence: 'Your median set is ' + L.medianReps + ' reps. Strength estimates get less reliable above about 12-15 reps.', action: 'To judge strength on this lift, test a heavier 5-10 rep set occasionally.' }));
    });
    // When several lifts stall together the cause is rarely the exercises themselves.
    var stallF = f.filter(function (x) { return /^stall-/.test(x.id); });
    if (stallF.length > 2) {
      var keep = stallF[0], rest = stallF.slice(1);
      f = f.filter(function (x) { return !/^stall-/.test(x.id) || x === keep; });
      f.push(F({ id: 'stall-many', area: 'lifts', severity: 'warn', title: rest.length + ' more lifts have stalled too', evidence: rest.map(function (x) { return x.lift; }).join(', ') + ' have not set a new best in 3+ weeks either.',
        action: 'When most lifts stall together, look at recovery and total weekly volume before changing individual exercises: sleep, calories, and a lighter week.', dont: 'Do not add weight to every lift at once to force progress.', check: 'Sleep 7+ hours most nights this week and take one lighter session per lift, then re-test.' }));
    }
    return { f: f, data: out };
  }
  function ownSeries(b) {
    var byDay = {};
    b.sets.forEach(function (x) { (byDay[x.d] = byDay[x.d] || []).push(x.s); });
    return Object.keys(byDay).map(Number).sort(function (p, q) { return p - q; }).map(function (d) {
      var ss = byDay[d].filter(function (s) { return !isWarm(s); }), best = 0, top = 0, topReps = 0, vol = 0;
      ss.forEach(function (s) { var w = Number(s.weight), r = Number(s.reps); vol += w * r; if (r <= 12) best = Math.max(best, epley(w, r)); if (w > top || (w === top && r > topReps)) { top = w; topReps = r; } });
      if (!best) ss.forEach(function (s) { best = Math.max(best, epley(Number(s.weight), Number(s.reps))); });
      return { day: d, date: dstr(d), e1rm: best, top: top, topReps: topReps, volume: vol };
    });
  }
  function trendOf(s) {
    if (s.length < 2) return { d: 'insufficient', ch: null, n: s.length };
    var a = s[0].e1rm, z = s[s.length - 1].e1rm, ch = (z - a) / a * 100;
    return { d: Math.abs(ch) < 1.5 ? 'stable' : (ch > 0 ? 'up' : 'down'), ch: ch, n: s.length };
  }
  // The most likely reason a lift stopped moving: rest/frequency, effort, volume, or (unknowable here) recovery & food.
  function stallCause(L) {
    var nm = L.name;
    if (L.medianGap != null && L.medianGap >= 9) return { name: 'too much time between sessions', action: 'Train ' + nm + ' about once every 4-7 days; once every ' + r0(L.medianGap) + ' days is too sparse to build on.', check: 'Train ' + nm + ' again within 7 days.' };
    if (L.avgRir != null && L.avgRir >= 3) return { name: 'effort (sets finish with ' + r1(L.avgRir) + ' reps left on average)', action: 'Push your top sets of ' + nm + ' to RIR 1-2; the weight is probably fine, the effort is not yet.', check: 'Finish the top set of ' + nm + ' at RIR 1-2 next session.' };
    if (L.hardSetsPerWeek < 6) return { name: 'low volume (' + r1(L.hardSetsPerWeek) + ' hard sets a week)', action: 'Add 2-3 hard sets a week of ' + nm + ' (or a close variation) for a few weeks.', check: 'Log ' + Math.ceil(L.hardSetsPerWeek + 3) + '+ hard sets of ' + nm + ' this week.' };
    return { name: 'recovery (sleep, food or stress; these are not tracked here)', action: 'Take one lighter week for ' + nm + ' (about -10% weight, -40% sets), then retry; also check sleep and calories.', check: 'Do one lighter ' + nm + ' session this week.' };
  }

  /* ---------- Strength Intelligence health ---------- */
  function siHealth(L, ctx) {
    var f = [], arr = L.data || [];
    var prelim = arr.filter(function (l) { return l.confLevel === 'preliminary' || l.confLevel === 'insufficient'; });
    if (arr.length && prelim.length >= Math.ceil(arr.length / 2)) f.push(F({ id: 'si-prelim', area: 'si', severity: 'info', title: 'Strength predictions are still preliminary', evidence: prelim.map(function (l) { return l.name; }).join(', ') + ' do not have enough comparable sessions yet.', action: 'Log the same lift at a repeatable weight for 3+ more sessions (and add RIR) to firm up the predictions.' }));
    var log = (ctx.forecastLog || []).filter(function (r) { return r && r.status === 'resolved'; });
    var data = { resolved: log.length, hit: log.filter(function (r) { return r.inRange; }).length };
    if (log.length >= 5) {
      var rate = data.hit / log.length;
      if (rate >= 0.6) f.push(F({ id: 'si-trust', area: 'si', severity: 'good', title: 'Your forecasts have been reliable', evidence: data.hit + ' of ' + log.length + ' past forecasts landed in range.', action: null }));
      else f.push(F({ id: 'si-wobbly', area: 'si', severity: 'info', title: 'Forecasts have missed often', evidence: 'Only ' + data.hit + ' of ' + log.length + ' forecasts landed in range.', action: 'Treat forecast ranges as rough guides, and log RIR so predictions know how hard each set was.' }));
    }
    return { f: f, data: data };
  }

  /* ---------- deload ---------- */
  function deloadFinding(C, W, L) {
    var rows = (W.data.weeks || []).filter(function (r) { return !r.partial; });
    var run = 0; for (var i = rows.length - 1; i >= 0; i--) { if (rows[i].sessions >= Math.max(2, C.goal - 1)) run++; else break; }
    var troubled = (L.data || []).filter(function (l) { return l.stalled || l.regress; }).length;
    if (run >= 6 && troubled >= 2) return F({ id: 'deload', area: 'weekly', severity: 'warn', title: 'A deload week is due', evidence: 'You have trained ' + run + ' weeks in a row at full frequency and ' + troubled + ' of your main lifts have stalled or slipped.', action: 'Take a deload week: keep your sessions but cut sets by about 40% and weights by about 10%.', dont: 'Do not skip the deload and push harder; stalling across several lifts is the usual sign you need one.', check: 'Run one deload week, then re-test your main lifts.' });
    return null;
  }

  /* ---------- pick the three priorities ---------- */

  /* one-line science behind each kind of advice (shown in the PDF) */
  var SCI = [
    [/^(under|missing)-/, 'Muscle growth follows weekly hard sets per muscle; about 10-20 is the productive range and below it growth is noticeably smaller.', 'Strong evidence'],
    [/^over-/, 'Returns shrink sharply beyond roughly 20 weekly sets while fatigue keeps rising.', 'Strong evidence'],
    [/^freq-/, 'Training a muscle about twice a week lets you spread the same weekly sets over fresher sessions.', 'Moderate evidence'],
    [/^(push-pull|pull-push|quad-dominant|post-dominant|legs-lag)/, 'Balanced weekly sets keep every muscle in its growth range and joints happier; the exact ratios are coaching rules, not studied cut-offs.', 'Practical guideline'],
    [/^no-legs/, 'Legs are the largest muscle group and need their own weekly hard sets like any other.', 'Strong evidence'],
    [/^rir-/, 'Growth comes mostly from sets taken within about 0-3 reps of failure; failure on every set adds fatigue without clear extra growth.', 'Strong evidence'],
    [/^(stall|regress|jump|highrep|up)-/, 'Progressive overload (more reps or weight over time) is the signal that keeps muscle growing; stalls usually trace to effort, volume or recovery.', 'Strong evidence'],
    [/^(consistency|gap|skipped)/, 'Weekly volume per muscle only adds up if sessions actually happen; consistency beats any single workout.', 'Strong evidence'],
    [/^time-off/, 'Muscle and strength are kept for a few weeks off and return quickly, but easing back in lowers soreness and injury risk.', 'Moderate evidence'],
    [/^(volume-|deload)/, 'Raise volume gradually and plan lighter weeks when performance drops; exact numbers are coaching practice with limited trial evidence.', 'Practical guideline']
  ];
  function addScience(f) { for (var i = 0; i < SCI.length; i++) if (SCI[i][0].test(f.id)) { f.why = SCI[i][1]; f.level = SCI[i][2]; return; } }

  function pickPriorities(findings) {
    var out = [], areas = {}, seen = {};
    var cand = findings.filter(function (f) { return f.severity !== 'good' && f.action && f.check; });
    cand.forEach(function (f) { if (out.length < 3 && !areas[f.area]) { out.push(f); areas[f.area] = 1; seen[f.id] = 1; } });
    cand.forEach(function (f) { if (out.length < 3 && !seen[f.id]) { out.push(f); seen[f.id] = 1; } });
    return out.map(function (f) { return { id: f.id, area: f.area, title: f.title, action: f.action, check: f.check, evidence: f.evidence, why: f.why, level: f.level }; });
  }

  /* ---------- graph-by-graph readings ---------- */
  function graphReadings(rep, C, B, E, W, D, L, S) {
    var g = [];
    var cd = C.data;
    // HOME
    var items = [];
    items.push({ chart: 'Calendar', reading: 'You trained on ' + plural(rep.snapshot.last28.sessions, 'day') + ' in the last 28 (' + plural(rep.snapshot.prev28.sessions, 'day') + ' in the 28 before). Your longest break in 8 weeks was ' + cd.longestGap + ' days.', advice: cd.longestGap >= 10 ? 'Look at the gap on the calendar and plan around whatever caused it.' : 'Your calendar has no long gaps; keep the rhythm.' });
    var wdTop = argmax(cd.weekdayCounts), wdLow = argmin(cd.weekdayCounts);
    if (sum(cd.weekdayCounts) >= 8) items.push({ chart: 'Calendar (weekday pattern)', reading: 'You train most on ' + WEEKDAYS[wdTop] + 's (' + cd.weekdayCounts[wdTop] + ') and least on ' + WEEKDAYS[wdLow] + 's (' + cd.weekdayCounts[wdLow] + ').', advice: cd.weekdayCounts[wdLow] === 0 ? WEEKDAYS[wdLow] + ' is your natural rest day; keep it free for recovery.' : 'If ' + WEEKDAYS[wdLow] + ' keeps getting skipped, move that session to a day you reliably train.' });
    items.push({ chart: 'Weekly rings', reading: 'This week: ' + plural(cd.thisWeek, 'session') + ' of ' + cd.goal + ' goal. Streak: ' + plural(cd.streakWeeks, 'week') + ' hitting the goal.', advice: cd.thisWeek >= cd.goal ? 'Goal met. Do not add extra sessions just because; recovery is part of the plan.' : 'You need ' + (cd.goal - cd.thisWeek) + ' more session' + (cd.goal - cd.thisWeek === 1 ? '' : 's') + ' to hit the goal this week.' });
    g.push({ screen: 'Home', items: items });
    // STATS
    var bd = B.data, it2 = [];
    if (bd.totalHard >= 12) {
      it2.push({ chart: 'Muscle radar (weekly frequency)', reading: GROUPS.map(function (k) { return LABEL[k] + ' ' + bd.daysPerWeek[k] + 'x/wk'; }).join(', ') + '.', advice: 'Aim to hit each muscle group you care about about twice a week; groups under 1x a week gain slowest.' });
      it2.push({ chart: '3D body and split volume (hard sets)', reading: GROUPS.map(function (k) { return LABEL[k] + ' ' + bd.perGroup[k].perWeek; }).join(', ') + ' hard sets a week (4-week average).', advice: balanceAdvice(B, bd) });
    } else it2.push({ chart: 'Muscle radar and 3D body', reading: 'Not enough hard sets in the last 28 days (' + bd.totalHard + ') to compare muscle groups.', advice: 'Keep logging for a few more weeks.' });
    g.push({ screen: 'Stats', items: it2 });
    // EFFORT
    var ed = E.data, it3 = [];
    it3.push({ chart: 'Effort (RIR) on your sets', reading: ed.rated ? ('Average RIR ' + r1(ed.avgRir) + ' across ' + ed.rated + ' rated sets (' + r0(ed.coverage * 100) + '% of recent sets).') : 'No RIR logged in the last 28 days.', advice: ed.rated ? (ed.avgRir >= 3.5 ? 'You are stopping early; push closer to failure on key sets.' : ed.avgRir <= 0.8 ? 'You are grinding; keep some reps in reserve.' : 'Effort looks productive; keep rating sets so the numbers stay sharp.') : 'Rate your sets with RIR to unlock effort-aware stats.' });
    g.push({ screen: 'Progress: effort', items: it3 });
    // PROGRESS: exercise
    var it4 = [];
    (L.data || []).slice(0, 4).forEach(function (l) {
      var t = l.trend90 || {}, nm = l.name;
      var top = l.series.slice(-6), topNow = top.length ? top[top.length - 1].top : null, topThen = top.length ? top[0].top : null;
      it4.push({ chart: nm + ': Estimated 1RM', reading: t.d === 'insufficient' || t.ch == null ? 'Not enough sessions in the last 90 days.' : 'Estimated 1RM ' + chTxt(t.ch) + ' over ' + plural(t.n, 'session') + ' (90 days)' + (l.e1rm ? '; current estimate about ' + r0(l.e1rm) + ' kg' + (l.confidence ? ' (' + l.confidence.toLowerCase() + ')' : '') : '') + '.', advice: l.regress ? 'Trending down: deload, then rebuild.' : l.stalled ? stallCause(l).action : t.d === 'up' ? 'Going up: keep the same plan.' : 'Holding steady: add a rep before you add weight.' });
      if (topNow != null) it4.push({ chart: nm + ': Top weight', reading: 'Top weight ' + (topNow === topThen ? 'stayed at ' + topNow + ' kg' : 'went from ' + topThen + ' to ' + topNow + ' kg') + ' over your last ' + top.length + ' sessions.', advice: topNow > topThen ? 'Heavier loads are coming through; make sure reps did not collapse.' : topNow === topThen ? 'Same top weight; progress here should come as extra reps.' : 'Top weight dropped; fine if you changed the rep range on purpose.' });
      if (l.volumeJumpPct != null) it4.push({ chart: nm + ': Session volume', reading: 'Last session volume was ' + (Math.abs(l.volumeJumpPct) < 5 ? 'about the same as' : signed(l.volumeJumpPct, 0) + '% against') + ' your previous 3.', advice: l.volumeJumpPct > 40 ? 'A big jump; do not repeat it next time.' : l.volumeJumpPct < -30 ? 'A big drop; check it was deliberate.' : 'Steady, which is what you want.' });
      if (l.medianReps != null) it4.push({ chart: nm + ': Reps and rep range', reading: 'Median set is ' + l.medianReps + ' reps' + (l.avgRir != null ? ' at average RIR ' + r1(l.avgRir) : '') + '.', advice: l.medianReps >= 15 ? 'Very high reps; use an occasional heavier set to track strength.' : l.medianReps <= 3 ? 'Very low reps; add a back-off set of 6-10 for volume.' : 'In the 4-12 rep zone where progress is easiest to measure.' });
      if (l.forecast) it4.push({ chart: nm + ': Next-session target (Strength Intelligence)', reading: 'At ' + l.forecast.weight + ' kg expect about ' + l.forecast.reps + ' reps (likely ' + l.forecast.low + '-' + l.forecast.high + ').', advice: 'Use ' + Math.min(l.forecast.high, l.forecast.reps + 1) + ' reps as your target; beating the top of the range is a sign to add weight.' });
      var ins = (l.insights || []).filter(function (x) { return x.type === 'caution' || x.type === 'positive'; }).slice(0, 2);
      ins.forEach(function (x) { it4.push({ chart: nm + ': ' + x.title, reading: x.detail, advice: x.type === 'positive' ? 'Good sign; keep doing what you are doing.' : 'Keep an eye on this over the next 2-3 sessions.' }); });
    });
    if (!it4.length) it4.push({ chart: 'Exercise charts', reading: 'No lift has 3+ sessions in the last 90 days yet.', advice: 'Repeat the same main lifts for a few weeks so trends become visible.' });
    g.push({ screen: 'Progress: exercises', items: it4 });
    // PROGRESS: day
    var it5 = [];
    (D.data.perDay || []).forEach(function (d) { it5.push({ chart: d.name + ' day', reading: d.last ? 'Last trained ' + (d.daysAgo === 0 ? 'today' : plural(d.daysAgo, 'day') + ' ago') + '; ' + plural(d.sessions28, 'session') + ' in the last 28 days.' : 'Never trained yet.', advice: d.daysAgo != null && d.daysAgo >= 14 ? 'Do this day next.' : d.last ? 'On track.' : 'Do this day to complete your split.' }); });
    if (it5.length) g.push({ screen: 'Progress: days', items: it5 });
    // PROGRESS: split
    var it6 = [], wd = W.data;
    var weeksWithData = (wd.weeks || []).filter(function (r) { return r.volume > 0; });
    if (weeksWithData.length >= 3) it6.push({ chart: 'Weekly volume (split charts)', reading: 'Last 8 weeks, kg lifted per week: ' + (wd.weeks || []).map(function (r) { return r.volume.toLocaleString('en-US'); }).join(', ') + (wd.lastWeekChangePct != null ? '. Last full week was ' + signed(wd.lastWeekChangePct, 0) + '% against the 3 weeks before.' : '.'), advice: wd.lastWeekChangePct != null && wd.lastWeekChangePct > 30 ? 'Fast ramp-up: hold steady this week.' : 'Aim for slow, steady increases of roughly 5-10% when you feel fresh, and a lighter week every 6-8 weeks.' });
    it6.push({ chart: 'Hard sets per week', reading: (wd.weeks || []).map(function (r) { return r.hardSets; }).join(', ') + ' (oldest to newest).', advice: 'Hard sets show effective work better than raw tonnage; look for a gentle upward line with the odd lighter week.' });
    g.push({ screen: 'Progress: split', items: it6 });
    // SI
    var it7 = [];
    (L.data || []).slice(0, 3).forEach(function (l) { if (l.confidence) it7.push({ chart: l.name + ': prediction confidence', reading: l.name + ' is rated "' + l.confidence + '".', advice: l.confLevel === 'well-calibrated' || l.confLevel === 'moderate' ? 'Trust the curve and forecast for planning.' : 'Log 3+ more repeatable sessions (with RIR) to firm up predictions.' }); });
    if (S.data.resolved >= 5) it7.push({ chart: 'Forecast accuracy', reading: S.data.hit + ' of ' + S.data.resolved + ' resolved forecasts were in range.', advice: S.data.hit / S.data.resolved >= 0.6 ? 'Forecasts are earning their keep.' : 'Treat forecasts as rough guides for now.' });
    if (it7.length) g.push({ screen: 'Stats: Strength Intelligence', items: it7 });
    return g;
  }
  function balanceAdvice(B, bd) {
    var top = B.f.filter(function (f) { return f.severity !== 'good' && f.area === 'balance'; })[0];
    return top ? top.action : 'Your muscle groups look reasonably balanced for the plan you are running.';
  }
  function argmax(a) { var m = 0; for (var i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; }
  function argmin(a) { var m = 0; for (var i = 1; i < a.length; i++) if (a[i] < a[m]) m = i; return m; }

  return { build: build, records: function (ctx, limit) { return recordsFromCtx(ctx, limit); }, GROUPS: GROUPS, LABEL: LABEL, _internals: { weekStart: weekStart, dnum: dnum, dstr: dstr, isHard: isHard } };

  function recordsFromCtx(ctx, limit) {
    var key = ctx.identityKey || defaultKey, T = dnum(ctx.today), exById = {};
    (ctx.exercises || []).forEach(function (e) { exById[e.id] = e; });
    var perf = [];
    (ctx.sets || []).forEach(function (s) { var ex = exById[s.exerciseId]; if (!ex || !s.date || !isPerf(s)) return; var d = dnum(s.date); if (d !== d || d > T) return; perf.push({ s: s, d: d, ex: ex, key: key(ex.name) }); });
    return records(perf, T, limit);
  }
}));
