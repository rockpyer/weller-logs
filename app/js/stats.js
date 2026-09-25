/* Zone statistics and EDA. Zones come from tops: each top to the next top, or to TD.
   Means are depth-weighted; log-scale curves (resistivity, gas, perm) use the geometric mean. */

const ZONE_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'] };
const isDark = () => cssVar('color-scheme').includes('dark') || getComputedStyle(document.documentElement).colorScheme === 'dark';

function statsDefaults() { return { wells: null, cutoff: 75, curve: 'GR', x: 'NPHI', y: 'RHOB' }; }

function zonesOf(w) {
  const d = depthOf(w), td = d[d.length - 1], start = d[0];
  const tops = [...w.tops].filter(t => t.md > start && t.md < td).sort((a, b) => a.md - b.md);
  if (!tops.length) return [{ name: 'Whole well', top: start, base: td }];
  const z = [{ name: 'Above ' + tops[0].name, top: start, base: tops[0].md }];
  tops.forEach((t, i) => z.push({ name: t.name, top: t.md, base: tops[i + 1]?.md ?? td }));
  return z;
}

// Stable zone colors across all wells, ordered by average depth, so filtering never repaints a zone.
function zoneColorMap() {
  const acc = new Map();
  for (const w of S.wells) for (const z of zonesOf(w)) { const a = acc.get(z.name) || [0, 0]; acc.set(z.name, [a[0] + z.top, a[1] + 1]); }
  const names = [...acc].sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1]).map(a => a[0]);
  const pal = ZONE_COLORS[isDark() ? 'dark' : 'light'];
  return new Map(names.map((n, i) => [n, i < pal.length ? pal[i] : cssVar('--muted')]));
}

function statCurves() {
  const seen = new Set(), out = [];
  for (const t of S.tracks) { if (t.type) continue;
    for (const c of t.curves) { if (seen.has(c.label)) continue; seen.add(c.label); out.push(c); } }
  return out;
}

function sampleWeights(dep) {
  const n = dep.length, w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.abs((dep[Math.min(n - 1, i + 1)] - dep[Math.max(0, i - 1)]) / (i === 0 || i === n - 1 ? 1 : 2));
  return w;
}

function zoneValues(w, curve, z, log) {
  const ok = v => Number.isFinite(v) && (!log || v > 0);
  if (curve.sparse) { const v = [], wt = []; let total = 0;
    for (let k = 0; k < curve.md.length; k++) if (curve.md[k] >= z.top && curve.md[k] < z.base) { total++; if (ok(curve.data[k])) { v.push(curve.data[k]); wt.push(1); } }
    return { v, wt, total }; }
  const dep = depthOf(w); w._wt ||= sampleWeights(dep);
  const i0 = d3.bisectLeft(dep, z.top), i1 = d3.bisectLeft(dep, z.base);
  const v = [], wt = [];
  for (let i = i0; i < i1; i++) if (ok(curve.data[i])) { v.push(curve.data[i]); wt.push(w._wt[i]); }
  return { v, wt, total: i1 - i0 };
}

function summarize({ v, wt, total }, log) {
  if (!v.length) return { n: 0, total, nullPct: total ? 100 : null };
  const sw = d3.sum(wt);
  const mean = log ? Math.exp(d3.sum(v, (x, i) => Math.log(x) * wt[i]) / sw) : d3.sum(v, (x, i) => x * wt[i]) / sw;
  const sd = log ? null : Math.sqrt(d3.sum(v, (x, i) => wt[i] * (x - mean) ** 2) / sw);
  const s = Float64Array.from(v).sort();
  const q = p => d3.quantileSorted(s, p);
  return { n: v.length, total, nullPct: total ? 100 * (1 - v.length / total) : 0, mean, sd, min: s[0], p10: q(.1), p25: q(.25), p50: q(.5), p75: q(.75), p90: q(.9), max: s[s.length - 1] };
}

function statWells() { const ids = S.stats.wells; return S.wells.filter(w => !ids || ids.includes(w.id)); }

