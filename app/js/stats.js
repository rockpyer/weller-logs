/* Zone statistics and EDA. Zones come from tops: each top to the next top, or to TD.
   Means are depth-weighted; log-scale curves (resistivity, gas, perm) use the geometric mean. */

const ZONE_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'] };
const isDark = () => cssVar('color-scheme').includes('dark') || getComputedStyle(document.documentElement).colorScheme === 'dark';

function statsDefaults() { return { wells: null, cutoff: 75, curve: 'GR', x: 'NPHI', y: 'RHOB', type: 'nd', color: 'zone', clean: true }; }

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
  // Your top colors (Tops panel) win over the palette; zones above the first top keep the palette.
  let k = 0; return new Map(names.map(n => [n, S.topColors?.[n] || (k < pal.length ? pal[k++] : cssVar('--muted'))]));
}

function statCurves() {
  const seen = new Set(), out = [];
  for (const t of S.tracks) { if (t.type) continue;   // lithology, cuttings and flag tracks are not averaged
    for (const c of t.curves) { if (seen.has(c.label) || c.events) continue; seen.add(c.label); out.push(c); } }   // labeled depths have no value to average
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
  const dep = depthOf(w); w._wt ||= sampleWeights(tvdOf(w) || dep);   // true vertical thickness for deviated wells
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

function tvdThick(w, z) { return tvdOf(w) ? mdToTvd(w, z.base) - mdToTvd(w, z.top) : z.base - z.top; }

// Summations follow the usual convention: net reservoir and net pay thickness from the flag curves, average PHIE over
// net reservoir, average Sw over net pay, porosity-feet (sum phi h over net) and hydrocarbon-feet (sum phi (1 - Sw) h
// over net pay). Thickness is true vertical in deviated wells. Without porosity logs, net falls back to a GR cutoff.
function computeStats() {
  const curves = statCurves(), grCfg = S.tracks.flatMap(t => t.curves).find(c => c.label === 'GR') || { aliases: A.GR };
  const rows = [];
  for (const w of statWells()) {
    const gr = resolveCurve(w, grCfg), dep = depthOf(w);
    const fl = m => w.curves.find(c => c.computed && c.mnemonic === m);
    const tot = S.interp?.swPhi === 'total', nres = fl('NET_RES'), npay = fl('NET_PAY'), phie = fl(tot ? 'PHIT_ND' : 'PHIE'), sw = fl('SW');
    w._wt ||= sampleWeights(tvdOf(w) || dep);
    for (const z of zonesOf(w)) {
      const row = { well: w, zone: z, gross: tvdThick(w, z), by: {} };
      const i0 = d3.bisectLeft(dep, z.top), i1 = d3.bisectLeft(dep, z.base);
      if (nres && phie) {
        let net = 0, pay = 0, phiNet = 0, swPay = 0, phih = 0, hch = 0, cov = 0;
        for (let i = i0; i < i1; i++) { const h = w._wt[i]; if (Number.isFinite(phie.data[i])) cov += h;
          if (nres.data[i] > 0.5) { net += h; phiNet += phie.data[i] * h; phih += phie.data[i] * h; }
          if (npay?.data[i] > 0.5 && sw) { pay += h; swPay += sw.data[i] * h; hch += phie.data[i] * (1 - sw.data[i]) * h; } }
        Object.assign(row, { net, ntg: cov ? net / cov : null, pay: npay ? pay : null, phiNet: net ? phiNet / net : null, swPay: pay ? swPay / pay : null, phih, hch: npay ? hch : null, basis: 'flags' });
      } else if (gr && !gr.sparse) { const { v, wt } = zoneValues(w, gr, z, false); const cov = d3.sum(wt);
        row.net = d3.sum(v, (x, i) => x < S.stats.cutoff ? wt[i] : 0); row.ntg = cov ? row.net / cov : null; row.basis = 'gr'; }
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
  // Group by formation, top down, then by well.
  const zi = new Map([...colors.keys()].map((n, i) => [n, i])), wi = new Map(S.wells.map((w, i) => [w.id, i]));
  rows.sort((a, b) => zi.get(a.zone.name) - zi.get(b.zone.name) || wi.get(a.well.id) - wi.get(b.well.id));
  // Well chips
  $('stWells').innerHTML = S.wells.map(w => `<label class="chip"><input type="checkbox" data-stwell="${w.id}"${!S.stats.wells || S.stats.wells.includes(w.id) ? ' checked' : ''}> ${esc(w.name)}</label>`).join('');
  $('stCutoff').value = S.stats.cutoff;
  // Legend
  const zoneNames = [...colors.keys()].filter(n => rows.some(r => r.zone.name === n));
  $('stLegend').innerHTML = zoneNames.map(n => `<span><i style="background:${colors.get(n)}"></i>${esc(n)}</span>`).join('');
  // Summary table
  const petro = rows.some(r => r.basis === 'flags'), grOnly = rows.some(r => r.basis === 'gr');
  $('stCutoffWrap').hidden = !grOnly;
  const pc = (v, d = 0) => v == null ? '—' : (100 * v).toFixed(d) + '%'; const PH = S.interp?.swPhi === 'total' ? 'PHIT' : 'PHIE';
  const U = dispU(); const head = `<tr><th>Zone</th><th>Well</th><th class="num">Top MD</th><th class="num">Base MD</th><th class="num" title="True vertical thickness in deviated wells">Gross ${U}</th><th class="num">Net ${U}</th><th class="num">N/G</th>`
    + (petro ? `<th class="num">Pay ${U}</th><th class="num" title="Average ${PH} over net reservoir">${PH} net</th><th class="num" title="Average Sw over net pay">Sw pay</th><th class="num" title="Sum of ${PH} x h over net reservoir">φ·h ${U}</th><th class="num" title="Sum of ${PH} x (1 - Sw) x h over net pay">HC·h ${U}</th>` : '')
    + curves.map(c => `<th class="num" title="${c.log ? 'Geometric mean' : 'Depth-weighted mean'}${c.unit ? ', ' + esc(c.unit) : ''}">${esc(c.label)}${c.log ? ' <small>g</small>' : ''}</th>`).join('') + '</tr>';
  const body = rows.map((r, k) => `<tr${k && rows[k - 1].zone.name !== r.zone.name ? ' class="grp"' : ''}><td>${k && rows[k - 1].zone.name === r.zone.name ? '' : `<i class="zsw" style="background:${colors.get(r.zone.name)}"></i>${esc(r.zone.name)}`}</td><td>${esc(r.well.name)}</td><td class="num">${fmtD(r.zone.top, r.well)}</td><td class="num">${fmtD(r.zone.base, r.well)}</td><td class="num">${fmtD(r.gross, r.well)}</td><td class="num">${r.net == null ? '—' : fmtD(r.net, r.well)}${r.basis === 'gr' ? '<small title="GR cutoff">*</small>' : ''}</td><td class="num">${pc(r.ntg)}</td>`
    + (petro ? `<td class="num">${r.pay == null ? '—' : fmtD(r.pay, r.well)}</td><td class="num">${pc(r.phiNet, 1)}</td><td class="num">${pc(r.swPay)}</td><td class="num">${r.phih == null ? '—' : fmtD(r.phih, r.well, 1)}</td><td class="num">${r.hch == null ? '—' : fmtD(r.hch, r.well, 1)}</td>` : '')
    + curves.map(c => { const b = r.by[c.label]; const s = b?.s; return `<td class="num" title="${s?.n ? `${b.curve.mnemonic}: n ${s.n}, P10 ${f3(s.p10, c.log)}, P50 ${f3(s.p50, c.log)}, P90 ${f3(s.p90, c.log)}, ${s.nullPct.toFixed(0)}% null` : 'no data'}">${s?.n ? f3(s.mean, c.log) : '—'}</td>`; }).join('') + '</tr>').join('');
  $('stSummary').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  const I = S.interp;
  $('stSumNote').textContent = petro ? `Net reservoir: Vsh < ${I.cut.vsh}, ${PH} ≥ ${I.cut.phi}, not bad hole. Net pay adds Sw ≤ ${I.cut.sw} (Sw on ${PH}). Parameters are in the Interpretation panel.` + (grOnly ? ' * Wells without porosity logs use the GR cutoff.' : '') : 'Net uses the GR cutoff above because no well has porosity logs.';
  // Curve pickers
  const all = statCurves().filter(c => S.wells.some(w => resolveCurve(w, c)));
  const opt = sel => all.map(c => `<option value="${esc(c.label)}"${c.label === sel ? ' selected' : ''}>${esc(c.label)}${c.pointSeries ? ' (points)' : ''}</option>`).join('');
  if (!all.some(c => c.label === S.stats.curve)) S.stats.curve = all[0]?.label;
  if (!all.some(c => c.label === S.stats.x)) S.stats.x = all.find(c => c.label === 'NPHI')?.label || all[0]?.label;
  if (!all.some(c => c.label === S.stats.z)) S.stats.z = all.find(c => c.label === 'GR')?.label || all[0]?.label;
  if (!all.some(c => c.label === S.stats.y)) S.stats.y = all.find(c => c.label === 'RHOB')?.label || all[1]?.label || all[0]?.label;
  $('stCurve').innerHTML = opt(S.stats.curve); $('stX').innerHTML = opt(S.stats.x); $('stY').innerHTML = opt(S.stats.y); $('stZ').innerHTML = opt(S.stats.z); $('stZ').hidden = S.stats.color !== 'curve';
  $('stType').value = S.stats.type || 'custom'; $('stColor').value = S.stats.color || 'zone'; $('stClean').checked = S.stats.clean !== false;
  $('stXY').hidden = S.stats.type && S.stats.type !== 'custom'; $('stCleanWrap').hidden = S.stats.type !== 'pickett';
  drawBoxes(rows, all.find(c => c.label === S.stats.curve), colors);
  const cfgOf = (label, aliases, extra) => ({ label, aliases, ...extra });
  const T = S.stats.type || 'custom';
  const pair = T === 'nd' ? [cfgOf('NPHI', A.NPHI, { min: -0.15, max: 0.45, unit: 'v/v' }), cfgOf('RHOB', A.RHOB, { min: 1.9, max: 3.0, unit: 'g/cc' })]
    : T === 'pickett' ? [cfgOf('PHIE', ['PHIE', 'PHIT_ND', 'PHIT', 'PHI'], { min: 0.01, max: 1, log: true, unit: 'v/v' }), cfgOf('Deep', A.RD, { min: 0.1, max: 1000, log: true, unit: 'Ω·m' })]
    : T === 'pe' ? [cfgOf('PEF', A.PE, { min: 0, max: 7, unit: 'b/e' }), cfgOf('RHOB', A.RHOB, { min: 1.9, max: 3.0, unit: 'g/cc' })]
    : [all.find(c => c.label === S.stats.x), all.find(c => c.label === S.stats.y)];
  drawCrossplot(pair[0], pair[1], colors, T, all.find(c => c.label === S.stats.z));
  drawHistograms(colors);
}

function drawBoxes(rows, cfg, colors) {
  const svg = d3.select('#stBox'); svg.selectAll('*').remove(); $('stDetail').innerHTML = '';
  if (!cfg) return;
  const items = rows.map(r => ({ r, b: r.by[cfg.label] })).filter(x => x.b?.s.n);
  if (!items.length) { svg.attr('height', 40).append('text').attr('x', 8).attr('y', 24).attr('class', 'ax').text('No samples for this curve in the selected wells.'); return; }
  // One header row per formation (top down), then a box per well.
  const lines = []; items.forEach((it, i) => { if (!i || items[i - 1].r.zone.name !== it.r.zone.name) lines.push({ head: it.r.zone.name }); lines.push(it); });
  const W = Math.max(320, $('stBox').parentElement.clientWidth - 4), rowH = 20, left = Math.min(220, Math.max(130, 7 * d3.max(items, it => it.r.well.name.length) + 24)), right = 16, topPad = 4, H = topPad + lines.length * rowH + 30;
  svg.attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  const lo = d3.min(items, x => x.b.s.p10), hi = d3.max(items, x => x.b.s.p90);
  const x = (cfg.log ? d3.scaleLog().domain([Math.max(lo, 1e-6), hi]) : d3.scaleLinear().domain([lo, hi])).nice().range([left, W - right]);
  const ticks = cfg.log ? x.ticks(4).filter(t => /^1/.test(t.toExponential())) : x.ticks(6);
  svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'gl').attr('x1', x).attr('x2', x).attr('y1', topPad).attr('y2', H - 24);
  svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'ax').attr('x', x).attr('y', H - 8).attr('text-anchor', 'middle').text(t => f3(t, cfg.log));
  lines.forEach((ln, i) => {
    const yc = topPad + i * rowH + rowH / 2;
    if (ln.head) { const c = colors.get(ln.head);
      if (i) svg.append('line').attr('class', 'gl').attr('x1', 0).attr('x2', W).attr('y1', yc - rowH / 2).attr('y2', yc - rowH / 2);
      svg.append('rect').attr('x', 0).attr('y', yc - 5).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', c);
      svg.append('text').attr('class', 'grp').attr('x', 16).attr('y', yc + 4).text(ln.head); return; }
    const { r, b } = ln, s = b.s, c = colors.get(r.zone.name);
    const g = svg.append('g');
    g.append('rect').attr('x', 0).attr('y', yc - rowH / 2).attr('width', W).attr('height', rowH).attr('fill', 'transparent');
    g.append('text').attr('class', 'lbl').attr('x', left - 8).attr('y', yc + 4).attr('text-anchor', 'end').text(r.well.name);
    g.append('line').attr('x1', x(s.p10)).attr('x2', x(s.p90)).attr('y1', yc).attr('y2', yc).attr('stroke', c).attr('stroke-width', 2);
    g.append('rect').attr('x', x(s.p25)).attr('y', yc - 6).attr('width', Math.max(2, x(s.p75) - x(s.p25))).attr('height', 12).attr('rx', 2).attr('fill', c).attr('fill-opacity', .35).attr('stroke', c).attr('stroke-width', 1.5);
    g.append('line').attr('x1', x(s.p50)).attr('x2', x(s.p50)).attr('y1', yc - 6).attr('y2', yc + 6).attr('stroke', 'var(--ink)').attr('stroke-width', 2);
    g.append('circle').attr('cx', x(s.mean)).attr('cy', yc).attr('r', 3).attr('fill', 'var(--paper)').attr('stroke', 'var(--ink)').attr('stroke-width', 1.5);
    g.append('title').text(`${r.zone.name} · ${r.well.name} · ${b.curve.mnemonic}\nn ${s.n}  ${cfg.log ? 'gmean' : 'mean'} ${f3(s.mean, cfg.log)}\nP10 ${f3(s.p10, cfg.log)}  P50 ${f3(s.p50, cfg.log)}  P90 ${f3(s.p90, cfg.log)}\n${s.nullPct.toFixed(0)}% null`);
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
    for (let k = 0; k < s.md.length; k++) { const md = s.md[k]; out.push([at(a, md), at(b, md), zoneAt(md), true, md]); } }
  else { const step = Math.max(1, Math.floor(dep.length / 8000));
    for (let i = 0; i < dep.length; i += step) out.push([a.data[i], b.data[i], zoneAt(dep[i]), false, dep[i]]); }
  return out.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!cx.log || p[0] > 0) && (!cy.log || p[1] > 0));
}

