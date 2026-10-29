Plate & Progress — STATS update

Files:
- index.html — existing app with STATS tab, primary-frequency radar, classification overrides, four-tab swipe navigation, and (new) the interactive 3D-body STATS view.
- exercise-database.js — bundled local copy of plate_progress_exercise_database.json used for exercise classification.
- plate_progress_exercise_database.json — source database used to generate the bundled classifier.
- stats3d.js — (new) the 3D body module: procedural muscle-region model, Three.js scene/camera/gesture handling, raycasting-based muscle selection, and a swappable model-adapter layer. See the header comment in this file, and MODEL_ATTRIBUTION.md, for how to later replace the procedural body with a sculpted GLB.
- MODEL_ATTRIBUTION.md — (new) 3D model source/license documentation, required by the STATS-3D spec even though no third-party asset is currently bundled.
- sw.js — service worker; now also caches stats3d.js and the Three.js CDN build for offline use, alongside the existing Chart.js/fonts caching.

No server/API/cloud storage was added. User classification overrides use the existing IndexedDB `data` object store under the `exerciseClassificationOverrides` key and are included in backup/import data. The 3D STATS feature reads the same exercise/set/classification data — no new storage was introduced for it.

Known limitation (please read): this was built without network access, so no third-party 3D asset could be sourced. The body shown is a procedurally-built Three.js figure (see MODEL_ATTRIBUTION.md), not a photorealistic scan. It is architected so a licensed GLB can be dropped in later as a swap, not a rewrite.


LOCAL 3D PREVIEW
=================
Do not open index.html directly with file:// when testing the 3D model.
Run start-local-server.bat (or use VS Code Live Server), then open:
http://localhost:8000/
The GLB is loaded as ./body.glb and requires HTTP serving in browsers that block file:// XHR/fetch.
