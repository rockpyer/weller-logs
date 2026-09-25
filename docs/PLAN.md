# Weller Logs — Plan

Desktop well-log viewer with correlation panels, built for Southern California work.
Opens LAS files (and later scanned PDF/TIFF logs), renders tracks on sensible default
scales, correlates across wells, and saves the whole session as one project file.

## 0. Decisions (proposed)

| Concern | Choice | Why |
|---|---|---|
| Shell | **Web app on GitHub Pages**, installable PWA | No install, works in Firefox/Brave/Chrome, offline via service worker. Brave/Chrome can pin it to the Dock and save straight to `.lasproj` (File System Access API); Firefox downloads copies. Opened LAS text is cached in IndexedDB so "Resume last session" needs no file picking. Electron was tried and dropped: not needed. |
| UI | Plain HTML + D3, one file for now | The app is ~1,500 lines. Splitting into Vite modules happens when the raster and survey code lands, not before. |
| LAS parsing | Our own parser (LAS 1.2/2.0, wrapped) | Real SoCal files break `las-js` assumptions: free-text ELEV and LOC fields, `-9999` in addition to `-999.25`, mixed-case mnemonics, positive west longitudes. The parser handles those with notes shown to the user. |
| Track rendering | Our D3 renderer now; **@equinor/videx-wellog** stays an option | videx-wellog is excellent for a single well, but the correlation panel needs datum shifts, cross-column polygons and gradient fills it does not provide. The current renderer does all of that in ~300 lines. Revisit if per-track zoom or huge curve counts become a problem. |
| Cross-section / trajectory | **@equinor/esv-intersection** (phase 3) | Vertical-section view of deviated wells with surfaces and logs along the path. Same family as videx. |
| 3D (later) | three.js or @webviz/subsurface-viewer | Only once trajectories and surfaces exist. |
| Map | **Leaflet** + USGS National Map topo and imagery tiles (public domain) | Light, no API key, satellite toggle. NAD27 is shifted to WGS84 with the abridged Molodensky transform (CONUS parameters, about 5 m). State Plane input still needs proj4js. |
| Raster logs | **pdf.js** (PDF) + **UTIF** (TIFF) | Render page to canvas, user picks depth tie points, we stretch to the depth scale. |
| Project file | `.lasproj` = JSON (optionally zipped with embedded LAS/raster copies) | Human-readable, diffable, easy to recover. |
| Session memory | localStorage autosave + IndexedDB LAS cache | App start prompts "Resume last session?" |

