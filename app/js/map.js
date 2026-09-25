/* Well map on Leaflet with USGS National Map basemaps (public domain): topo or satellite imagery. */

const BASEMAPS = {
  map: { label: 'Map', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}' },
  sat: { label: 'Satellite', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}' },
};
const MAP = { map: null, tiles: null, layer: null, fitKey: '' };

/* NAD27 -> WGS84 with the abridged Molodensky transform and the CONUS mean shift (EPSG:1173, about 5 m).
   Skipping this puts old SoCal wells roughly 90 m east of where the imagery shows them. */
function nad27ToWgs84(lat, lon) {
  const r = Math.PI / 180, a = 6378206.4, f = 1 / 294.978698, da = 6378137 - a, df = 1 / 298.257223563 - f;
  const dx = -8, dy = 160, dz = 176, e2 = 2 * f - f * f;
  const p = lat * r, l = lon * r, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const w = Math.sqrt(1 - e2 * sp * sp), N = a / w, M = a * (1 - e2) / (w * w * w);
  const dp = (-dx * sp * cl - dy * sp * sl + dz * cp + (a * df + f * da) * 2 * sp * cp) / M;
  const dl = (-dx * sl + dy * cl) / (N * cp);
  return [lat + dp / r, lon + dl / r];
}
function wgs84Of(w) {
  const { lat, lon, crs } = w.location || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return /NAD\s*27/i.test(crs || '') ? nad27ToWgs84(lat, lon) : [lat, lon];
}

function setBasemap(key) {
  S.basemap = BASEMAPS[key] ? key : 'map';
  if (MAP.map) {
    if (MAP.tiles) MAP.map.removeLayer(MAP.tiles);
    MAP.tiles = L.tileLayer(BASEMAPS[S.basemap].url, { maxNativeZoom: 16, maxZoom: 18, attribution: 'USGS The National Map' }).addTo(MAP.map);
  }
  document.querySelectorAll('[data-basemap]').forEach(b => b.setAttribute('aria-pressed', b.dataset.basemap === S.basemap));
}

function initMap() {
  if (MAP.map || !window.L) return;
  MAP.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([33.88, -118.3], 10);
  L.control.zoom({ position: 'bottomleft' }).addTo(MAP.map);
  MAP.map.attributionControl.setPrefix(false);
  MAP.layer = L.layerGroup().addTo(MAP.map);
  setBasemap(S.basemap || 'map');
  new ResizeObserver(() => MAP.map.invalidateSize()).observe($('map'));
}

function renderMap() {
  if (!window.L) { $('map').textContent = 'Map library did not load.'; return; }
  initMap(); MAP.layer.clearLayers();
  const ink = cssVar('--ink'), accent = cssVar('--accent'), focus = cssVar('--focus'), paper = cssVar('--paper');
  const placed = S.wells.map(w => ({ w, ll: wgs84Of(w) })).filter(p => p.ll);
  const inPanel = S.mode === 'corr' ? S.panel.map(wellById).filter(Boolean) : [];
  const sec = inPanel.map(w => wgs84Of(w)).filter(Boolean);
  if (sec.length > 1) {
    L.polyline(sec, { color: accent, weight: 2.5, dashArray: '6 4' }).addTo(MAP.layer);
    const tag = (ll, t) => L.marker(ll, { interactive: false, icon: L.divIcon({ className: 'secTag', html: t, iconSize: [18, 18], iconAnchor: [22, 22] }) }).addTo(MAP.layer);
    tag(sec[0], 'A'); tag(sec[sec.length - 1], 'A′');
  }
  for (const { w, ll } of placed) {
    const inSec = S.mode === 'corr' && S.panel.includes(w.id), sel = w.id === S.selected;
    L.circleMarker(ll, { radius: 6, weight: sel ? 3 : 1.5, color: sel ? focus : ink, fillColor: inSec ? accent : paper, fillOpacity: 1 })
      .bindTooltip(w.name, { permanent: true, direction: 'right', offset: [7, 0], className: 'wlabel' })
      .on('click', () => clickWell(w.id)).addTo(MAP.layer);
  }
  const key = placed.map(p => p.w.id + p.ll.join()).join('|');
  if (key && key !== MAP.fitKey) { MAP.fitKey = key; MAP.map.fitBounds(L.latLngBounds(placed.map(p => p.ll)), { paddingTopLeft: [24, 24], paddingBottomRight: [100, 24], maxZoom: 14 }); }
  const off = S.wells.length - placed.length;
  $('mapHint').textContent = (S.mode === 'corr' ? 'Click wells to add or remove them from section A–A′, in order.' : 'Click a well to show it.')
    + (off ? ` ${off} well${off > 1 ? 's have' : ' has'} no location: set it in well settings.` : '');
}

document.addEventListener('click', e => { const b = e.target.closest('[data-basemap]'); if (b) { e.preventDefault(); setBasemap(b.dataset.basemap); autosave(); } });
