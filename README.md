# Weller Logs

Web-based well-log viewer with correlation panels, aimed at Southern California work.
Opens LAS files (wireline and mud logs), renders tracks on sensible default scales
(log-scale resistivity, reversed neutron/sonic, gas and drilling curves, stacked cuttings
percentages), correlates tops across wells, exports PNG, and saves everything as a
`.lasproj` file. Runs in Firefox, Brave, and Chrome; installable as an offline web app.

Plan and design notes: [docs/PLAN.md](docs/PLAN.md).

## Use it

**Hosted (after the PR merges):** https://rockpyer.github.io/weller-logs/ — GitHub Pages deploys
`app/` on every push to `main` (workflow in `.github/workflows/pages.yml`). The first run needs
Pages enabled once: repo **Settings → Pages → Source: GitHub Actions**.

**One-click open:** in Brave or Chrome, use the address-bar *Install* icon (or menu → *Install
Weller Logs*). It lands in the Dock/Applications like an app and works offline. In Firefox,
bookmark it or drag the URL to the Dock. Reopening shows "Resume last session?" and restores your
wells from the browser's cache, no file picking needed.

**Locally:**
```
npm run web            # serves app/ on http://localhost:8080
```

Files: Brave/Chrome save straight back to your `.lasproj` (Cmd+S) via the File System Access
API. Firefox downloads a copy instead. Cmd+O opens LAS, Cmd+E exports PNG. Everything runs in
the browser; no data leaves your machine.

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
app/index.html       the app (single file, D3 from cdnjs with a vendored fallback)
app/sw.js            service worker: offline shell cache
app/synth.js         synthetic well generator shared with the sample script
.github/workflows/   GitHub Pages deploy
samples/*.las        synthetic LAS 2.0 files
scripts/             utilities
```
