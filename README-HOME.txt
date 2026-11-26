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
- Report button (bottom): opens a chooser sheet -> Overall report or Weekly report (This week / Last week).
  Both download as PDFs generated fully offline.

REPORT (rule-based, no network)
- Top 3 priorities (each with action + a measurable check), going-well list, Do / Don't lists,
  per-lift cards, "Reading your graphs" for every screen, all findings, and stated limits.
- Muscle balance: hard sets per muscle/week, push:pull, quad:posterior, upper/lower share, frequency.

Notes
- Not tested on a real device or against live CDNs (Chart.js was stubbed in browser tests).
- The report cannot see food, sleep or stress; it only reads your logged sets.
- Strength Intelligence 1RM is effort-adjusted (reps + RIR); Progress charts use logged reps.
- Single tap on a calendar day waits ~300 ms to tell it apart from a double-tap.

WEEKLY REPORT (report-weekly.js, ReportPDF.renderWeekly)
- One Mon-Sun week vs the previous logged week (same days when the week is still in progress).
- Per split day (hard sets, volume, avg RIR vs last time), per muscle (hard sets vs the 10-20 range),
  per lift (best set vs previous session, estimated 1RM change), effort (RIR spread), rep ranges,
  records, 3 priorities, do / don't, and a next-week plan (set targets per muscle, double-progression
  target per lift).
- Every suggestion carries a one-line "why" and an evidence label (Strong / Moderate / Practical), and
  the PDF ends with the research behind the rules (Schoenfeld 2016/2017, Refalo 2023 etc.).
- The overall report now carries the same why/evidence notes and a science section.
- Service worker cache: plate-progress-v54-weekly.

UPDATE 3 - ROTATION, LOCKED WEEKLY REPORT
- Split rotation now follows the calendar (scheduledDay in index.html, used by Home and the Log tab's
  default day): the day after your last logged day is due the next day, and so on. A skipped day is
  "missed" (Home shows "Missed Lower 1 yesterday - Do it today instead") and today shows the day after
  it. After a break longer than one full cycle it falls back to "the day after the last logged one".
- Weekly report opens when its week ends (Monday 00:00 local). The Home report card and the chooser sheet show
  a live countdown while it is locked. When it opens: a toast, a NEW badge on the report card (cleared
  once you open the chooser), and an OS notification only if you had already allowed notifications.
- All reports unlock after 2 logged working sets (warm-ups do not count). Overall reports built from
  under 3 sessions are marked "EARLY REPORT" in the PDF.
- DB_META.weeklyNotified / weeklySeen remember which week was announced / seen.
- Service worker cache: plate-progress-v55-lock.

UPDATE 4 - TODAY CARD
- A day with sets logged but exercises still untouched now shows "in progress" (x of y exercises, progress bar, remaining exercises, Continue / Finish for today). "Done for today" appears once every exercise has sets or you tap Finish (DB_META.finishedDate). Cache v56-progress.

UPDATE 5 - REST DAY
- Log tab rest day shows the sleeping-monkey photo (rest-monkey.jpg) in a night-sky frame: breathing, floating Zs, snore bubble, twinkling stars, rocking moon, rotating goofy captions, a fake "rebuild" bar, and tap-to-poke (bubble lines escalate). Respects reduced motion. Cache v57-monkey.
