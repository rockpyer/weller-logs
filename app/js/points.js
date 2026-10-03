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

// Depth in the well's MD: TVD converts through the survey (a well without one is taken as vertical).
function mdFromTvd(w, tvd) {
  const s = w.survey; if (!s || s.md.length < 2) return tvd;
  const n = s.md.length;
  if (tvd <= s.tvd[0]) return s.md[0] * (s.tvd[0] > 0 ? tvd / s.tvd[0] : 1);
  for (let k = 1; k < n; k++) if (tvd <= s.tvd[k] && s.tvd[k] > s.tvd[k - 1]) return s.md[k - 1] + (s.md[k] - s.md[k - 1]) * (tvd - s.tvd[k - 1]) / (s.tvd[k] - s.tvd[k - 1]);
  const c = Math.cos(s.inc[n - 1] * Math.PI / 180); return s.md[n - 1] + (tvd - s.tvd[n - 1]) / Math.max(c, 0.05);
}

// A depth in the given reference (MD, TVD, or TVDSS = TVD minus KB or GL, positive down) as MD; NaN for TVDSS without an elevation.
function mdFromRef(w, v, ref) {
  if (ref === 'MD' || !Number.isFinite(v)) return v;
  if (ref === 'TVDSS') { const e = WellerLAS.datumElevation(w); if (!Number.isFinite(e)) return NaN; v += e; }
  return mdFromTvd(w, v);
}

// Rows grouped by open well (API first, then well or short name); rows with no open well are counted by name.
function groupRows(recs, ref) {
  const byWell = new Map(), missing = new Map(); let tvdNoSurvey = 0; const noElev = new Map();
  for (const r of recs) {
    const w = WellerTables.matchWell(S.wells, r);
    if (!w) { const k = r.name || r.alias || r.api || '?'; missing.set(k, (missing.get(k) || 0) + 1); continue; }
    if (ref === 'TVD' || ref === 'TVDSS') {
      if (ref === 'TVDSS' && !Number.isFinite(WellerLAS.datumElevation(w))) { noElev.set(w.name, (noElev.get(w.name) || 0) + 1); continue; }
      if (!w.survey) tvdNoSurvey++; r.top = mdFromRef(w, r.top, ref); r.base = r.base == null ? r.top : mdFromRef(w, r.base, ref);
    }
    if (!byWell.has(w)) byWell.set(w, []); byWell.get(w).push(r);
  }
  return { byWell, missing: [...missing].map(([name, n]) => ({ name, n })), tvdNoSurvey, noElev: [...noElev].map(([name, n]) => ({ name, n })) };
}
const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;
function importProblems(g) {
  return [...(g.missing.length ? [{ level: 'warn', cat: 'Match', title: `No open well for ${g.missing.map(u => `${u.name} (${plural(u.n, 'row')})`).join(', ')}`,
    fix: 'Open the LAS for those wells first, or rename the well (Wells → Manage wells) to match. Rows match by API (first 10 digits), then well or short name, ignoring case and punctuation.' }] : []),
    ...(g.tvdNoSurvey ? [{ level: 'warn', cat: 'Depth', title: `${plural(g.tvdNoSurvey, 'TVD depth')} in wells without a survey were taken as MD (vertical hole)` }] : []),
    ...(g.noElev?.length ? [{ level: 'warn', cat: 'Depth', title: `TVDSS rows skipped, no KB or GL elevation: ${g.noElev.map(u => `${u.name} (${plural(u.n, 'row')})`).join(', ')}`,
      fix: 'Add the KB (or GL) elevation in Wells → Manage wells, then import again.' }] : [])];
}

// Measurements at depth (core, XRD, pressures): one series per numeric column.
function importValuePoints(t, map, fileName) {
  const g = groupRows(WellerTables.mapRecords(t, 'points', map, fileName), map.ref);
  const notes = []; const added = [];
  for (const i of map.values || []) {
    const col = t.columns[i]; let { mnemonic, unit } = splitHeader(col);
    const all = [...g.byWell.values()].flat().map(r => r.values[col]).filter(Number.isFinite);
    if (!all.length) continue;
    // Porosity in percent is the classic core-data trap: convert to v/v so it sits on the log scale.
    let f = 1;
    if (/PHI|POR/.test(mnemonic) && d3.median(all) > 1) { f = 0.01; unit = 'v/v'; notes.push(`${mnemonic} converted from % to v/v`); }
    for (const [w, rs] of g.byWell) {
      const ok = rs.filter(r => Number.isFinite(r.values[col])); if (!ok.length) continue;
      const labels = ok.map(r => [r.label, r.note].filter(Boolean).join(' · ') || null);
      setWellPoints(w, makePointCurve(mnemonic, unit, `from ${fileName}`, ok.map(r => r.top), ok.map(r => r.values[col] * f), labels.some(Boolean) ? labels : null));
    }
    added.push(mnemonic);
  }
  if (!added.length && !g.missing.length) throw new Error('no numeric values next to depth');
  added.forEach(m => placePointSeries(m));
  const n = [...g.byWell.values()].reduce((a, r) => a + r.length, 0);
  return { note: `Point data: ${plural(n, 'sample')}, ${added.length} series (${added.join(', ')}) in ${plural(g.byWell.size, 'well')}` + (notes.length ? '; ' + notes.join('; ') : ''), problems: importProblems(g) };
}