// Curve value at a depth: nearest log sample within 1 ft, or the nearest point of a point series.
function sampleAt(w, c, md) { if (c.sparse) { const k = nearestPoint(c, md, 0.5); return k < 0 ? NaN : c.data[k]; }
  const dep = depthOf(w), i = d3.bisectCenter(dep, md); return Math.abs(dep[i] - md) <= 1 ? c.data[i] : NaN; }
// Five inner breaks splitting a curve's values (across the given wells) into six equal-count groups, with min and max attached.
function curveGroups(wells, cfg) {
  const v = []; for (const w of wells) { const c = resolveCurve(w, cfg); if (!c) continue; const step = c.sparse ? 1 : Math.max(1, Math.floor(c.data.length / 20000));
    for (let i = 0; i < c.data.length; i += step) if (Number.isFinite(c.data[i]) && (!cfg.log || c.data[i] > 0)) v.push(c.data[i]); }
  if (!v.length) return null; v.sort((a, b) => a - b);
  const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))], br = [1, 2, 3, 4, 5].map(k => q(k / 6));
  br.min = v[0]; br.max = v[v.length - 1]; return br;
}

// GR in six bands over 0-150 API (the petroplots convention), light to dark in one hue; stepped for each theme.
const GR_BANDS = { light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'], dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'] };
// Matrix neutron readings on each calibration (thermal neutron, fresh water). The calibration matrix is exact by
// definition; the other two are approximate offsets after the service-company chartbooks, drawn dashed.
const ND_MATRIX = { limestone: { sandstone: -0.035, limestone: 0, dolomite: 0.02 }, sandstone: { sandstone: 0, limestone: 0.035, dolomite: 0.055 } };
const RHO_MA = { sandstone: 2.65, limestone: 2.71, dolomite: 2.87 };
const PE_POINTS = [['Quartz', 1.81, 2.65], ['Calcite', 5.08, 2.71], ['Dolomite', 3.14, 2.87], ['Anhydrite', 5.05, 2.98]];

