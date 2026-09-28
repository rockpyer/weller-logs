# Weller Logs

Web-based well-log viewer and correlation tool. It opens LAS files (wireline and mud logs), draws tracks on
standard scales, runs a transparent quick-look petrophysical interpretation, correlates tops across wells in MD,
TVDSS or flattened on a top, and summarizes zones with net pay and crossplots. It runs in Firefox, Brave and
Chrome, installs as an offline web app, and saves everything to a `.lasproj` file. No data leaves your machine.

**Live:** https://rockpyer.github.io/weller-logs/

It opens on real data: seven Niobrara wells from the northern Denver-Julesburg Basin (Laramie County, Wyoming;
WOGCC public records) and a Weld County, Colorado Niobrara horizontal, flattened on the Niobrara top. See
[app/data/niobrara/README.md](app/data/niobrara/README.md) for provenance.

Methods, equations, defaults and limits: [docs/PETROPHYSICS.md](docs/PETROPHYSICS.md).

## What it does

- **Logs.** Tracks follow the [petroplots](https://github.com/andymcdgeo/petroplots) curve families, aliases and
  colors: GR/SP/caliper, resistivity on a log scale, density-neutron with PE and sonic, quick-look lithology from GR
  and PE, and interpretation tracks. The density scale follows the neutron's recorded matrix (read from the LAS
  header), so crossover reads correctly in every well. Fills can be solid or colored by value. Point data (core,
  XRD, pressures) plots as markers on any track.
- **Interpretation.** Vshale (linear, Larionov, Clavier), neutron-density porosity, Archie or Simandoux Sw on
  effective or total porosity with Rw corrected for temperature, Passey ΔlogR TOC, bad-hole flags, and net
  reservoir and net pay from cutoffs. Every parameter is in the Interpretation panel and saved with the project.
- **Correlation.** The dot beside each well (or a click on the map) adds it to the section; the section follows the Wells
  list order, which you drag to change and which starts west to east. Hang on MD, sea level (TVDSS) or flatten on any top.
  The depth track always labels real MD and subsea TVD (KB minus TVD, negative below sea level), whatever the hang.
  Deviated and horizontal wells use TVD from the directional survey in the LAS file. Zones are filled in the same
  colors as the stats tab. Gaps can be equal or scaled to wellhead distance, which is labeled. Drag any top line to
  move it, or type its MD in the Tops panel, where each top's color is set and can be saved as your default. The app
  warns when tops cross between wells or are missing from one.
- **Zone stats.** Box plots by zone and well, and crossplots: neutron-density with lithology lines, Pickett with Sw
  lines, PE-density with matrix points, or any two curves, colored by zone, GR band or well. The summary table gives
  gross, net, net-to-gross, net pay, average porosity and Sw, porosity-feet and hydrocarbon-feet per zone, with true
  vertical thickness in deviated wells. Everything exports as CSV.
- **Map.** USGS National Map topo or satellite imagery. NAD27 coordinates are shifted to WGS84.
- **Robust LAS reading.** LAS 1.2 and 2.0, wrapped data, several null values, headers with label and value swapped,
  elevations in `~Parameter`, bottom-up logs, surveys in `~Other`, and implausible KB elevations flagged rather
  than used. Covered by unit tests on the bundled real files.
- **Several files, one well.** LAS files whose API names the same borehole (first 12 digits; a 10-digit API is the
  original hole, `00`) merge into one well on a common depth grid. The event code (digits 13–14) does not split a
  well; a sidetrack code (`-01`, `-02`) does. A file with no API joins an open well of the same name (case and
  punctuation ignored) unless the APIs disagree. Runs of one curve that follow each other are spliced; curves that
  overlap (mud-log GR, MWD GR, a cement-bond GR) stay separate.