/* Labeled depths (events): corrosion points, perforations, shows, casing damage. One series per import, drawn in
   one track with a lane and color per class; Split puts each class in its own series and track. data[k] is the
   class index, so the readout and track editor treat it like any point series. */
function makeEventCurve(name, description, recs, classes) {
  const order = d3.range(recs.length).sort((a, b) => recs[a].top - recs[b].top);
  return { mnemonic: name, unit: '', description: description || '', sparse: true, events: true, classes: [...classes],
    md: Float64Array.from(order, i => recs[i].top), base: Float64Array.from(order, i => Math.max(recs[i].top, recs[i].base ?? recs[i].top)),
    data: Float64Array.from(order, i => classes.indexOf(recs[i].label || '(no label)')),
    labels: order.map(i => recs[i].note || null) };
}
function seriesName(fileName) {
  const s = String(fileName || 'Points').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ')
    .replace(/\b(points?|md|tvd|data|export|csv)\b/gi, '').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Points';
}
function importEvents(t, map, fileName, name) {
  name = (name || seriesName(fileName)).trim();
  const recs = WellerTables.mapRecords(t, 'events', map, fileName);
  const g = groupRows(recs, map.ref);
  const classes = [...new Set([...g.byWell.values()].flat().map(r => r.label || '(no label)'))];
  for (const [w, rs] of g.byWell) setWellPoints(w, makeEventCurve(name, `from ${fileName}`, rs, classes));
  if (g.byWell.size) { for (const t of S.tracks) t.curves = t.curves.filter(c => c.pointSeries !== name); placePointSeries(name); }
  const n = [...g.byWell.values()].reduce((a, r) => a + r.length, 0), iv = [...g.byWell.values()].flat().filter(r => r.base > r.top).length;
  return { note: `Labeled depths: ${plural(n, 'point')}${iv ? ` (${iv} with a base)` : ''} in ${plural(g.byWell.size, 'well')}, classes ${classes.join(', ') || 'none'}` + (g.byWell.size ? ` → track "${name}"` : ''), problems: importProblems(g) };
}
// One series per class, each in its own track next to the original.
function splitEventSeries(m) {
  const any = S.wells.map(w => w.curves.find(c => c.events && c.mnemonic === m)).find(Boolean); if (!any) return;
  const names = pointSeriesNames(), track = pointTrackOf(m);
  const outName = cls => names.includes(cls) && cls !== m ? `${m}: ${cls}` : cls;
  for (const w of S.wells) {
    const c = w.curves.find(c => c.events && c.mnemonic === m); if (!c) continue;
    w.curves = w.curves.filter(x => x !== c);
    any.classes.forEach((cls, k) => { const idx = d3.range(c.md.length).filter(i => c.data[i] === k); if (!idx.length) return;
      w.curves.push({ mnemonic: outName(cls), unit: '', description: c.description, sparse: true, events: true, classes: [cls],
        md: Float64Array.from(idx, i => c.md[i]), base: Float64Array.from(idx, i => c.base[i]), data: new Float64Array(idx.length), labels: idx.map(i => c.labels?.[i] ?? null) }); });
  }
  const at = track ? S.tracks.indexOf(track) : S.tracks.length - 1;
  movePointSeries(m, 'hidden'); S.hiddenPoints = S.hiddenPoints.filter(x => x !== m);
  any.classes.slice().reverse().forEach(cls => { const n = outName(cls); if (!S.wells.some(w => w.curves.some(c => c.events && c.mnemonic === n))) return;
    const t = { id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6), name: n, width: 90, pointTrack: true, panel: true, curves: [pointCfg(n)] };
    S.tracks.splice(Math.min(at, S.tracks.length), 0, t); });
}
function removePointSeries(m) {
  for (const w of S.wells) w.curves = w.curves.filter(c => !(c.sparse && c.mnemonic === m));
  for (const t of S.tracks) t.curves = t.curves.filter(c => c.pointSeries !== m);
  S.tracks = S.tracks.filter(t => t.curves.length || !t.pointTrack);
  S.hiddenPoints = (S.hiddenPoints || []).filter(x => x !== m);
}