function drawCrossplot(cx, cy, colors, type = 'custom', cz) {
  const cv = $('stXp'); const W = Math.max(320, cv.parentElement.clientWidth - 4), H = Math.min(540, Math.round(W * 0.82));
  const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  $('stXpLegend').innerHTML = '';
  if (!cx || !cy) { $('stXpNote').textContent = 'Pick two curves.'; return; }
  const m = { l: 56, r: 14, t: 12, b: 40 };
  const dom = c => [Math.min(c.min, c.max), Math.max(c.min, c.max)];
  const x = (cx.log ? d3.scaleLog() : d3.scaleLinear()).domain(dom(cx)).range([m.l, W - m.r]);
  const yDown = /^(RHOB|GRAIN)/.test(cy.label);   // density increases downward on N-D and PE-density charts
  const y = (cy.log ? d3.scaleLog() : d3.scaleLinear()).domain(dom(cy)).range(yDown ? [m.t, H - m.b] : [H - m.b, m.t]);
  const grid = cssVar('--grid'), muted = cssVar('--muted'), ink = cssVar('--ink'), paper = cssVar('--paper');
  ctx.font = '11px "IBM Plex Mono",monospace'; ctx.fillStyle = muted; ctx.strokeStyle = grid; ctx.lineWidth = 1;
  const decades = sc => sc.ticks(6).filter(t => /^1(\.0+)?e/.test(t.toExponential()));
  const xt = cx.log ? decades(x) : x.ticks(6), yt = cy.log ? decades(y) : y.ticks(6);
  ctx.textAlign = 'center'; for (const t of xt) { ctx.beginPath(); ctx.moveTo(x(t), m.t); ctx.lineTo(x(t), H - m.b); ctx.stroke(); ctx.fillText(f3(t, cx.log), x(t), H - m.b + 14); }
  ctx.textAlign = 'right'; for (const t of yt) { ctx.beginPath(); ctx.moveTo(m.l, y(t)); ctx.lineTo(W - m.r, y(t)); ctx.stroke(); ctx.fillText(f3(t, cy.log), m.l - 6, y(t) + 4); }
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.fillText(`${cx.label}${cx.unit ? ' (' + cx.unit + ')' : ''}`, (m.l + W - m.r) / 2, H - 8);
  ctx.save(); ctx.translate(14, (m.t + H - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`${cy.label}${cy.unit ? ' (' + cy.unit + ')' : ''}`, 0, 0); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, W - m.l - m.r, H - m.t - m.b); ctx.clip();
  const mode = S.stats.color || 'zone', dark = isDark(), bands = GR_BANDS[dark ? 'dark' : 'light'];
  const wellsOn = statWells(), wellColor = new Map(wellsOn.map((w, i) => [w.id, ZONE_COLORS[dark ? 'dark' : 'light'][i % 6]]));
  const vshCut = S.interp?.cut?.vsh ?? 0.5, cleanOnly = type === 'pickett' && S.stats.clean !== false;
  let n = 0, skipped = 0; const temps = [], matrices = new Set();
  // Color by a third curve: six equal-count groups over that curve in the plotted wells, light to dark.
  const zBreaks = mode === 'curve' && cz ? curveGroups(wellsOn, cz) : null;
  for (const w of wellsOn) {
    const zC = zBreaks && resolveCurve(w, cz), grC = resolveCurve(w, { aliases: A.GR }), vshC = w.curves.find(c => c.computed && c.mnemonic === 'VSH_GR'), dep = depthOf(w);
    if (type === 'nd' && resolveCurve(w, cy) && resolveCurve(w, cx)) matrices.add(w.neutronMatrix || 'limestone');
    const tvd = tvdOf(w) || dep, td = tvd[tvd.length - 1];
    for (const [a, b, z, pt, md] of pairSamples(w, cx, cy)) {
      const i = d3.bisectCenter(dep, md);
      if (cleanOnly && vshC && !(vshC.data[i] < vshCut)) { skipped++; continue; }
      if (type === 'pickett') temps.push(WellerPetro.tempAtDepth(tvd[i], S.interp.surfaceT, w.params?.bht, td));
      let col = colors.get(z) || muted;
      if (mode === 'well') col = wellColor.get(w.id);
      else if (mode === 'curve') { const v = zC ? sampleAt(w, zC, md) : NaN; col = zBreaks && Number.isFinite(v) ? bands[Math.min(5, d3.bisectRight(zBreaks, v))] : muted; }
      else if (mode === 'gr') { const g = grC && !grC.sparse ? grC.data[i] : NaN; col = Number.isFinite(g) ? bands[Math.min(5, Math.max(0, Math.floor(g / 25)))] : muted; }
      ctx.fillStyle = col;
      if (pt) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x(a), y(b), 3.5, 0, 7); ctx.fill(); ctx.strokeStyle = paper; ctx.stroke(); }
      else { ctx.globalAlpha = .35; ctx.fillRect(x(a) - 1, y(b) - 1, 2.2, 2.2); }
      n++;
    }
  }
  ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.textAlign = 'left';
  const notes = [];
  if (type === 'nd') {
    const cal = matrices.size === 1 ? [...matrices][0] : null;
    if (matrices.size > 1) notes.push('Wells mix neutron calibrations; lines drawn for limestone. Compare wells with the same calibration.');
    const offs = ND_MATRIX[cal === 'sandstone' ? 'sandstone' : 'limestone'];
    for (const lith of ['sandstone', 'limestone', 'dolomite']) {
      const nma = offs[lith], rma = RHO_MA[lith], exact = nma === 0;
      ctx.setLineDash(exact ? [] : [5, 4]); ctx.beginPath();
      for (let p = 0; p <= 0.4001; p += 0.02) { const X = x(nma * (1 - p) + p), Y = y(rma * (1 - p) + p); p === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
      ctx.stroke(); ctx.setLineDash([]);
      for (const p of [0, .1, .2, .3]) { const X = x(nma * (1 - p) + p), Y = y(rma * (1 - p) + p); ctx.beginPath(); ctx.arc(X, Y, 2.5, 0, 7); ctx.fill(); if (lith === 'limestone' || exact) ctx.fillText(`${Math.round(p * 100)}`, X + 5, Y - 4); }
      ctx.textAlign = 'right'; ctx.fillText(lith[0].toUpperCase() + lith.slice(1) + (exact ? '' : ' ≈'), x(nma) - 6, y(rma) + 4); ctx.textAlign = 'left';
    }
    notes.push(`${cal ? 'Neutron ' + cal + '-calibrated' : 'Neutron'}: the solid line is exact, dashed lines are approximate. Porosity ticks in %.`);
  } else if (type === 'pickett') {
    const I = S.interp, T = temps.length ? WellerLAS.median(temps) : I.rwTemp, rwT = WellerPetro.rwAtTemp(I.rw, I.rwTemp, T);
    for (const sw of [1, 0.5, 0.25]) {
      ctx.setLineDash(sw === 1 ? [] : [5, 4]); ctx.beginPath();
      const ps = [0.01, 1]; ps.forEach((p, k) => { const X = x(p), Y = y(WellerPetro.pickettRt(p, sw, rwT, I.a, I.m, I.n)); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
      const lp = 0.3, ly = y(WellerPetro.pickettRt(lp, sw, rwT, I.a, I.m, I.n)); ctx.fillText(`Sw ${sw * 100}%`, x(lp) + 4, ly - 4);
    }
    ctx.setLineDash([]);
    notes.push(`Lines: Archie with a ${I.a}, m ${I.m}, n ${I.n}, Rw ${rwT.toFixed(3)} Ω·m at ${T.toFixed(0)} °F (median formation temperature of the points). Fit the Sw 100% line to the wet points to read Rw; its slope is -m.` + (cleanOnly ? ` Showing Vsh < ${vshCut} only (${skipped.toLocaleString()} shaly samples hidden).` : ''));
  } else if (type === 'pe') {
    for (const [name, pe, rho] of PE_POINTS) { const X = x(pe), Y = y(rho); ctx.beginPath(); ctx.rect(X - 4, Y - 4, 8, 8); ctx.fillStyle = paper; ctx.fill(); ctx.stroke(); ctx.fillStyle = ink; ctx.fillText(name, X + 7, Y + 4); }
    notes.push('Squares: matrix points (PE b/e, grain density g/cc). Porosity moves points toward lower density at roughly constant PE.');
  }
  ctx.restore();
  $('stXpNote').textContent = `${n.toLocaleString()} samples plotted${n ? '' : ' (no overlapping data)'}. ${notes.join(' ')}`;
  if (mode === 'gr') $('stXpLegend').innerHTML = 'GR API ' + bands.map((c, i) => `<span><i style="background:${c}"></i>${i * 25}–${i === 5 ? '150+' : (i + 1) * 25}</span>`).join('');
  else if (mode === 'curve' && zBreaks) { const e = [zBreaks.min, ...zBreaks, zBreaks.max]; $('stXpLegend').innerHTML = esc(cz.label) + ' ' + bands.map((c, i) => `<span><i style="background:${c}"></i>${f3(e[i], cz.log)}–${f3(e[i + 1], cz.log)}</span>`).join(''); }
  else if (mode === 'curve') $('stXpLegend').innerHTML = `No ${esc(cz?.label || 'color curve')} data in these wells.`;
  else if (mode === 'well') $('stXpLegend').innerHTML = wellsOn.map(w => `<span><i style="background:${wellColor.get(w.id)}"></i>${esc(w.name)}</span>`).join('');
  cv.onmousemove = e => { const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < m.l || px > W - m.r || py < m.t || py > H - m.b) { $('stXpRead').textContent = ''; return; }
    $('stXpRead').textContent = `${cx.label} ${f3(x.invert(px), cx.log)} · ${cy.label} ${f3(y.invert(py), cy.log)}`; };
}

/* ---------- Zone histograms: the standard petrophysics set, one row per zone (and all zones), one column per curve.
   Bars are the share of zone thickness (depth-weighted, true vertical in deviated wells) in each bin; the line is the
   cumulative share; the triangle is the P50; the dashed line is the cutoff that sets net reservoir or pay. ---------- */
const HIST_SET = () => { const tot = S.interp?.swPhi === 'total';
  return [
    { key: 'GR', label: 'GR', unit: 'API', aliases: A.GR, min: 0, max: 200, cut: () => S.stats.cutoff, cutLbl: 'GR cutoff' },
    { key: 'VSH', label: 'Vsh', unit: 'v/v', aliases: ['VSH_GR'], min: 0, max: 1, cut: () => S.interp?.cut?.vsh, cutLbl: 'Vsh cutoff' },
    { key: 'PHI', label: tot ? 'PHIT' : 'PHIE', unit: 'v/v', aliases: tot ? ['PHIT_ND', 'PHIT'] : ['PHIE'], min: 0, max: 0.3, cut: () => S.interp?.cut?.phi, cutLbl: 'φ cutoff' },
    { key: 'SW', label: 'Sw', unit: 'v/v', aliases: ['SW'], min: 0, max: 1, cut: () => S.interp?.cut?.sw, cutLbl: 'Sw cutoff' },
    { key: 'RT', label: 'Deep res.', unit: 'Ω·m', aliases: A.RD, min: 0.2, max: 2000, log: true },
    { key: 'RHOB', label: 'RHOB', unit: 'g/cc', aliases: A.RHOB, min: 1.95, max: 2.95 },
    { key: 'NPHI', label: 'NPHI', unit: 'v/v', aliases: A.NPHI, min: -0.05, max: 0.45 },
    { key: 'DT', label: 'DT', unit: 'µs/ft', aliases: A.DT, min: 40, max: 140 },
    { key: 'PEF', label: 'PEF', unit: 'b/e', aliases: A.PE, min: 0, max: 10 },
  ]; };
const HIST_DEFAULT = ['GR', 'VSH', 'PHI', 'SW', 'RT', 'RHOB', 'NPHI'];

function histData(colors) {
  const wells = statWells(), set = HIST_SET().filter(c => wells.some(w => resolveCurve(w, c)));
  const on = S.stats.hist || HIST_DEFAULT, cols = set.filter(c => on.includes(c.key));
  const names = [...colors.keys()], rows = [{ name: 'All zones', color: cssVar('--muted') }, ...names.map(n => ({ name: n, color: colors.get(n) }))];
  const acc = new Map(rows.map(r => [r.name, cols.map(() => ({ v: [], wt: [] }))]));
  for (const w of wells) for (const z of zonesOf(w)) cols.forEach((c, k) => { const cur = resolveCurve(w, c); if (!cur) return;
    const { v, wt } = zoneValues(w, cur, z, c.log); for (const a of [acc.get(z.name)?.[k], acc.get('All zones')[k]]) if (a) { for (let i = 0; i < v.length; i++) { a.v.push(v[i]); a.wt.push(wt[i]); } } });
  const grid = rows.map(r => ({ ...r, cells: acc.get(r.name).map((a, k) => ({ n: a.v.length, h: WellerPetro.histogram(a.v, a.wt, { min: cols[k].min, max: cols[k].max, bins: 20, log: cols[k].log }) })) }))
    .filter((r, i) => i === 0 || r.cells.some(c => c.n));
  return { set, cols, grid: grid.length === 2 ? grid.slice(1) : grid };   // one zone: "All zones" would repeat it
}

function drawHistograms(colors) {
  const { set, cols, grid } = histData(colors), on = S.stats.hist || HIST_DEFAULT;
  $('stHistCurves').innerHTML = set.map(c => `<label class="mini"><input type="checkbox" data-sthist="${c.key}"${on.includes(c.key) ? ' checked' : ''}> ${esc(c.label)}</label>`).join('');
  const cv = $('stHist'), read = $('stHistRead'); read.textContent = '';
  if (!cols.length || !grid.length) { cv.width = cv.height = 0; cv.style.width = cv.style.height = '0'; $('stHistNote').textContent = set.length ? 'Pick at least one curve.' : 'None of the standard curves (GR, Vsh, porosity, Sw, resistivity, density, neutron, sonic, PE) are in the selected wells.'; return; }
  const labW = 128, headH = 34, footH = 18, cellH = 74, gap = 10;
  const W0 = Math.max(320, cv.parentElement.clientWidth - 4), cellW = Math.max(110, Math.floor((W0 - labW) / cols.length) - gap);
  const W = labW + cols.length * (cellW + gap), H = headH + grid.length * (cellH + footH + 6);
  const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const ink = cssVar('--ink'), muted = cssVar('--muted'), grid0 = cssVar('--grid'), mono = '"IBM Plex Mono",monospace', cond = '"IBM Plex Sans Condensed",sans-serif';
  const cutCol = isDark() ? '#ff7b72' : '#c1121f';
  const geo = [];
  cols.forEach((c, k) => { const x0 = labW + k * (cellW + gap);
    ctx.fillStyle = ink; ctx.font = `600 12px ${cond}`; ctx.textAlign = 'center'; ctx.fillText(`${c.label}${c.log ? ' (log)' : ''}`, x0 + cellW / 2, 13);
    ctx.fillStyle = muted; ctx.font = `10px ${mono}`; ctx.fillText(c.unit, x0 + cellW / 2, 26); });
  grid.forEach((r, j) => { const y0 = headH + j * (cellH + footH + 6);
    ctx.fillStyle = r.color; ctx.fillRect(0, y0 + cellH / 2 - 5, 10, 10);
    ctx.fillStyle = ink; ctx.font = `${j === 0 && r.name === 'All zones' ? 'italic ' : ''}600 12px ${cond}`; ctx.textAlign = 'left';
    let nm = r.name; while (nm.length > 4 && ctx.measureText(nm).width > labW - 22) nm = nm.slice(0, -2) + '…'; ctx.fillText(nm, 16, y0 + cellH / 2 + 4);
    r.cells.forEach((cell, k) => { const c = cols[k], x0 = labW + k * (cellW + gap), h = cell.h, nb = h.frac.length, bw = cellW / nb;
      geo.push({ x0, y0, r, c, cell });
      ctx.strokeStyle = grid0; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y0 + .5, cellW - 1, cellH - 1);
      ctx.fillStyle = muted; ctx.font = `9px ${mono}`; ctx.textAlign = 'left'; ctx.fillText(c.min === 0 ? '0' : f3(c.min, c.log), x0, y0 + cellH + 11); ctx.textAlign = 'right'; ctx.fillText(f3(c.max, c.log), x0 + cellW, y0 + cellH + 11);
      if (!cell.n) { ctx.textAlign = 'center'; ctx.fillText('no data', x0 + cellW / 2, y0 + cellH / 2 + 3); return; }
      const peak = Math.max(...h.frac, 1e-9), sy = (cellH - 14) / peak, base = y0 + cellH - 1;
      ctx.fillStyle = r.color; ctx.globalAlpha = .6; h.frac.forEach((f, b) => { if (f > 0) ctx.fillRect(x0 + b * bw + .5, base - f * sy, Math.max(1, bw - 1), f * sy); }); ctx.globalAlpha = 1;
      // Cumulative share, full cell height = 100%.
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, base - h.below * (cellH - 2));
      h.cum.forEach((f, b) => ctx.lineTo(x0 + (b + 1) * bw, base - f * (cellH - 2))); ctx.stroke();
      const xv = v => { const t = c.log ? (Math.log10(v) - Math.log10(c.min)) / (Math.log10(c.max) - Math.log10(c.min)) : (v - c.min) / (c.max - c.min); return x0 + Math.max(0, Math.min(1, t)) * cellW; };
      const cut = c.cut?.(); if (Number.isFinite(cut) && (c.key !== 'GR' || !set.some(s => s.key === 'PHI'))) { ctx.strokeStyle = cutCol; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xv(cut) + .5, y0 + 1); ctx.lineTo(xv(cut) + .5, base); ctx.stroke(); ctx.setLineDash([]); }
      if (Number.isFinite(h.p50)) { const px = xv(h.p50); ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(px, base + 1); ctx.lineTo(px - 4, base + 7); ctx.lineTo(px + 4, base + 7); ctx.fill(); }
      ctx.fillStyle = muted; ctx.font = `9px ${mono}`; ctx.textAlign = 'left'; ctx.fillText(`${Math.round(peak * 100)}%`, x0 + 3, y0 + 10);
      ctx.textAlign = 'right'; ctx.fillText(`P50 ${f3(h.p50, c.log)}`, x0 + cellW - 3, y0 + 10); }); });
  cv.onmousemove = e => { const b = cv.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    const g = geo.find(g => px >= g.x0 && px < g.x0 + cellW && py >= g.y0 && py < g.y0 + cellH); if (!g || !g.cell.n) { read.textContent = ''; return; }
    const h = g.cell.h, k = Math.min(h.frac.length - 1, Math.floor((px - g.x0) / (cellW / h.frac.length)));
    read.textContent = `${g.r.name} · ${g.c.label} ${f3(h.edges[k], g.c.log)}–${f3(h.edges[k + 1], g.c.log)}: ${(100 * h.frac[k]).toFixed(1)}% of thickness, ${(100 * h.cum[k]).toFixed(0)}% below · P10 ${f3(h.p10, g.c.log)} P50 ${f3(h.p50, g.c.log)} P90 ${f3(h.p90, g.c.log)} · n ${g.cell.n.toLocaleString()}`; };
  cv.onmouseleave = () => { read.textContent = ''; };
  const outs = grid[0].cells.map((cell, k) => cell.n && cell.h.below + cell.h.above > 0.02 ? `${cols[k].label} ${Math.round(100 * (cell.h.below + cell.h.above))}%` : '').filter(Boolean);
  $('stHistNote').textContent = 'Bars: share of zone thickness per bin (true vertical in deviated wells), scaled to each panel\'s peak. Line: cumulative share. ▲ P50. Dashed: the cutoff for net reservoir or pay.' + (outs.length ? ` Outside the plotted range (not in the bars): ${outs.join(', ')}.` : '');
}

