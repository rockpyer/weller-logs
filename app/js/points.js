/* Point data: sparse depth samples (core plugs, XRD, pressure tests, shows) shown as markers in log tracks.
   A point series lives in well.curves with sparse:true and its own md array, so tracks, the track editor,
   cursor readout and zone stats all find it through the same alias lookup as log curves. */

const POINT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];

function makePointCurve(mnemonic, unit, description, md, data, labels) {
  const order = d3.range(md.length).sort((a, b) => md[a] - md[b]);
  return { mnemonic, unit: unit || '', description: description || '', sparse: true,
    md: Float64Array.from(order, i => md[i]), data: Float64Array.from(order, i => data[i]),
    labels: labels ? order.map(i => labels[i]) : null };
}

function setWellPoints(w, curve) {
  w.curves = w.curves.filter(c => !(c.sparse && c.mnemonic === curve.mnemonic));
  w.curves.push(curve);
}

const pointSeriesNames = () => [...new Set(S.wells.flatMap(w => w.curves.filter(c => c.sparse).map(c => c.mnemonic)))];

// Column header "core_phi (v/v)" or "k [mD]" -> {mnemonic:'CORE_PHI', unit:'v/v'}
function splitHeader(h) {
  const m = h.match(/^(.*?)\s*[([]\s*([^)\]]*)\s*[)\]]\s*$/);
  const name = (m ? m[1] : h).trim(), unit = m ? m[2].trim() : '';
  return { mnemonic: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''), unit };
}

function findWell(key, api) {
  key = (key || '').trim().toLowerCase(); api = (api || '').replace(/\D/g, '');
  return S.wells.find(x => x.name.toLowerCase() === key)
    || (api && S.wells.find(x => (x.api || '').replace(/\D/g, '') === api))
    || (key && S.wells.find(x => (x.api || '').replace(/\D/g, '') === key.replace(/\D/g, '') && key.replace(/\D/g, '').length >= 8))
    || null;
}

function importPointsCSV(text, fileName) {
  const rows = d3.csvParse(text); const cols = rows.columns;
  const low = cols.map(c => c.toLowerCase().trim());
  const pick = re => cols[low.findIndex(c => re.test(c))];
  const cWell = pick(/^(well|well[_ ]?name|wellname|name)$/), cApi = pick(/^(api|uwi)/);
  const cMd = pick(/^(md|depth|md_ft|md \(ft\)|depth_ft|measured|sample_depth)/);
  if (!cMd) throw new Error('needs a depth column named md or depth (found: ' + cols.join(', ') + ')');
  const skip = new Set([cWell, cApi, cMd].filter(Boolean));
  const numeric = [], text_ = [];
  for (const c of cols) { if (skip.has(c)) continue;
    const vals = rows.map(r => r[c]).filter(v => v !== '' && v != null);
    const nums = vals.filter(v => Number.isFinite(+v));
    (vals.length && nums.length / vals.length > 0.8 ? numeric : text_).push(c); }
  if (!numeric.length) throw new Error('no numeric value columns next to depth');

  const byWell = new Map(); const missing = new Set();
  for (const r of rows) {
    const md = +r[cMd]; if (!Number.isFinite(md)) continue;
    let w = (cWell || cApi) ? findWell(cWell && r[cWell], cApi && r[cApi]) : null;
    if (!w && !cWell && !cApi) w = wellById(S.selected);
    if (!w) { missing.add((cWell && r[cWell]) || (cApi && r[cApi]) || '?'); continue; }
    if (!byWell.has(w)) byWell.set(w, []);
    byWell.get(w).push(r);
  }
  const notes = []; const added = new Set();
  for (const c of numeric) {
    let { mnemonic, unit } = splitHeader(c);
    const all = [...byWell.values()].flat().map(r => +r[c]).filter(Number.isFinite);
    // Porosity in percent is the classic core-data trap: convert to v/v so it sits on the log scale.
    let f = 1;
    if (/PHI|POR/.test(mnemonic) && d3.median(all) > 1) { f = 0.01; unit = 'v/v'; notes.push(`${mnemonic} converted from % to v/v`); }
    for (const [w, rs] of byWell) {
      const ok = rs.filter(r => r[c] !== '' && Number.isFinite(+r[c]));
      if (!ok.length) continue;
      const labels = text_.length ? ok.map(r => text_.map(t => r[t]).filter(Boolean).join(' · ')) : null;
      setWellPoints(w, makePointCurve(mnemonic, unit, `from ${fileName}`, ok.map(r => +r[cMd]), ok.map(r => +r[c] * f), labels));
    }
    added.add(mnemonic);
  }
  added.forEach(m => placePointSeries(m));
  const n = [...byWell.values()].reduce((a, r) => a + r.length, 0);
  return `${n} samples, ${added.size} series (${[...added].join(', ')}) in ${byWell.size} well${byWell.size === 1 ? '' : 's'}`
    + (notes.length ? '; ' + notes.join('; ') : '') + (missing.size ? '; no matching well for: ' + [...missing].join(', ') : '');
}

