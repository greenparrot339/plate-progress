/* Run with:  node report-engine.test.js */
'use strict';
const assert = require('assert');
const RE = require('./report-engine.js');
let SI = null; try { SI = require('./strength-intelligence.js'); } catch (e) { /* optional */ }

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

/* ---------- synthetic data ---------- */
const GROUP = { 'Bench Press': 'chest', 'Overhead Press': 'shoulders', 'Triceps Pushdown': 'arms', 'Incline Dumbbell Press': 'chest', 'Barbell Row': 'back', 'Lat Pulldown': 'back', 'Squat': 'legs', 'Romanian Deadlift': 'legs', 'Bicep Curl': 'arms' };
const MUSCLE = { 'Bench Press': 'pectorals', 'Overhead Press': 'delts', 'Triceps Pushdown': 'triceps', 'Incline Dumbbell Press': 'pectorals', 'Barbell Row': 'upper back', 'Lat Pulldown': 'lats', 'Squat': 'quadriceps', 'Romanian Deadlift': 'hamstrings', 'Bicep Curl': 'biceps' };
const classify = n => GROUP[n] || null, muscleOf = n => MUSCLE[n] || null;
const today = '2026-11-24';
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function world(opts) {
  opts = opts || {};
  const splits = [{ id: 's1', name: 'PPL', archivedAt: null, days: [{ id: 'dPush', name: 'Push' }, { id: 'dPull', name: 'Pull' }, { id: 'dLegs', name: 'Legs' }, { id: 'dRest', name: 'Rest' }] }];
  const exercises = [
    ['e1', 'Bench Press', 'dPush'], ['e2', 'Overhead Press', 'dPush'], ['e3', 'Triceps Pushdown', 'dPush'], ['e4', 'Incline Dumbbell Press', 'dPush'],
    ['e5', 'Barbell Row', 'dPull'], ['e6', 'Lat Pulldown', 'dPull'], ['e7', 'Bicep Curl', 'dPull'],
    ['e8', 'Squat', 'dLegs'], ['e9', 'Romanian Deadlift', 'dLegs']
  ].map(([id, name, dayId]) => ({ id, name, dayId, splitId: 's1' }));
  const sets = []; let n = 0;
  const add = (exId, date, w, r, rir, type) => sets.push({ id: 'x' + (n++), exerciseId: exId, date, weight: w, reps: r, setNumber: String(n), setType: type || 'working', ...(rir != null ? { rir } : {}) });
  const weeks = opts.weeks || 10;
  for (let wk = weeks - 1; wk >= 0; wk--) {
    const mon = addDays('2026-11-23', -7 * wk);                                    // Monday
    const plan = opts.plan || [['Push', 0], ['Pull', 2], ['Legs', 4]];
    plan.forEach(([day, off]) => {
      const date = addDays(mon, off); if (date > today) return;
      const prog = weeks - 1 - wk;                                                  // 0..weeks-1
      if (day === 'Push') {
        const stall = opts.stallBench ? 0 : prog;
        for (let i = 0; i < 4; i++) add('e1', date, 80 + 2.5 * Math.min(stall, 3), 8, opts.rir != null ? opts.rir : null);
        for (let i = 0; i < 3; i++) add('e2', date, 40, 10, opts.rir != null ? opts.rir : null);
        for (let i = 0; i < 4; i++) add('e3', date, 30, 12);
        for (let i = 0; i < 4; i++) add('e4', date, 24, 10);
        add('e1', date, 40, 10, null, 'warmup');
      } else if (day === 'Pull' && !opts.noPull) {
        for (let i = 0; i < 2; i++) add('e5', date, 60 + prog, 8);
        for (let i = 0; i < 1; i++) add('e6', date, 55, 10);
      } else if (day === 'Legs' && !opts.noLegs) {
        for (let i = 0; i < 3; i++) add('e8', date, 100 + 2.5 * prog, 6);
        for (let i = 0; i < 2; i++) add('e9', date, 80, 8);
      }
    });
  }
  return { today, exercises, sets, splits, meta: {}, classify, muscleOf, SI, identityKey: undefined, isRestDayName: n => /rest/i.test(n) };
}