/* PNG of a stats chart: a canvas or an SVG drawn on the page background, with a title line. */
async function statsChartPNG(kind) {
  const title = { box: `Distribution · ${S.stats.curve}`, xp: `Crossplot · ${$('stType').selectedOptions[0]?.text || ''}${S.stats.type === 'custom' ? ` · ${S.stats.x} vs ${S.stats.y}` : ''}`, hist: 'Histograms by zone' }[kind];
  const src = { box: $('stBox'), xp: $('stXp'), hist: $('stHist') }[kind], r = src.getBoundingClientRect(); if (!r.width || !r.height) { $('stNote').textContent = 'Nothing to export in that chart'; return; }
  const res = 2, pad = 12, tH = 26, legend = kind === 'xp' ? $('stXpLegend').textContent.trim() : '';
  const W = Math.ceil(r.width) + 2 * pad, H = Math.ceil(r.height) + tH + pad + (legend ? 18 : 0);
  const cv = document.createElement('canvas'); cv.width = W * res; cv.height = H * res; const ctx = cv.getContext('2d'); ctx.scale(res, res);
  ctx.fillStyle = cssVar('--paper'); ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = cssVar('--ink'); ctx.font = '600 14px "IBM Plex Sans Condensed",sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(title, pad, 18);
  ctx.fillStyle = cssVar('--muted'); ctx.font = '11px "IBM Plex Mono",monospace'; ctx.textAlign = 'right'; ctx.fillText(statWells().map(w => w.name).join(', ').slice(0, 120), W - pad, 18); ctx.textAlign = 'left';
  if (src instanceof HTMLCanvasElement) ctx.drawImage(src, pad, tH, r.width, r.height);
  else ctx.drawImage(await inlinedSVG(src), pad, tH, r.width, r.height);
  if (legend) { ctx.fillStyle = cssVar('--muted'); ctx.fillText(legend.slice(0, 160), pad, H - pad + 4); }
  const name = `${kind === 'box' ? 'distribution_' + S.stats.curve : kind === 'xp' ? 'crossplot_' + (S.stats.type === 'custom' ? S.stats.x + '_' + S.stats.y : S.stats.type) : 'zone_histograms'}.png`.replace(/[^\w.-]+/g, '_');
  cv.toBlob(b => downloadBlob(name, b), 'image/png');
}
// An SVG with its CSS-styled text and lines baked in, as an image the canvas can draw.
function inlinedSVG(svg) { const clone = svg.cloneNode(true), a = svg.querySelectorAll('*'), b = clone.querySelectorAll('*');
  a.forEach((el, i) => { const cs = getComputedStyle(el); b[i].setAttribute('style', ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight'].map(p => `${p}:${cs.getPropertyValue(p)}`).join(';')); });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); const r = svg.getBoundingClientRect(); clone.setAttribute('width', r.width); clone.setAttribute('height', r.height);
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)); }); }
document.addEventListener('click', e => { const b = e.target.closest('[data-stpng]'); if (b) statsChartPNG(b.dataset.stpng).catch(err => { $('stNote').textContent = 'PNG export failed: ' + err.message; }); });

