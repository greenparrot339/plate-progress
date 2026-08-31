Plate & Progress — STATS update

Files:
- index.html — existing app with STATS tab, primary-frequency radar, classification overrides, and four-tab swipe navigation.
- exercise-database.js — bundled local copy of plate_progress_exercise_database.json used for exercise classification.
- plate_progress_exercise_database.json — source database used to generate the bundled classifier.

No server/API/cloud storage was added. User classification overrides use the existing IndexedDB `data` object store under the `exerciseClassificationOverrides` key and are included in backup/import data.
