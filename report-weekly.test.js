/* Run with:  node report-weekly.test.js */
'use strict';
const assert = require('assert');
const RW = require('./report-weekly.js');
let passed = 0, failed = 0;
function test(n, fn) { try { fn(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + (e && e.stack || e)); } }
const GROUP = { 'Bench Press': 'chest', 'Overhead Press': 'shoulders', 'Triceps Pushdown': 'arms', 'Incline Dumbbell Press': 'chest', 'Barbell Row': 'back', 'Lat Pulldown': 'back', 'Squat': 'legs', 'Romanian Deadlift': 'legs', 'Bicep Curl': 'arms' };
const MUSCLE = { 'Bench Press': 'pectorals', 'Overhead Press': 'delts', 'Triceps Pushdown': 'triceps', 'Incline Dumbbell Press': 'pectorals', 'Barbell Row': 'upper back', 'Lat Pulldown': 'lats', 'Squat': 'quadriceps', 'Romanian Deadlift': 'hamstrings', 'Bicep Curl': 'biceps' };
const classify = n => GROUP[n] || null, muscleOf = n => MUSCLE[n] || null;
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const MON = '2026-11-23';            // Monday of the "current" week; today = Sunday 29th unless stated

function world(o) {
  o = o || {};
  const splits = [{ id: 's1', name: 'PPL', archivedAt: null, days: [{ id: 'dPush', name: 'Push' }, { id: 'dPull', name: 'Pull' }, { id: 'dLegs', name: 'Legs' }, { id: 'dRest', name: 'Rest' }] }];
  const exercises = [['e1', 'Bench Press', 'dPush'], ['e2', 'Overhead Press', 'dPush'], ['e3', 'Triceps Pushdown', 'dPush'], ['e4', 'Incline Dumbbell Press', 'dPush'], ['e5', 'Barbell Row', 'dPull'], ['e6', 'Lat Pulldown', 'dPull'], ['e7', 'Bicep Curl', 'dPull'], ['e8', 'Squat', 'dLegs'], ['e9', 'Romanian Deadlift', 'dLegs']].map(([id, name, dayId]) => ({ id, name, dayId, splitId: 's1' }));
  const sets = []; let n = 0;
  const add = (ex, date, w, r, rir, type) => sets.push({ id: 'x' + n++, exerciseId: ex, date, weight: w, reps: r, setNumber: String(n), setType: type || 'working', ...(rir != null ? { rir } : {}) });
  // weeks: 0 = current, 1 = last, ...
  for (let wk = (o.weeks || 4) - 1; wk >= 0; wk--) {
    const mon = addDays(MON, -7 * wk), cfg = (o.week && o.week[wk]) || {};
    const prog = (o.weeks || 4) - 1 - wk;
    const rir = cfg.rir != null ? cfg.rir : (o.rir != null ? o.rir : null);
    (cfg.plan || o.plan || [['Push', 0], ['Pull', 2], ['Legs', 4]]).forEach(([day, off]) => {
      const date = addDays(mon, off);
      const bump = cfg.bench != null ? cfg.bench : 2.5 * prog;
      if (day === 'Push') {
        const ps = cfg.pushSets || 4;
        for (let i = 0; i < ps; i++) add('e1', date, 80 + bump, cfg.benchReps || 8, rir);
        for (let i = 0; i < 3; i++) add('e2', date, 40, 10, rir);
        for (let i = 0; i < 3; i++) add('e3', date, 30, 12, rir);
        add('e1', date, 40, 10, null, 'warmup');
      } else if (day === 'Pull') { for (let i = 0; i < (cfg.pullSets || 2); i++) add('e5', date, 60 + prog, 8, rir); add('e6', date, 55, 10, rir); add('e7', date, 14, 12, rir); }
      else if (day === 'Legs') { for (let i = 0; i < 3; i++) add('e8', date, 100 + 2.5 * prog, 6, rir); for (let i = 0; i < 2; i++) add('e9', date, 80, 8, rir); }
    });
  }
  return { today: o.today || addDays(MON, 6), exercises, sets, splits, meta: o.meta || {}, classify, muscleOf, isRestDayName: n => /rest/i.test(n) };
}
const ids = r => r.findings.map(f => f.id).join(',');