- **Several curves of one kind.** Where a well has more than one GR, ROP or other curve family, open-hole beats cased-hole
  and the curve covering the most depth is used. Pick another, or overlay all of them, in the well's settings (⚙),
  which also list curves no track shows and add a track for one with a click. Gamma ray from a cement-bond run is
  marked cased hole. The lithology track is labeled *computed* and names its GR, since it comes from cutoffs.
- **Header clean-up.** Latitude and longitude in degrees-minutes-seconds, drill time (min/ft) converted to ROP in
  ft/hr, and a TVD curve used for TVD when the file has no survey.
- **Import report.** A file that will not load says why: wrong file type (PDF, DLIS, TIFF, Excel, CSV, LAS 3.0),
  parse errors with the offending line (column count, text or comma decimals in the data), or no usable data
  (empty `~A`, all nulls, time-indexed), each with a fix and a minimal LAS 2.0 template.

## Use it

- **Open…** (Cmd+O), or drop files anywhere: LAS, `.lasproj`, tops CSV (`well, top, md`) or point-data CSV
  (`well, md`, then one column per measurement, units in the header such as `k (mD)`).
- **Save** (Cmd+S) writes the `.lasproj`. Brave and Chrome save back to the same file; Firefox downloads a copy.
- **Export PNG** (Cmd+E) renders the log view, or the crossplot on the stats tab.
- **Undo / redo**: Cmd+Z and Shift+Cmd+Z (Ctrl on Windows and Linux) step through edits to tops, tracks, parameters and the section.
- **ft / m** in the top bar switches display units; data stay in each file's own unit. ◐ switches to a dark theme.
- **Scale** is a print ratio: 1:240 is 5 in per 100 ft, 1:600 is 2 in per 100 ft (nominal on screen at 96 px per inch).
  **Fit** fits the logs to the window. Logs and Correlation keep their own zoom and scroll.
- **Manage wells** renames wells, fills operator, field, county, state and elevations for several at once, merges
  selected wells, splits a merged well back into one well per file, and removes or clears wells. Automatic merging
  by API can be turned off there. Re-opening a file with the same name replaces the earlier copy. Hover a well name for its header: operator, location, API, log date, elevations, TD.
- The lithology track's gear edits its Vshale and PE cutoffs and colors. Hover the lithology or flag tracks for the
  class at that depth, the values behind it and MD / ssTVD; hover their header swatches for the full legend.
- **Load example data** in the Wells panel switches between the Niobrara set and a synthetic LA Basin set.
- Reopening the app offers to resume the last session; opened LAS files are cached in the browser.
- In Brave or Chrome, the address-bar *Install* icon adds it to the Dock and it works offline.

## Publication figures with petroplots

On the Zone stats tab, **Export for petroplots** writes the curves in petroplots' canonical names with a
FORMATION column. Then:

```
pip install petroplots
python tools/petroplots_figures.py weller-curves-petroplots.csv --out figures --top 6300 --bottom 7650
```

It writes a log plot per well, a neutron-density crossplot split by formation and colored by GR, and a porosity
histogram by formation, using the app's zone colors.

## Develop

```
npm run web     # serves app/ on http://localhost:8080
npm test        # LAS parser and petrophysics unit tests (Node 18+)
npm run tops    # re-pick the example tops (Python 3 with numpy)
```

GitHub Pages deploys `app/` on every push to `main`; CI runs the tests on every pull request.

```
app/index.html       layout and styles
app/js/las.js        LAS reader, header normalization, surveys and TVD (browser and Node)
app/js/petro.js      petrophysics equations (browser and Node)
app/js/interp.js     interpretation workflow and its panel
app/js/core.js       state, tracks, depth frames, correlation, files, project
app/js/stats.js      zone summations, box plots, crossplots, CSV exports
app/js/map.js        Leaflet map, basemaps, NAD27 to WGS84
app/js/points.js     point-data import and drawing
app/data/niobrara/   example LAS files and tops
tests/               node:test suites
tools/               petroplots figure script
scripts/             data preparation and top picking
docs/                plan and petrophysics methods
```
