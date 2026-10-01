# Backlog: ideas from StarSteer, and thickness maps

October 2026. What ROGII's [StarSteer](https://rogii.com/products/starsteer) added from 2020 to 2026, sorted into
what helps a log-correlation tool and what does not, then a backlog for Weller Logs. Scope stays the same:
correlation panels and log display in a browser, not geosteering.

Source: ROGII release posts and press ([2026.1](https://www.rogii.com/blog/starsteer-2026-1),
[2025](https://rogii.com/blog/blog-post-all-the-features-we-launched-in-2025-part-1),
[2024](https://www.rogii.com/blog/major-features-releases-2024),
[2022.2](https://www.rogii.com/blog/starsteer-2022-2-new-release), [2021.3](https://www.rogii.com/blog/starsteer-2021-3),
[2021.2](https://www.rogii.com/blog/starsteer-20212-here), [2021.1](https://www.rogii.com/blog/starsteer-20211-has-launched),
[2020.4](https://www.rogii.com/blog/starsteer-20204-live), [World Oil, June 2026](https://www.worldoil.com/news/2026/6/1/rogii-upgrades-starsteer-software-for-geosteering-and-subsurface-analysis/)).
Their full notes are at kb.solo.cloud. 2023.2 to 2024.1 have no public feature lists, so those releases are thin here.

## 1. StarSteer releases, sorted

**A. Display, ease, speed, consistency, project management**

| Release | Feature | Weller Logs |
|---|---|---|
| 2020.3 | New UI; vertical and horizontal zoom; mudlog in the log track | Have |
| 2020.4 | Starred objects; several logs exported as one LAS; mudlog in the correlation panel | Have LAS export and mudlogs; no starring |
| 2021.1 | **Comments tied to an MD**; log color fills in the correlation panel | Fills: have. Comments: **backlog** |
| 2021.2 | Bulk LAS import; object-tree search; open a project with a colleague's profile | Have bulk import |
| 2021.3 | Custom reports; well workspaces; select objects on the map; **TVT scale in the correlation panel** | Map selection: have. TVT: partly (TVD hang) |
| 2022.1 | Grid import, reports, comment boxes, workspaces | — |
| 2022.2 | **Custom fill palettes**; multi-well import from one spreadsheet; **starred tops** (top, base, target); **1:1 vertical-exaggeration strip**; average dip across segments | Spreadsheet import: have. Rest: **backlog** |
| 2022.3 | Group tree; well-correlation mode; default view | Have a correlation tab |
| 2023.1 | Dark mode; **tops on/off in the correlation panel**; **tops spreadsheet for all wells**; prog tops from grids | Dark mode: have. Rest: **backlog** |
| 2025.1 | Multi-window map view; data owners | — |
| 2025.3 | **Template library with correlation-panel layouts**; coordinate conversion of many objects | **Backlog**; proj4js already planned |
| 2026.1 | **Undo/redo everywhere**; shared layouts and "Get window"; well-attribute manager; Google map underlay with **townships and sections**; public wells on the map; less memory | Undo and header tables: have. PLSS and public wells: **backlog** |

ROGII billed 2026.1 as a "quality of life" update. Undo, saved layouts and shared views are what users notice day to day.

**B. Geosteering, modeling and mapping**

| Release | Feature | Relevant here? |
|---|---|---|
| 2020.3–2020.4 | Bit projection, drilling corridors, confidence curve; resistivity tool models (PeriScope, ADR, BoundaryTracker); pre-job modeling | No |
| 2021.1 | Edit the target line on the map; 3D geomodel import; gamma-wrap correlation | No |
| 2021.2 | Curtain section for wells that turn; **auto-tops correlation**; stochastic resistivity inversion; sidetrack script | Auto-tops: yes (ghost tops, PLAN Next 1) |
| 2022.2 | 3D seismic; **thickness change in the pseudo-typewell**; average dip | Thickness and dip: yes |
| 2022.3 | Endless interpretations; multi-well autosteer | No |
| 2023.1 | Well-pad planning; resistivity inversion on servers | No |
| 2024 | Grid mapping; object slicing; **zones with attributes** | Zones with attributes: yes (zone stats on the map) |
| 2025.1 | Completions; **property mapping**; smudge tool | Property mapping: yes |
| 2025.2 | **Multi-typewell geosteering**; Solo projects; 3D geomodels in Solo | Type well column: yes |
| 2025.3 | Multilateral planning; **auto-calculated petrophysical logs**; fault-honoring grids | Have computed logs; faults: later |
| 2026.1 | Geomodel slices; synthetic logs along a trajectory | No |

Leave out: seismic, 3D geomodels, well planning, inversion, completions and server collaboration. They need a
server, large data or a drilling workflow, and they would bury the correlation panel under modes.

## 2. Backlog

Ordered by value for effort. Each item should add at most one visible control, or none.

### Now: small, daily use

1. **Tops grid.** One table: wells as rows, tops as columns, MD by default, with TVDSS and thickness as a toggle.
   Blank cells mark missing picks; typing in a cell moves the pick. Copy pastes into Excel. (StarSteer 2023.1)
2. **Show or hide tops.** Click a top in the correlation legend to dim it. Hidden tops stay in the project and
   the stats. (2023.1)
3. **Dip and thickness labels between wells.** When gaps are scaled to distance, label each correlation line with
   apparent dip (ft/mi or degrees) and each well's zone with its TVT. The numbers are already computed. (2022.2)
4. **1:1 view.** A *True scale* button sets vertical exaggeration to 1 when gaps are scaled to distance, and the
   panel shows the current VE. (2022.2)
5. **Notes at depth.** Alt-click a log to pin a short note to that MD: a core point, a show, "check this pick". Notes
   show as a flag in Logs and Correlation and save with the project. (2021.1)

### Next: correlation help

6. **Ghost and auto-tops.** Already Next 1 in [PLAN.md](PLAN.md). Ghosting first: drag a semi-transparent copy of one
   well's GR over a neighbor, stretch it with the wheel, and drop a top where it matches. Then DTW-suggested tops with
   Accept/Reject. (2021.2)
7. **Type well column.** Mark one well as the type well; it is pinned at the left of every section, hung the same way.
   (2025.2)
8. **Saved views.** Name the current section, hang, tracks and zoom as a view and switch from one dropdown. Views save
   in the project; one can be made the default for new projects. This also covers StarSteer's layout templates.
   (2025.3, 2026.1)
9. **Fill palettes.** Pick a palette (GR, resistivity, porosity) for value-colored fills from swatches, not a ramp
   editor. (2022.2)

### Maps: thickness and structure (Next 2 in PLAN.md)

See section 3. Done (October 2026): isopach and structure maps with posted values and "no pick" wells, thin-plate
contours clipped to the hull, a large-map view, well paths from directional surveys, and survey import from CSV,
text reports and .xlsx.

### Later

10. **Townships and sections** over the map from the BLM PLSS service, off by default. (2026.1)
11. **Public wells** from state services (ECMC, WOGCC, CalGEM) as grey dots that can be opened. Each state needs
    its own adapter, so start with one.
12. **Pseudo type log**: a composite GR built from wells flattened on a top, stretched for thickness change. (2022.2)
13. **Faults** as breaks in the section and in the grid. (2025.3)

## 3. Thickness and structure maps

### What the user sees

The Map / Satellite switch becomes four buttons: **Map · Satellite · Structure · Thickness**.

- **Structure** grids the depth (TVDSS) of a top. It starts on the top the section is flattened on, or the first top.
- **Thickness** grids the interval from one top to the next one down (isochore, true vertical). It starts on the zone
  last used in Zone stats. One dropdown sets the top; a thickness map adds a second set to "next top" unless changed.
- The basemap stays under the grid but turns grey and faded, so roads and section lines read without fighting the
  colors. No opacity slider.
- Every well posts its value. Wells missing either top show as hollow circles labeled "no pick", so gaps in the data
  are visible.
- Hover anywhere for the gridded value and the nearest wells. A click on a well still adds it to the section.
- Color is sequential for thickness and depth, with labeled contours at a round interval of about ten lines. The legend
  gives units and the number of wells used.

### Honest gridding

With 7 to 50 wells, any contour map suggests more than the data know. So:

- **Ship a bubble map first.** Circles colored and sized by value need no interpolation. That alone answers "where
  is it thick?" and is a day's work.
- **Then grid** with a thin-plate spline with light smoothing. It makes smooth surfaces close to what a geologist
  draws by hand, without IDW's bullseyes, and runs in milliseconds for 50 wells. Kriging
  ([kriging.js](https://github.com/oeo4b/kriging.js)) is a later option; its variogram needs more wells than most
  projects have.
- **Clip to the data.** Draw only inside the convex hull of the wells plus a small buffer. Outside it the map is
  blank, not extrapolated.
- Grid in feet or meters on a local plane around the wells' centroid, not in degrees.
- Thickness is TVT from each well's survey, not MD. A horizontal well counts only where it crosses both tops;
  otherwise it posts "not penetrated".
- Thickness is gridded directly (an isochore), not by subtracting two structure grids, which adds both grids' errors.

### Map any zone number

Zone stats already compute gross, net, net-to-gross, porosity, Sw, phi-h and HC-feet per zone and well. A small **map**
icon on each column header of the summary table maps that column through the same bubble or grid view. That gives
net pay and phi-h maps without new settings. This is StarSteer's "zones with attributes" and "property mapping"
(2024, 2025.1) at log scale.

### Link map and section

Draw the section's well order as a line on the map, and draw a line on the map to make a section (Next 2 in PLAN.md).
With a grid on, the section shows the gridded top as a dashed ghost between wells: the map and the panel then check
each other.

### Browser details

- Grid and contour in a Web Worker; draw on a canvas or `L.imageOverlay` with
  [d3-contour](https://d3js.org/d3-contour) for lines and labels.
  [d3-delaunay](https://d3js.org/d3-delaunay) gives the hull and nearest wells.
- PNG export of the map needs tiles loaded with `crossOrigin` from a server that sends CORS headers (check USGS). The grid and wells export
  without the basemap either way.
- Grids work offline; basemap tiles only show if cached. Export contours as GeoJSON for QGIS or ArcGIS.
- PLSS: [BLM National PLSS (CadNSDI) map service](https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer),
  public and keyless.

### Order

1. ~~Posted values for structure and thickness, with "no pick" wells.~~ Done.
2. Map icons on Zone stats columns.
3. ~~Thin-plate grid and contours clipped to the hull.~~ Done.
4. Section line on the map, and the gridded top ghosted in the section.
5. PLSS overlay; GeoJSON export.