/* ---------- Placement: which track shows a series ---------- */
function pointTrackOf(m) { return S.tracks.find(t => t.curves.some(c => c.pointSeries === m)) || null; }

function pointCfg(m) {
  const vals = S.wells.flatMap(w => { const c = w.curves.find(c => c.sparse && c.mnemonic === m); return c ? Array.from(c.data).filter(Number.isFinite) : []; });
  const unit = S.wells.map(w => w.curves.find(c => c.sparse && c.mnemonic === m)?.unit).find(Boolean) || '';
  const pos = vals.filter(v => v > 0);
  const spansDecades = pos.length === vals.length && pos.length > 1 && d3.max(pos) / d3.min(pos) > 100;
  const i = pointSeriesNames().indexOf(m);
  const cfg = { label: m, aliases: [m], pointSeries: m, unit, size: 3.5, color: POINT_COLORS[Math.max(0, i) % POINT_COLORS.length] };
  if (/PHI|POR/.test(m)) Object.assign(cfg, { min: 0.45, max: -0.15, color: 'var(--ink)' });           // same scale as NPHI
  else if (/^(K|PERM|KAIR|KH|KV|KLINK)|_K$|PERM/.test(m)) Object.assign(cfg, { min: 0.01, max: 10000, log: true });
  else if (/GRAIN|RHOG|RHOM|GD$/.test(m)) Object.assign(cfg, { min: 1.95, max: 2.95 });               // same scale as RHOB
  else if (spansDecades) Object.assign(cfg, { min: 10 ** Math.floor(Math.log10(d3.min(pos))), max: 10 ** Math.ceil(Math.log10(d3.max(pos))), log: true });
  else { const [a, b] = d3.scaleLinear().domain(d3.extent(vals.length ? vals : [0, 1])).nice(5).domain(); Object.assign(cfg, { min: a, max: b }); }
  return cfg;
}

function defaultTrackFor(m) {
  if (/PHI|POR|GRAIN|RHOG|RHOM|GD$/.test(m)) return S.tracks.find(t => t.id === 't3') ? 't3' : 'new:Core';
  if (/^(K|PERM|KAIR|KH|KV|KLINK)|_K$|PERM/.test(m)) return 'new:Permeability';
  return 'new:Point data';
}

// target: track id, 'new:<name>' (reuse a same-named track), or 'hidden'
function movePointSeries(m, target) {
  const old = S.tracks.flatMap(t => t.curves).find(c => c.pointSeries === m);
  for (const t of S.tracks) t.curves = t.curves.filter(c => c.pointSeries !== m);
  S.tracks = S.tracks.filter(t => t.curves.length || !t.pointTrack);
  S.hiddenPoints = (S.hiddenPoints || []).filter(x => x !== m);
  if (target === 'hidden') { S.hiddenPoints.push(m); return; }
  const cfg = old || pointCfg(m);
  let t;
  if (target.startsWith('new:')) {
    const name = target.slice(4);
    t = S.tracks.find(x => x.name === name && x.pointTrack);
    if (!t) { t = { id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e3), name, width: 130, pointTrack: true, panel: false, curves: [] };
      const after = S.tracks.findIndex(x => x.id === 't3'); S.tracks.splice(after >= 0 ? after + 1 : S.tracks.length, 0, t); }
  } else t = S.tracks.find(x => x.id === target);
  if (t) t.curves.push(cfg);
}

