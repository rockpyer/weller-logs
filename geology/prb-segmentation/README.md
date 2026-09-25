# Powder River Basin geologic map → polygons

Raster-to-vector test on the WSGS *Geologic Map of the Powder River Basin, Wyoming* (1:350,000 PDF;
map is a hillshaded raster, legend is vector).

## Outputs (`output/`)

| File | Use |
|---|---|
| `powder_river_basin_geology.geojson` | Upload to geolibre / any web GIS. EPSG:4326, 2,692 polygons, 66 units |
| `powder_river_basin_geology_shp.zip` | Same data as a zipped shapefile |
| `overview_compare.png` | Original · prediction · USGS truth · errors (gray ok, orange = right color but wrong unit in a same-color group, red = wrong) |
| `detail_compare.png` | Close-up near Sundance / Moorcroft |

Attributes: `unit` (map code; Tr = Triassic, IP = Pennsylvanian, Cm = Cambrian, pCu = Precambrian),
`unit_name`, `color` (legend hex, for styling), `alt_units` (other units with an identical legend
fill, so color alone can't distinguish them), `area_km2`.

## Method

1. **Legend**: read the 70 swatch rectangles, codes, and names straight from the PDF vectors; render each
   swatch to get a pattern-averaged color signature.
2. **Georeference**: least-squares fit of pixel→Lambert Conformal Conic (params printed on the map) using the 26
   graticule labels. Residual RMS is 12 m (0.2 px), and the fitted scale is 59.27 m/px (1:350,000).
3. **Classify** (three approaches were tested):
   - **Pixel**: shade-invariant nearest legend color (best multiplicative hillshade factor per class),
     majority filter.
   - **Superpixel**: SLIC segments, each classified by its mean color.
   - **Line-snap**: regions bounded by the map's own drawn linework, each given its majority label.
4. **Self-training**: fit per-unit Gaussian color models (Lab) on confident pixels from the map itself, then
   reclassify (2 iterations).
5. **Regularize and vectorize**: 21 px majority filter, 400 px (~1.4 km²) minimum area, polygonize, 30 m
   simplification, reproject to WGS84.

## Scores vs. USGS digital version of the same source map (Love & Christiansen 1985, [USGS SGMC WY](https://mrdata.usgs.gov/geology/state/))

| Method | Exact unit | Color group* | mIoU | Polygons |
|---|---|---|---|---|
| Superpixel (SLIC) | 55.5% | 70.9% | 0.22 | 4,952 |
| Pixel | 60.7% | 77.6% | 0.29 | 9,880 |
| Pixel + line-snap | 60.8% | 77.7% | 0.29 | 9,884 |
| Pixel + self-training | 66.9% | 82.7% | 0.32 | 7,020 |
| **+ regularization (final)** | **69.0%** | **84.0%** | **0.34** | **2,692** (truth: 2,531) |

\*Units with identical legend fills merged (e.g. KJ/KJg/Kgb/Kft, Tml/Tmo, Tfl/Tftl/Tflt).

Caveat: the USGS layer and this WSGS print disagree in places. For example, the north Fort Union
block is labeled **Tflt** on the print (the prediction matches the print) but **Tft** in USGS.
These disagreements count against the scores above.

## Reproduce

Needs `pymupdf opencv-python-headless scikit-image shapely geopandas rasterio pyproj scipy`, the PDF, and
`WY.zip` from https://mrdata.usgs.gov/geology/state/shp/WY.zip unzipped to `wy/`. The PDF path is set at the
top of `legend.py`, `georef.py`, and `sig.py`. Run in order:
`legend.py → georef.py → sig.py → prep.py → seg.py → seg2.py → export.py`.
