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

/* ---------- Local plane: meters east and north of the wells' mean position (fine over a field or a county) ---------- */
function localPlane(lls) {
  const lat0 = lls.reduce((a, l) => a + l[0], 0) / lls.length, lon0 = lls.reduce((a, l) => a + l[1], 0) / lls.length;
  const ky = 110574, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  return { toXY: ll => [(ll[1] - lon0) * kx, (ll[0] - lat0) * ky], toLL: (x, y) => [lat0 + y / ky, lon0 + x / kx] };
}
// Offsets along the well path in meters, from the survey (LAS or imported). A TVD curve alone has no azimuth: no path.
const M_PER = w => /^m/i.test(w.depthUnit || '') ? 1 : 0.3048;
const hasPath = w => !!(w.survey?.north && !w.survey.fromCurve);
function llAtMD(w, ll, md) {
  if (!hasPath(w)) return ll;
  const o = WellerSurvey.offsetAt(w.survey, md), k = M_PER(w), r = 6371008.8;
  return [ll[0] + o.north * k / r * 180 / Math.PI, ll[1] + o.east * k / (r * Math.cos(ll[0] * Math.PI / 180)) * 180 / Math.PI];
}
function pathLLs(w, ll) {
  const s = w.survey, n = s.md.length, step = Math.max(1, Math.floor(n / 400)), out = [ll];
  for (let i = 0; i < n; i += step) out.push(llAtMD(w, ll, s.md[i]));
  out.push(llAtMD(w, ll, s.md[n - 1])); return out;
}