console.log('Weekly report');
test('no sets in the week is reported, not guessed', () => {
  const w = world({ weeks: 2 }); w.today = addDays(MON, 20);
  const r = RW.build(w); assert.strictEqual(r.insufficient, true); assert.ok(/No sets were logged/.test(r.limits[0]));
});
test('week window is Monday-Sunday and partial flag works', () => {
  const r = RW.build(world()); assert.strictEqual(r.weekStart, '2026-11-23'); assert.strictEqual(r.weekEnd, '2026-11-29'); assert.strictEqual(r.partial, false);
  const p = RW.build(world({ today: '2026-11-25' })); assert.strictEqual(p.partial, true); assert.strictEqual(p.dayOfWeek, 3);
});
test('which:last selects the previous week', () => {
  const r = RW.build(world({ today: '2026-11-25' }), { which: 'last' }); assert.strictEqual(r.weekStart, '2026-11-16'); assert.strictEqual(r.partial, false);
});
test('compares with previous logged week, skipping empty weeks', () => {
  const r = RW.build(world({ weeks: 4, week: { 1: { plan: [] } } }));
  assert.ok(r.compare.has); assert.strictEqual(r.compare.start, '2026-11-09'); assert.ok(/previous logged week/.test(r.compare.label));
});
test('partial week compares same days of the previous week', () => {
  const r = RW.build(world({ today: '2026-11-25' })); assert.ok(r.compare.sameDays);
  assert.strictEqual(r.totals.cur.sessions, 2);   // Mon Push + Wed Pull
});
test('totals, hard sets exclude warm-ups and RIR 4+', () => {
  const r = RW.build(world({ rir: 4 })); assert.strictEqual(r.totals.cur.hardSets, 0);
  const r2 = RW.build(world()); assert.ok(r2.totals.cur.hardSets >= 19); assert.ok(r2.totals.d.hard != null);
});
test('missed planned session is flagged with a catch-up action', () => {
  const r = RW.build(world({ week: { 0: { plan: [['Push', 0], ['Pull', 2]] } } }));
  const f = r.findings.find(f => f.id === 'w-sessions-low'); assert.ok(f, ids(r)); assert.ok(/Legs/.test(f.evidence) && /next 2-3 days/.test(f.action) && f.why && f.level);
  assert.ok(r.days.find(d => d.name === 'Legs').status === 'missed');
});
test('in-progress week does not call pending days missed', () => {
  const r = RW.build(world({ today: '2026-11-25' })); assert.ok(r.days.every(d => d.status !== 'missed')); assert.ok(r.findings.some(f => f.id === 'w-sessions-prog'));
});
test('low muscle volume on a finished week is a warning with a number', () => {
  const r = RW.build(world()); const f = r.findings.find(f => /^w-vol-low-/.test(f.id)); assert.ok(f, ids(r)); assert.ok(/hard sets/.test(f.title) && f.action && f.level === 'Strong evidence');
});
test('high volume above 20 sets is flagged', () => {
  const r = RW.build(world({ week: { 0: { pushSets: 12, plan: [['Push', 0], ['Push', 2], ['Pull', 3], ['Legs', 4]] } } })); assert.ok(r.findings.some(f => f.id === 'w-vol-high-chest'), ids(r));
});
test('more than 10 sets in one session triggers the per-session cap', () => {
  const r = RW.build(world({ week: { 0: { pushSets: 12 } } })); const f = r.findings.find(f => f.id === 'w-cap-chest'); assert.ok(f, ids(r)); assert.strictEqual(f.level, 'Practical guideline');
});
test('push-heavy week flags push:pull', () => {
  const r = RW.build(world()); assert.ok(r.findings.some(f => f.id === 'w-push-pull'), ids(r));
});
test('progression: a heavier bench is "up", same weight fewer reps is not', () => {
  const up = RW.build(world({ week: { 0: { bench: 10 }, 1: { bench: 5 } } })); const b = up.lifts.find(l => l.name === 'Bench Press'); assert.strictEqual(b.verdict, 'up'); assert.ok(b.change > 1.5);
  const dn = RW.build(world({ week: { 0: { bench: 0 }, 1: { bench: 10 } } })); assert.strictEqual(dn.lifts.find(l => l.name === 'Bench Press').verdict, 'down');
});
test('next-week targets use double progression', () => {
  const r = RW.build(world({ week: { 0: { benchReps: 12, bench: 5 }, 1: { bench: 5 } } })); const b = r.lifts.find(l => l.name === 'Bench Press');
  assert.strictEqual(b.target.kind, 'weight'); assert.ok(b.target.weight > 85);
  const r2 = RW.build(world()); assert.strictEqual(r2.lifts.find(l => l.name === 'Bench Press').target.kind, 'reps');
});
test('easy sets (RIR 4) are called out; grinding (RIR 0) is called out', () => {
  assert.ok(RW.build(world({ rir: 4 })).findings.some(f => f.id === 'w-rir-easy'));
  assert.ok(RW.build(world({ rir: 0 })).findings.some(f => f.id === 'w-rir-grind'));
  assert.ok(RW.build(world({ rir: 2 })).findings.some(f => f.id === 'w-rir-good'));
});
test('missing RIR asks to log it', () => { assert.ok(RW.build(world()).findings.some(f => f.id === 'w-rir-cov')); });
test('volume spike vs previous week is a warning', () => {
  const r = RW.build(world({ week: { 0: { pushSets: 8, pullSets: 6 }, 1: { pushSets: 3 } } })); assert.ok(r.findings.some(f => f.id === 'w-vol-spike'), ids(r));
});
test('several lifts falling plus hard effort suggests a lighter week', () => {
  const r = RW.build(world({ rir: 0, week: { 0: { bench: -10 }, 1: { bench: 5 } } }));
  // bench falls; make legs fall too
  const w = world({ rir: 0, week: { 0: { bench: -10 }, 1: { bench: 5 } } }); w.sets.forEach(s => { if (s.exerciseId === 'e8' && s.date >= '2026-11-23') s.weight = 80; if (s.exerciseId === 'e5' && s.date >= '2026-11-23') s.weight = 40; });
  const r2 = RW.build(w); assert.ok(r2.findings.some(f => f.id === 'w-lifts-down'), ids(r2)); assert.ok(r2.findings.some(f => f.id === 'w-deload'), ids(r2));
});
test('every finding carries a science note when it gives advice', () => {
  [world(), world({ rir: 0 }), world({ rir: 4 }), world({ week: { 0: { pushSets: 14 } } })].forEach(w => RW.build(w).findings.forEach(f => { if (f.severity !== 'good' && f.action && f.id !== 'w-sessions-prog') assert.ok(f.why && f.level, f.id + ' lacks why/level'); }));
});
test('priorities: max 3, each with action, why and a check', () => {
  const r = RW.build(world()); assert.ok(r.priorities.length >= 1 && r.priorities.length <= 3); r.priorities.forEach(p => assert.ok(p.action && p.check && p.title));
});
test('plan gives set targets per muscle and a target per lift', () => {
  const r = RW.build(world()); assert.ok(r.plan.muscles.length >= 4 && r.plan.lifts.length >= 3);
  const low = r.plan.muscles.find(m => m.note === 'build up'); if (low) assert.ok(low.target > low.now && low.target <= 10);
});
test('checks and headline are produced', () => {
  const r = RW.build(world({ rir: 2 })); assert.strictEqual(r.checks.length, 4); assert.ok(/week/i.test(r.headline));
});
test('first logged week has no baseline and says so', () => {
  const r = RW.build(world({ weeks: 1 })); assert.strictEqual(r.compare.has, false); assert.ok(r.findings.some(f => f.id === 'w-first'));
});
test('no NaN / undefined / Infinity leaks into any text', () => {
  [world(), world({ rir: 0 }), world({ rir: 4 }), world({ rir: 2 }), world({ weeks: 1 }), world({ today: '2026-11-25' }), world({ week: { 0: { plan: [['Push', 0]] } } })].forEach(w => {
    const r = RW.build(w), txt = JSON.stringify([r.findings, r.priorities, r.plan, r.days, r.lifts, r.checks, r.headline]);
    assert.ok(!/NaN|undefined|Infinity|null%/.test(txt), (txt.match(/.{30}(NaN|undefined|Infinity|null%).{30}/) || [''])[0]);
  });
});
test('science table is complete', () => { RW.SCIENCE.forEach(s => assert.ok(s.topic && s.rule && s.level && s.ref)); });
console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
