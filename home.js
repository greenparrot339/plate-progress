/* ============================================================
   Plate & Progress — HOME screen
   ------------------------------------------------------------
   Today card, weekly rings, month calendar, records, muscle
   balance, coach notes, top lifts and the downloadable report.
   Everything is derived from local data; nothing is stored here
   except the optional weekly session goal (DB_META.weeklyGoal).

   Uses these globals from index.html at call time:
     DB, DB_META, state, todayStr, fmtDate, esc, toast, goToTab,
     activeSplit, dayById, isRestDay, isRestDayName, exerciseById,
     exercisesOfDay, allLoggedSessions, historySessionsForDay,
     isHardSet, hasRir, setRir, isCountedLoggedSet, isWarmupSet,
     classifyExercise, builtInExerciseRecord, exerciseIdentityKey,
     saveMeta, idbGet, render
   and ReportEngine / ReportPDF / StrengthIntelligence.
   ============================================================ */
(function () {
  'use strict';

  var GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];
  var GLABEL = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', core: 'Core' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  var viewMonth = null;           // {y, m} shown on the calendar
  var ringMode = 0;               // 0 sessions, 1 hard sets, 2 muscles
  var openNote = null;            // expanded coach note id
  var reportCache = { key: null, rep: null };
  var lastTap = { date: null, t: 0, timer: null };
  var slide = '';                 // calendar slide direction for the next render

  /* ---------- small utils ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ds(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function dnum(s) { var p = String(s).slice(0, 10).split('-'); return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function dstr(n) { var d = new Date(n * 86400000); return ds(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function weekStart(n) { return n - ((n + 3) % 7); }
  function nfmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function ago(date, today) {
    var d = dnum(today) - dnum(date);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? d + ' days ago' : d < 60 ? Math.round(d / 7) + ' weeks ago' : Math.round(d / 30) + ' months ago';
  }

  /* ---------- data ---------- */
  function homeCtx() {
    return {
      today: todayStr(), exercises: DB.exercises, sets: DB.sets, splits: DB.splits, meta: DB_META,
      classify: function (n) { try { return classifyExercise(n); } catch (e) { return null; } },
      muscleOf: function (n) { try { var r = builtInExerciseRecord(n); return r && r.primary_muscle ? String(r.primary_muscle).toLowerCase() : null; } catch (e) { return null; } },
      identityKey: exerciseIdentityKey, isRestDayName: isRestDayName, SI: window.StrengthIntelligence || null, ReportEngine: window.ReportEngine || null
    };
  }
  function dataKey() {
    var t = 0, i, s;
    for (i = 0; i < DB.sets.length; i++) { s = DB.sets[i]; t = (t * 31 + (Number(s.weight) || 0) * 7 + (Number(s.reps) || 0) * 3 + (s.rir == null ? 9 : s.rir) + (s.setType === 'warmup' ? 1 : 0)) % 1000000007; }
    return [todayStr(), DB.sets.length, DB.exercises.length, t, DB_META.weeklyGoal || 0, DB.splits.length].join('|');
  }
  function getReport(force) {
    var k = dataKey();
    if (!force && reportCache.key === k && reportCache.rep) return reportCache.rep;
    var rep = null;
    try { if (window.ReportEngine) rep = ReportEngine.build(homeCtx()); } catch (e) { console.warn('Report build failed', e); }
    reportCache = { key: k, rep: rep };
    return rep;
  }
  function weeklyGoal(split) {
    if (DB_META.weeklyGoal) return Number(DB_META.weeklyGoal);
    if (split) return Math.max(2, Math.min(7, (split.days || []).filter(function (d) { return !isRestDay(d); }).length)) || 3;
    return 3;
  }
  // Same rule the Log tab uses (scheduledDay in index.html): the split follows the calendar,
  // so a skipped day is "missed" and today shows the day after it.
  function plannedDay(split, sessions, today) {
    if (!split || !(split.days || []).length) return null;
    var ids = split.days.map(function (d) { return d.id; });
    var inSplit = sessions.filter(function (s) { return ids.indexOf(s.dayId) >= 0 && s.date <= today; });
    var doneToday = inSplit.filter(function (s) { return s.date === today; })[0] || null;
    if (doneToday) return { day: dayById(doneToday.dayId), done: doneToday, missed: [] };
    var sd = scheduledDay(split, inSplit, today);
    return { day: split.days[sd.idx], done: null, missed: sd.missed.map(function (m) { return { day: dayById(m.dayId), daysAgo: m.daysAgo }; }).filter(function (m) { return m.day; }).reverse() };
  }
  function sessionStats(s) {
    var work = s.sets.filter(function (x) { return !isWarmupSet(x) && isCountedLoggedSet(x); });
    return { hard: work.filter(isHardSet).length, sets: work.length, volume: s.volume };
  }
  function recordsByDate(ctx) {
    var map = {}, list = [];
    try { if (window.ReportEngine) list = ReportEngine.records(ctx, 400); } catch (e) { list = []; }
    list.forEach(function (r) { map[r.date] = (map[r.date] || 0) + 1; });
    return { map: map, list: list };
  }

  /* ---------- icons ---------- */
  var I = {
    flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2s5 4.2 5 9.2c0 1.2-.4 2.1-.9 2.8.1-1.6-.8-3-2.1-3.8.3 2-.6 3.3-1.6 4.3-1.2 1.2-2.4 2.1-2.4 4.1A4.9 4.9 0 0 0 12 22a6.5 6.5 0 0 0 6.5-6.6C18.5 8.4 12 2 12 2z"/></svg>',
    medal: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="15" r="6"/><path d="M8.5 3l3.5 6 3.5-6M12 12.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2L9.1 14.3l2-.3z" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke-linecap="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" stroke-linejoin="round"/></svg>',
    dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke-linecap="round"/></svg>'
  };

  /* ---------- styles (injected once) ---------- */
  function ensureCss() {
    if (document.getElementById('hm-css')) return;
    var st = document.createElement('style'); st.id = 'hm-css';
    st.textContent = [
      '.hm{display:flex;flex-direction:column;gap:12px;}',
      '.hm .hm-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 15px;margin:0;position:relative;overflow:hidden;}',
      '.hm .hm-in{animation:hmUp .5s cubic-bezier(.2,.8,.2,1) both;}',
      '@keyframes hmUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
      '.hm-eyebrow{font-family:var(--font-display);font-weight:500;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.hm-eyebrow small{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.04em;color:var(--text-faint);text-transform:none;font-weight:400;}',
      '.hm svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;}',
      /* today */
      '.hm-today{background:linear-gradient(160deg,#241f12 0%,var(--surface) 62%);border-color:#3a3320;}',
      '.hm-today .hm-hello{font-size:12px;color:var(--text-dim);margin-bottom:2px;}',
      '.hm-today h2{font-size:26px;line-height:1.1;margin:0 0 4px;}',
      '.hm-today .hm-sub{font-size:12.5px;color:var(--text-dim);margin-bottom:10px;}',
      '.hm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}',
      '.hm-chip{font-family:var(--font-mono);font-size:10.5px;color:var(--text-dim);border:1px solid var(--border);border-radius:999px;padding:3px 9px;background:rgba(255,255,255,.02);}',
      '.hm-prog{height:8px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden;margin:2px 0 4px;}',
      '.hm-prog i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent-dim),var(--accent));transition:width .5s cubic-bezier(.2,.8,.2,1);}',
      '.hm-missed{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:-2px 0 12px;padding:8px 10px;border:1px dashed var(--border);border-radius:10px;font-size:12px;color:var(--text-dim);}',
      '.hm-missed button{background:none;border:0;color:var(--accent);font-weight:700;font-size:12px;padding:4px 2px;white-space:nowrap;}',
      '.hm-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:0;border-radius:var(--radius);padding:13px;font-weight:700;font-size:15px;background:var(--accent);color:#1A1200;position:relative;overflow:hidden;transition:transform .12s ease,filter .12s;}',
      '.hm-btn:active{transform:scale(.97);filter:brightness(.95);}',
      '.hm-btn svg{width:16px;height:16px;fill:currentColor;stroke:none;}',
      '.hm-btn.shine::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.4),transparent);transform:skewX(-20deg);animation:hmShine 3.4s ease-in-out infinite;}',
      '@keyframes hmShine{0%,55%{left:-60%}100%{left:130%}}',
      '.hm-btn.ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border);font-weight:600;}',
      '.hm-rest{display:flex;align-items:center;gap:12px;}',
      '.hm-rest svg{width:34px;height:34px;color:var(--accent);animation:hmFloat 4s ease-in-out infinite;}',
      '@keyframes hmFloat{50%{transform:translateY(-4px) rotate(-6deg)}}',
      '.hm-done{display:flex;align-items:center;gap:10px;}',
      '.hm-done .hm-tick{width:38px;height:38px;border-radius:50%;background:var(--good-dim);color:var(--good);display:grid;place-items:center;flex:none;animation:hmPop .5s cubic-bezier(.2,1.6,.4,1) both;}',
      '.hm-done .hm-tick svg{width:20px;height:20px;stroke-width:2.6;}',
      '@keyframes hmPop{from{transform:scale(.2);opacity:0}to{transform:none;opacity:1}}',
      /* week */
      '.hm-week{display:flex;gap:14px;align-items:center;}',
      '.hm-rings{position:relative;width:128px;height:128px;flex:none;cursor:pointer;-webkit-user-select:none;user-select:none;}',
      '.hm-rings svg{width:128px;height:128px;transform:rotate(-90deg);stroke-width:7.5;stroke-linecap:round;}',
      '.hm-rings .trk{stroke:var(--surface2);}',
      '.hm-rings .arc{transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1);}',
      '.hm-rings .mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center;}',
      '.hm-rings .mid b{font-family:var(--font-mono);font-size:19px;line-height:1;}',
      '.hm-rings .mid span{font-size:8.5px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-top:3px;}',
      '.hm-rings:active .mid{transform:scale(.94);}',
      '.hm-legend{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;}',
      '.hm-leg{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim);}',
      '.hm-leg i{width:9px;height:9px;border-radius:3px;flex:none;}',
      '.hm-leg b{margin-left:auto;font-family:var(--font-mono);font-size:12px;color:var(--text);}',
      '.hm-leg.on{color:var(--text);}',
      '.hm-goal{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:11px;color:var(--text-faint);}',
      '.hm-goal button{width:24px;height:24px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text);display:grid;place-items:center;padding:0;}',
      '.hm-goal button svg{width:12px;height:12px;stroke-width:2.4;}',
      '.hm-goal button:active{transform:scale(.88);}',
      '.hm-days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:14px;}',
      '.hm-d{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:10px;color:var(--text-faint);font-family:var(--font-mono);}',
      '.hm-d i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--border);color:#1A1200;font-style:normal;transition:transform .15s;}',
      '.hm-d i svg{width:14px;height:14px;stroke-width:3;}',
      '.hm-d.on i{background:var(--accent);border-color:var(--accent);animation:hmPop .45s cubic-bezier(.2,1.6,.4,1) both;}',
      '.hm-d.today i{border-color:var(--accent);box-shadow:0 0 0 0 rgba(232,179,44,.5);animation:hmPulse 2.2s ease-out infinite;}',
      '.hm-d.today.on i{animation:hmPop .45s both;}',
      '.hm-d.fut{opacity:.45;}',
      '.hm-d:active i{transform:scale(.88);}',
      '@keyframes hmPulse{70%{box-shadow:0 0 0 8px rgba(232,179,44,0)}100%{box-shadow:0 0 0 0 rgba(232,179,44,0)}}',
      '.hm-streak{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--accent-dim);background:rgba(232,179,44,.08);color:var(--accent);border-radius:999px;padding:3px 10px 3px 7px;font-family:var(--font-mono);font-size:11px;cursor:pointer;}',
      '.hm-streak svg{width:14px;height:14px;fill:var(--accent);stroke:none;transform-origin:50% 90%;animation:hmFlame 1.6s ease-in-out infinite;}',
      '.hm-streak.cold{color:var(--text-faint);border-color:var(--border);background:none;}.hm-streak.cold svg{fill:var(--text-faint);animation:none;}',
      '@keyframes hmFlame{0%,100%{transform:scale(1) rotate(-3deg)}50%{transform:scale(1.14) rotate(3deg)}}',
      '.hm-streak.wiggle svg{animation:hmWig .5s ease both;}@keyframes hmWig{30%{transform:scale(1.5) rotate(-14deg)}60%{transform:scale(1.3) rotate(12deg)}}',
      /* calendar */
      '.hm-calhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}',
      '.hm-calhead h3{font-size:15px;letter-spacing:.04em;}',
      '.hm-nav{display:flex;gap:6px;}',
      '.hm-nav button{width:32px;height:32px;border-radius:9px;border:1px solid var(--border);background:var(--surface2);color:var(--text);display:grid;place-items:center;padding:0;}',
      '.hm-nav button:active{transform:scale(.9);}.hm-nav button:disabled{opacity:.3;}',
      '.hm-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;}',
      '.hm-cal.s-l{animation:hmSlL .28s ease both;}.hm-cal.s-r{animation:hmSlR .28s ease both;}',
      '@keyframes hmSlL{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:none}}@keyframes hmSlR{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:none}}',
      '.hm-dow{text-align:center;font-family:var(--font-mono);font-size:10px;color:var(--text-faint);padding-bottom:2px;}',
      '.hm-c{position:relative;aspect-ratio:1/1.08;border-radius:9px;border:1px solid transparent;background:transparent;color:var(--text-dim);font-family:var(--font-mono);font-size:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;gap:1px;overflow:hidden;-webkit-user-select:none;user-select:none;transition:transform .12s;}',
      '.hm-c.blank{visibility:hidden;}',
      '.hm-c.fut{opacity:.35;}',
      '.hm-c .n{line-height:1;}',
      '.hm-c .l{font-size:8.5px;line-height:1;letter-spacing:.04em;opacity:.85;font-weight:700;}',
      '.hm-c.t{color:#1A1200;font-weight:700;border-color:rgba(232,179,44,.5);animation:hmCellIn .4s cubic-bezier(.2,1.4,.4,1) both;animation-delay:calc(var(--i)*14ms);}',
      '.hm-c.t.h1{background:rgba(232,179,44,.38);color:var(--text);}.hm-c.t.h2{background:rgba(232,179,44,.62);}.hm-c.t.h3{background:rgba(232,179,44,.84);}.hm-c.t.h4{background:var(--accent);}',
      '@keyframes hmCellIn{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}',
      '.hm-c.today{border-color:var(--accent);box-shadow:0 0 0 0 rgba(232,179,44,.5);animation:hmPulse 2.4s ease-out infinite;color:var(--accent);font-weight:700;}',
      '.hm-c.today.t{color:#1A1200;}',
      '.hm-c:not(.blank):not(.fut):active{transform:scale(.9);}',
      '.hm-c .pr{position:absolute;top:2px;right:3px;width:9px;height:9px;fill:#fff3c4;stroke:none;}',
      '.hm-c .rp{position:absolute;border-radius:50%;background:rgba(255,255,255,.55);transform:scale(0);animation:hmRip .5s ease-out forwards;pointer-events:none;}',
      '@keyframes hmRip{to{transform:scale(4);opacity:0}}',
      '.hm-calfoot{display:flex;justify-content:space-between;gap:8px;margin-top:10px;font-size:11px;color:var(--text-faint);flex-wrap:wrap;}',
      '.hm-calfoot b{color:var(--text-dim);font-family:var(--font-mono);font-weight:600;}',
      '.hm-hint{font-size:10.5px;color:var(--text-faint);margin-top:8px;text-align:center;}',
      /* stat tiles */
      '.hm-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
      '.hm-tile{background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:10px 11px;}',
      '.hm-tile .k{font-size:10px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.07em;}',
      '.hm-tile .v{font-family:var(--font-mono);font-size:21px;margin-top:3px;line-height:1.1;}',
      '.hm-tile .v small{font-size:11px;color:var(--text-dim);margin-left:2px;}',
      '.hm-tile .s{font-size:10.5px;margin-top:3px;color:var(--text-faint);}',
      '.hm-up{color:var(--good)!important;}.hm-dn{color:var(--rust)!important;}',
      /* records */
      '.hm-rec{display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid var(--border);}',
      '.hm-rec:first-of-type{border-top:0;padding-top:2px;}',
      '.hm-medal{width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#f7d77a,#c8921a);color:#4a3200;cursor:pointer;box-shadow:0 2px 8px rgba(200,146,26,.25);}',
      '.hm-medal svg{width:18px;height:18px;stroke-width:1.9;}',
      '.hm-medal.spin{animation:hmSpin .7s cubic-bezier(.3,1.4,.5,1);}@keyframes hmSpin{to{transform:rotateY(360deg) scale(1.15)}}',
      '.hm-rec .nm{font-size:13.5px;font-weight:600;}',
      '.hm-rec .dt{font-size:11px;color:var(--text-faint);margin-top:1px;}',
      '.hm-rec .when{margin-left:auto;font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);text-align:right;white-space:nowrap;}',
      '.hm-empty{font-size:12.5px;color:var(--text-faint);padding:6px 0 2px;line-height:1.5;}',
      /* balance */
      '.hm-bal{display:flex;flex-direction:column;gap:9px;}',
      '.hm-br{display:grid;grid-template-columns:70px 1fr 34px;gap:8px;align-items:center;cursor:pointer;}',
      '.hm-br .nm{font-size:12px;color:var(--text-dim);}',
      '.hm-br .tr{height:10px;border-radius:5px;background:var(--surface2);position:relative;overflow:visible;}',
      '.hm-br .fl{position:absolute;left:0;top:0;bottom:0;border-radius:5px;width:0;transition:width .9s cubic-bezier(.2,.8,.2,1);}',
      '.hm-br .tk{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--text);opacity:.55;border-radius:1px;}',
      '.hm-br .vl{font-family:var(--font-mono);font-size:11.5px;text-align:right;}',
      '.hm-br:active .tr{transform:scaleY(1.4);}',
      '.hm-bnote{font-size:10.5px;color:var(--text-faint);margin-top:9px;line-height:1.5;}',
      /* notes */
      '.hm-note{border:1px solid var(--border);border-left:3px solid var(--border);border-radius:9px;background:var(--surface2);padding:10px 12px;cursor:pointer;transition:transform .12s;}',
      '.hm-note + .hm-note{margin-top:8px;}',
      '.hm-note:active{transform:scale(.985);}',
      '.hm-note.warn{border-left-color:var(--accent);}.hm-note.alert{border-left-color:var(--rust);}.hm-note.good{border-left-color:var(--good);}',
      '.hm-note .t{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:8px;}',
      '.hm-note .t svg{width:14px;height:14px;margin-left:auto;transition:transform .25s;color:var(--text-faint);}',
      '.hm-note.open .t svg{transform:rotate(90deg);}',
      '.hm-note .e{font-size:12px;color:var(--text-dim);margin-top:4px;line-height:1.45;}',
      '.hm-note .x{display:none;margin-top:8px;font-size:12.5px;line-height:1.5;}',
      '.hm-note.open .x{display:block;animation:hmUp .3s both;}',
      '.hm-note .x b{color:var(--accent);font-weight:600;}',
      /* lifts */
      '.hm-scroll{display:flex;gap:9px;overflow-x:auto;margin:0 -15px;padding:2px 15px 4px;scroll-snap-type:x proximity;}',
      '.hm-lift{flex:none;width:148px;scroll-snap-align:start;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 11px;cursor:pointer;transition:transform .12s;}',
      '.hm-lift:active{transform:scale(.96);}',
      '.hm-lift .nm{font-size:12px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.hm-lift .v{font-family:var(--font-mono);font-size:20px;margin:4px 0 2px;}.hm-lift .v small{font-size:10.5px;color:var(--text-faint);margin-left:2px;}',
      '.hm-lift .tr{font-family:var(--font-mono);font-size:10.5px;}',
      '.hm-lift svg.sp{width:100%;height:30px;margin-top:6px;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;}',
      /* report */
      '.hm-report{background:linear-gradient(150deg,#2a2210 0%,#1b1e23 70%);border-color:#4a3d1c;}',
      '.hm-report h3{font-size:20px;margin-bottom:4px;}',
      '.hm-report p{font-size:12.5px;color:var(--text-dim);line-height:1.5;margin:0 0 12px;}',
      '.hm-rtags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}',
      '.hm-btn.busy{pointer-events:none;filter:saturate(.6);}',
      '.hm-btn.busy svg{animation:hmBob .7s ease-in-out infinite;}',
      '@keyframes hmBob{50%{transform:translateY(4px)}}',
      '.hm-btn.ok{background:var(--good);color:#06150a;}',
      '.hm-btn[disabled]{opacity:.5;}',
      '.hm-wk{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim);margin:0 0 12px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.04);}',
      '.hm-wk svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;flex:none;}',
      '.hm-wk .cd,.hm-seg .cd{font-family:var(--font-mono);color:var(--accent);font-variant-numeric:tabular-nums;}',
      '.hm-wk .cd{margin-left:auto;font-weight:700;}',
      '.hm-wk.new{color:var(--text);background:rgba(232,179,44,.1);border:1px solid var(--accent-dim);animation:hmPulse 2.2s ease-in-out infinite;}',
      '.hm-wk .pill{background:var(--accent);color:#1a1405;font-weight:800;font-size:10px;letter-spacing:.08em;padding:2px 7px;border-radius:99px;}',
      '@keyframes hmPulse{50%{box-shadow:0 0 0 4px rgba(232,179,44,.12)}}',
      '.hm-seg .lk{display:flex;align-items:center;gap:4px;}',
      '.hm-seg .lk svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.2;flex:none;}',
      '.hm-seg.lock b{color:var(--text-dim);}',
      '.hm-btn .cd{font-family:var(--font-mono);font-variant-numeric:tabular-nums;}',
      '.hm-sheet-t{font-size:20px;margin:2px 0 2px;}',
      '.hm-sheet-s{font-size:12px;color:var(--text-dim);margin:0 0 14px;}',
      '.hm-opt{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:12px;}',
      '.hm-opt-h{display:flex;align-items:center;gap:12px;margin-bottom:8px;}',
      '.hm-opt-h b{display:block;font-size:16px;}',
      '.hm-opt-h small{font-size:11.5px;color:var(--text-dim);}',
      '.hm-opt-i{width:38px;height:38px;border-radius:12px;background:rgba(232,179,44,.14);color:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:700;font-size:17px;flex:none;}',
      '.hm-opt p{font-size:12.5px;color:var(--text-dim);line-height:1.5;margin:0 0 12px;}',
      '.hm-segs{display:flex;gap:8px;margin-bottom:10px;}',
      '.hm-seg{flex:1;min-width:0;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:9px 10px;color:var(--text);transition:border-color .15s,transform .12s;}',
      '.hm-seg b{display:block;font-size:13.5px;}',
      '.hm-seg small{display:block;font-size:10.5px;color:var(--text-dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.hm-seg.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset;}',
      '.hm-seg:active{transform:scale(.97);}',
      '.hm-seg[disabled]{opacity:.4;}',
      '.hm-fine{font-size:10.5px;color:var(--text-faint);margin-top:9px;text-align:center;}',
      /* confetti */
      '.hm-conf{position:fixed;width:8px;height:12px;z-index:90;pointer-events:none;border-radius:2px;animation:hmConf 1.1s cubic-bezier(.2,.7,.4,1) forwards;}',
      '@keyframes hmConf{to{transform:translate(var(--dx),var(--dy)) rotate(var(--rot));opacity:0}}',
      '@media (prefers-reduced-motion:reduce){.hm *,.hm *::before,.hm *::after{animation:none!important;transition:none!important}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- render ---------- */
  function render() {
    ensureCss();
    var today = todayStr(), split = activeSplit();
    var hr = new Date().getHours();
    var hello = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Good night';
    setHeader(hello, 'Home', null, null);
    var main = document.getElementById('main');

    if (!split) {
      main.innerHTML = '<div class="hm"><div class="hm-card hm-today hm-in"><div class="hm-hello">Welcome</div><h2>Let’s set up your split</h2><div class="hm-sub">Build a routine, then Home fills with your calendar, streak, records and coaching notes.</div><button class="hm-btn shine" id="hm-setup">Create a split</button></div></div>';
      document.getElementById('hm-setup').onclick = function () { goToTab('split'); };
      return;
    }

    var sessions = allLoggedSessions();
    var ctx = homeCtx();
    var rec = recordsByDate(ctx);
    var rep = getReport();
    var html = '<div class="hm">';
    var cards = [todayCard(split, sessions, today, rep), weekCard(split, sessions, today, rep), calendarCard(sessions, today, rec), statsCard(sessions, today, rep), recordsCard(rec.list, today), balanceCard(rep), notesCard(rep), liftsCard(rep), reportCard(rep)];
    cards.forEach(function (c, i) { if (c) html += c.replace('class="hm-card', 'style="animation-delay:' + (i * 55) + 'ms" class="hm-card'); });
    html += '</div>';
    main.innerHTML = html;
    bind(split, sessions, today, rep);
    animate();
    startTicker(); checkWeeklyReady();
    slide = '';
  }

  function todayCard(split, sessions, today, rep) {
    var p = plannedDay(split, sessions, today), d = new Date();
    var wd = d.toLocaleDateString(undefined, { weekday: 'long' });
    if (!p || !p.day) return '';
    var quips = ['Plates won’t lift themselves.', 'Small reps, big compounding.', 'Show up. The numbers follow.', 'Today’s sets are tomorrow’s PRs.', 'Chalk up. Focus in.', 'Consistency beats intensity.', 'One more good session in the bank.'];
    var q = quips[(Math.floor(Date.now() / 864e5)) % quips.length];
    if (p.done) {
      // A session in progress is not "done": only call it done when every exercise of the day has sets, or the user said so.
      var dayExs = exercisesOfDay(p.day.id), loggedIds = {};
      p.done.sets.forEach(function (x) { if (!isWarmupSet(x) && isCountedLoggedSet(x) && x.exerciseId) loggedIds[x.exerciseId] = 1; });
      var left = dayExs.filter(function (e) { return !loggedIds[e.id]; }), nDone = dayExs.length - left.length;
      if (left.length && DB_META.finishedDate !== today) {
        var stp = sessionStats(p.done), pct = Math.round(nDone / dayExs.length * 100);
        var rest = left.slice(0, 4).map(function (e) { return '<span class="hm-chip">' + esc(e.name) + '</span>'; }).join('') + (left.length > 4 ? '<span class="hm-chip">+' + (left.length - 4) + ' more</span>' : '');
        return '<div class="hm-card hm-today hm-in"><div class="hm-hello">' + wd + ' · in progress</div><h2>' + esc(p.day.name) + '</h2>' +
          '<div class="hm-sub">' + nDone + ' of ' + dayExs.length + ' exercises logged · ' + stp.hard + ' hard sets · ' + nfmt(stp.volume) + ' kg so far.</div>' +
          '<div class="hm-prog" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>' +
          '<div class="hm-hello" style="margin:10px 0 6px">Still to do</div><div class="hm-chips">' + rest + '</div>' +
          '<button class="hm-btn shine" id="hm-start" data-day="' + p.day.id + '">' + I.play + ' Continue ' + esc(p.day.name) + '</button>' +
          '<button class="hm-btn ghost" id="hm-finish" style="margin-top:8px">Finish for today</button></div>';
      }
      var st = sessionStats(p.done), prs = 0; try { prs = (recordsByDate(homeCtx()).map[today]) || 0; } catch (e) { }
      return '<div class="hm-card hm-today hm-in"><div class="hm-done"><div class="hm-tick">' + I.check + '</div><div><div class="hm-hello">' + wd + '</div><h2>Done for today</h2></div></div>' +
        '<div class="hm-sub" style="margin-top:8px">' + esc(p.done.dayName) + ' is in the books. Nice work.</div>' +
        '<div class="hm-chips"><span class="hm-chip">' + st.hard + ' hard sets</span><span class="hm-chip">' + nfmt(st.volume) + ' kg</span><span class="hm-chip">' + p.done.exercises.length + ' exercises</span>' + (prs ? '<span class="hm-chip" style="color:var(--accent);border-color:var(--accent-dim)">' + plural(prs, 'record') + ' today</span>' : '') + '</div>' +
        '<button class="hm-btn ghost" id="hm-add-more">Add more sets</button></div>';
    }
    if (isRestDay(p.day)) {
      return '<div class="hm-card hm-today hm-in"><div class="hm-rest"><div>' + I.moon + '</div><div><div class="hm-hello">' + wd + '</div><h2>Rest day</h2></div></div>' +
        '<div class="hm-sub" style="margin-top:8px">Recovery is where the gains actually happen. Sleep well, eat enough, walk a little.</div>' + missedNote(p) +
        '<button class="hm-btn ghost" id="hm-log-anyway">Train anyway</button></div>';
    }
    var exs = exercisesOfDay(p.day.id), hist = historySessionsForDay(p.day.id), last = hist[hist.length - 1];
    var names = exs.slice(0, 4).map(function (e) { return '<span class="hm-chip">' + esc(e.name) + '</span>'; }).join('') + (exs.length > 4 ? '<span class="hm-chip">+' + (exs.length - 4) + ' more</span>' : '');
    return '<div class="hm-card hm-today hm-in"><div class="hm-hello">' + wd + ' · up next</div><h2>' + esc(p.day.name) + '</h2>' +
      '<div class="hm-sub">' + esc(q) + (last ? ' Last time: ' + ago(last.date, today) + '.' : ' First time on this day.') + '</div>' +
      '<div class="hm-chips">' + (names || '<span class="hm-chip">No exercises yet</span>') + '</div>' + missedNote(p) +
      '<button class="hm-btn shine" id="hm-start" data-day="' + p.day.id + '">' + I.play + ' Start ' + esc(p.day.name) + '</button></div>';
  }

  function missedNote(p) {
    var m = p.missed && p.missed[0]; if (!m || m.daysAgo > 3) return '';
    var when = m.daysAgo === 1 ? 'yesterday' : m.daysAgo + ' days ago';
    return '<div class="hm-missed"><span>Missed ' + esc(m.day.name) + ' ' + when + '</span><button id="hm-do-missed" data-day="' + m.day.id + '">Do it today instead</button></div>';
  }

  function weekCard(split, sessions, today, rep) {
    var T = dnum(today), W0 = weekStart(T), goal = weeklyGoal(split);
    var week = []; for (var i = 0; i < 7; i++) { var dd = dstr(W0 + i); week.push({ date: dd, n: W0 + i, s: sessions.filter(function (s) { return s.date === dd; })[0] || null }); }
    var done = week.filter(function (w) { return w.s; }).length;
    var hard = 0, groups = {};
    week.forEach(function (w) { if (w.s) w.s.sets.forEach(function (x) { if (isHardSet(x)) { hard++; var ex = exerciseById(x.exerciseId); var g = ex && classifyExercise(ex.name); if (g) groups[g] = 1; } }); });
    var nGroups = Object.keys(groups).length;
    // typical week = average hard sets of the previous four full weeks
    var prev = 0, wk = 0; for (var k = 1; k <= 4; k++) { var a = W0 - 7 * k, b = a + 6, c = 0; sessions.forEach(function (s) { var n = dnum(s.date); if (n >= a && n <= b) c += s.sets.filter(isHardSet).length; }); if (c) { prev += c; wk++; } }
    var typical = wk ? Math.max(8, Math.round(prev / wk)) : 20;
    var vals = [Math.min(1, done / goal), Math.min(1, hard / typical), Math.min(1, nGroups / 6)];
    var cols = ['var(--accent)', 'var(--good)', '#EDEAE3'], rad = [56, 46, 36], circ = rad.map(function (r) { return 2 * Math.PI * r; });
    var svg = '<svg viewBox="0 0 128 128" aria-hidden="true">' + rad.map(function (r, j) {
      return '<circle class="trk" cx="64" cy="64" r="' + r + '" fill="none"/><circle class="arc" data-v="' + vals[j].toFixed(3) + '" data-c="' + circ[j].toFixed(2) + '" cx="64" cy="64" r="' + r + '" fill="none" stroke="' + cols[j] + '" stroke-dasharray="' + circ[j].toFixed(2) + '" stroke-dashoffset="' + circ[j].toFixed(2) + '"/>';
    }).join('') + '</svg>';
    var mids = [[done + '/' + goal, 'sessions'], [String(hard), 'hard sets'], [nGroups + '/6', 'muscles']];
    var m = mids[ringMode % 3];
    var streak = rep && rep.consistency ? rep.consistency.streakWeeks : 0;
    var days = week.map(function (w, idx) {
      var cls = 'hm-d' + (w.s ? ' on' : '') + (w.date === today ? ' today' : '') + (w.n > T ? ' fut' : '');
      return '<div class="' + cls + '" data-date="' + w.date + '"><span>' + DOW[idx] + '</span><i>' + (w.s ? I.check : '') + '</i></div>';
    }).join('');
    var met = done >= goal;
    return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>This week</span><span class="hm-streak ' + (streak ? '' : 'cold') + '" id="hm-streak" title="Weeks in a row hitting your goal">' + I.flame + (streak ? plural(streak, 'week') : 'no streak yet') + '</span></div>' +
      '<div class="hm-week"><div class="hm-rings" id="hm-rings" role="button" aria-label="Weekly rings, tap to switch the centre value">' + svg + '<div class="mid"><b data-mid>' + m[0] + '</b><span>' + m[1] + '</span></div></div>' +
      '<div class="hm-legend">' +
      '<div class="hm-leg ' + (ringMode % 3 === 0 ? 'on' : '') + '"><i style="background:var(--accent)"></i>Sessions<b>' + done + ' / ' + goal + '</b></div>' +
      '<div class="hm-leg ' + (ringMode % 3 === 1 ? 'on' : '') + '"><i style="background:var(--good)"></i>Hard sets<b>' + hard + ' / ' + typical + '</b></div>' +
      '<div class="hm-leg ' + (ringMode % 3 === 2 ? 'on' : '') + '"><i style="background:#EDEAE3"></i>Muscles<b>' + nGroups + ' / 6</b></div>' +
      '<div class="hm-goal">Goal <button id="hm-gminus" aria-label="Lower weekly goal">' + I.minus + '</button><b class="mono" style="color:var(--text)">' + goal + '</b>/wk<button id="hm-gplus" aria-label="Raise weekly goal">' + I.plus + '</button></div>' +
      '</div></div>' +
      '<div class="hm-days">' + days + '</div>' +
      (met ? '<div class="hm-hint" style="color:var(--good)">Weekly goal hit. Tap the rings to celebrate.</div>' : '<div class="hm-hint">' + (goal - done) + ' more session' + (goal - done === 1 ? '' : 's') + ' to hit your goal. Tap the rings to switch the centre value.</div>') +
      '</div>';
  }

  function calendarCard(sessions, today, rec) {
    var T = new Date(), vm = viewMonth || (viewMonth = { y: T.getFullYear(), m: T.getMonth() });
    var first = new Date(vm.y, vm.m, 1), lead = (first.getDay() + 6) % 7, dim = new Date(vm.y, vm.m + 1, 0).getDate();
    var byDate = {}; sessions.forEach(function (s) { byDate[s.date] = s; });
    var cells = DOW.map(function (d) { return '<div class="hm-dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < lead; i++) cells += '<div class="hm-c blank"></div>';
    var monthS = 0, monthHard = 0, monthVol = 0;
    for (var d = 1; d <= dim; d++) {
      var date = ds(vm.y, vm.m, d), s = byDate[date], cls = 'hm-c', inner = '<span class="n">' + d + '</span>';
      if (date > today) cls += ' fut';
      if (date === today) cls += ' today';
      if (s) {
        var st = sessionStats(s); monthS++; monthHard += st.hard; monthVol += st.volume;
        var lv = st.hard <= 8 ? 1 : st.hard <= 16 ? 2 : st.hard <= 24 ? 3 : 4;
        cls += ' t h' + lv;
        inner += '<span class="l">' + esc((s.dayName || 'S').slice(0, 3).toUpperCase()) + '</span>';
        if (rec.map[date]) inner += '<svg class="pr" viewBox="0 0 24 24"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/></svg>';
      }
      cells += '<button type="button" class="' + cls + '" style="--i:' + (d + lead) + '" data-date="' + date + '" aria-label="' + date + (s ? ', ' + esc(s.dayName) + ' session' : '') + '">' + inner + '</button>';
    }
    var atNow = vm.y === T.getFullYear() && vm.m === T.getMonth();
    return '<div class="hm-card hm-in"><div class="hm-calhead"><h3>' + MONTHS[vm.m] + ' ' + vm.y + '</h3><div class="hm-nav"><button id="hm-prev" aria-label="Previous month">' + I.chevL + '</button><button id="hm-next" aria-label="Next month" ' + (atNow ? 'disabled' : '') + '>' + I.chevR + '</button></div></div>' +
      '<div class="hm-cal ' + (slide === 'l' ? 's-l' : slide === 'r' ? 's-r' : '') + '" id="hm-cal">' + cells + '</div>' +
      '<div class="hm-calfoot"><span><b>' + monthS + '</b> session' + (monthS === 1 ? '' : 's') + '</span><span><b>' + monthHard + '</b> hard sets</span><span><b>' + nfmt(monthVol) + '</b> kg</span></div>' +
      '<div class="hm-hint">Tap a day for its history · double-tap to open that day in Log</div></div>';
  }

  function statsCard(sessions, today, rep) {
    var T = new Date(), y = T.getFullYear(), m = T.getMonth(), cur = ds(y, m, 1), pm = new Date(y, m - 1, 1), prv = ds(pm.getFullYear(), pm.getMonth(), 1);
    var curVol = 0, prvVol = 0, curS = 0, prvS = 0;
    // compare with the SAME point of last month (month-to-date), not the whole of last month
    var dom = T.getDate(), pdim = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate(), prvEnd = ds(pm.getFullYear(), pm.getMonth(), Math.min(dom, pdim));
    sessions.forEach(function (s) { if (s.date >= cur) { curVol += s.volume; curS++; } else if (s.date >= prv && s.date <= prvEnd) { prvVol += s.volume; prvS++; } });
    var pct = prvVol > 0 ? Math.round((curVol / prvVol - 1) * 100) : null;
    var eff = rep && rep.effort, hardWeek = 0, W0 = weekStart(dnum(today));
    sessions.forEach(function (s) { if (dnum(s.date) >= W0) hardWeek += s.sets.filter(isHardSet).length; });
    var rirTile = eff && eff.rated ? '<div class="v" data-count="' + (eff.avgRir).toFixed(1) + '" data-dec="1">' + eff.avgRir.toFixed(1) + '</div><div class="s">' + Math.round(eff.coverage * 100) + '% of sets rated</div>' : '<div class="v" style="font-size:15px;color:var(--text-dim)">Not logged</div><div class="s">add RIR to sets</div>';
    return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>This month</span><small>vs same date last month</small></div><div class="hm-tiles">' +
      '<div class="hm-tile"><div class="k">Volume</div><div class="v"><span data-count="' + Math.round(curVol) + '">' + nfmt(curVol) + '</span><small>kg</small></div><div class="s ' + (pct != null ? (pct >= 0 ? 'hm-up' : 'hm-dn') : '') + '">' + (pct == null ? 'no last month yet' : (pct >= 0 ? '+' : '') + pct + '% vs same date last month') + '</div></div>' +
      '<div class="hm-tile"><div class="k">Sessions</div><div class="v"><span data-count="' + curS + '">' + curS + '</span></div><div class="s">' + prvS + ' by this date last month</div></div>' +
      '<div class="hm-tile"><div class="k">Hard sets, this week</div><div class="v"><span data-count="' + hardWeek + '">' + hardWeek + '</span></div><div class="s">RIR 0-3 or unrated</div></div>' +
      '<div class="hm-tile"><div class="k">Avg RIR, 4 weeks</div>' + rirTile + '</div></div></div>';
  }

  function recordsCard(list, today) {
    var rows = list.slice(0, 5).map(function (r) {
      var detail = r.weight + ' kg × ' + r.reps + (r.rir != null ? ' · RIR ' + r.rir : '') + (r.type === 'e1rm' ? ' · est. 1RM ' + Math.round(r.e1rm) + ' kg' : '');
      return '<div class="hm-rec"><div class="hm-medal" data-medal>' + I.medal + '</div><div style="min-width:0"><div class="nm">' + esc(r.name) + '</div><div class="dt">' + esc(r.label) + ' · ' + detail + '</div></div><div class="when">' + ago(r.date, today) + '</div></div>';
    }).join('');
    return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>Latest records</span><small>tap a medal</small></div>' + (rows || '<div class="hm-empty">Beat a previous best on any lift and it lands here with a medal.</div>') + '</div>';
  }

  function balanceCard(rep) {
    if (!rep || rep.insufficient || !rep.balance || rep.balance.totalHard < 12) return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>Muscle balance</span></div><div class="hm-empty">Log a few more weeks of hard sets and your muscle balance shows up here.</div></div>';
    var b = rep.balance, max = 24;
    var rows = GROUPS.map(function (g) {
      var p = b.perGroup[g], wk = p.weekSets, avg = p.perWeek, c = avg < 4 ? 'var(--rust)' : avg <= 20 ? 'var(--good)' : 'var(--accent)';
      return '<div class="hm-br" data-g="' + g + '"><span class="nm">' + GLABEL[g] + '</span><div class="tr"><div class="fl" data-w="' + Math.min(100, wk / max * 100).toFixed(1) + '" style="background:' + c + '"></div><div class="tk" style="left:' + Math.min(100, avg / max * 100).toFixed(1) + '%" title="4-week average"></div></div><span class="vl">' + wk + '</span></div>';
    }).join('');
    var pp = b.push, pl = b.pull, note = (pp + pl >= 20) ? 'Push : pull over 4 weeks is ' + pp + ' : ' + pl + (pl > 0 ? ' (' + (Math.round(pp / pl * 10) / 10) + ' : 1).' : '.') : '';
    return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>Muscle balance</span><small>hard sets this week</small></div><div class="hm-bal">' + rows + '</div>' +
      '<div class="hm-bnote">Bars = this week. The white tick = your 4-week weekly average. Green is about 8-20 sets a week.' + (note ? ' ' + note : '') + '</div></div>';
  }

  function notesCard(rep) {
    if (!rep) return '';
    if (rep.insufficient || rep.limited) return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>Coach notes</span></div><div class="hm-empty">Log 3+ sessions and short, specific notes appear here: what to push, what to ease off, what is working.</div></div>';
    var f = rep.findings.filter(function (x) { return x.severity !== 'good'; }).slice(0, 3), g = rep.findings.filter(function (x) { return x.severity === 'good'; })[0];
    var list = f.concat(g ? [g] : []);
    if (!list.length) return '';
    var html = list.map(function (n) {
      var open = openNote === n.id;
      return '<div class="hm-note ' + n.severity + (open ? ' open' : '') + '" data-note="' + esc(n.id) + '"><div class="t">' + esc(n.title) + I.chevR + '</div><div class="e">' + esc(n.evidence) + '</div>' +
        '<div class="x">' + (n.action ? '<b>Do:</b> ' + esc(n.action) : '') + (n.dont ? '<br><b style="color:var(--rust)">Don’t:</b> ' + esc(n.dont) : '') + (n.check ? '<br><b style="color:var(--good)">Check:</b> ' + esc(n.check) : '') + (!n.action && !n.dont ? 'Keep it up.' : '') + '</div></div>';
    }).join('');
    return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>Coach notes</span><small>tap to expand</small></div>' + html + '</div>';
  }

  function liftsCard(rep) {
    if (!rep || !rep.lifts || !rep.lifts.length) return '';
    var cards = rep.lifts.map(function (l) {
      var t = l.trend90 || {}, up = t.d === 'up', dn = t.d === 'down' || l.regress, c = dn ? 'var(--rust)' : up ? 'var(--good)' : 'var(--text-dim)';
      var vals = l.series.slice(-10).map(function (s) { return s.e1rm; }), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mx === mn) { mx += 1; mn -= 1; }
      var pts = vals.map(function (v, i) { return (vals.length < 2 ? 0 : i / (vals.length - 1) * 100).toFixed(1) + ',' + (28 - (v - mn) / (mx - mn) * 26).toFixed(1); }).join(' ');
      var tr = l.stalled ? 'stalled' : l.regress ? 'trending down' : t.ch == null ? '—' : (Math.abs(t.ch) < 0.5 ? 'flat' : (t.ch > 0 ? '+' : '') + t.ch.toFixed(1) + '%');
      return '<div class="hm-lift" data-lift="' + esc(l.key) + '"><div class="nm">' + esc(l.name) + '</div><div class="v">' + (l.e1rm ? Math.round(l.e1rm) : '—') + '<small>kg e1RM</small></div><div class="tr" style="color:' + c + '">' + tr + ' · 90d</div>' +
        '<svg class="sp" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '" stroke="' + c + '"/></svg></div>';
    }).join('');
    return '<div class="hm-card hm-in"><div class="hm-eyebrow"><span>Your main lifts</span><small>tap to open Progress</small></div><div class="hm-scroll">' + cards + '</div></div>';
  }

  function reportCard(rep) {
    var ready = workingCount() >= MIN_SETS, wk = weekInfo(todayStr()), line = '';
    if (ready) {
      if (wk.last.ready && DB_META.weeklySeen !== wk.last.key) line = '<div class="hm-wk new"><span class="pill">NEW</span><span>Weekly report for ' + wk.last.label + ' is ready</span></div>';
      else line = '<div class="hm-wk">' + I.lock + '<span>Next weekly report opens in</span>' + cd(wk.this.unlock) + '</div>';
    }
    var tags = ready ? '<span class="hm-chip">Overall</span><span class="hm-chip">Weekly</span><span class="hm-chip">science-based advice</span><span class="hm-chip">next-week targets</span>' : '';
    return '<div class="hm-card hm-report hm-in"><div class="hm-eyebrow"><span>Coaching report</span><small>PDF · works offline</small></div><h3>Your report, written from your own sets</h3>' +
      '<p>' + (ready ? 'Pick an overall report on your whole training, or a weekly report that opens when the week ends and compares it with the week before. Advice follows hypertrophy research.' : 'Log a couple of sets and the report unlocks. It reads every graph in the app and tells you what to do next.') + '</p>' +
      '<div class="hm-rtags">' + tags + '</div>' + line +
      '<button class="hm-btn ' + (ready ? 'shine' : '') + '" id="hm-report" ' + (ready ? '' : 'disabled') + '>' + I.dl + '<span>' + (ready ? 'Get my report' : 'Log a couple of sets to unlock') + '</span></button>' +
      '<div class="hm-fine">Based on your logged training only. Not medical advice.</div></div>';
  }

  /* ---------- behaviour ---------- */
  function bind(split, sessions, today, rep) {
    var $ = function (id) { return document.getElementById(id); };
    var start = $('hm-start'); if (start) start.onclick = function () { state.logDayId = start.dataset.day; state.logDate = todayStr(); goToTab('log'); };
    var dm = $('hm-do-missed'); if (dm) dm.onclick = function () { state.logDayId = dm.dataset.day; state.logDate = todayStr(); goToTab('log'); };
    var fin = $('hm-finish'); if (fin) fin.onclick = function () { DB_META.finishedDate = todayStr(); Promise.resolve(saveMeta()).then(function () { reportCache = { key: null, rep: null }; render(); toast('Nice work. Session closed for today.', 1800); }); };
    var more = $('hm-add-more'); if (more) more.onclick = function () { state.logDate = todayStr(); goToTab('log'); };
    var anyway = $('hm-log-anyway'); if (anyway) anyway.onclick = function () { state.logDate = todayStr(); goToTab('log'); };

    // rings: tap to cycle the centre value (and celebrate when the goal is met)
    var rings = $('hm-rings');
    if (rings) rings.onclick = function () {
      ringMode = (ringMode + 1) % 3;
      var done = rings.parentNode.querySelectorAll('.hm-leg'); var mids = [['sessions'], ['hard sets'], ['muscles']];
      var legs = rings.parentNode.querySelectorAll('.hm-leg b'); var txt = [legs[0].textContent.split(' / '), legs[1].textContent.split(' / '), legs[2].textContent.split(' / ')];
      var b = rings.querySelector('[data-mid]'), sp = rings.querySelector('.mid span');
      b.textContent = ringMode === 0 ? txt[0][0] + '/' + txt[0][1] : ringMode === 1 ? txt[1][0] : txt[2][0] + '/6'; sp.textContent = mids[ringMode][0];
      done.forEach(function (el, i) { el.classList.toggle('on', i === ringMode); });
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) { }
      var g = weeklyGoal(split), cnt = sessions.filter(function (s) { return dnum(s.date) >= weekStart(dnum(today)); }).length;
      if (ringMode === 0 && cnt >= g) confetti(rings);
    };
    var gm = $('hm-gminus'), gp = $('hm-gplus');
    function setGoal(v) { DB_META.weeklyGoal = Math.max(1, Math.min(7, v)); Promise.resolve(saveMeta()).then(function () { reportCache = { key: null, rep: null }; render(); }); }
    if (gm) gm.onclick = function () { setGoal(weeklyGoal(split) - 1); };
    if (gp) gp.onclick = function () { setGoal(weeklyGoal(split) + 1); };
    var streak = $('hm-streak');
    if (streak) streak.onclick = function () {
      streak.classList.remove('wiggle'); void streak.offsetWidth; streak.classList.add('wiggle');
      var n = rep && rep.consistency ? rep.consistency.streakWeeks : 0;
      toast(n >= 4 ? n + ' weeks straight. That’s a habit now.' : n >= 1 ? n + (n === 1 ? ' week' : ' weeks') + ' on the board. Keep the chain going.' : 'Hit your weekly goal to start a streak.', 2200);
    };

    // calendar + week-day taps share one handler: tap = history, double tap = that day's log
    function dayTap(el) {
      var date = el.dataset.date; if (!date || date > today) return;
      var now = Date.now();
      if (lastTap.date === date && now - lastTap.t < 340) { clearTimeout(lastTap.timer); lastTap = { date: null, t: 0, timer: null }; openLog(date, sessions, split); return; }
      clearTimeout(lastTap.timer);
      ripple(el);
      lastTap = { date: date, t: now, timer: setTimeout(function () { lastTap = { date: null, t: 0, timer: null }; openHistory(date, sessions, split); }, 300) };
    }
    document.querySelectorAll('.hm-c[data-date], .hm-d[data-date]').forEach(function (el) { el.addEventListener('click', function () { dayTap(el); }); });
    var prev = $('hm-prev'), next = $('hm-next');
    if (prev) prev.onclick = function () { viewMonth = { y: viewMonth.m === 0 ? viewMonth.y - 1 : viewMonth.y, m: (viewMonth.m + 11) % 12 }; slide = 'r'; render(); };
    if (next) next.onclick = function () { viewMonth = { y: viewMonth.m === 11 ? viewMonth.y + 1 : viewMonth.y, m: (viewMonth.m + 1) % 12 }; slide = 'l'; render(); };

    document.querySelectorAll('[data-medal]').forEach(function (m) { m.onclick = function () { m.classList.remove('spin'); void m.offsetWidth; m.classList.add('spin'); }; });
    document.querySelectorAll('.hm-br').forEach(function (r) {
      r.onclick = function () {
        var g = r.dataset.g, p = rep.balance.perGroup[g];
        toast(GLABEL[g] + ': ' + p.weekSets + ' this week, ' + p.perWeek + ' a week on average' + (p.perWeek < 4 ? ' (low)' : p.perWeek > 20 ? ' (high)' : ''), 2400);
      };
    });
    document.querySelectorAll('.hm-note').forEach(function (n) { n.onclick = function () { openNote = n.classList.contains('open') ? null : n.dataset.note; n.parentNode.querySelectorAll('.hm-note').forEach(function (o) { o.classList.toggle('open', o === n && openNote === n.dataset.note); }); }; });
    document.querySelectorAll('.hm-lift').forEach(function (l) {
      l.onclick = function () {
        var key = l.dataset.lift, ex = DB.exercises.filter(function (e) { return !e.archived && exerciseIdentityKey(e.name) === key && split.days.some(function (d) { return d.id === e.dayId; }); })[0];
        if (ex) { state.progressSplitId = split.id; state.progressMode = 'exercise'; state.progressExerciseId = ex.id; }
        goToTab('progress');
      };
    });
    var rb = $('hm-report'); if (rb && !rb.disabled) rb.onclick = function () { openReportSheet(); };
  }

  function sessionOn(date, sessions) { return sessions.filter(function (s) { return s.date === date; })[0] || null; }
  function openHistory(date, sessions, split) {
    var s = sessionOn(date, sessions);
    if (!s) { toast('No workout logged on ' + fmtDate(date) + ' · double-tap to log one', 2000); return; }
    if (!s.dayId || !split.days.some(function (d) { return d.id === s.dayId; })) { toast('That session belongs to a split you’ve archived', 2200); return; }
    state.logDayId = s.dayId; state.logHistoryDate = date; state.logHistoryOpen = true; state.logDate = todayStr();
    goToTab('log');
    setTimeout(function () { var c = document.querySelector('.history-card'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); }, 420);
  }
  function openLog(date, sessions, split) {
    var s = sessionOn(date, sessions);
    state.logDate = date;
    if (s && s.dayId && split.days.some(function (d) { return d.id === s.dayId; })) state.logDayId = s.dayId;
    state.logHistoryOpen = false;
    goToTab('log');
    toast(date === todayStr() ? 'Opening today’s log' : 'Logging for ' + fmtDate(date), 1600);
  }

  /* ---------- weekly report: lock, countdown, ready notice ---------- */
  var MIN_SETS = 2;               // working sets needed before any report unlocks
  var cdTimer = null, unlockTimer = null;
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function workingCount(a, b) {
    return DB.sets.filter(function (x) { if (isWarmupSet(x) || !isCountedLoggedSet(x)) return false; if (a == null) return true; var n = dnum(x.date); return n >= a && n <= b; }).length;
  }
  function unlockMs(W0) { var q = dstr(W0 + 7).split('-'); return new Date(+q[0], +q[1] - 1, +q[2], 0, 0, 0).getTime(); }   // local midnight after Sunday
  function fmtCd(ms) {
    if (ms < 0) ms = 0; var t = Math.floor(ms / 1000), d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
    return d > 0 ? d + 'd ' + pad2(h) + 'h ' + pad2(m) + 'm' : pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
  }
  function weekInfo(today) {
    var W0 = weekStart(dnum(today)), out = {}, now = Date.now();
    [['this', W0], ['last', W0 - 7]].forEach(function (p) {
      var a = p[1], b = a + 6, fa = fmtDate(dstr(a)), fb = fmtDate(dstr(b)), unlock = unlockMs(a), n = workingCount(a, b);
      out[p[0]] = { start: a, end: b, key: dstr(a), sets: n, unlock: unlock, locked: now < unlock, ready: now >= unlock && n >= MIN_SETS,
        label: fa + ' – ' + (fa.split(' ')[0] === fb.split(' ')[0] ? fb.split(' ').slice(1).join(' ') : fb) };
    });
    return out;
  }
  function tick() {
    var els = document.querySelectorAll('[data-cd]');
    if (!els.length) { clearInterval(cdTimer); cdTimer = null; return; }
    var now = Date.now(); els.forEach(function (el) { el.textContent = fmtCd(Number(el.dataset.cd) - now); });
  }
  function startTicker() { clearInterval(cdTimer); cdTimer = null; if (document.querySelector('[data-cd]')) { tick(); cdTimer = setInterval(tick, 1000); } }
  function cd(ms) { return '<span class="cd" data-cd="' + ms + '">' + fmtCd(ms - Date.now()) + '</span>'; }

  // Called after every Home render and when the unlock moment passes: toast (and an OS notification if the
  // user already allowed them) once per finished week that has enough sets.
  function checkWeeklyReady() {
    try {
      var wk = weekInfo(todayStr()), last = wk.last;
      if (last.ready && DB_META.weeklyNotified !== last.key) {
        DB_META.weeklyNotified = last.key; Promise.resolve(saveMeta());
        var msg = 'Your weekly report for ' + last.label + ' is ready';
        setTimeout(function () { toast(msg + ' · open Home → Get my report', 4200); }, 700);
        if (window.Notification && Notification.permission === 'granted') { try { new Notification('Plate & Progress', { body: msg }); } catch (e) { } }
      }
      clearTimeout(unlockTimer);
      var next = wk.this.unlock - Date.now();
      if (next > 0 && next < 2147483000) unlockTimer = setTimeout(function () { reportCache = { key: null, rep: null }; if (state.tab === 'home') render(); else checkWeeklyReady(); }, next + 400);
    } catch (e) { }
  }

  function openReportSheet() {
    var today = todayStr(), wk = weekInfo(today), total = workingCount();
    var overallOk = total >= MIN_SETS;
    var pick = wk.last.ready ? 'last' : 'this';
    if (wk.last.ready && DB_META.weeklySeen !== wk.last.key) { DB_META.weeklySeen = wk.last.key; Promise.resolve(saveMeta()); }
    var root = document.getElementById('modal-root');
    function close() { clearInterval(cdTimer); cdTimer = null; root.innerHTML = ''; if (state.tab === 'home') { reportCache = { key: null, rep: null }; render(); } }
    function paint() {
      var chip = function (k, name) {
        var w = wk[k], dis = !w.locked && w.sets < MIN_SETS;
        var sub = w.locked ? '<small class="lk">' + I.lock + 'Opens in ' + cd(w.unlock) + '</small>' : '<small>' + (dis ? 'needs ' + MIN_SETS + ' sets' : plural(w.sets, 'set') + ' logged') + '</small>';
        return '<button class="hm-seg' + (pick === k ? ' on' : '') + (w.locked ? ' lock' : '') + '" data-wk="' + k + '" ' + (dis ? 'disabled' : '') + '><b>' + name + '</b><small>' + w.label + '</small>' + sub + '</button>';
      };
      var sel = wk[pick], wBtn = sel.locked ? '<button class="hm-btn ghost" id="hm-go-weekly" disabled>' + I.lock + '<span>Unlocks in ' + cd(sel.unlock) + '</span></button>'
        : '<button class="hm-btn" id="hm-go-weekly" ' + (sel.sets >= MIN_SETS ? '' : 'disabled') + '>' + I.dl + '<span>Download weekly report</span></button>';
      root.innerHTML = '<div class="modal-overlay" id="m-overlay"><div class="modal-sheet hm-sheet" role="dialog" aria-label="Choose a report">' +
        '<div class="modal-close-row"><button class="icon-btn" id="m-close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>' +
        '<h2 class="hm-sheet-t">Which report?</h2><p class="hm-sheet-s">Both are PDFs built on your device from your logged sets.</p>' +
        '<div class="hm-opt"><div class="hm-opt-h"><span class="hm-opt-i">∑</span><div><b>Overall report</b><small>Your whole training so far</small></div></div>' +
        '<p>Consistency, muscle balance, effort, every main lift, a reading of every graph, and your top 3 priorities with do and don’t lists.</p>' +
        '<button class="hm-btn ' + (overallOk ? '' : 'ghost') + '" id="hm-go-overall" ' + (overallOk ? '' : 'disabled') + '>' + I.dl + '<span>' + (overallOk ? 'Download overall report' : 'Log a couple of sets to unlock') + '</span></button></div>' +
        '<div class="hm-opt"><div class="hm-opt-h"><span class="hm-opt-i">7</span><div><b>Weekly report</b><small>A finished week vs the one before it</small></div></div>' +
        '<p>Split day by day and muscle by muscle, lift progress, effort, plus targets for next week. A week’s report opens when that week ends (Sunday night).</p>' +
        '<div class="hm-segs">' + chip('this', 'This week') + chip('last', 'Last week') + '</div>' + wBtn + '</div>' +
        '</div></div>';
      document.getElementById('m-close').onclick = close;
      document.getElementById('m-overlay').onclick = function (e) { if (e.target.id === 'm-overlay') close(); };
      document.querySelectorAll('.hm-seg').forEach(function (b) { b.onclick = function () { if (b.disabled) return; pick = b.dataset.wk; paint(); }; });
      var o = document.getElementById('hm-go-overall'); if (o && !o.disabled) o.onclick = function () { downloadReport('overall', null, o, close); };
      var w = document.getElementById('hm-go-weekly'); if (w && !w.disabled) w.onclick = function () { downloadReport('weekly', pick, w, close); };
      startTicker();
    }
    paint();
  }

  function downloadReport(kind, which, btn, done) {
    if (kind === 'weekly') { var wi = weekInfo(todayStr())[which]; if (!wi || wi.locked || wi.sets < MIN_SETS) { toast('That weekly report isn’t open yet', 2200); return; } }
    var label = btn.querySelector('span'), old = label.textContent;
    btn.classList.add('busy'); label.textContent = 'Building your report…';
    setTimeout(function () {                      // let the button repaint before the (synchronous) build
      try {
        Promise.resolve(kind === 'overall' && typeof idbGet === 'function' ? idbGet('strengthIntelligence') : null).catch(function () { return null; }).then(function (si) {
          var ctx = homeCtx(), bytes, name;
          if (kind === 'weekly') {
            var rep = ReportWeekly.build(ctx, { which: which });
            bytes = ReportPDF.renderWeekly(rep); name = 'plate-progress-weekly-report-' + rep.weekStart + '.pdf';
          } else {
            ctx.forecastLog = si && si.forecasts ? si.forecasts : [];
            bytes = ReportPDF.render(ReportEngine.build(ctx)); name = 'plate-progress-report-' + todayStr() + '.pdf';
          }
          var blob = new Blob([bytes], { type: 'application/pdf' });
          var url = URL.createObjectURL(blob), a = document.createElement('a');
          a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          btn.classList.remove('busy'); btn.classList.add('ok'); label.textContent = 'Report downloaded';
          toast((kind === 'weekly' ? 'Weekly' : 'Overall') + ' report saved as PDF', 2200); confetti(btn);
          setTimeout(function () { if (done) done(); }, 1100);
        }).catch(fail);
      } catch (e) { fail(e); }
      function fail(e) { console.error('Report failed', e); btn.classList.remove('busy'); label.textContent = old; toast('Couldn’t build the report', 2600); }
    }, 60);
  }

  /* ---------- delight ---------- */
  function animate() {
    var arcs = document.querySelectorAll('.hm-rings .arc'), fills = document.querySelectorAll('.hm-br .fl'), nums = document.querySelectorAll('[data-count]');
    var go = function () {
      arcs.forEach(function (a, i) { var c = parseFloat(a.dataset.c), v = parseFloat(a.dataset.v); setTimeout(function () { a.style.strokeDashoffset = (c * (1 - v)).toFixed(2); }, i * 120); });
      fills.forEach(function (f) { f.style.width = f.dataset.w + '%'; });
    };
    if (reduced()) { arcs.forEach(function (a) { a.style.transition = 'none'; }); fills.forEach(function (f) { f.style.transition = 'none'; }); }
    requestAnimationFrame(function () { requestAnimationFrame(go); });
    if (reduced()) return;
    nums.forEach(function (el) {
      var to = parseFloat(el.dataset.count), dec = parseInt(el.dataset.dec || '0', 10); if (!isFinite(to)) return;
      var t0 = performance.now(), dur = 800;
      (function tick(now) {
        var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = to * e;
        el.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US');
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    });
  }
  function ripple(el) {
    if (reduced()) return;
    var r = document.createElement('span'), s = Math.max(el.clientWidth, el.clientHeight) / 3;
    r.className = 'rp'; r.style.width = r.style.height = s + 'px'; r.style.left = (el.clientWidth / 2 - s / 2) + 'px'; r.style.top = (el.clientHeight / 2 - s / 2) + 'px';
    el.appendChild(r); setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 520);
  }
  function confetti(anchor) {
    if (reduced()) return;
    var rc = anchor.getBoundingClientRect(), cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2, colors = ['#E8B32C', '#6FA97B', '#EDEAE3', '#C1543A'];
    for (var i = 0; i < 26; i++) {
      var p = document.createElement('i'), ang = Math.random() * Math.PI * 2, dist = 70 + Math.random() * 90;
      p.className = 'hm-conf'; p.style.left = cx + 'px'; p.style.top = cy + 'px'; p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px'); p.style.setProperty('--dy', (Math.sin(ang) * dist + 60) + 'px'); p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      document.body.appendChild(p); setTimeout((function (n) { return function () { if (n.parentNode) n.parentNode.removeChild(n); }; })(p), 1200);
    }
  }

  window.HomeScreen = { render: render, resetMonth: function () { viewMonth = null; }, _plannedDay: plannedDay };
})();