function statsCSV() {
  const { rows, curves } = computeStats();
  const head = ['well', 'zone', 'top_md_ft', 'base_md_ft', 'gross_tvt_ft', 'net_ft', 'ntg', 'pay_ft', (S.interp?.swPhi === 'total' ? 'phit' : 'phie') + '_net', 'sw_pay', 'phi_h_ft', 'hc_h_ft', ...curves.flatMap(c => ['mean', 'p10', 'p50', 'p90', 'n'].map(k => `${c.label}_${k === 'mean' && c.log ? 'gmean' : k}`))];
  const q = v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const L = [head.join(',')];
  const f = (v, d) => v == null || !Number.isFinite(v) ? '' : +v.toFixed(d);
  for (const r of rows) L.push([r.well.name, r.zone.name, r.zone.top, r.zone.base, f(r.gross, 1), f(r.net, 1), f(r.ntg, 3), f(r.pay, 1), f(r.phiNet, 4), f(r.swPay, 4), f(r.phih, 2), f(r.hch, 2),
    ...curves.flatMap(c => { const s = r.by[c.label]?.s; return s?.n ? [s.mean, s.p10, s.p50, s.p90, s.n].map(v => +v.toPrecision(5)) : ['', '', '', '', 0]; })].map(q).join(','));
  return L.join('\n') + '\n';
}