function placePointSeries(m) {
  if (pointTrackOf(m) || (S.hiddenPoints || []).includes(m)) return;
  movePointSeries(m, defaultTrackFor(m));
}

/* ---------- Drawing and readout ---------- */
function drawPoints(svg, cfg, curve, sx, y, o, top, bot) {
  const g = svg.append('g');
  for (let k = 0; k < curve.md.length; k++) {
    const md = curve.md[k], v = curve.data[k];
    if (md < top + o || md > bot + o || !Number.isFinite(v) || (cfg.log && v <= 0)) continue;
    g.append('circle').attr('cx', sx(v)).attr('cy', y(md - o)).attr('r', cfg.size || 3.5)
      .attr('fill', cfg.color || 'var(--ink)').attr('stroke', 'var(--paper)').attr('stroke-width', 1)
      .append('title').text(`${curve.mnemonic} ${fmtVal(v, cfg)} ${curve.unit} at ${md} ft${curve.labels?.[k] ? ' · ' + curve.labels[k] : ''}`);
  }
}

function fmtVal(v, cfg) { return !Number.isFinite(v) ? 'null' : cfg?.log ? v.toPrecision(3) : Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1); }

function nearestPoint(curve, md, tol = 1.5) {
  const i = d3.bisectCenter(curve.md, md); const d = Math.abs(curve.md[i] - md);
  return d <= tol ? i : -1;
}

function pointsJSON(w) {
  return w.curves.filter(c => c.sparse).map(c => ({ mnemonic: c.mnemonic, unit: c.unit, description: c.description,
    md: Array.from(c.md), data: Array.from(c.data), labels: c.labels }));
}
function restorePoints(w, list) {
  if (!list) return;
  w.curves = w.curves.filter(c => !c.sparse);
  for (const p of list) w.curves.push(makePointCurve(p.mnemonic, p.unit, p.description, p.md, p.data.map(v => v ?? NaN), p.labels));
}

/* ---------- Sidebar section ---------- */
function renderPointList() {
  const box = $('pointList'); const names = pointSeriesNames(); $('pointCount').textContent = names.length || '';
  if (!names.length) { box.innerHTML = '<p class="hint">Open a CSV with md plus value columns (core, XRD, pressures, shows). Columns: well, md, then one per measurement.</p>'; return; }
  box.innerHTML = '';
  for (const m of names) {
    const wells = S.wells.filter(w => w.curves.some(c => c.sparse && c.mnemonic === m));
    const n = d3.sum(wells, w => w.curves.find(c => c.sparse && c.mnemonic === m).md.length);
    const t = pointTrackOf(m); const hidden = (S.hiddenPoints || []).includes(m);
    const cfg = t?.curves.find(c => c.pointSeries === m);
    const opts = S.tracks.filter(x => !x.type).map(x => `<option value="${x.id}"${t === x ? ' selected' : ''}>${x.name}</option>`).join('');
    const row = document.createElement('div'); row.className = 'trackrow';
    row.innerHTML = `<span class="sw"><i class="dotsw" style="background:${cfg?.color || 'var(--muted)'}"></i></span><span class="nm" title="${n} samples in ${wells.map(w => w.name).join(', ')}">${m} <small class="hint">${n}</small></span>
      <select data-ptmove="${m}" aria-label="Track for ${m}">${opts}<option value="new:${m}">New track</option><option value="hidden"${hidden ? ' selected' : ''}>Hidden</option></select>`;
    box.appendChild(row);
  }
}
document.addEventListener('change', e => { const m = e.target.dataset?.ptmove; if (m) { movePointSeries(m, e.target.value); render(); } });