/* ---------- Isopach and structure maps from tops ----------
   Isopach: true vertical thickness from one top to another (TVD from the survey where there is one), posted where the
   well path is halfway through the interval. Structure: subsea depth of a top (datum elevation minus TVD), posted where
   the path crosses it. Values are in display units. A thin-plate spline grids them inside the wells' hull plus a margin. */
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
function gridValues(placed) {
  const g = S.mapGrid || {}, out = [], missing = [];
  for (const { w, ll } of placed) {
    const t = w.tops.find(x => x.name === g.top), b = g.kind === 'iso' ? w.tops.find(x => x.name === g.base) : null;
    if (!t || (g.kind === 'iso' && !b)) { missing.push({ w, ll, why: 'no pick' }); continue; }
    if (g.kind === 'iso') {
      if (b.md <= t.md) { missing.push({ w, ll, why: 'base above top' }); continue; }
      const v = toDisp(mdToTvd(w, b.md) - mdToTvd(w, t.md), w);
      out.push({ w, id: w.id, ll: llAtMD(w, ll, (t.md + b.md) / 2), v });
    } else {
      const v = ssAt(w, t.md); if (!Number.isFinite(v)) { missing.push({ w, ll, why: 'no elevation' }); continue; }
      out.push({ w, id: w.id, ll: llAtMD(w, ll, t.md), v: toDisp(v, w) });
    }
  }
  return { pts: out, missing };
}
function buildGrid(placed) {
  const g = S.mapGrid || {}, { pts, missing } = gridValues(placed);
  const key = JSON.stringify([g, S.units, pts.map(p => [p.id, p.ll, p.v])]);
  if (MAP.grid?.key === key) return MAP.grid;
  const out = { key, pts, missing, kind: g.kind };
  if (pts.length) {
    const P = localPlane(pts.map(p => p.ll)), xy = pts.map(p => { const [x, y] = P.toXY(p.ll); return { x, y, v: p.v, id: p.id }; });
    const G = WellerGrid.gridSurface(xy, { cells: 260 });
    out.reason = G.reason; out.P = P;
    if (!G.reason) {
      const lo = Math.min(G.min, ...pts.map(p => p.v)), hi = Math.max(G.max, ...pts.map(p => p.v));
      const step = WellerGrid.niceStep(lo, hi, 10), levels = d3.range(Math.ceil(lo / step) * step, hi + step * 1e-6, step);
      // Isopach: thick is dark. Structure: deep (more negative) is dark.
      const dom = RAMP.map((_, i) => lo + (hi - lo) * i / (RAMP.length - 1)), color = d3.scaleLinear().domain(g.kind === 'iso' ? dom : [...dom].reverse()).range(RAMP).interpolate(d3.interpolateLab).clamp(true);
      const cv = document.createElement('canvas'); cv.width = G.nx; cv.height = G.ny;
      const ctx = cv.getContext('2d'), img = ctx.createImageData(G.nx, G.ny);
      // Alpha fades over one cell at the edge of the gridded area, so the boundary is smooth rather than stepped.
      for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
        const k = j * G.nx + i, dist = WellerGrid.hullDistance(G.hull, G.x0 + i * G.d, G.y0 + (G.ny - 1 - j) * G.d), a = Math.max(0, Math.min(1, (G.pad - dist) / G.d + 0.5));
        if (!a) continue; const c = d3.rgb(color(G.raw[k])); img.data.set([c.r, c.g, c.b, Math.round(255 * a)], k * 4); }
      ctx.putImageData(img, 0, 0);
      const half = G.d / 2, sw = P.toLL(G.x0 - half, G.y0 - half), ne = P.toLL(G.x0 + (G.nx - 1) * G.d + half, G.y0 + (G.ny - 1) * G.d + half);
      // Contour lines from the full surface, kept to the hull plus margin; d3 grid coordinates are cell corners.
      const inside = (X, Y) => X > 0.01 && Y > 0.01 && X < G.nx - 0.01 && Y < G.ny - 0.01 && WellerGrid.hullDistance(G.hull, G.x0 + (X - 0.5) * G.d, G.y0 + (G.ny - Y - 0.5) * G.d) <= G.pad;
      const lines = [];
      for (const c of d3.contours().size([G.nx, G.ny]).thresholds(levels)(Array.from(G.raw))) {
        const major = Math.abs(Math.round(c.value / (step * 5)) * step * 5 - c.value) < step * 1e-6;
        for (const poly of c.coordinates) for (const ring of poly) { let seg = [];
          const flush = () => { if (seg.length > 1) lines.push({ v: c.value, major, lls: seg }); seg = []; };
          for (const [X, Y] of ring) { if (inside(X, Y)) seg.push(P.toLL(G.x0 + (X - 0.5) * G.d, G.y0 + (G.ny - Y - 0.5) * G.d)); else flush(); } flush(); } }
      Object.assign(out, { url: cv.toDataURL(), bounds: [sw, ne], lines, step, lo, hi, color, G });
    }
  }
  return MAP.grid = out;
}
const fmtV = (v, step) => (Math.round(v / (step || 1)) * (step || 1)).toLocaleString(undefined, { maximumFractionDigits: step < 1 ? 1 : 0 }).replace(/^-/, '−');
function gridTitle() { const g = S.mapGrid; return g.kind === 'iso' ? `Isopach ${g.top} → ${g.base}` : `Structure on ${g.top}`; }
function drawGrid(gr) {
  const ink = cssVar('--ink'), u = dispU();
  if (gr.url) {
    L.imageOverlay(gr.url, gr.bounds, { opacity: 0.72, className: 'gridimg', interactive: false }).addTo(MAP.layer);
    const labeled = new Set(), nLevels = new Set(gr.lines.map(l => l.v)).size;
    for (const l of [...gr.lines].sort((x, y) => y.lls.length - x.lls.length)) {
      L.polyline(l.lls, { color: ink, weight: l.major ? 1.6 : 0.8, opacity: l.major ? 0.85 : 0.55, interactive: false }).addTo(MAP.layer);
      const want = nLevels <= 12 || l.major;
      if (want && !labeled.has(l.v) && l.lls.length > 8) { labeled.add(l.v); const m = l.lls[Math.floor(l.lls.length / 2)];
        L.marker(m, { interactive: false, icon: L.divIcon({ className: 'clabel', html: fmtV(l.v, gr.step), iconSize: null }) }).addTo(MAP.layer); }
    }
  }
  for (const p of gr.pts) {
    L.circleMarker(p.ll, { radius: 3, weight: 1, color: ink, fillColor: ink, fillOpacity: 1, interactive: false }).addTo(MAP.layer);
    L.marker(p.ll, { interactive: false, icon: L.divIcon({ className: 'gval', html: fmtV(p.v, gr.step ? gr.step / 10 : 1), iconSize: null }) }).addTo(MAP.layer);
  }
  for (const m of gr.missing) L.marker(m.ll, { interactive: false, icon: L.divIcon({ className: 'gval miss', html: m.why, iconSize: null }) }).addTo(MAP.layer);
  // Legend: the ramp with its range, the interval and how many wells carry it.
  const box = $('mapLegend');
  if (!gr.url) { box.hidden = !gr.pts.length && !gr.missing.length; box.innerHTML = `<b>${esc(gridTitle())}</b><br>${gr.pts.length ? 'Values posted; ' + esc(gr.reason || '') : 'No well has these tops'}`; return; }
  const stops = d3.range(0, 1.0001, 0.1).map(t => gr.color(gr.lo + (gr.hi - gr.lo) * t)), lo = fmtV(gr.lo, gr.step / 10), hi = fmtV(gr.hi, gr.step / 10);
  box.hidden = false;
  box.innerHTML = `<b>${esc(gridTitle())}</b> <span class="hint">${S.mapGrid.kind === 'iso' ? 'TVT' : 'ssTVD'}, ${u}</span>
    <div class="lgbar" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="lgends"><span>${lo}</span><span>${hi}</span></div>
    <span class="hint">${gr.pts.length} well${gr.pts.length > 1 ? 's' : ''} · contours every ${fmtV(gr.step, gr.step)} ${u} · gridded only between wells</span>`;
}
// Grid controls: kind, top, and base for an isopach (defaults to the next top down).
function syncGridControls() {
  const names = topNames(), g = S.mapGrid = S.mapGrid || { kind: '' };
  if (g.kind && !names.includes(g.top)) g.top = names.find(n => S.wells.some(w => w.tops.some(t => t.name === n))) || '';
  if (g.kind === 'iso' && (!names.includes(g.base) || names.indexOf(g.base) <= names.indexOf(g.top))) g.base = names[names.indexOf(g.top) + 1] || '';
  $('mapGrid').value = g.kind || '';
  const opts = (sel, list, v) => { sel.innerHTML = list.map(n => `<option${n === v ? ' selected' : ''}>${esc(n)}</option>`).join(''); };
  opts($('mapTop'), names, g.top); opts($('mapBase'), names.slice(names.indexOf(g.top) + 1), g.base);
  $('mapTop').hidden = !g.kind; $('mapBase').hidden = $('mapTo').hidden = g.kind !== 'iso';
  if (g.kind === 'iso' && !g.base) $('mapBase').hidden = false;
}

