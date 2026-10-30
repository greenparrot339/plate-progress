Strength Intelligence (Stats tab)
=================================
Files
- strength-intelligence.js       Pure maths engine (no DOM/DB). Also runs in Node.
- strength-intelligence.test.js  71 tests:  node strength-intelligence.test.js
- strength-ui.js                 Stats doorway card + full-screen dashboard (Ask / Curve / Trend / Insights). Injects its own CSS.
- index.html                     3 small hooks only: two <script> tags, the card mount in renderStats(), back-button + swipe guards.
- sw.js                          New files cached; cache bumped to v48.

Data
- Reads the existing sets/exercises. Nothing in them is changed or duplicated.
- Same lift on several days/splits is pooled by name (same normalisation as the rest of the app).
- One new IndexedDB key, 'strengthIntelligence' {version, unit, tab, forecasts[]}: kg/lb choice, last tab, forecast log.
  It is not part of the JSON backup (forecast history only; everything else is recomputed from your sets).

Model (no machine learning)
- Per-set 1RM = Epley/Brzycki/Lombardi blend, weighted by rep range.
- 1RM + personal "endurance factor" fitted to your own sets (recency-weighted, repeat/back-off sets down-weighted,
  reps treated as a lower bound). Factor only fitted when logs span ~15% in weight; otherwise formula curve shape.
- Range = fit residuals, then out-of-sample back-test errors. Systematic bias found in the back-test is corrected.
- Back-test: every session's top set is predicted from earlier sessions only. Different weight / long gap => skipped.
- Confidence: Insufficient / Preliminary / Moderate / Well calibrated, from sessions, sets, recency,
  consistency and measured back-test error.
- Ignored: warm-ups, sets with no weight (bodyweight), invalid rows, sessions >30% off their neighbours (probable typos).
