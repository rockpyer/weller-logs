/* Curve QC, despiking and LAS 2.0 export. Pure functions: runs in the browser (global WellerQC) and in Node (tests).
   Checks follow welly's quality tests (agilescientific/welly, quality.py); the writer follows lasio's LAS 2.0 layout
   (kinverarity1/lasio, writer.py). */
(function (root) {
  const LAS = root.WellerLAS;

  /* ---------- Despike: rolling median, replace points far outside the local spread ---------- */
  // A point is a spike when it sits more than z robust standard deviations (1.4826 × MAD) from the median of the
  // `win` samples around it. Spikes become that median. Returns the new data and the indices replaced.
  // log: work on log10 values (resistivity, gas), so a spike is judged by ratio, not by difference.
  function despike(raw, { win = 11, z = 6, log = false } = {}) {
    const data = log ? Float64Array.from(raw, v => v > 0 ? Math.log10(v) : NaN) : raw;
    const n = data.length, h = Math.max(1, win >> 1), out = Float64Array.from(data), idx = [];
    const buf = [];
    for (let i = 0; i < n; i++) {
      const v = data[i]; if (!Number.isFinite(v)) continue;
      buf.length = 0; for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) if (Number.isFinite(data[j])) buf.push(data[j]);
      if (buf.length < 5) continue;
      buf.sort((a, b) => a - b); const med = mid(buf);
      for (let k = 0; k < buf.length; k++) buf[k] = Math.abs(buf[k] - med);
      buf.sort((a, b) => a - b); const mad = mid(buf) * 1.4826;
      const tol = mad > 0 ? z * mad : 0;
      if (tol > 0 ? Math.abs(v - med) > tol : false) { out[i] = med; idx.push(i); }
    }
    if (log) { const back = Float64Array.from(raw); for (const i of idx) back[i] = 10 ** out[i]; return { data: back, idx }; }
    return { data: out, idx };
  }
  function mid(s) { const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  /* ---------- Curve checks ---------- */
  // Plausible physical range and expected units by curve family (the first alias of a track curve, as core.js names it).
  const RANGE = { GR: [0, 1500], CAL: [2, 40], BS: [2, 40], RD: [0.01, 1e5], RM: [0.01, 1e5], RS: [0.01, 1e5], RHOB: [1, 3.5], NPHI: [-0.15, 1],
    DPHI: [-0.5, 1], PE: [0, 20], DT: [30, 300], DRHO: [-1, 1], ROP: [0, 5000], K: [0, 20], TH: [0, 100], U: [0, 100] };
  const UNITS = { GR: /API|GAPI/, RD: /OHM/, RM: /OHM/, RS: /OHM/, RHOB: /^(G\/C|G\/CC|G\/CM3|GM\/CC|G\/CM|GCC)/, NPHI: /^(V\/V|DEC|FRAC|CFCF|PU|%|)$/,
    DPHI: /^(V\/V|DEC|FRAC|PU|%|)$/, DT: /^(US\/F|USEC\/F|US\/FT|USEC\/FT|US\/M|USEC\/M)/, PE: /^(B\/E|BARN|B\/EL|)$/, CAL: /^(IN|INCH|INCHES|MM|CM)$/ };
  const UNIT_HINT = { GR: 'API', RD: 'ohm·m', RM: 'ohm·m', RS: 'ohm·m', RHOB: 'g/cc', NPHI: 'v/v', DPHI: 'v/v', DT: 'µs/ft', PE: 'b/e', CAL: 'in' };

  function medianStep(d) { const s = []; for (let i = 1; i < d.length; i++) { const x = d[i] - d[i - 1]; if (x > 1e-9) s.push(x); } return s.length ? LAS.median(s) : 0; }

  // Each check: { key, label, ok, level ('ok'|'warn'|'bad'), text }. fam: family key for range and unit checks.
  function checkCurve(dep, curve, fam, { log = false, spike = {} } = {}) {
    const d = curve.data, n = d.length, step = medianStep(dep) || 1, out = [];
    let first = -1, last = -1, have = 0;
    for (let i = 0; i < n; i++) if (Number.isFinite(d[i])) { if (first < 0) first = i; last = i; have++; }
    const span = n > 1 ? dep[n - 1] - dep[0] : 0;
    const cov = first < 0 || span <= 0 ? 0 : (dep[last] - dep[first]) / span;
    out.push({ key: 'coverage', label: 'Coverage', level: first < 0 ? 'bad' : cov < 0.25 ? 'warn' : 'ok', value: cov,
      text: first < 0 ? 'no data' : `${Math.round(cov * 100)}% of the well, ${fmt(dep[first])}–${fmt(dep[last])}` });
    if (first < 0) return { checks: out, score: 0, first, last };
    // Gaps: null runs inside the curve's own range longer than 3 samples.
    let gaps = 0, gapLen = 0, run = 0;
    for (let i = first; i <= last; i++) { if (!Number.isFinite(d[i])) run++; else { if (run > 3) { gaps++; gapLen += run * step; } run = 0; } }
    out.push({ key: 'gaps', label: 'Gaps', level: gaps ? 'warn' : 'ok', value: gaps, text: gaps ? `${gaps} gap${gaps > 1 ? 's' : ''}, ${fmt(gapLen)} in total` : 'none' });
    // Flat runs: the same value over 20+ samples and 10+ depth units, as from a stuck tool or a filled-in interval.
    let flatBest = 0, flatAt = -1, k = first;
    for (let i = first + 1; i <= last + 1; i++) { if (i <= last && d[i] === d[i - 1] && Number.isFinite(d[i])) continue; const len = i - k; if (len > flatBest) { flatBest = len; flatAt = k; } k = i; }
    const flatDepth = flatBest * step, flat = flatBest >= 20 && flatDepth >= 10;
    out.push({ key: 'flat', label: 'Flat runs', level: flat ? 'warn' : 'ok', value: flatDepth, text: flat ? `constant ${fmt(d[flatAt])} over ${fmt(flatDepth)} from ${fmt(dep[flatAt])}` : 'none' });
    // Spikes: count of points despike would replace.
    const sp = despike(d, { log, ...spike }).idx;
    const spFrac = sp.length / Math.max(1, have);
    out.push({ key: 'spikes', label: 'Spikes', level: spFrac > 0.01 ? 'warn' : 'ok', value: sp.length, idx: sp,
      text: sp.length ? `${sp.length} (${(spFrac * 100).toFixed(1)}%)${sp.length ? ', first at ' + fmt(dep[sp[0]]) : ''}` : 'none' });
    // Physical range.
    const R = RANGE[fam];
    if (R) { let bad = 0; for (let i = first; i <= last; i++) { const v = d[i]; if (Number.isFinite(v) && (v < R[0] || v > R[1])) bad++; }
      const f = bad / have; out.push({ key: 'range', label: 'Range', level: f > 0.05 ? 'bad' : f > 0 ? 'warn' : 'ok', value: f, text: bad ? `${(f * 100).toFixed(1)}% outside ${R[0]}–${R[1]}` : `within ${R[0]}–${R[1]}` }); }
    if (log) { let neg = 0; for (let i = first; i <= last; i++) if (d[i] <= 0) neg++; if (neg) out.push({ key: 'neg', label: 'Zero or negative', level: 'warn', value: neg, text: `${neg} values ≤ 0 on a log scale` }); }
    // Units.
    const U = UNITS[fam], u = String(curve.unit || '').toUpperCase().replace(/\s/g, '');
    if (U) out.push({ key: 'unit', label: 'Unit', level: U.test(u) ? 'ok' : 'warn', value: curve.unit, text: U.test(u) ? (curve.unit || 'none given') : `"${curve.unit || ''}", expected ${UNIT_HINT[fam]}` });
    const score = out.filter(c => c.level === 'ok').length / out.length;
    return { checks: out, score, first, last };
  }
  function fmt(v) { return Number.isFinite(v) ? (+v.toFixed(Math.abs(v) < 10 ? 3 : 1)).toLocaleString('en-US') : '—'; }

  // Percentile rescale of one curve onto a reference: the reference's P5 and P95 map onto this curve's P5 and P95.
  function normCoeffs(src, ref, lo = 0.05, hi = 0.95) {
    const q = (a, p) => { const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y); if (v.length < 20) return NaN; const x = p * (v.length - 1), i = Math.floor(x); return v[i] + (x - i) * ((v[i + 1] ?? v[i]) - v[i]); };
    const s5 = q(src, lo), s95 = q(src, hi), r5 = q(ref, lo), r95 = q(ref, hi);
    if (![s5, s95, r5, r95].every(Number.isFinite) || s95 - s5 <= 0) return null;
    const a = (r95 - r5) / (s95 - s5); return { a, b: r5 - a * s5, src: [s5, s95], ref: [r5, r95] };
  }

  /* ---------- LAS 2.0 writer ---------- */
  const ascii = s => String(s ?? '').replace(/Ω·?m/gi, 'OHMM').replace(/[Ωω]/g, 'OHM').replace(/[µμ]/g, 'U').replace(/°/g, 'DEG').replace(/·/g, '').replace(/[^\x20-\x7e]/g, '');
  const mnem = s => ascii(s).replace(/[.:\s]+/g, '_').replace(/^_+|_+$/g, '') || 'CURVE';
  const unitOf = s => ascii(s).replace(/\s+/g, '');
  const val = v => ascii(v).replace(/:/g, ' ').trim();
  function num(v) { if (!Number.isFinite(v)) return '-999.25'; const s = String(+v.toPrecision(7)); return s === '-0' ? '0' : s; }

  // well: a Weller well (curves[0] is depth). opts.computed: include computed curves; opts.app: text for the ~Other note.
  function writeLAS(w, { computed = true, notes = [], date = new Date() } = {}) {
    const dep = w.curves[0].data, n = dep.length, du = w.depthUnit === 'm' ? 'M' : 'FT';
    const curves = w.curves.slice(1).filter(c => !c.sparse && c.data?.length === n && (computed || !c.computed));
    const used = new Set(['DEPT']);
    const cols = curves.map(c => { let m = mnem(c.mnemonic), k = 2; const base = m; while (used.has(m.toUpperCase())) m = `${base}_${k++}`; used.add(m.toUpperCase()); return { c, m }; });
    const st = medianStep(dep); let uniform = st > 0;
    for (let i = 1; i < n && uniform; i++) if (Math.abs(dep[i] - dep[i - 1] - st) > Math.max(1e-4, st * 1e-3)) uniform = false;
    const dd = Math.min(6, Math.max(1, decimals(st)));
    const L = [], hl = (m, u, v, d) => L.push(` ${(m + '.' + (u || '')).padEnd(14)} ${String(v ?? '').padEnd(30)} : ${d}`);
    L.push('~VERSION INFORMATION'); hl('VERS', '', '2.0', 'CWLS LOG ASCII STANDARD - VERSION 2.0'); hl('WRAP', '', 'NO', 'ONE LINE PER DEPTH STEP');
    L.push('~WELL INFORMATION');
    hl('STRT', du, dep[0].toFixed(dd), 'START DEPTH'); hl('STOP', du, dep[n - 1].toFixed(dd), 'STOP DEPTH'); hl('STEP', du, uniform ? +st.toFixed(dd) : 0, uniform ? 'STEP' : 'STEP (irregular sampling)'); hl('NULL', '', '-999.25', 'NULL VALUE');
    const m = w.meta || {}, loc = w.location || {};
    const W = [['COMP', w.company, 'COMPANY'], ['WELL', w.name, 'WELL'], ['FLD', w.field, 'FIELD'], ['LOC', m.location, 'LOCATION'], ['CNTY', w.county, 'COUNTY'], ['STAT', w.state, 'STATE'],
      ['CTRY', m.country, 'COUNTRY'], ['SRVC', m.service, 'SERVICE COMPANY'], ['DATE', m.logDate, 'LOG DATE'], ['API', w.api, 'API NUMBER']];
    for (const [k, v, d] of W) hl(k, '', val(v), d);
    if (Number.isFinite(loc.lat)) hl('LATI', 'DEG', +loc.lat.toFixed(6), 'LATITUDE'); if (Number.isFinite(loc.lon)) hl('LONG', 'DEG', +loc.lon.toFixed(6), 'LONGITUDE');
    if (loc.crs && loc.crs !== 'unknown') hl('GDAT', '', val(loc.crs), 'GEODETIC DATUM');
    L.push('~PARAMETER INFORMATION');
    const e = w.elevation || {}, p = w.params || {};
    if (Number.isFinite(e.kb)) hl('EKB', du, e.kb, 'ELEVATION KELLY BUSHING'); if (Number.isFinite(e.gl)) hl('EGL', du, e.gl, 'ELEVATION GROUND LEVEL');
    if (Number.isFinite(p.bht)) hl('BHT', '', p.bht, 'BOTTOM HOLE TEMPERATURE'); if (Number.isFinite(p.bitSize)) hl('BS', 'IN', p.bitSize, 'BIT SIZE');
    if (Number.isFinite(p.rm)) hl('RM', 'OHMM', p.rm, 'MUD RESISTIVITY'); if (Number.isFinite(p.rmf)) hl('RMF', 'OHMM', p.rmf, 'MUD FILTRATE RESISTIVITY');
    if (w.neutronMatrix) hl('MATR', '', w.neutronMatrix.toUpperCase(), 'NEUTRON MATRIX');
    const tops = [...(w.tops || [])].filter(t => Number.isFinite(t.md)).sort((a, b) => a.md - b.md), tUsed = new Set();
    for (const t of tops) { let k = 'TOP_' + mnem(t.name).toUpperCase(); while (tUsed.has(k)) k += '_'; tUsed.add(k); hl(k, du, +t.md.toFixed(2), `TOP ${val(t.name)} (MD)`); }
    L.push('~CURVE INFORMATION');
    hl('DEPT', du, '', 'MEASURED DEPTH');
    for (const { c, m: mm } of cols) {
      const extra = [c.computed && 'computed by Weller Logs', c.note, c.editNote, c.shifted && `shifted ${c.shifted} ${w.depthUnit || 'ft'}`].filter(Boolean).join('; ');
      hl(mm, unitOf(c.unit), '', val([c.description, extra && `(${extra})`].filter(Boolean).join(' ')) || mm);
    }
    // Survey and notes in ~Other: the reader takes MD INC AZI TVD back as the directional survey.
    const other = [];
    if (w.survey?.md?.length > 1) { const s = w.survey; other.push(' MD INC AZI TVD'); for (let i = 0; i < s.md.length; i++) other.push(` ${num(s.md[i])} ${num(s.inc[i])} ${num(s.azi[i])} ${num(s.tvd[i])}`); }
    other.push(`# Exported by Weller Logs ${date.toISOString().slice(0, 10)}${w.sources?.length || w.fileName ? ' from ' + ascii((w.sources || [w.fileName]).filter(Boolean).join(', ')) : ''}`);
    for (const t of notes) other.push('# ' + ascii(t));
    L.push('~OTHER INFORMATION', ...other);
    L.push('~A  DEPT ' + cols.map(x => x.m).join(' '));
    const cw = Math.max(11, ...cols.map(x => x.m.length + 1));
    const data = cols.map(x => x.c.data);
    for (let i = 0; i < n; i++) { let row = dep[i].toFixed(dd).padStart(11); for (const a of data) row += ' ' + num(a[i]).padStart(cw); L.push(row); }
    return L.join('\n') + '\n';
  }
  function decimals(st) { if (!(st > 0)) return 2; for (let d = 0; d <= 6; d++) if (Math.abs(st * 10 ** d - Math.round(st * 10 ** d)) < 1e-6) return d; return 4; }

  root.WellerQC = { despike, checkCurve, normCoeffs, writeLAS, RANGE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