function renderMap() {
  if (!window.L) { $('map').textContent = 'Map library did not load.'; return; }
  initMap(); MAP.layer.clearLayers();
  const ink = cssVar('--ink'), accent = cssVar('--accent'), focus = cssVar('--focus'), paper = cssVar('--paper');
  const placed = S.wells.map(w => ({ w, ll: wgs84Of(w) })).filter(p => p.ll);
  syncGridControls();
  const gridOn = !!(S.mapGrid?.kind && S.mapGrid.top && (S.mapGrid.kind !== 'iso' || S.mapGrid.base));
  $('map').classList.toggle('gridOn', gridOn);
  MAP.cur = gridOn ? buildGrid(placed) : null;
  if (MAP.cur) drawGrid(MAP.cur); else $('mapLegend').hidden = true;
  // Well paths seen from above, from the wellhead to TD.
  const paths = placed.filter(p => hasPath(p.w)).map(p => ({ ...p, lls: pathLLs(p.w, p.ll) }));
  for (const { w, lls } of paths) {
    const sel = w.id === S.selected, s = w.survey, n = s.md.length - 1, disp = Math.hypot(s.north[n], s.east[n]);
    const az = (Math.atan2(s.east[n], s.north[n]) * 180 / Math.PI + 360) % 360;
    L.polyline(lls, { color: sel ? focus : ink, weight: sel ? 3 : 2, opacity: 0.85 })
      .bindTooltip(`${esc(w.name)}: TD ${fmtD(disp, w)} ${dispU()} from the wellhead toward ${Math.round(az)}°`, { sticky: true, className: 'wlabel' })
      .on('click', () => (S.mode === 'corr' ? toggleSection(w.id) : clickWell(w.id))).addTo(MAP.layer);
    L.circleMarker(lls[lls.length - 1], { radius: 2.5, weight: 1, color: sel ? focus : ink, fillColor: paper, fillOpacity: 1, interactive: false }).addTo(MAP.layer);
  }
  const inPanel = S.mode === 'corr' ? sectionWells() : [];
  const sec = inPanel.map(w => wgs84Of(w)).filter(Boolean);
  if (sec.length > 1) {
    L.polyline(sec, { color: accent, weight: 2.5, dashArray: '6 4' }).addTo(MAP.layer);
    const tag = (ll, t) => L.marker(ll, { interactive: false, icon: L.divIcon({ className: 'secTag', html: t, iconSize: [18, 18], iconAnchor: [22, 22] }) }).addTo(MAP.layer);
    tag(sec[0], 'A'); tag(sec[sec.length - 1], 'A′');
  }
  const key = placed.map(p => p.w.id + p.ll.join()).join('|') + paths.map(p => p.w.id + p.lls.length).join();
  if (key && key !== MAP.fitKey) { MAP.fitKey = key; MAP.map.fitBounds(L.latLngBounds([...placed.map(p => p.ll), ...paths.flatMap(p => [p.lls[p.lls.length - 1]])]), { paddingTopLeft: [24, 24], paddingBottomRight: [100, 24], maxZoom: 14 }); }
  // Permanent labels only where they fit: the selected well first, then section wells, then the rest.
  // Wells on a crowded pad keep a hover label instead of stacking unreadable text.
  const order = [...placed].sort((a, b) => (b.w.id === S.selected) - (a.w.id === S.selected) || (S.panel.includes(b.w.id) - S.panel.includes(a.w.id)));
  const boxes = [];
  for (const { w, ll } of order) {
    const inSec = S.mode === 'corr' && S.panel.includes(w.id), sel = w.id === S.selected;
    const pt = MAP.map.latLngToContainerPoint(ll), wpx = 7 + w.name.length * 6.8, box = [pt.x + 6, pt.y - 8, pt.x + 6 + wpx, pt.y + 8];
    const fits = !boxes.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]));
    if (fits) boxes.push(box);
    L.circleMarker(ll, { radius: 6, weight: sel ? 3 : 1.5, color: sel ? focus : ink, fillColor: inSec ? accent : paper, fillOpacity: 1 })
      .bindTooltip(w.name, { permanent: fits, direction: 'right', offset: [7, 0], className: 'wlabel' })
      .on('click', () => (S.mode === 'corr' ? toggleSection(w.id) : clickWell(w.id))).addTo(MAP.layer);
  }
  if (!MAP.zoomHooked) { MAP.zoomHooked = true; MAP.map.on('zoomend', () => renderMap()); MAP.map.on('mousemove', hoverGrid); MAP.map.on('mouseout', () => { if (MAP.hint != null) $('mapHint').textContent = MAP.hint; }); }
  const off = S.wells.length - placed.length;
  MAP.hint = (gridOn && MAP.cur?.reason && MAP.cur.pts.length ? `Not contoured: ${MAP.cur.reason}. ` : '') + (S.mode === 'corr' ? 'Click a well to add or remove it from A–A′' : 'Click a well to show it.')
    + (off ? ` ${off} well${off > 1 ? 's have' : ' has'} no location: set it in well settings.` : '');
  $('mapHint').textContent = MAP.hint;
}
// Hover on a grid: the gridded value there and the nearest well's posted value.
function hoverGrid(e) {
  const gr = MAP.cur; if (!gr?.G || !gr.P) return;
  const [x, y] = gr.P.toXY([e.latlng.lat, e.latlng.lng]), G = gr.G;
  if (WellerGrid.hullDistance(G.hull, x, y) > G.pad) { $('mapHint').textContent = MAP.hint; return; }
  let best = null, bd = Infinity; for (const p of gr.pts) { const [px, py] = gr.P.toXY(p.ll), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = p; } }
  $('mapHint').textContent = `≈ ${fmtV(G.f(x, y), gr.step / 10)} ${dispU()} gridded here · nearest well ${best.w.name}: ${fmtV(best.v, gr.step / 10)} ${dispU()}, ${fmtDist(bd / 1000)} away`;
}
// Grid controls and the larger map.
document.getElementById('mapGrid').onchange = e => { S.mapGrid = { ...S.mapGrid, kind: e.target.value }; renderMap(); autosave(); };
document.getElementById('mapTop').onchange = e => { S.mapGrid = { ...S.mapGrid, top: e.target.value }; renderMap(); autosave(); };
document.getElementById('mapBase').onchange = e => { S.mapGrid = { ...S.mapGrid, base: e.target.value }; renderMap(); autosave(); };
function setBigMap(on) { $('mapWrap').classList.toggle('big', on); $('mapBig').setAttribute('aria-pressed', on); $('mapBig').textContent = on ? '✕' : '⤢'; setTimeout(() => { MAP.map?.invalidateSize(); MAP.fitKey = ''; renderMap(); }, 0); }
document.getElementById('mapBig').onclick = () => setBigMap(!$('mapWrap').classList.contains('big'));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('mapWrap').classList.contains('big')) setBigMap(false); });

document.addEventListener('click', e => { const b = e.target.closest('[data-basemap]'); if (b) { e.preventDefault(); setBasemap(b.dataset.basemap); autosave(); } });