// Directional survey from a table: per well, MD, inclination and azimuth; TVD by minimum curvature.
function importSurveyTable(t, map, fileName) {
  const g = groupRows(WellerTables.mapRecords(t, 'survey', map, fileName), 'MD'); const notes = [];
  for (const [w, rs] of g.byWell) {
    rs.sort((a, b) => a.top - b.top); if (rs.length < 2) { notes.push(`${w.name}: one station, not used`); continue; }
    const md = Float64Array.from(rs, r => r.top), inc = Float64Array.from(rs, r => r.inc), azi = Float64Array.from(rs, r => r.azi);
    if (w.survey && !w.survey.fromCurve && !w.dirSurvey) notes.push(`${w.name}: replaced the survey from the LAS`);
    setDirSurvey(w, { md: [...md], inc: [...inc], azi: [...azi], source: fileName, unit: '', notes: [] });
  }
  const n = [...g.byWell.values()].reduce((a, r) => a + r.length, 0);
  return { note: `Survey: ${plural(n, 'station')} in ${plural(g.byWell.size, 'well')}` + (notes.length ? '; ' + notes.join('; ') : ''), problems: importProblems(g) };
}

/* ---------- Placement: which track shows a series ---------- */
function pointTrackOf(m) { return S.tracks.find(t => t.curves.some(c => c.pointSeries === m)) || null; }

// Every class of every labeled-depth series, in first-seen order, so a class keeps its color after Split.
const eventClasses = () => [...new Set(S.wells.flatMap(w => w.curves.filter(c => c.events).flatMap(c => c.classes)))];
const EVENT_COLORS = ['#c0392b', '#2a78d6', '#1baf7a', '#eda100', '#8e44ad', '#e87ba4', '#4a3aa7', '#7f8c8d'];
const eventColor = cls => EVENT_COLORS[Math.max(0, eventClasses().indexOf(cls)) % EVENT_COLORS.length];
const eventSeries = m => S.wells.map(w => w.curves.find(c => c.events && c.mnemonic === m)).find(Boolean) || null;

function pointCfg(m) {
  const ev = eventSeries(m);
  if (ev) return { label: m, aliases: [m], pointSeries: m, events: true, unit: '', size: 4, min: -0.5, max: ev.classes.length - 0.5, color: eventColor(ev.classes[0]) };
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
  if (eventSeries(m)) return 'new:' + m;
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
    // Labeled depths go next to GR and show in the correlation panel too; value series sit after density-neutron.
    const ev = !!eventSeries(m);
    if (!t) { t = { id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e3), name, width: ev ? 110 : 130, pointTrack: true, panel: ev, curves: [] };
      const after = S.tracks.findIndex(x => x.id === (ev ? 't1' : 't3')); S.tracks.splice(after >= 0 ? after + 1 : S.tracks.length, 0, t); }
  } else t = S.tracks.find(x => x.id === target);
  if (t) t.curves.push(cfg);
}

function placePointSeries(m) {
  if (pointTrackOf(m) || (S.hiddenPoints || []).includes(m)) return;
  movePointSeries(m, defaultTrackFor(m));
}

/* ---------- Drawing and readout ---------- */
function drawPoints(svg, cfg, curve, sx, y, F, top, bot) {
  const g = svg.append('g');
  if (curve.events) return drawEvents(g, curve, y, F, top, bot);
  for (let k = 0; k < curve.md.length; k++) {
    const md = curve.md[k], v = curve.data[k], z = F.z(md);
    if (z < top || z > bot || !Number.isFinite(v) || (cfg.log && v <= 0)) continue;
    g.append('circle').attr('cx', sx(v)).attr('cy', y(z)).attr('r', cfg.size || 3.5)
      .attr('fill', cfg.color || 'var(--ink)').attr('stroke', 'var(--paper)').attr('stroke-width', 1)
      .append('title').text(`${curve.mnemonic} ${fmtVal(v, cfg)} ${curve.unit} at ${md} ft${curve.labels?.[k] ? ' · ' + curve.labels[k] : ''}`);
  }
}

