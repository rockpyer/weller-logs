# Well(er) Logs

Web-based well-log viewer and correlation tool. It opens LAS files (wireline and mud logs), draws tracks on
standard scales, runs a transparent quick-look petrophysical interpretation, correlates tops across wells in MD, ground level,
TVDSS or flattened on a top, and summarizes zones with net pay and crossplots. It runs in Firefox, Brave and
Chrome, installs as an offline web app, and saves everything to one `.lasproj` file: the LAS data, mudlog images,
tops, tracks and settings, so a project opens on any computer. No data leaves your machine.

**Live:** https://logs.ryweller.com

It opens on real data: seven Niobrara wells from the northern Denver-Julesburg Basin (Laramie County, Wyoming;
WOGCC public records) and a Weld County, Colorado Niobrara horizontal, flattened on the Niobrara top. See
[app/data/niobrara/README.md](app/data/niobrara/README.md) for provenance.

Methods, equations, defaults and limits: [app/methods.md](app/methods.md), shown in the app at
[logs.ryweller.com/methods.html](https://logs.ryweller.com/methods.html).

## What it does

- **Logs.** Tracks follow the [petroplots](https://github.com/andymcdgeo/petroplots) curve families, aliases and
  colors: GR/SP/caliper, resistivity on a log scale, density-neutron with PE and sonic, quick-look lithology from GR
  and PE, and interpretation tracks. The density scale follows the neutron's recorded matrix (read from the LAS
  header), so crossover reads correctly in every well. Fills can be solid or colored by value. Point data (core,
  XRD, pressures) plots as markers on any track.
- **Point data and other tables.** A CSV or sheet that is plainly tops or a well header loads straight away. Anything
  else asks *What's in this file?*: labeled depths (corrosion, perfs, shows; one depth or top and base), measurements
  at depth, tops, well header or directional survey, with the well, API, label and depth columns preselected and a
  preview of which wells are open. MD or TVD (converted through the survey). Labeled depths land in one track, in the
  logs and the correlation panel, with a lane and color per class; **Split** in Point data gives each class its own track.
- **Interpretation.** Vshale (linear, Larionov, Clavier), neutron-density porosity, Archie or Simandoux Sw on
  effective or total porosity with Rw corrected for temperature, Passey ΔlogR TOC, bad-hole flags, and net
  reservoir and net pay from cutoffs. Every parameter is in the Interpretation panel and saved with the project.
- **Correlation.** The dot beside each well (or a click on the map) adds it to the section; the section follows the Wells
  list order, which you drag to change and which starts west to east. Hang on MD, ground level (TVD below GL), sea level (TVDSS) or flatten on any top.
  The depth track always labels real MD and TVDSS (TVD minus KB, positive down), whatever the hang.
  Deviated and horizontal wells use TVD from the directional survey in the LAS file. Zones are filled in the same
  colors as the stats tab. Gaps can be equal or scaled to wellhead distance, which is labeled. The app warns when
  tops cross between wells or are missing from one.
- **Picking tops.** **Pick tops** above the logs (or T) opens a pick bar: choose a top (or type a new one, or press 1–9),
  then click it in each well of the section; pick mode stays on until Done or Esc. The bar shows which wells still
  need the top and each well's MD, where you can type an exact depth. Drag any top line to move it, and ↑/↓ nudge the
  last pick by half a foot (Shift: 5 ft). In the Logs tab, [ and ] step to the previous or next well, keeping the top.
  Picks redraw only the top lines and the correlation, not the logs. The Tops panel sets each top's color, which can
  be saved as your default.
- **Zone stats.** Box plots by zone and well, and crossplots: neutron-density with lithology lines, Pickett with Sw
  lines, PE-density with matrix points, or any two curves, colored by zone, GR band or well. The summary table gives
  gross, net, net-to-gross, net pay, average porosity and Sw, porosity-feet and hydrocarbon-feet per zone, with true
  vertical thickness in deviated wells. Everything exports as CSV.
- **Map.** USGS National Map topo or satellite imagery. NAD27 coordinates are shifted to WGS84. Wells with a
  directional survey are drawn from the wellhead to TD as seen from above. The side panel keeps a small map with
  Map · Satellite · Gridding in its header (Gridding opens the **Map** tab) and a color bar labeled with the contour interval.
- **Isopach and structure maps** (Map tab). Pick *Isopach* and two tops, or *Structure* and one top. The panel beside
  the map lists each well's value (click a row to select the well), how the surface was made, and the full legend. Each well
  posts its value: true vertical thickness (TVD from the survey), placed where the well path is halfway through the
  interval, or the top's subsea depth, placed where the path crosses it. A thin-plate spline contours the values at
  a round interval, only inside the wells' convex hull plus a margin; beyond that the map is blank. Wells missing a
  pick say so on the map. The basemap turns grey under the colors; hover gives the gridded value and the nearest
  well's. Thick (or deep) is dark. Fewer than three wells, or wells on a line, post values without contours.
- **Directional surveys** load from their own files: CSV, tab-delimited, fixed-width text reports, `.xlsx` or pasted
  cells. Columns are found by name (MD, Inc, Azi, and TVD, N/S, E/W when given) below any preamble; units come from
  the header, a units row or the preamble; the well from a well or API column, the preamble (`Well Name:`, `API:`) or
  the file name, and one sheet may hold several wells. A file with only MD, TVD and offsets works too. TVD and
  offsets are recomputed by minimum curvature, tied in at the first station, and a disagreement with the file's own
  TVD is noted. An imported survey replaces the LAS one and is saved in the project; each well's ⚙ has *Load
  survey…* and *Remove imported survey*. `samples/Inglewood_12_A_survey.txt` is a synthetic example survey.
- **Robust LAS reading.** LAS 1.2, 2.0 and 3.0 (Log, Tops and Inclinometry data sets; comma or tab delimiters, quoted text), wrapped data, several null values, headers with label and value swapped,
  lasio-style tolerance (run-together values like `-999.25-999.25`, comma decimal marks, text nulls such as `NA` or `INF`,
  extra sentinels such as `9999.25` and `2147483647`, header lines missing the period, byte-order marks and old Mac line ends),
  elevations in `~Parameter`, bottom-up logs, surveys in `~Other`, and implausible KB elevations flagged rather
  than used. Covered by unit tests on the bundled real files.
- **Several files, one well.** LAS files whose API names the same borehole (first 12 digits; a 10-digit API is the
  original hole, `00`) merge into one well on a common depth grid. The event code (digits 13–14) does not split a
  well; a sidetrack code (`-01`, `-02`) does. A file with no API joins an open well of the same name (case and
  punctuation ignored) unless the APIs disagree. Where the file name starts with an API (as state downloads such as
  CalGEM and WOGCC do) that names a different well than the `~Well` header, the file name wins, with a warning: vendors
  often copy the header from the neighboring well. The load summary warns when a merged file repeats curves over the
  same depths, the usual sign of a wrong merge. Runs of one curve that follow each other are spliced; curves that
  overlap (mud-log GR, MWD GR, a cement-bond GR) stay separate.
- **Several curves of one kind.** Where a well has more than one GR, ROP or other curve family, open-hole beats cased-hole
  and the curve covering the most depth is used. Pick another, or overlay all of them, in the well's settings (⚙),
  which also list curves no track shows and add a track for one with a click. Gamma ray from a cement-bond run is
  marked cased hole. The lithology track is labeled *computed* and names its GR, since it comes from cutoffs.
- **Vendor mnemonics.** Built-in tracks recognize common LWD, mud-log and cased-hole names: array resistivity by depth of
  investigation (R20/R30/R40/R60/R85 and RT10–RT90 with their processing variants), spectral gamma (K, Th, U, CGR),
  neutron and density porosity on limestone, sandstone or dolomite (NPRL, DPRL…), density caliper and correction,
  bit size, C3–C5 gas, oil shows, mud-log lithology percentages, and shock and stick-slip. Cased hole gets Cement bond
  (3 ft amplitude, transit time, bond index, CCL), Ultrasonic cement (acoustic impedance), Casing (thickness, ID,
  ovality) and Temp · tension tracks. These appear only in wells that have the curves; where the range depends on the
  job (casing size, tension, shock) the scale comes from the well's data.
- **MWD / LWD.** Sensor-to-bit offsets in the header are listed per tool in the load summary; when the header says the
  index is bit depth, matching curves move to sensor depth, otherwise one click applies the shift (saved with the
  project). Azimuthal GR (up, down, left, right, asymmetry) and survey inclination and azimuth have their own tracks.
  Cable tension plots with GR and caliper to show tight spots.
- **Edit a curve in place.** Click a curve's scale in a track header: display name, which curve, color, line style
  (solid, dashed, dotted, dash-dot) and width, left and right scale, log scale, wrap, and a fill (solid or colored by
  value). Changes apply at once to that track in every well; **Remove from track** drops the curve. Cmd+Z undoes.
- **Measure** (M) drags out an interval on any log and reads its MD thickness, true vertical thickness (TVT, from the
  survey) and the MD and TVDSS at top and base. Esc ends.
- **Saved views.** **Views ▾** names the current section, hang, tracks, scale and depth on screen, and switches back
  to it from the same menu. Views are kept in the session (so *Resume* brings them back) and in the saved project.
- **Off-scale values wrap.** A value past a track's scale continues from the other edge as a dotted backup trace, as on a
  printed log, instead of piling up at the edge. Each track's ⚙ turns it off.
- **Lithology patterns.** The computed lithology and cuttings % tracks draw FGDC-style ornaments over each color (dots for
  sand, dashes for shale, brick for limestone, slanted brick for dolomite), in the tracks, legends and PNG export.
- **Curve QC** (Wells → Curve QC). A coverage table shows which wells have which logs. Per well, each curve is checked for
  coverage, gaps, flat runs, spikes, physical range and units ([welly](https://github.com/agilescientific/welly)'s tests),
  with a score. Despike replaces spikes with a rolling median (resistivity in log space). Normalize GR rescales a well's
  P5–P95 onto a reference well's, over the whole log or one zone. Edits are saved with the project and undo with Cmd+Z.
- **LAS export.** Export LAS writes the selected well as LAS 2.0: logged curves as shown (shifts, despiking and
  normalization applied), computed curves, tops as `TOP_` parameters, the directional survey and the interpretation
  parameters in `~Other`. It reads back into Well(er) Logs and lasio.
- **Curve help.** Hover a track header for each curve's color, what it measures, the file it came from and what else
  in the well could stand in. About → *Methods, curve mapping and assumptions* lists every rule and the mnemonics each
  track accepts.
- **Header clean-up.** Latitude and longitude in degrees-minutes-seconds, a positive longitude in a western US well
  read as west (noted, not flagged), a missing API taken from the file name, drill time (min/ft) converted to ROP in
  ft/hr, and a TVD curve used for TVD when the file has no survey.
- **Load summary.** After opening files, one card per well says what came in and what to do: pick between duplicate
  curves, add curves no track shows, fill a missing location or elevation. Notes are folded under Details.
  A file that will not load says why: wrong file type (DLIS, Excel, CSV),
  parse errors with the offending line (column count, text or comma decimals in the data), or no usable data
  (empty `~A`, all nulls, time-indexed), each with a fix and a minimal LAS 2.0 template.
- **Mudlogs (beta).** A separate tab lines up to 8 PDF or TIFF mudlogs side by side, hung in MD, in subsea
  (MD − KB, positive down, vertical hole assumed) or flattened on a pick. Where the PDF has text (vector output, or a scan
  already run through OCR), the depth column is found and fitted page by page, stray numbers outvoted, and header and
  legend pages are hidden. Scans without text take two clicks on ruled depth lines (the click snaps to the line); later
  pages continue at that scale, and one more click on any page fixes its offset. Well name, API, operator, field,
  KB/GL and latitude/longitude are read from the header text and can be edited; **Sort west → east** orders the panel by
  longitude. Link a LAS well (matched by API or name) to share picks with its tops, which then show in Correlation, and
  to draw one of its curves over the scan. Images are cut into strips at import (in a background worker for TIFF) and
  kept in the browser's IndexedDB, with a quarter-resolution copy for zoomed-out views, so the panel scrolls smoothly
  whatever the file size. The panel opens at 1:2400 and keeps its scale when you change the hang; **Fit** shows
  everything. The mudlog panel on the left can be dragged wider. A 40 MB uncompressed TIFF (3435 × 98,000 px) imports in about 16 s without freezing
  the page; files over 35 MB ask first. Projects save the images with the calibration and picks. **Remove all mudlogs**
  clears the tab and its stored images.

## Use it

- **Open…** (Cmd+O), or drop files anywhere: LAS, `.lasproj`, tops or well-header tables, or point-data CSV
  (`well, md`, then one column per measurement, units in the header such as `k (mD)`). PDF and TIFF files open in
  the Mudlogs tab.
- **Tops and well-header tables** load from CSV, tab-delimited text, an Excel `.xlsx` (every sheet), or cells copied
  from a spreadsheet and pasted anywhere (Cmd+V, header row included). Columns are recognized by name, extra columns
  are fine:
  - *Tops*: well name or API, a top name (`Formation`, `Marker / Formation Top`…) and MD (`MD`, `Top (ft MD)`…).
  - *Well header*: well name or API plus any of operator, field, county, state, KB, GL, KB above GL, latitude,
    longitude, surface X/Y and CRS, spud and completion dates, status, type, TD (MD and TVD) and depth datum.
    Other columns (casing depth, scope…) are kept as named values and shown on hover over the well name.
  - Rows match open wells by API (first 10 digits; a 9-digit API that lost its leading zero is fixed) or by well or
    short name, ignoring case, spaces and punctuation. Repeated rows collapse. Where rows disagree, or a value
    differs from the well's, **Review import** asks which to keep (the value most rows give is preselected) or takes
    a typed one. Blank fields fill without asking. Several files opened together merge first.
- **New** closes all wells, mudlogs and their stored files (it asks first). Tick "Also reset settings" to return
  tracks, interpretation parameters, units, depth labels, header height and map to defaults; theme stays.
- **Older projects** saved before the LAS text was stored inside: open the .lasproj together with its LAS files
  (select them all in one Open) and the wells come back with their tops and edits. Save again to pack them in.
- **Save** (Cmd+S) writes the `.lasproj`. Brave and Chrome save back to the same file; Firefox downloads a copy.
  The project holds the LAS files (gzip), mudlog images, tops, shifts and edits, point data, tracks (order, curves,
  colors, scales), interpretation parameters, hang, zoom, section order, units, depth labels and header height, so
  it opens complete on another machine. Projects saved by older versions still open; they ask for the LAS files.
- **Export** menu: the current view as PNG (Cmd+E; the log, section, crossplot or mudlog; for logs and sections a dialog
  sets the depth range or interval between two tops, print scale, resolution, headers and a white background, with a preview), the selected well or all wells
  as LAS, tops or zone stats as CSV, or a full project bundle (.zip with the project file, every well as LAS, tops and
  stats CSV, and a section PNG).
- **Undo / redo**: Cmd+Z and Shift+Cmd+Z (Ctrl on Windows and Linux) step through edits to tops, tracks, parameters and the section.
- **Esc** closes any dialog or popover without applying it. New curves in a track get their own range and a color that
  reads in both themes.
- **ft / m** in the top bar switches display units; data stay in each file's own unit. ◐ switches to a dark theme.
- **Scale** is a print ratio: 1:240 is 5 in per 100 ft, 1:600 is 2 in per 100 ft (nominal on screen at 96 px per inch).
  **Fit** fits the logs to the window. Logs and Correlation keep their own zoom and scroll.
- **Manage wells** renames wells, fills operator, field, county, state, latitude/longitude and elevations for several at once, merges
  selected wells, splits a merged well back into one well per file, and removes or clears wells. Automatic merging
  by API can be turned off there. Re-opening a file with the same name replaces the earlier copy. Hover a well name for its header: operator, location, API, log date, elevations, TD.
- **State and county from the API number.** When a file leaves them blank or gives only codes (`04`, `037`), the
  first five API digits fill them in (04-037 → CA, Los Angeles). API county codes are FIPS codes outside Alaska;
  the table is `app/js/apicodes.js`, built by `scripts/make-api-codes.py`. Names already in the file are kept.
- The lithology track's gear edits its Vshale and PE cutoffs and colors. Hover the lithology or flag tracks for the
  class at that depth, the values behind it and MD / TVDSS; hover their header swatches for the full legend.
- On load, a dialog offers: resume the last session, load the example dataset (DJ Basin Niobrara), start a new
  project, or open files. **Load example data** in the Wells panel reloads the example.
  Opened LAS files are cached in the browser.
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
npm test        # LAS parser, petrophysics and mudlog calibration unit tests (Node 18+)
npm run tops    # re-pick the example tops (Python 3 with numpy)
```

Cloudflare Workers Builds deploys `app/` to https://logs.ryweller.com on every push to `main` (config in `wrangler.jsonc`)
and builds a preview URL for every other branch; CI runs the tests on every pull request.

```
app/index.html       layout and styles
app/js/las.js        LAS reader, header normalization, surveys and TVD (browser and Node)
app/js/petro.js      petrophysics equations (browser and Node)
app/js/interp.js     interpretation workflow and its panel
app/js/core.js       state, tracks, depth frames, correlation, files, project
app/js/stats.js      zone summations, box plots, crossplots, CSV exports
app/js/zip.js        stored ZIP writer for multi-file exports
app/js/map.js        Leaflet map, basemaps, NAD27 to WGS84, well paths, isopach and structure maps
app/js/survey.js     directional survey files: column finding, units, wells, minimum curvature (browser and Node)
app/js/grid.js       thin-plate spline gridding inside the wells' hull (browser and Node)
app/js/points.js     point-data import and drawing
app/js/mudcal.js     mudlog depth-label fitting, page calibration, header reading (browser and Node)
app/js/mudlog.js     Mudlogs tab: import, strip storage, correlation canvas, calibration, picks
app/js/mudworker.js  TIFF decoding in a worker (UTIF.js)
app/vendor/          d3, Leaflet, pdf.js 3.11 (Apache-2.0), UTIF.js and pako (MIT)
app/data/niobrara/   example LAS files and tops
tests/               node:test suites
tools/               petroplots figure script
scripts/             data preparation and top picking
docs/                plan and petrophysics methods
```

## License

Apache License 2.0 (`LICENSE`, `NOTICE`). The software and its results are provided as is, with no warranty and no
liability; see sections 7 and 8 of the license.
