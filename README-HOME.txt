PLATE & PROGRESS - ROUND 2: HOME SCREEN + REPORT
=================================================
New files: home.js, report-engine.js, report-pdf.js (all cached offline by sw.js, cache v53-home).

HOME (first tab)
- Today card: next day in your rotation, Start button; done-for-today and rest-day states.
- This week: rings (sessions / hard sets / muscles; tap the centre to cycle), weekly goal stepper
  (saved in appMeta.weeklyGoal), streak flame, Mon-Sun dots, confetti when the goal is hit.
- Calendar: heat = hard sets that day, star = PR. Tap a day -> history view of that day.
  Double-tap a day -> open that day's log (works for backfilling empty days too).
- This month vs same date last month, average RIR.
- Latest records, muscle balance bars, coach notes, main lifts strip.
- Report button (bottom): downloads plate-progress-report-YYYY-MM-DD.pdf, generated fully offline.

REPORT (rule-based, no network)
- Top 3 priorities (each with action + a measurable check), going-well list, Do / Don't lists,
  per-lift cards, "Reading your graphs" for every screen, all findings, and stated limits.
- Muscle balance: hard sets per muscle/week, push:pull, quad:posterior, upper/lower share, frequency.

Notes
- Not tested on a real device or against live CDNs (Chart.js was stubbed in browser tests).
- The report cannot see food, sleep or stress; it only reads your logged sets.
- Strength Intelligence 1RM is effort-adjusted (reps + RIR); Progress charts use logged reps.
- Single tap on a calendar day waits ~300 ms to tell it apart from a double-tap.