Links: [las-js](https://www.npmjs.com/package/las-js) · [videx-wellog](https://github.com/equinor/videx-wellog) · [esv-intersection](https://github.com/equinor/esv-intersection) · [pdf.js](https://mozilla.github.io/pdf.js/) · [UTIF](https://github.com/photopea/UTIF.js) · [MapLibre](https://maplibre.org/) · [proj4js](http://proj4js.org/) · [Electron](https://www.electronjs.org/)

## 1. Architecture

```
electron/            main process: windows, file dialogs, recent sessions, shortcut
src/
  core/
    las/             parse (las-js + fallback), normalize to WellData
    curves/          mnemonic alias table, default scales, unit conversion
    depth/           MD ↔ TVD ↔ TVDSS, datum handling, TST (later)
    raster/          pdf/tiff decode, depth calibration model
    project/         .lasproj schema (zod), load/save, migrations
  ui/
    map/             MapLibre well map, section line picker
    logview/         videx-wellog wrapper, track config panel
    correlation/     multi-well panel, tops, correlation lines, hang datum
    session/         resume-last-session prompt, autosave
mockup/index.html    single-file mockup (this deliverable), no build step
samples/             synthetic SoCal LAS files for demo/testing
```

Data model (the important bit):

```ts
Well { id, name, api?, location {lat, lon, crs}, elevation {kb, df, gl, unit},
       depthUnit: 'ft'|'m', curves: Curve[], survey?: SurveyStation[],
       rasters?: RasterLog[], tops: Top[] }
Curve { mnemonic, unit, description, data: Float64Array, null: NaN }
Top   { name, md, tvd?, color, source: 'user'|'import' }
Correlation { topName, wells: {wellId, md}[] }
Project { version, wells: WellRef[], tracks: TrackConfig[], panels: Panel[],
          correlations: Correlation[], view: {...} }
```

## 2. Phases

**Phase 1 — single well (done in the mockup, now the app).**
Open LAS → parse → alias curves → auto-build tracks (GR/SP/CAL, Resistivity log, Porosity, Drilling,
Gas, Cuttings %) → zoom/pan/depth window → edit tracks, scales, colors, fills → tops (pick, CSV)
→ save/load `.lasproj` → PNG export → hosted on GitHub Pages with resume-last-session.
Remaining for phase 1: enable Pages once after merge, and a test pass on more real LAS files.

**Phase 2 — correlation panel.**
Open several wells → side-by-side with shared depth or hung on a datum (sea level, a top,
or MD) → click-to-pick tops → correlation lines between panels → map shows section line
in the order of the panel → export panel as PNG/PDF.
Raster logs: open PDF/TIFF, pick two or more depth tie points, stretch into a track.

**Phase 3 — space.**
Directional surveys (LAS or CSV) → MD→TVD via minimum curvature → TVDSS in the panel →
esv-intersection cross section along the map line → true stratigraphic thickness from
dip (user-entered or from tops in ≥3 wells) → 3D preview.

## 3. Default scales and curve aliases

Everything is adjustable; these are the defaults. Resistivity is always log scale.

| Track | Curves (aliases) | Scale | Style |
|---|---|---|---|
| Lithology / SP / GR | GR (GR, GRC, SGR, CGR, ECGR, HSGR, GAMMA) | 0–150 GAPI linear (SoCal Puente/Monterey can run hot: allow 0–200) | green |
|  | SP (SP, SPR) | −160 to +40 mV | blue |
|  | CAL (CALI, CAL, HCAL) | 6–16 in | dashed grey |
| Resistivity | Deep (ILD, LLD, RT, AT90, AHT90, RLA5, RD, RILD) | 0.2–2000 Ω·m, 4 decades log | red |
|  | Medium (ILM, AT60, AHT60, RLA3, RM, RILM) | same | blue |
|  | Shallow (SFL, SFLU, MSFL, LLS, AT10, RXO, RS, SN) | same | green |
| Porosity | RHOB (RHOB, RHOZ, DEN, ZDEN) | 1.95–2.95 g/cc | red |
|  | NPHI (NPHI, TNPH, NPOR, CNC) | 0.45 to −0.15 v/v (reversed; convert pu→v/v) | blue dashed |
|  | DT (DT, DTC, DTCO, AC) | 140–40 µs/ft (reversed) | purple |
|  | PE (PE, PEF, PEFZ) | 0–10 b/e | black |
| Mud log — drilling | ROP (ROP, ROPA) | 0–300 ft/hr | black |
|  | WOB (WOB, WOBA) | 0–50 klb | blue |
|  | RPM | 0–200 | grey |
| Mud log — gas | Total gas (TG, TGAS, GAS, GASU) | 1–10000 units, log | black |
|  | C1 (C1, CH4, METH, METHANE) | 1–100000 ppm, log | red |
|  | C2, C3, iC4, nC4, C5 | same | orange/yellow/brown |
| Mud log — lithology | LITH, cutting % (SAND, SHALE, SILT, LIME) | 0–100 % | pattern fills |

## 4. Pitfalls we are designing around

- **Nulls.** −999.25 (and −999, −9999, 1e30) are gaps. Never draw across them, never treat as zero, never let them enter min/max autoscale.
- **Depth direction and step.** Negative STEP, STEP = 0 (irregular sampling), depth in meters with curves in field units. We trust the actual depth column, not STEP.
- **Depth reference.** MD from KB vs DF vs GL. Old SoCal files often omit elevation; we prompt for it and store it on the well. TVDSS only when a survey or vertical-well assumption is explicit.
- **Units.** ft vs m, pu vs v/v, µs/ft vs µs/m, ohm·m variants. Alias table carries expected unit and converts.
- **Mnemonic chaos.** GR_1, GR:2, GRC_EDIT; multiple runs in one file. First match wins, user can remap.
- **Resistivity on linear scale** hides everything. Default log, with optional wrap/backup.
- **Reversed scales** (NPHI, DT) so crossover reads correctly for gas.
- **Wrapped LAS** (`WRAP. YES`) and LAS 1.2 headers. Fallback parser.
- **Mud-log lag.** Gas and cuttings are lag-corrected by the logger, or not. We keep a per-curve depth shift.
- **Raster stretch.** Scanned paper is not linear over a 5-inch-per-100-ft log; two tie points is the minimum, more points with piecewise-linear mapping when needed. Watch 2-inch vs 5-inch scale sections in one scan.
- **Coordinates.** NAD27 vs NAD83 differs by ~100 m in LA. State Plane CA Zone 5 vs 6 in US survey feet. Always record CRS.
- **Hung datums.** Flattening on a top is stratigraphic and can hide structure. Both modes stay one click apart.
- **Deviated wells.** MD thickness ≠ TVT ≠ TST. Phase 3, but the model reserves the fields now.

## 4b. Point data and zone statistics

- Point series (core, XRD, pressures, shows) are sparse curves with their own depths. They
  resolve through the same alias lookup as log curves, so tracks, cursor readout, stats and
  crossplots treat them alike.
- Core-to-log depth shift is not applied yet. Core depths are often 2 to 10 ft off the logs;
  a per-well bulk shift is the next step.
- Zone stats weight each sample by its depth interval, so irregular sampling does not bias
  means. Resistivity, gas and permeability use geometric means; arithmetic means of
  log-normal data overstate them.
- Net sand is a single GR cutoff for now. A per-well Vsh from clean/shale baselines, plus
  porosity and resistivity cutoffs, would make net pay.

## 5. Session and desktop behavior

- App launch → if an autosaved session exists: "Resume last session?" (Resume / Start fresh).
- Autosave to localStorage on every render; opened LAS text cached in IndexedDB by file name.
- Project stores LAS file names; on load, wells come from the cache, else the user is asked to re-open them.
- "Desktop shortcut" = PWA install in Brave/Chrome, bookmark in Firefox.

## 6. Answers so far

- Web app, not a Mac app. Must work in Firefox and Brave; others will use Chromium.
- Headers may lack elevation and coordinates: entered per well in Well settings, stored in the project.
- Mud logs arrive as LAS when possible (Petrolog iLog export verified), otherwise PDF (phase 2 raster).
- Tops CSV import exists (`well,top,md`); no preload list yet.
- PNG is the export format.

## 7. Open questions

1. Windows, macOS, or both for the first installer?
2. Do your LAS files carry elevation and coordinates, or will you enter them? Do you have directional surveys?
3. Preferred CRS for map input: lat/lon, or State Plane Zone 5/6 feet?
4. Mud logs: do they arrive as LAS with C1..C5 curves, or as PDF only?
5. Any existing tops or formation naming (e.g. Pico / Repetto / Puente / Topanga) to preload?
6. Export needs: PNG of the panel, PDF, or a Petrel/Kingdom-style tops CSV?