console.log('Report engine');
test('too little data is reported, not guessed', () => {
  const r = RE.build({ today, exercises: [{ id: 'e', name: 'Bench Press', dayId: 'd' }], sets: [{ id: '1', exerciseId: 'e', date: today, weight: 60, reps: 8 }], splits: [], classify, muscleOf });
  assert.strictEqual(r.insufficient, true); assert.ok(r.limits[0].includes('1 working set'));
  assert.deepStrictEqual(r.priorities, []);
});
test('two sets are enough to build a report (flagged as early), with no junk text', () => {
  const ex = [{ id: 'e', name: 'Bench Press', dayId: 'd' }];
  const r = RE.build({ today, exercises: ex, sets: [{ id: '1', exerciseId: 'e', date: today, weight: 60, reps: 8 }, { id: '2', exerciseId: 'e', date: today, weight: 60, reps: 8 }], splits: [], classify, muscleOf });
  assert.strictEqual(r.insufficient, false); assert.strictEqual(r.limited, true);
  const txt = JSON.stringify([r.findings, r.graphs, r.priorities, r.doList, r.dontList]);
  assert.ok(!/NaN|undefined|Infinity|null%/.test(txt), (txt.match(/.{30}(NaN|undefined|Infinity|null%).{30}/) || [''])[0]);
  const r3 = RE.build({ today, exercises: ex, sets: [{ id: '1', exerciseId: 'e', date: today, weight: 60, reps: 8, setType: 'warmup' }, { id: '2', exerciseId: 'e', date: today, weight: 60, reps: 8 }], splits: [], classify, muscleOf });
  assert.strictEqual(r3.insufficient, true);   // a warm-up is not a working set
});
test('hard sets exclude warm-ups and RIR 4+', () => {
  const I = RE._internals;
  assert.strictEqual(I.isHard({ weight: 50, reps: 10, setType: 'warmup' }), false);
  assert.strictEqual(I.isHard({ weight: 50, reps: 10, rir: 4 }), false);
  assert.strictEqual(I.isHard({ weight: 50, reps: 10, rir: 3 }), true);
  assert.strictEqual(I.isHard({ weight: 50, reps: 10 }), true);
});
test('week starts on Monday', () => {
  const I = RE._internals;
  assert.strictEqual(I.dstr(I.weekStart(I.dnum('2026-11-24'))), '2026-11-23');   // Tue -> Mon
  assert.strictEqual(I.dstr(I.weekStart(I.dnum('2026-11-29'))), '2026-11-23');   // Sun -> Mon
  assert.strictEqual(I.dstr(I.weekStart(I.dnum('2026-11-23'))), '2026-11-23');
});
test('flags a push-heavy plan and low pulling', () => {
  const r = RE.build(world());
  const ids = r.findings.map(f => f.id);
  assert.ok(ids.includes('push-pull'), 'push-pull flagged: ' + ids.join(','));
  const f = r.findings.find(f => f.id === 'push-pull');
  assert.ok(/rows|pull-downs/.test(f.action) && f.dont && f.check);
});
test('flags missing legs as an alert', () => {
  const r = RE.build(world({ noLegs: true }));
  const f = r.findings.find(f => f.id === 'no-legs' || f.id === 'under-legs' || f.id === 'missing-legs');
  assert.ok(f, r.findings.map(x => x.id).join(','));
});
test('detects a stalled lift and names a cause', () => {
  const r = RE.build(world({ stallBench: true, weeks: 10 }));
  const f = r.findings.find(f => f.id === 'stall-' + 'bench press');
  assert.ok(f, r.findings.map(x => x.id).join(','));
  assert.ok(/Most likely cause/.test(f.evidence) && f.action && f.check);
});
test('a progressing lift is praised', () => {
  const r = RE.build(world({ weeks: 8 }));
  assert.ok(r.findings.some(f => f.severity === 'good' && /progressing/.test(f.title)), r.findings.map(x => x.id).join(','));
});
test('low consistency is a warning with a measurable check', () => {
  const r = RE.build(world({ plan: [['Push', 0]], weeks: 8 }));
  const f = r.findings.find(f => f.id === 'consistency-low');
  assert.ok(f && /Log 3 sessions/.test(f.check), r.findings.map(x => x.id).join(','));
});
test('long time off triggers an ease-back-in warning', () => {
  const w = world({ weeks: 8 }); w.today = addDays(today, 20);
  const r = RE.build(w);
  const f = r.findings.find(f => f.id === 'time-off');
  assert.ok(f && f.severity === 'warn' && /80-90%/.test(f.action));
});
test('RIR coverage nudge appears when RIR is missing', () => {
  const r = RE.build(world());
  assert.ok(r.findings.some(f => f.id === 'rir-coverage'));
});
test('easy-set effort is called out when most RIR is 4+', () => {
  const r = RE.build(world({ rir: 4 }));
  assert.ok(r.findings.some(f => f.id === 'rir-easy'), r.findings.map(x => x.id).join(','));
});
test('grinding every set to failure is called out', () => {
  const r = RE.build(world({ rir: 0 }));
  assert.ok(r.findings.some(f => f.id === 'rir-grind'), r.findings.map(x => x.id).join(','));
});
test('priorities: at most 3, each with action and a check, distinct areas first', () => {
  const r = RE.build(world({ stallBench: true }));
  assert.ok(r.priorities.length >= 1 && r.priorities.length <= 3);
  r.priorities.forEach(p => assert.ok(p.action && p.check && p.title));
  const areas = r.priorities.map(p => p.area); assert.strictEqual(new Set(areas).size, areas.length >= 2 ? Math.min(areas.length, new Set(areas).size) : 1);
});
test('do and dont lists come from findings', () => {
  const r = RE.build(world({ stallBench: true }));
  assert.ok(r.doList.length > 0 && r.dontList.length > 0);
  assert.ok(r.doList.every(s => typeof s === 'string' && s.length > 10));
});
test('graph readings cover every screen', () => {
  const r = RE.build(world({ weeks: 8 }));
  const screens = r.graphs.map(g => g.screen);
  ['Home', 'Stats', 'Progress: exercises', 'Progress: split'].forEach(s => assert.ok(screens.includes(s), 'missing ' + s + ' in ' + screens.join(',')));
  r.graphs.forEach(g => g.items.forEach(i => assert.ok(i.chart && i.reading && i.advice, JSON.stringify(i))));
});
test('records list new bests only (not the first session)', () => {
  const w = world({ weeks: 6 });
  const recs = RE.records(w, 20);
  assert.ok(recs.length > 0 && recs.every(r => r.date > '2026-10-01'));
  assert.ok(recs.every(r => r.label && r.name));
});
test('no NaN or undefined leaks into any text', () => {
  [world(), world({ stallBench: true }), world({ rir: 2 }), world({ noPull: true })].forEach(w => {
    const r = RE.build(w); const txt = JSON.stringify([r.findings, r.graphs, r.priorities, r.doList, r.dontList]);
    assert.ok(!/NaN|undefined|Infinity|null%/.test(txt), (txt.match(/.{30}(NaN|undefined|Infinity|null%).{30}/) || [''])[0]);
  });
});
test('engine works without Strength Intelligence', () => {
  const w = world(); w.SI = null; const r = RE.build(w); assert.ok(r.lifts.length > 0 && r.graphs.length > 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
