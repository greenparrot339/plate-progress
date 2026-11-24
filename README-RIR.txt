RIR (reps in reserve) update
============================
Data
- Each working set can carry an OPTIONAL `rir` (0-5, 5 = "5 or more"). Missing = unknown. Warm-ups never carry it.
- No migration: old sets simply have no `rir`, and behave exactly as before. Backup and split export/import copy the field as-is.
Entry
- Set modal: tap an RIR chip (tap again to clear). New rows copy the previous row's RIR. Log rows show "RIR n" / "to failure".
How each stat uses it
- Strength Intelligence: a set with RIR is read as reps + RIR (reps you could have reached), skips the "reps are a lower bound"
  penalty and gets a small weight boost. Headline 1RM, curve and forecasts use this. The trend line, anomaly check and records keep
  using logged reps so history stays comparable. Back-test/forecast scoring compares like with like. The learned lower-bound bias
  fades as RIR coverage rises. Confidence reports RIR coverage.
- Back-off detection: a lighter set taken to RIR <= 2 is a real hard set, not a back-off.
- Progress > Progressive overload: once the latest 5 same-weight sessions all have RIR on every set, the comparison switches to
  reps + RIR (only that RIR-logged run is used, so starting to log RIR can't fake progress).
- Insights: "Same weight, easier" / "Same reps, but harder" from RIR changes at an unchanged weight.
- Stats tab: volume is counted in HARD sets (working sets with RIR 0-3 or no RIR logged). Warm-ups and RIR 4+ sets are not counted.
- Progress > Day: working-sets tile shows hard sets and average RIR.
Unchanged on purpose: personal bests, tonnage (kg x reps), the primary-muscle frequency radar.
Tests: node strength-intelligence.test.js  (83 tests). Service worker cache bumped to v52.