// One lane per class across the track; a tick and dot at a single depth, a bar from top to base for an interval.
function drawEvents(g, curve, y, F, top, bot) {
  const W = +g.node().ownerSVGElement.getAttribute('width'), n = Math.max(1, curve.classes.length), lw = W / n;
  for (let k = 0; k < curve.md.length; k++) {
    const md = curve.md[k], b = curve.base?.[k] ?? md, z0 = F.z(md), z1 = F.z(b), ci = curve.data[k];
    if (Math.max(z0, z1) < top || Math.min(z0, z1) > bot) continue;
    const cls = curve.classes[ci] ?? '', col = eventColor(cls), x0 = ci * lw, cx = x0 + lw / 2, y0 = y(z0), y1 = y(z1);
    const tip = `${cls} at ${md}${b > md ? '–' + b : ''} ft MD${curve.labels?.[k] ? '\n' + curve.labels[k].split(' · ').join('\n') : ''}`;
    const el = Math.abs(y1 - y0) >= 3
      ? g.append('rect').attr('x', x0 + lw * 0.25).attr('width', lw * 0.5).attr('y', Math.min(y0, y1)).attr('height', Math.abs(y1 - y0)).attr('fill', col).attr('fill-opacity', 0.75).attr('stroke', col)
      : g.append('g');
    if (Math.abs(y1 - y0) < 3) {
      el.append('line').attr('x1', x0 + 2).attr('x2', x0 + lw - 2).attr('y1', y0).attr('y2', y0).attr('stroke', col).attr('stroke-width', 1.5);
      el.append('circle').attr('cx', cx).attr('cy', y0).attr('r', 3.5).attr('fill', col).attr('stroke', 'var(--paper)').attr('stroke-width', 1);
    }
    el.append('title').text(tip);
  }
}
const eventLegendHTML = curve => curve.classes.map(c => `<span class="evk"><i style="background:${eventColor(c)}"></i>${esc(c)}</span>`).join('');

function fmtVal(v, cfg) { return !Number.isFinite(v) ? 'null' : cfg?.log ? v.toPrecision(3) : Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1); }

function nearestPoint(curve, md, tol = 1.5) {
  if (curve.base) { for (let k = 0; k < curve.md.length; k++) if (md >= curve.md[k] - tol && md <= curve.base[k] + tol) return k; return -1; }
  const i = d3.bisectCenter(curve.md, md); const d = Math.abs(curve.md[i] - md);
  return d <= tol ? i : -1;
}

function pointsJSON(w) {
  return w.curves.filter(c => c.sparse).map(c => ({ mnemonic: c.mnemonic, unit: c.unit, description: c.description,
    md: Array.from(c.md), data: Array.from(c.data), labels: c.labels, ...(c.events ? { events: true, classes: c.classes, base: Array.from(c.base) } : {}) }));
}
function restorePoints(w, list) {
  if (!list) return;
  w.curves = w.curves.filter(c => !c.sparse);
  for (const p of list) w.curves.push(p.events
    ? makeEventCurve(p.mnemonic, p.description, p.md.map((m, k) => ({ top: m, base: p.base?.[k] ?? m, label: p.classes[p.data[k]], note: p.labels?.[k] })), p.classes)
    : makePointCurve(p.mnemonic, p.unit, p.description, p.md, p.data.map(v => v ?? NaN), p.labels));
}

/* ---------- Sidebar section ---------- */
function renderPointList() {
  const box = $('pointList'); const names = pointSeriesNames(); $('pointCount').textContent = names.length || '';
  if (!names.length) { setHTML(box, '<p class="hint">Open a CSV of depths per well: labeled points (corrosion, perfs) or values (core)</p>'); return; }
  setHTML(box, names.map(m => {
    const wells = S.wells.filter(w => w.curves.some(c => c.sparse && c.mnemonic === m));
    const n = d3.sum(wells, w => w.curves.find(c => c.sparse && c.mnemonic === m).md.length);
    const t = pointTrackOf(m); const hidden = (S.hiddenPoints || []).includes(m);
    const cfg = t?.curves.find(c => c.pointSeries === m), ev = eventSeries(m);
    const opts = S.tracks.filter(x => !x.type).map(x => `<option value="${x.id}"${t === x ? ' selected' : ''}>${x.name}</option>`).join('');
    return `<div class="trackrow"><span class="sw"><i class="dotsw" style="background:${cfg?.color || 'var(--muted)'}"></i></span><span class="nm" title="${n} samples in ${wells.map(w => w.name).join(', ')}">${m} <small class="hint">${n}</small></span>
      <select data-ptmove="${esc(m)}" aria-label="Track for ${esc(m)}">${opts}<option value="new:${esc(m)}">New track</option><option value="hidden"${hidden ? ' selected' : ''}>Hidden</option></select>${ev && ev.classes.length > 1 ? `<button class="small" data-ptsplit="${esc(m)}" title="One series and track per class: ${esc(ev.classes.join(', '))}">Split</button>` : ''}<button class="small" data-ptdel="${esc(m)}" title="Remove ${esc(m)} from all wells" aria-label="Remove ${esc(m)}">✕</button></div>`;
  }).join(''));
}
document.addEventListener('change', e => { const m = e.target.dataset?.ptmove; if (m) { movePointSeries(m, e.target.value); render(); } });
document.addEventListener('click', async e => { const b = e.target.closest?.('[data-ptsplit],[data-ptdel]'); if (!b) return;
  if (b.dataset.ptsplit) { splitEventSeries(b.dataset.ptsplit); render(); return; }
  const m = b.dataset.ptdel; if (await ask({ title: `Remove ${m}?`, body: 'Removes this point series from every well and its track. Undo by importing the file again.', ok: 'Remove' })) { removePointSeries(m); render(); } });