function computeStats() {
  const curves = statCurves(), grCfg = S.tracks.flatMap(t => t.curves).find(c => c.label === 'GR') || { aliases: A.GR };
  const rows = [];
  for (const w of statWells()) {
    const gr = resolveCurve(w, grCfg);
    for (const z of zonesOf(w)) {
      const row = { well: w, zone: z, gross: z.base - z.top, by: {} };
      if (gr && !gr.sparse) { const { v, wt } = zoneValues(w, gr, z, false); const cov = d3.sum(wt);
        row.net = d3.sum(v, (x, i) => x < S.stats.cutoff ? wt[i] : 0); row.ntg = cov ? row.net / cov : null; }
      for (const c of curves) { const cur = resolveCurve(w, c); if (cur) row.by[c.label] = { cfg: c, curve: cur, s: summarize(zoneValues(w, cur, z, c.log), c.log) }; }
      rows.push(row);
    }
  }
  return { rows, curves: curves.filter(c => rows.some(r => r.by[c.label]?.s.n)) };
}

const f3 = (v, log) => v == null || !Number.isFinite(v) ? '—' : log ? (v >= 100 ? d3.format(',.0f')(v) : v.toPrecision(3)) : Math.abs(v) >= 100 ? d3.format(',.0f')(v) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderStats() {
  S.stats ||= statsDefaults();
  const colors = zoneColorMap(); const { rows, curves } = computeStats();
  // Well chips
  $('stWells').innerHTML = S.wells.map(w => `<label class="chip"><input type="checkbox" data-stwell="${w.id}"${!S.stats.wells || S.stats.wells.includes(w.id) ? ' checked' : ''}> ${esc(w.name)}</label>`).join('');
  $('stCutoff').value = S.stats.cutoff;
  // Legend
  const zoneNames = [...colors.keys()].filter(n => rows.some(r => r.zone.name === n));
  $('stLegend').innerHTML = zoneNames.map(n => `<span><i style="background:${colors.get(n)}"></i>${esc(n)}</span>`).join('');
  // Summary table
  const head = `<tr><th>Well</th><th>Zone</th><th class="num">Top</th><th class="num">Base</th><th class="num">Gross ft</th><th class="num">Net ft</th><th class="num">N/G</th>${curves.map(c => `<th class="num" title="${c.log ? 'Geometric mean' : 'Depth-weighted mean'}${c.unit ? ', ' + esc(c.unit) : ''}">${esc(c.label)}${c.log ? ' <small>g</small>' : ''}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr><td>${esc(r.well.name)}</td><td><i class="zsw" style="background:${colors.get(r.zone.name)}"></i>${esc(r.zone.name)}</td><td class="num">${fmtDepth(r.zone.top)}</td><td class="num">${fmtDepth(r.zone.base)}</td><td class="num">${fmtDepth(r.gross)}</td><td class="num">${r.net == null ? '—' : fmtDepth(r.net)}</td><td class="num">${r.ntg == null ? '—' : (100 * r.ntg).toFixed(0) + '%'}</td>`
    + curves.map(c => { const b = r.by[c.label]; const s = b?.s; return `<td class="num" title="${s?.n ? `${b.curve.mnemonic}: n ${s.n}, P10 ${f3(s.p10, c.log)}, P50 ${f3(s.p50, c.log)}, P90 ${f3(s.p90, c.log)}, ${s.nullPct.toFixed(0)}% null` : 'no data'}">${s?.n ? f3(s.mean, c.log) : '—'}</td>`; }).join('') + '</tr>').join('');
  $('stSummary').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  // Curve pickers
  const all = statCurves().filter(c => S.wells.some(w => resolveCurve(w, c)));
  const opt = sel => all.map(c => `<option value="${esc(c.label)}"${c.label === sel ? ' selected' : ''}>${esc(c.label)}${c.pointSeries ? ' (points)' : ''}</option>`).join('');
  if (!all.some(c => c.label === S.stats.curve)) S.stats.curve = all[0]?.label;
  if (!all.some(c => c.label === S.stats.x)) S.stats.x = all.find(c => c.label === 'NPHI')?.label || all[0]?.label;
  if (!all.some(c => c.label === S.stats.y)) S.stats.y = all.find(c => c.label === 'RHOB')?.label || all[1]?.label || all[0]?.label;
  $('stCurve').innerHTML = opt(S.stats.curve); $('stX').innerHTML = opt(S.stats.x); $('stY').innerHTML = opt(S.stats.y);
  drawBoxes(rows, all.find(c => c.label === S.stats.curve), colors);
  drawCrossplot(all.find(c => c.label === S.stats.x), all.find(c => c.label === S.stats.y), colors);
}

function drawBoxes(rows, cfg, colors) {
  const svg = d3.select('#stBox'); svg.selectAll('*').remove(); $('stDetail').innerHTML = '';
  if (!cfg) return;
  const items = rows.map(r => ({ r, b: r.by[cfg.label] })).filter(x => x.b?.s.n);
  if (!items.length) { svg.attr('height', 40).append('text').attr('x', 8).attr('y', 24).attr('class', 'ax').text('No samples for this curve in the selected wells.'); return; }
  const W = Math.max(320, $('stBox').parentElement.clientWidth - 4), rowH = 22, left = 170, right = 16, topPad = 8, H = topPad + items.length * rowH + 30;
  svg.attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  const lo = d3.min(items, x => x.b.s.p10), hi = d3.max(items, x => x.b.s.p90);
  const x = (cfg.log ? d3.scaleLog().domain([Math.max(lo, 1e-6), hi]) : d3.scaleLinear().domain([lo, hi])).nice().range([left, W - right]);
  const ticks = cfg.log ? x.ticks(4).filter(t => /^1/.test(t.toExponential())) : x.ticks(6);
  svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'gl').attr('x1', x).attr('x2', x).attr('y1', topPad).attr('y2', H - 24);
  svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'ax').attr('x', x).attr('y', H - 8).attr('text-anchor', 'middle').text(t => f3(t, cfg.log));
  items.forEach(({ r, b }, i) => {
    const s = b.s, yc = topPad + i * rowH + rowH / 2, c = colors.get(r.zone.name);
    const g = svg.append('g');
    g.append('rect').attr('x', 0).attr('y', yc - rowH / 2).attr('width', W).attr('height', rowH).attr('fill', 'transparent');
    g.append('text').attr('class', 'lbl').attr('x', left - 8).attr('y', yc + 4).attr('text-anchor', 'end').text(`${r.zone.name} · ${r.well.name}`);
    g.append('line').attr('x1', x(s.p10)).attr('x2', x(s.p90)).attr('y1', yc).attr('y2', yc).attr('stroke', c).attr('stroke-width', 2);
    g.append('rect').attr('x', x(s.p25)).attr('y', yc - 6).attr('width', Math.max(2, x(s.p75) - x(s.p25))).attr('height', 12).attr('rx', 2).attr('fill', c).attr('fill-opacity', .35).attr('stroke', c).attr('stroke-width', 1.5);
    g.append('line').attr('x1', x(s.p50)).attr('x2', x(s.p50)).attr('y1', yc - 6).attr('y2', yc + 6).attr('stroke', 'var(--ink)').attr('stroke-width', 2);
    g.append('circle').attr('cx', x(s.mean)).attr('cy', yc).attr('r', 3).attr('fill', 'var(--paper)').attr('stroke', 'var(--ink)').attr('stroke-width', 1.5);
    g.append('title').text(`${r.well.name} · ${r.zone.name} · ${b.curve.mnemonic}\nn ${s.n}  ${cfg.log ? 'gmean' : 'mean'} ${f3(s.mean, cfg.log)}\nP10 ${f3(s.p10, cfg.log)}  P50 ${f3(s.p50, cfg.log)}  P90 ${f3(s.p90, cfg.log)}\n${s.nullPct.toFixed(0)}% null`);
  });
  $('stDetail').innerHTML = `<thead><tr><th>Zone</th><th>Well</th><th class="num">n</th><th class="num">${cfg.log ? 'gmean' : 'mean'}</th><th class="num">sd</th><th class="num">min</th><th class="num">P10</th><th class="num">P50</th><th class="num">P90</th><th class="num">max</th><th class="num">null</th></tr></thead><tbody>`
    + items.map(({ r, b }) => { const s = b.s; return `<tr><td><i class="zsw" style="background:${colors.get(r.zone.name)}"></i>${esc(r.zone.name)}</td><td>${esc(r.well.name)}</td><td class="num">${s.n}</td><td class="num">${f3(s.mean, cfg.log)}</td><td class="num">${f3(s.sd)}</td><td class="num">${f3(s.min, cfg.log)}</td><td class="num">${f3(s.p10, cfg.log)}</td><td class="num">${f3(s.p50, cfg.log)}</td><td class="num">${f3(s.p90, cfg.log)}</td><td class="num">${f3(s.max, cfg.log)}</td><td class="num">${s.nullPct.toFixed(0)}%</td></tr>`; }).join('') + '</tbody>';
}

// Pairs x/y samples by depth. A point series pairs with the nearest log sample within 1 ft.
function pairSamples(w, cx, cy) {
  const a = resolveCurve(w, cx), b = resolveCurve(w, cy); if (!a || !b) return [];
  const zones = zonesOf(w), zoneAt = md => (zones.find(z => md >= z.top && md < z.base) || zones[zones.length - 1]).name;
  const dep = depthOf(w), out = [];
  const at = (c, md) => { if (!c.sparse) { const i = d3.bisectCenter(dep, md); return Math.abs(dep[i] - md) <= 1 ? c.data[i] : NaN; } const k = nearestPoint(c, md, 0.5); return k < 0 ? NaN : c.data[k]; };
  if (a.sparse || b.sparse) { const s = a.sparse ? a : b;
    for (let k = 0; k < s.md.length; k++) { const md = s.md[k]; out.push([at(a, md), at(b, md), zoneAt(md), true]); } }
  else { const step = Math.max(1, Math.floor(dep.length / 8000));
    for (let i = 0; i < dep.length; i += step) out.push([a.data[i], b.data[i], zoneAt(dep[i]), false]); }
  return out.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!cx.log || p[0] > 0) && (!cy.log || p[1] > 0));
}

function drawCrossplot(cx, cy, colors) {
  const cv = $('stXp'); const W = Math.max(320, cv.parentElement.clientWidth - 4), H = Math.min(520, Math.round(W * 0.8));
  const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (!cx || !cy) return;
  const m = { l: 56, r: 14, t: 12, b: 40 };
  const dom = c => [Math.min(c.min, c.max), Math.max(c.min, c.max)];
  const x = (cx.log ? d3.scaleLog() : d3.scaleLinear()).domain(dom(cx)).range([m.l, W - m.r]);
  // Density conventionally increases downward on a neutron-density crossplot.
  const yRange = cy.label === 'RHOB' || /GRAIN/.test(cy.label) ? [m.t, H - m.b] : [H - m.b, m.t];
  const y = (cy.log ? d3.scaleLog() : d3.scaleLinear()).domain(dom(cy)).range(yRange);
  const grid = cssVar('--grid'), muted = cssVar('--muted'), ink = cssVar('--ink');
  ctx.font = '11px "IBM Plex Mono",monospace'; ctx.fillStyle = muted; ctx.strokeStyle = grid; ctx.lineWidth = 1;
  const xt = cx.log ? x.ticks(5).filter(t => /^1/.test(t.toExponential())) : x.ticks(6), yt = cy.log ? y.ticks(5).filter(t => /^1/.test(t.toExponential())) : y.ticks(6);
  ctx.textAlign = 'center'; for (const t of xt) { ctx.beginPath(); ctx.moveTo(x(t), m.t); ctx.lineTo(x(t), H - m.b); ctx.stroke(); ctx.fillText(f3(t, cx.log), x(t), H - m.b + 14); }
  ctx.textAlign = 'right'; for (const t of yt) { ctx.beginPath(); ctx.moveTo(m.l, y(t)); ctx.lineTo(W - m.r, y(t)); ctx.stroke(); ctx.fillText(f3(t, cy.log), m.l - 6, y(t) + 4); }
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.fillText(`${cx.label}${cx.unit ? ' (' + cx.unit + ')' : ''}`, (m.l + W - m.r) / 2, H - 8);
  ctx.save(); ctx.translate(14, (m.t + H - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`${cy.label}${cy.unit ? ' (' + cy.unit + ')' : ''}`, 0, 0); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, W - m.l - m.r, H - m.t - m.b); ctx.clip();
  let n = 0;
  for (const w of statWells()) for (const [a, b, z, pt] of pairSamples(w, cx, cy)) {
    ctx.fillStyle = colors.get(z) || muted;
    if (pt) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x(a), y(b), 3.5, 0, 7); ctx.fill(); ctx.strokeStyle = cssVar('--paper'); ctx.stroke(); }
    else { ctx.globalAlpha = .35; ctx.fillRect(x(a) - 1, y(b) - 1, 2.2, 2.2); }
    n++;
  }
  ctx.globalAlpha = 1;
  // Limestone matrix line for a limestone-calibrated neutron vs bulk density (fluid 1.0 g/cc).
  if (cx.label === 'NPHI' && cy.label === 'RHOB') {
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x(0), y(2.71)); ctx.lineTo(x(0.4), y(2.71 - 1.71 * 0.4)); ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'left';
    for (const p of [0, .1, .2, .3, .4]) { ctx.beginPath(); ctx.arc(x(p), y(2.71 - 1.71 * p), 2.5, 0, 7); ctx.fill(); ctx.fillText(`${p * 100}`, x(p) + 5, y(2.71 - 1.71 * p) - 4); }
    ctx.fillText('Limestone (φ %)', x(0.02), y(2.71) + 16);
  }
  ctx.restore();
  $('stXpNote').textContent = `${n.toLocaleString()} samples plotted${n ? '' : ' (no overlapping data)'}. Log samples are thinned to about 8,000 per well; point data is drawn as larger dots.`;
  cv.onmousemove = e => { const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < m.l || px > W - m.r || py < m.t || py > H - m.b) { $('stXpRead').textContent = ''; return; }
    $('stXpRead').textContent = `${cx.label} ${f3(x.invert(px), cx.log)} · ${cy.label} ${f3(y.invert(py), cy.log)}`; };
}

function statsCSV() {
  const { rows, curves } = computeStats();
  const head = ['well', 'zone', 'top_ft', 'base_ft', 'gross_ft', 'net_ft', 'ntg', ...curves.flatMap(c => ['mean', 'p10', 'p50', 'p90', 'n'].map(k => `${c.label}_${k === 'mean' && c.log ? 'gmean' : k}`))];
  const q = v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const L = [head.join(',')];
  for (const r of rows) L.push([r.well.name, r.zone.name, r.zone.top, r.zone.base, r.gross, r.net ?? '', r.ntg == null ? '' : r.ntg.toFixed(3),
    ...curves.flatMap(c => { const s = r.by[c.label]?.s; return s?.n ? [s.mean, s.p10, s.p50, s.p90, s.n].map(v => +v.toPrecision(5)) : ['', '', '', '', 0]; })].map(q).join(','));
  return L.join('\n') + '\n';
}

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset?.stwell) { const ids = S.stats.wells || S.wells.map(w => w.id); S.stats.wells = t.checked ? [...new Set([...ids, t.dataset.stwell])] : ids.filter(i => i !== t.dataset.stwell); render(); }
  else if (t.id === 'stCutoff') { S.stats.cutoff = +t.value || 75; render(); }
  else if (t.id === 'stCurve') { S.stats.curve = t.value; render(); }
  else if (t.id === 'stX') { S.stats.x = t.value; render(); }
  else if (t.id === 'stY') { S.stats.y = t.value; render(); }
});
