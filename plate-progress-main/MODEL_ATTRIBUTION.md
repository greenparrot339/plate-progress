# 3D body model — source & license

## Current state: bundled processed GLB, no third-party asset

The interactive body shown on the STATS tab is **not** a downloaded or
third-party 3D model. It is built entirely at runtime from Three.js
primitive geometry (spheres, capsules, cylinders, boxes) in
`stats3d.js` → `buildProceduralBody()`.

Why: the model was built in a sandboxed environment with no outbound
network access, so no external GLB/GLTF file could be downloaded,
inspected, or license-checked. Rather than bundle a model of unknown
or unverifiable license, the body is generated in code instead. This
means:

- **License**: none needed — no third-party asset is included.
- **Attribution**: none required.
- **Modifications**: not applicable.

Each muscle group (chest, back, shoulders, arms, legs, core) is a
real, separately named `THREE.Mesh` (or set of meshes, left/right),
tagged with `mesh.userData.category`, so selection/highlighting/stats
work exactly as they would against a sculpted model.

## Upgrading to a sculpted/scanned GLB later

`stats3d.js` is already structured as a small model **adapter** so
this is meant to be a drop-in swap, not a rewrite. To upgrade:

1. Source a GLB with a **clear, redistributable license** that permits
   this kind of interactive/derivative use (e.g. CC0, CC-BY, or a
   license explicitly allowing app bundling). Good starting points:
   Sketchfab (filter by downloadable + CC license), Mixamo/Adobe
   (check current terms), or a purpose-built "muscle anatomy" asset
   pack with a compatible license. Verify the license text yourself —
   this document is not legal advice.
2. Ideally the GLB has muscle regions as separate mesh nodes (doesn't
   need to match the app's 6 categories exactly — finer detail like
   `pectoralis_major_l` / `deltoid_posterior_r` / `quadriceps_l` is fine
   and often better).
3. Update this file with: model name, source URL, author/creator,
   license, required attribution text, and any modifications made
   (e.g. re-exported, decimated, textures compressed).
4. Add the mesh/node names your GLB actually uses to
   `MUSCLE_MESH_TO_CATEGORY` in `stats3d.js` if they aren't already
   covered (matching is fuzzy — exact match first, then "contains").
5. Save the file as `body.glb` in the project root (same folder as
   `index.html`).
6. Include a GLTFLoader build for the Three.js version in use (the
   app currently loads Three.js r128 from cdnjs; cdnjs does not
   mirror the `examples/jsm` loaders, so you'll need to add a
   `<script>` tag for a compatible `GLTFLoader.js` UMD build — e.g.
   from a CDN that serves the three.js examples directory for r128,
   or upgrade the pinned Three.js version and pull a matching loader).
   `stats3d.js` checks for `THREE.GLTFLoader` and simply skips the GLB
   attempt (falling back to the bundled processed GLB body) if it isn't present,
   so nothing breaks if this step is missed — the model just won't
   upgrade.
7. Add `'./body.glb'` (and the GLTFLoader script URL, if it's a local
   file) to `APP_SHELL` / `EXTERNAL_RESOURCES` in `sw.js` so it's
   cached for offline use, and bump `CACHE_NAME`.
8. Reload. No changes are needed anywhere else — muscle-category
   mapping, selection, highlighting, the stats callout, the radar
   chart, gestures, and swipe-navigation protection all consume the
   same `{root, regions, anchors}` shape regardless of whether it came
   from `buildProceduralBody()` or the loaded GLB.
