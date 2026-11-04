Split sharing (Split tab > Local backup card)
=============================================
Export this split  -> plate-progress-split-<name>-<date>.json
  One split + all its exercises (incl. archived) + every logged set + their muscle-group overrides.
Open a split file  -> in-app PREVIEW (temporary, in memory). Nothing is saved until Import.
  Edit before importing: rename split/days/exercises, add/remove exercises and days, fix or delete sets.
  Import asks for a name. If the name is taken it suggests "Name (imported)", then "Name (imported 2)"...
  The split is added as a NEW split (archived, unless you have no active split). Existing data is untouched.
  "Save edited file" re-exports the edited version to send back (e.g. on WhatsApp).
Android Share: manifest.json share_target + sw.js. With the app installed, Share the .json from WhatsApp /
  Files and pick Plate & Progress -> opens the preview directly. (iPhone: use "Open a split file" in the app.)
  After updating, the installed app may need a reload/reinstall before it appears in the Share menu.
Service worker cache bumped to v51.