/* Long-format curve export in petroplots' canonical names (GR, RDEEP, RHOB, NPHI, PHIT, SW, ...), one row per depth per
   well, with FORMATION from the tops. tools/petroplots_figures.py turns it into publication figures with petroplots. */
const ppColumns = () => [['GR', A.GR], ['SP', A.SP], ['CALI', A.CAL], ['RDEEP', A.RD], ['RMED', A.RM], ['RSHAL', A.RS], ['RHOB', A.RHOB], ['NPHI', A.NPHI], ['PEF', A.PE], ['DT', A.DT],
  ['VSH', ['VSH_GR']], ['PHIT', ['PHIT_ND']], ['PHIE', ['PHIE']], ['SW', ['SW']], ['TOC', ['TOC_DLR']]];   // built lazily: the alias table loads later
function petroplotsCSV(step = 1) {
  const q = v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const PP = ppColumns(), L = ['WELL,DEPTH,TVDSS,' + PP.map(c => c[0]).join(',') + ',FORMATION,NEUTRON_MATRIX'];
  for (const w of statWells()) {
    const dep = depthOf(w), cols = PP.map(([, al]) => { const c = resolveCurve(w, { aliases: al }); return c && !c.sparse ? c.data : null; });
    const e = WellerLAS.datumElevation(w), tvd = tvdOf(w) || dep, zones = zonesOf(w);
    const every = Math.max(1, Math.round(step / Math.max(1e-6, dep[1] - dep[0])));
    let zi = 0;
    for (let i = 0; i < dep.length; i += every) {
      while (zi < zones.length - 1 && dep[i] >= zones[zi].base) zi++;
      const vals = cols.map(a => a && Number.isFinite(a[i]) ? +a[i].toPrecision(5) : '');
      L.push([q(w.name), dep[i], Number.isFinite(e) ? +(tvd[i] - e).toFixed(1) : '', ...vals, q(zones[zi].name), w.neutronMatrix || ''].join(','));
    }
  }
  return L.join('\n') + '\n';
}

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset?.stwell) { const ids = S.stats.wells || S.wells.map(w => w.id); S.stats.wells = t.checked ? [...new Set([...ids, t.dataset.stwell])] : ids.filter(i => i !== t.dataset.stwell); render(); }
  else if (t.id === 'stCutoff') { S.stats.cutoff = +t.value || 75; render(); }
  else if (t.id === 'stCurve') { S.stats.curve = t.value; render(); }
  else if (t.id === 'stX') { S.stats.x = t.value; render(); }
  else if (t.id === 'stY') { S.stats.y = t.value; render(); }
  else if (t.id === 'stType') { S.stats.type = t.value; render(); }
  else if (t.id === 'stZ') { S.stats.z = t.value; render(); }
  else if (t.id === 'stColor') { S.stats.color = t.value; render(); }
  else if (t.id === 'stClean') { S.stats.clean = t.checked; render(); }
  else if (t.dataset?.sthist) { const on = new Set(S.stats.hist || HIST_DEFAULT); t.checked ? on.add(t.dataset.sthist) : on.delete(t.dataset.sthist); S.stats.hist = HIST_SET().map(c => c.key).filter(k => on.has(k)); render(); }
});
