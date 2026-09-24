# Weller Logs — Plan

Desktop well-log viewer with correlation panels, built for Southern California work.
Opens LAS files (and later scanned PDF/TIFF logs), renders tracks on sensible default
scales, correlates across wells, and saves the whole session as one project file.

## 0. Decisions (proposed)

| Concern | Choice | Why |
|---|---|---|
| Shell | **Electron** + electron-builder | One-click desktop shortcut, native file dialogs, "reopen last session" prompt, no Rust toolchain needed. Core stays a plain web app, so it also runs in a browser. Tauri is the lighter alternative if install size matters. |
| UI | **React + TypeScript + Vite** | Boring and well-supported. Zustand for state. |
| LAS parsing | **las-js** (LAS 2.0) with our own fallback parser | `las-js` is maintained and zero-dep. Old CalGEM/DOGGR-era files are often LAS 1.2, wrapped, or have malformed headers; our fallback handles that. `wellio` is an older LAS-to-JSON converter with no advantage over las-js. |
| Track rendering | **@equinor/videx-wellog** | Production log-track component from Equinor (MIT). Scale tracks, log-scale resistivity, area fills, zoom/pan, headers. Avoids writing a track renderer from scratch. |
| Cross-section / trajectory | **@equinor/esv-intersection** (phase 3) | Vertical-section view of deviated wells with surfaces and logs along the path. Same family as videx. |
| 3D (later) | three.js or @webviz/subsurface-viewer | Only once trajectories and surfaces exist. |
| Map | **MapLibre GL** + OSM/USGS raster tiles, **proj4js** for CRS | SoCal wells come in NAD27, NAD83, CA State Plane Zone 5/6 (feet). proj4 handles all of it. |
| Raster logs | **pdf.js** (PDF) + **UTIF** (TIFF) | Render page to canvas, user picks depth tie points, we stretch to the depth scale. |
| Project file | `.lasproj` = JSON (optionally zipped with embedded LAS/raster copies) | Human-readable, diffable, easy to recover. |
| Session memory | Electron `userData` + recent-projects list | App start prompts "Reopen *last.lasproj*?" |

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

**Phase 1 — single well (the current ask).**
Open LAS → parse → alias curves → auto-build tracks (GR/SP/CAL, Resistivity log, Porosity, Mud log)
→ zoom/pan/depth window → edit tracks, scales, colors → tops → save/load `.lasproj`
→ Electron shell with desktop shortcut and "reopen last session" prompt.

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

## 5. Session and desktop behavior

- App launch → if a last project exists: "Reopen `<name>.lasproj`?" (Yes / Open another / New).
- Autosave a recovery copy every 60 s to `userData/recovery/`.
- Project stores relative paths to LAS/raster files plus an optional embedded copy so a `.lasproj` can travel alone.
- Desktop shortcut created by the installer (NSIS on Windows, DMG on macOS, AppImage/deb on Linux).

## 6. Open questions

1. Windows, macOS, or both for the first installer?
2. Do your LAS files carry elevation and coordinates, or will you enter them? Do you have directional surveys?
3. Preferred CRS for map input: lat/lon, or State Plane Zone 5/6 feet?
4. Mud logs: do they arrive as LAS with C1..C5 curves, or as PDF only?
5. Any existing tops or formation naming (e.g. Pico / Repetto / Puente / Topanga) to preload?
6. Export needs: PNG of the panel, PDF, or a Petrel/Kingdom-style tops CSV?
