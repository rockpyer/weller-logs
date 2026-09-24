# Weller Logs

Well-log viewer with correlation panels, aimed at Southern California work.
Opens LAS files (wireline and mud logs), renders tracks on sensible default scales
(log-scale resistivity, reversed neutron/sonic, gas and drilling curves, stacked cuttings
percentages), correlates tops across wells, exports PNG, and saves everything as a
`.lasproj` file. Runs as a web page (Firefox, Brave, Chrome) or as a Mac/Windows/Linux
desktop app.

Plan and design notes: [docs/PLAN.md](docs/PLAN.md).

## Run in a browser

```
npm run web            # serves mockup/ on http://localhost:8080
```
Or open `mockup/index.html` from any static server. Downloads (project, PNG, CSV) work
from a real browser tab; they are blocked inside the hosted claude.ai preview.

## Run as a desktop app (macOS first)

```
npm install
npm start              # launches the Electron app
npm run dist           # builds dist/Weller Logs.dmg (run on a Mac)
```
The installed app registers `.lasproj` files, keeps a recent-projects list, and asks
"Reopen last project?" on launch. Cmd+O opens LAS, Cmd+S saves, Cmd+E exports PNG.

## Using it

- **Open LAS…** loads one or more files. Header quirks are handled: KB and lat/long in
  free-text fields, positive west longitudes, `-9999` nulls, wrapped LAS 1.2.
- **Well ⚙** sets name, API, KB/GL, lat/long and CRS when the header lacks them.
- **Track ⚙** edits curves, scales (with *auto* from the data), line and fill styles.
  Fill can sit left or right of the curve, solid or as a value gradient. Styles are
  project-wide: change GR once and every well follows. *Save all tracks as my defaults*
  keeps the set for new projects.
- **Tops**: type a name, *Pick on log*, click the depth. Import/export as CSV
  (`well,top,md`).
- **Correlation panel**: click wells on the map in section order; hang on measured depth,
  sea level (TVDSS), or flatten on any top. Only tracks marked *panel* are shown.
- **Export PNG** renders the current view at 2x.

Sample LAS files in `samples/` are synthetic. Regenerate with `npm run samples`.

## Layout

```
docs/PLAN.md         architecture, phases, default scales, pitfalls, open questions
mockup/index.html    the app (single file, D3 from cdnjs with a vendored fallback)
mockup/synth.js      synthetic well generator shared with the sample script
desktop/             Electron main process and preload bridge
samples/*.las        synthetic LAS 2.0 files
scripts/             utilities
```
