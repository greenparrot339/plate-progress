/* Run with:  node strength-intelligence.test.js   (no dependencies) */
'use strict';
const assert = require('assert');
const SI = require('./strength-intelligence.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);

// ---------- data builders ----------
let uidn = 0;
function build(spec, extra) {
  // spec: [{date:'2026-01-05', sets:[[w,r],...], type?}] for "Bench Press" (two day-records to test pooling)
  const exercises = [
    { id: 'ex1', name: 'Bench Press', dayId: 'd1', splitId: 's1' },
    { id: 'ex1b', name: 'bench  press', dayId: 'd2', splitId: 's1' },
    { id: 'exSq', name: 'Squat', dayId: 'd3', splitId: 's1' }
  ];
  const sets = [];
  spec.forEach((s, i) => s.sets.forEach((x, j) => sets.push({
    id: 'set' + (uidn++), exerciseId: (s.ex || (i % 2 ? 'ex1b' : 'ex1')), setNumber: j + 1, date: s.date,
    weight: x[0], reps: x[1], setType: x[2] || 'working', createdAt: s.date + 'T10:00:00Z'
  })));
  (extra || []).forEach(x => sets.push(x));
  return { exercises, sets };
}
function addDays(date, n) { return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
const NOW = '2026-06-30';
const KEY = SI.defaultIdentityKey('Bench Press');

console.log('Formulas (independently computed)');
test('Epley 100x5 = 116.667', () => near(SI.calculateEpley1RM(100, 5), 100 * (1 + 5 / 30), 1e-9));
test('Brzycki 100x5 = 112.5', () => near(SI.calculateBrzycki1RM(100, 5), 112.5, 1e-9));
test('Lombardi 100x5 = 100*5^0.1', () => near(SI.calculateLombardi1RM(100, 5), 100 * Math.pow(5, 0.1), 1e-9));
test('1 rep returns the weight in every formula', () => {
  assert.strictEqual(SI.calculateEpley1RM(90, 1), 90);
  assert.strictEqual(SI.calculateBrzycki1RM(90, 1), 90);
  assert.strictEqual(SI.calculateLombardi1RM(90, 1), 90);
});
test('Brzycki is invalid at >=37 reps', () => assert.ok(Number.isNaN(SI.calculateBrzycki1RM(50, 37))));
test('blend normalised: factor(1) = 1', () => near(SI.blendFactor(1), 1, 1e-12));
test('blend weights sum to 1 across the range', () => { for (let r = 1; r <= 40; r += 0.7) { const w = SI.blendWeights(r); near(w.e + w.b + w.l, 1, 1e-9, 'r=' + r); } });
test('blend factor strictly increasing in reps (curve invertible)', () => {
  let prev = 0; for (let r = 1; r <= 60; r += 0.05) { const f = SI.blendFactor(r); assert.ok(f > prev, 'not increasing at r=' + r); prev = f; }
});
test('blend 100x5 lies between the lowest and highest formula', () => {
  const b = SI.blended1RM(100, 5); const lo = Math.min(b.epley, b.brzycki, b.lombardi), hi = Math.max(b.epley, b.brzycki, b.lombardi);
  assert.ok(b.value >= lo * 0.99 && b.value <= hi * 1.01, b.value + ' vs ' + lo + '..' + hi);
});
test('repsPrior inverts blendFactor', () => { [1, 2, 5, 8, 10, 12, 15, 20, 30].forEach(r => near(SI.repsPrior(1 / SI.blendFactor(r)), r, 0.03, 'r=' + r)); });
test('repsPrior above 100% = 0', () => assert.strictEqual(SI.repsPrior(1.01), 0));
test('unit conversion round trip', () => { near(SI.lbToKg(SI.kgToLb(85)), 85, 1e-9); near(SI.kgToLb(100), 220.462, 0.001); });
test('roundToIncrement', () => { assert.strictEqual(SI.roundToIncrement(83.7, 2.5), 82.5); assert.strictEqual(SI.roundToIncrement(84, 2.5), 85); });

console.log('Scenario 1: extensive, consistent history');
// Synthetic lifter: true 1RM ~100, generated straight from the prior curve with mild progression.
function simulate(E0, sFactor, sessionsN, weights, growthPerSession) {
  const spec = []; let date = '2026-01-02';
  for (let i = 0; i < sessionsN; i++) {
    const E = E0 * (1 + growthPerSession * i), w = weights[i % weights.length];
    const reps = Math.max(1, Math.round(1 + sFactor * (SI.repsPrior(w / E) - 1)));
    spec.push({ date, sets: [[w, reps], [w, Math.max(1, reps - 1)], [w, Math.max(1, reps - 2)]] });
    date = addDays(date, 4);
  }
  return spec;
}
const big = build(simulate(100, 1.0, 36, [70, 75, 80, 85], 0.002));
const A1 = SI.analyze(big, KEY, { now: addDays('2026-01-02', 4 * 35 + 3) });
test('pools "Bench Press" and "bench  press" across day records', () => {
  const cat = SI.buildCatalog(big); const bench = cat.filter(c => c.key === KEY);
  assert.strictEqual(bench.length, 1); assert.strictEqual(bench[0].exerciseIds.length, 2);
});
test('catalog lists only exercises with usable sets', () => assert.ok(!SI.buildCatalog(big).some(c => c.name === 'Squat')));
test('1RM near truth (≈107)', () => near(A1.model.E, 107, 8));
test('personalised shape fitted (multiple loads)', () => assert.ok(A1.model.personalizedShape));
test('fitted endurance factor s close to 1', () => near(A1.model.s, 1, 0.25));
test('estimate not provisional with 36 sessions', () => assert.strictEqual(A1.provisional, false));
test('back-test has points and low error', () => { assert.ok(A1.backtest.summary.n >= 10); assert.ok(A1.backtest.summary.medianAbsRepError <= 2, 'med err ' + A1.backtest.summary.medianAbsRepError); });
test('confidence is moderate or better', () => assert.ok(['moderate', 'well-calibrated'].includes(A1.confidence.level), A1.confidence.level));
test('trend up over all time', () => assert.strictEqual(A1.trends.all.direction, 'up'));
test('what-if: heavier weight → fewer reps (monotonic)', () => {
  let prev = Infinity; for (let w = 50; w <= 100; w += 5) { const p = SI.askWeight(A1, w); assert.ok(p.repsExact <= prev + 1e-9, 'w=' + w); prev = p.repsExact; }
});
test('what-if: low ≤ expected ≤ high', () => { [60, 75, 85, 95].forEach(w => { const p = SI.askWeight(A1, w); assert.ok(p.low <= p.reps && p.reps <= p.high, w + ': ' + [p.low, p.reps, p.high]); }); });
test('what-if: weight above 1RM → status above-max, 0 reps', () => { const p = SI.askWeight(A1, A1.model.E * 1.1); assert.strictEqual(p.status, 'above-max'); assert.strictEqual(p.reps, 0); });
test('what-if: returns a closest historical performance', () => { const p = SI.askWeight(A1, 80); assert.ok(p.closest && Math.abs(p.closest.weight - 80) < 1); });
test('reverse ↔ forward round trip (10 reps)', () => {
  const r = SI.askReps(A1, 10); const f = SI.predictRepetitions(A1.model, r.weight); near(f.repsExact, 10, 0.1);
});
test('reverse: conservative < expected < optimistic weight', () => { const r = SI.askReps(A1, 8); assert.ok(r.conservative < r.weight && r.weight < r.optimistic, [r.conservative, r.weight, r.optimistic].join(' ')); });
test('reverse: more reps → lighter weight', () => { assert.ok(SI.askReps(A1, 12).weight < SI.askReps(A1, 5).weight); });
test('reverse: %1RM of 1 rep ≈ 100%', () => near(SI.askReps(A1, 1).percentOf1RM, 100, 1.5));
test('forecast exists with range and suggestion', () => {
  const f = A1.forecast; assert.ok(f && f.atWeight.ok); assert.ok(f.atWeight.low <= f.atWeight.high); assert.ok(f.suggestion.weightLow < f.suggestion.weightHigh);
});
test('curve has recorded points and extrapolation flags', () => { assert.ok(A1.curve.points.length > 20); assert.ok(A1.curve.recorded.length >= 3); });
test('insights are evidence-based (no empty strings)', () => A1.insights.forEach(i => { assert.ok(i.title && i.detail); }));

console.log('Scenario 2: single recorded session');
const one = build([{ date: '2026-06-20', sets: [[80, 9], [80, 8]] }]);
const A2 = SI.analyze(one, KEY, { now: NOW });
test('model exists but is formula-only', () => { assert.ok(A2.model); assert.ok(A2.model.formulaOnly); });
test('confidence is insufficient', () => assert.strictEqual(A2.confidence.level, 'insufficient'));
test('flagged provisional', () => assert.ok(A2.provisional));
test('still produces a prediction', () => { const p = SI.askWeight(A2, 80); assert.ok(p.ok && p.reps >= 7 && p.reps <= 12, 'reps ' + p.reps); });
test('trend is insufficient', () => assert.strictEqual(A2.trends['30'].direction, 'insufficient'));
test('forecast works from one session', () => { assert.ok(A2.forecast); });
test('insight tells the user to log more', () => assert.strictEqual(A2.insights[0].id, 'need-data'));

console.log('Scenario 3: no usable history');
const none = build([{ date: '2026-06-20', sets: [[0, 10], [0, 8]] }, { date: '2026-06-22', sets: [[60, 10, 'warmup']] }]);
const A3 = SI.analyze(none, KEY, { now: NOW });
test('no model, no crash', () => { assert.strictEqual(A3.model, null); });
test('askWeight/askReps fail gracefully', () => { assert.strictEqual(SI.askWeight(A3, 80).ok, false); assert.strictEqual(SI.askReps(A3, 8).ok, false); });
test('confidence insufficient', () => assert.strictEqual(A3.confidence.level, 'insufficient'));
test('exercise absent from catalog; unknown key is safe', () => { assert.strictEqual(SI.buildCatalog(none).length, 0); const a = SI.analyze(none, 'nonexistent', { now: NOW }); assert.strictEqual(a.model, null); });
test('excluded counts reported (warm-up / bodyweight)', () => { assert.strictEqual(A3.history.excluded.warmup, 1); assert.strictEqual(A3.history.excluded.bodyweight, 2); });

console.log('Scenario 4: more reps, same weight');
const reps = build([8, 8, 9, 9, 10, 10, 11].map((r, i) => ({ date: addDays('2026-05-01', i * 5), sets: [[80, r], [80, r - 1], [80, r - 2]] })));
const A4 = SI.analyze(reps, KEY, { now: '2026-06-05' });
test('same-weight rep progression insight fires', () => assert.ok(A4.insights.some(i => i.id === 'same-weight-reps'), JSON.stringify(A4.insights.map(i => i.id))));
test('estimated 1RM rises although weight is constant', () => { assert.ok(A4.trends['90'].changePct > 1.5, 'pct ' + A4.trends['90'].changePct); assert.strictEqual(A4.trends['90'].direction, 'up'); });

console.log('Scenario 5: more weight, fewer reps');
const heavy = build([[70, 12], [72.5, 11], [75, 10], [77.5, 9], [80, 8], [82.5, 7], [85, 6]].map((x, i) => ({ date: addDays('2026-05-01', i * 5), sets: [[x[0], x[1]], [x[0], x[1] - 1]] })));
const A5 = SI.analyze(heavy, KEY, { now: '2026-06-05' });
test('does not call it a decline: e1RM roughly flat/up', () => assert.ok(A5.trends['90'].changePct > -3, 'pct ' + A5.trends['90'].changePct));
test('records show the heaviest weight, not the best estimate', () => { assert.strictEqual(A5.records.weight.weight, 85); assert.ok(A5.records.bestE1RM.value > 85); });
test('estimated 1RM is never labelled as a recorded record (distinct fields)', () => assert.ok(A5.records.bestE1RM.value !== A5.records.weight.weight));

console.log('Scenario 6: inconsistent performance');
const noisy = build([[80, 10], [80, 5], [80, 12], [80, 6], [80, 11], [80, 4], [80, 10], [80, 7]].map((x, i) => ({ date: addDays('2026-05-01', i * 4), sets: [[x[0], x[1]]] })));
const A6 = SI.analyze(noisy, KEY, { now: '2026-06-05' });
test('inconsistency flagged', () => assert.ok(A6.insights.some(i => i.id === 'inconsistent'), JSON.stringify(A6.insights.map(i => i.id))));
test('wider interval than a consistent lifter', () => {
  const cons = SI.analyze(build([8, 8, 9, 8, 8, 9, 8, 8].map((r, i) => ({ date: addDays('2026-05-01', i * 4), sets: [[80, r]] }))), KEY, { now: '2026-06-05' });
  const wn = SI.askWeight(A6, 80), wc = SI.askWeight(cons, 80);
  assert.ok(wn.sigma > wc.sigma, wn.sigma + ' vs ' + wc.sigma);
});
test('confidence not "well calibrated"', () => assert.notStrictEqual(A6.confidence.level, 'well-calibrated'));

console.log('Scenario 7: invalid / missing / anomalous data');
const dirty = build(
  [{ date: '2026-05-01', sets: [[80, 8]] }, { date: '2026-05-05', sets: [[80, 9]] }, { date: '2026-05-09', sets: [[82.5, 8]] },
   { date: '2026-05-13', sets: [[800, 8]] },   // typo: 800 kg
   { date: '2026-05-17', sets: [[82.5, 9]] }, { date: '2026-05-21', sets: [[85, 8]] }, { date: '2026-05-25', sets: [[85, 9]] }],
  [
    { id: 'bad1', exerciseId: 'ex1', setNumber: 1, date: '2026-05-02', weight: 'abc', reps: 8, setType: 'working' },
    { id: 'bad2', exerciseId: 'ex1', setNumber: 1, date: '2026-05-02', weight: 80, reps: null, setType: 'working' },
    { id: 'bad3', exerciseId: 'ex1', setNumber: 1, date: 'not-a-date', weight: 80, reps: 8, setType: 'working' },
    { id: 'bad4', exerciseId: 'ex1', setNumber: 1, date: '2026-05-03', weight: 80, reps: -3, setType: 'working' },
    { id: 'bad5', exerciseId: 'ex1', setNumber: 1, date: '2026-05-03', weight: 80, reps: 500, setType: 'working' },
    { id: 'bad6', exerciseId: 'ghost', setNumber: 1, date: '2026-05-03', weight: 80, reps: 8, setType: 'working' }
  ]);
let A7;
test('does not throw on bad records', () => { A7 = SI.analyze(dirty, KEY, { now: '2026-06-01' }); assert.ok(A7.model); });
test('invalid rows are excluded and counted', () => assert.ok(A7.history.excluded.invalid >= 4, JSON.stringify(A7.history.excluded)));
test('800 kg typo flagged anomalous and ignored by the model', () => { assert.ok(A7.history.excluded.anomalous >= 1 || A7.history.setCount <= 7); assert.ok(A7.model.E < 150, 'E=' + A7.model.E); });
test('records ignore the anomalous 800 kg', () => assert.ok(A7.records.weight.weight < 200, A7.records.weight.weight));

console.log('Scenario 8: sessions with different set counts + warm-ups');
const mixed = build([
  { date: '2026-05-01', sets: [[40, 10, 'warmup'], [80, 8], [80, 7]] },
  { date: '2026-05-05', sets: [[40, 10, 'warmup'], [60, 10, 'warmup'], [80, 8], [80, 8], [80, 7], [80, 6], [70, 10]] },
  { date: '2026-05-09', sets: [[80, 9]] },
  { date: '2026-05-13', sets: [[80, 9], [80, 8], [80, 8], [80, 7], [80, 7]] }
]);
const A8 = SI.analyze(mixed, KEY, { now: '2026-05-20' });
test('warm-ups excluded', () => assert.strictEqual(A8.history.excluded.warmup, 4 - 1 + 0 || 3));
test('works with 1–5 sets per session', () => assert.ok(A8.model && A8.model.nSessions === 4));
test('top set = first set at heaviest weight', () => assert.strictEqual(A8.history.sessions[1].topSet.reps, 8));
test('back-off sets (70 kg) are flagged', () => assert.ok(A8.history.sessions[1].sets.some(s => s.backoff)));

console.log('Scenario 9: exercise isolation');
const iso = build([{ date: '2026-05-01', sets: [[100, 5]], ex: 'exSq' }, { date: '2026-05-05', sets: [[105, 5]], ex: 'exSq' }, { date: '2026-05-09', sets: [[60, 8]] }, { date: '2026-05-13', sets: [[60, 9]] }]);
test('squat never influences bench', () => {
  const b = SI.analyze(iso, KEY, { now: '2026-05-20' }), s = SI.analyze(iso, SI.defaultIdentityKey('Squat'), { now: '2026-05-20' });
  assert.ok(b.model.E < 90, 'bench E=' + b.model.E); assert.ok(s.model.E > 110, 'squat E=' + s.model.E);
});

console.log('Calibration & accuracy');
test('model recovers a lifter with s = 1.3 (more endurance than formulas)', () => {
  const d = build(simulate(100, 1.3, 30, [75, 82.5, 90, 95], 0));
  const a = SI.analyze(d, KEY, { now: addDays('2026-01-02', 4 * 29 + 2) });
  assert.ok(a.model.personalizedShape); near(a.model.s, 1.3, 0.25, 's');
});
test('personalised model beats formula-only on a non-standard lifter', () => {
  const d = build(simulate(100, 1.3, 30, [75, 82.5, 90, 95], 0));
  const h = SI.getExerciseHistory(d, KEY), now = addDays('2026-01-02', 4 * 29 + 2);
  const m = SI.fitModel(h, { now }); const f = Object.assign({}, m, { s: 1 });
  let ep = 0, ef = 0; [75, 82.5, 90, 95].forEach(w => { const act = Math.max(1, Math.round(1 + 1.3 * (SI.repsPrior(w / 100) - 1))); ep += Math.abs(SI.predictRepetitions(m, w).repsExact - act); ef += Math.abs(SI.predictRepetitions(f, w).repsExact - act); });
  assert.ok(ep < ef, 'personal ' + ep + ' vs formula ' + ef);
});
test('backtest never uses the session it predicts', () => {
  const pts = A1.backtest.points; assert.ok(pts.length > 0); pts.forEach(p => assert.ok(p.day > 0));
  const h = SI.getExerciseHistory(big, KEY), k = h.sessions.length - 1;
  const prefix = { key: h.key, name: h.name, excluded: h.excluded, sessions: h.sessions.slice(0, k) };
  const m = SI.fitModel(prefix, { now: h.sessions[k].day }); assert.ok(m.lastDay < h.sessions[k].day);
});
test('backtest skips non-comparable sessions (big weight change / long gap)', () => {
  const d = build([[80, 8], [80, 9], [82.5, 8], [82.5, 9], [60, 15]].map((x, i) => ({ date: addDays('2026-01-01', i * 4), sets: [[x[0], x[1]]] })).concat([{ date: '2026-06-01', sets: [[82.5, 9]] }]));
  const bt = SI.backtest(SI.getExerciseHistory(d, KEY));
  assert.ok(bt.skipped.length >= 1, JSON.stringify(bt.skipped));
});
test('systematic under-prediction is corrected via bias', () => {
  // lifter improves fast → model lags → positive log errors → bias > 0
  const a = SI.analyze(build(simulate(80, 1.0, 30, [70, 75, 80], 0.012)), KEY, { now: addDays('2026-01-02', 4 * 29 + 2) });
  assert.ok(a.backtest.summary.n >= 6); assert.ok(a.model.bias >= 0, 'bias ' + a.model.bias);
});

console.log('Prediction log');
test('forecast → later session resolves comparable', () => {
  const d1 = build([{ date: '2026-05-01', sets: [[80, 8]] }, { date: '2026-05-05', sets: [[80, 9]] }, { date: '2026-05-09', sets: [[80, 9]] }]);
  const a = SI.analyze(d1, KEY, { now: '2026-05-10' });
  const rec = SI.createForecastRecord(a.history, a.forecast, '2026-05-10T00:00:00Z'); assert.strictEqual(rec.status, 'pending');
  const d2 = build([{ date: '2026-05-01', sets: [[80, 8]] }, { date: '2026-05-05', sets: [[80, 9]] }, { date: '2026-05-09', sets: [[80, 9]] }, { date: '2026-05-13', sets: [[80, 10]] }]);
  const out = SI.evaluateForecastLog([rec], SI.getExerciseHistory(d2, KEY))[0];
  assert.strictEqual(out.status, 'resolved'); assert.strictEqual(out.actual, 10); assert.strictEqual(out.error, 10 - rec.expected);
});
test('forecast vs session at a different weight → not comparable', () => {
  const d1 = build([{ date: '2026-05-01', sets: [[80, 8]] }, { date: '2026-05-05', sets: [[80, 9]] }, { date: '2026-05-09', sets: [[80, 9]] }]);
  const a = SI.analyze(d1, KEY, { now: '2026-05-10' }); const rec = SI.createForecastRecord(a.history, a.forecast);
  const d2 = build([{ date: '2026-05-01', sets: [[80, 8]] }, { date: '2026-05-05', sets: [[80, 9]] }, { date: '2026-05-09', sets: [[80, 9]] }, { date: '2026-05-13', sets: [[90, 5]] }]);
  assert.strictEqual(SI.evaluateForecastLog([rec], SI.getExerciseHistory(d2, KEY))[0].status, 'not-comparable');
});
test('pending stays pending with no later session', () => {
  const d1 = build([{ date: '2026-05-01', sets: [[80, 8]] }, { date: '2026-05-05', sets: [[80, 9]] }]);
  const a = SI.analyze(d1, KEY, { now: '2026-05-10' }); const rec = SI.createForecastRecord(a.history, a.forecast);
  assert.strictEqual(SI.evaluateForecastLog([rec], a.history)[0].status, 'pending');
});

console.log('Ranges');
test('7/30/90/all ranges filter correctly', () => {
  const d = build([0, 10, 40, 70, 100].map((n, i) => ({ date: addDays('2026-02-01', n), sets: [[80 + i, 8]] })));
  const a = SI.analyze(d, KEY, { now: addDays('2026-02-01', 101) });
  assert.strictEqual(a.trends['7'].nSessions, 1); assert.strictEqual(a.trends['30'].nSessions, 1); assert.strictEqual(a.trends['90'].nSessions, 3); assert.strictEqual(a.trends['all'].nSessions, 5);
  assert.strictEqual(a.trends['7'].direction, 'insufficient');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
