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

- **Open…** (or drop files anywhere) takes LAS files, `.lasproj` projects, tops CSVs and
  point-data CSVs. The app tells them apart by content.
- **Well ⚙** sets name, API, KB/GL, lat/long and CRS when the header lacks them.
- **Track ⚙** edits curves, scales (with *auto* from the data), line and fill styles.
  Styles are project-wide: change GR once and every well follows.
- **Point data**: a CSV with `well, md` and one column per measurement (core porosity,
  permeability, XRD, pressures, show ratings). Units go in the header, e.g.
  `core_phi (v/v)` or `k (mD)`. Porosity in percent is converted to v/v. Each series gets a
  sensible track (porosity on the neutron scale, permeability on a log track) and can be
  moved to any track or hidden from the sidebar.
- **Map / Satellite** toggles USGS National Map topo and imagery. NAD27 well coordinates
  are shifted to WGS84 so they land on the imagery.
- **Tops**: type a name, *Pick on log*, click the depth. Tops CSV columns: `well, top, md`.
- **Correlation**: click wells on the map in section order; hang on measured depth,
  sea level (TVDSS), or flatten on any top.
- **Zone stats**: per well and zone (top to next top), gross and net thickness from a GR
  cutoff, depth-weighted means (geometric for resistivity, gas and perm), P10/P50/P90,
  box plots by zone, and a crossplot of any two curves or point series colored by zone.
  Exports as CSV.
- **Export PNG** renders the log view, or the crossplot on the stats tab.

Sample LAS files and `samples/core_points.csv` are synthetic. Regenerate with `npm run samples`.

## Layout

```
docs/PLAN.md         architecture, phases, default scales, pitfalls, open questions
app/index.html       page layout and styles
app/js/core.js       state, LAS parsing, log tracks, files, project save/load
app/js/points.js     point-data import, placement and drawing
app/js/map.js        Leaflet map, basemap toggle, NAD27 to WGS84 shift
app/js/stats.js      zone statistics, box plots, crossplot
app/synth.js         synthetic wells and core plugs for the demo
app/vendor/          offline copies of D3 and Leaflet
app/sw.js            service worker: offline shell cache
.github/workflows/   GitHub Pages deploy
samples/*.las        synthetic LAS 2.0 files
scripts/             utilities
```
