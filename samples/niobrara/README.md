# Synthetic core point data: Mattson 12-32

Test files for point-data import and plotting, for the example well Mattson 12-32 (API 49-021-20933, `app/data/niobrara/2120933C.las`).
**Synthetic, not measured.** Values are driven by the well's own GR and RHOZ so they track the logs: chalk benches get more
calcite, porosity and stiffness; marls more clay, TOC and water. Core depths are on log depth (no core-to-log shift).
Regenerate with `python3 scripts/make_niobrara_points.py` (fixed seed).

| File | Rows | Spacing | Matched by | Columns |
|---|---|---|---|---|
| `Mattson_12-32_core_RCA.csv` | 154 | ~5 ft | well name + API | porosity (%), perm (mD), grain and bulk density, Sw, So (%), TOC (wt%) |
| `Mattson_12-32_geomech.csv` | 38 | ~20 ft | 10-digit API only | plug bulk density, Vp, Vs (ft/s), dynamic and static Young's modulus (Mpsi) and Poisson's ratio, UCS (psi) |
| `Mattson_12-32_XRD.csv` | 77 | ~10 ft | well name only | quartz, feldspars, calcite, dolomite, pyrite, four clays and total clay (wt%, rows sum to 100) |

All cover 6,530 to 7,300 ft MD (Sharon Springs base through the Niobrara into the top Carlile), with `sample_id` and
`lithofacies` text columns (lithofacies becomes the point label). Quirks on purpose: porosity in % (the importer converts
to v/v), three blank permeability cells, no well name in the geomech file.

Ranges, all typical of the Niobrara and its bounding shales (checked by `tests/samples.test.mjs`): porosity 1.5 to 14%,
matrix permeability 15 to 1,900 nD (median about 100), grain density 2.57 to 2.72 g/cc (kerogen pulls the marls down), TOC 0.7 to
5.4 wt%, static Young's modulus 1.4 to 5.7 Mpsi, Poisson's ratio 0.21 to 0.30, calcite 36 to 79 wt% in the chalks and marls.
