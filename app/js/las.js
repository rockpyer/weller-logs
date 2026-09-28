/* LAS 1.2 / 2.0 reader and well normalizer. Pure functions: runs in the browser (global WellerLAS) and in Node (tests).
   Handles the quirks real files carry: LAS 1.2 headers with label and value swapped, parameters filed in ~P instead
   of ~W, numbers followed by words ("41.31 degrees"), bottom-up depth order, wrapped data, several null sentinels,
   neutron matrix from the header, directional surveys in ~Other, and implausible KB elevations. */
(function (root) {
  const NULLS = [-999.25, -999, -9999, -999.99, -99999, 1e30, -1e30];
  const LABEL_WORDS = /^(WELL|COMPANY|FIELD|LOCATION|COUNTY|STATE|PROVINCE|COUNTRY|NATION|SERVICE COMPANY|LATITUDE|LONGITUDE|API NUMBER|UWI|UNIQUE WELL ID|LOG DATE|DATE|LICENSE|LICENCE NUMBER|RANGE|TOWNSHIP|SECTION)$/;

  function median(a) { const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return NaN; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
  function leadingNumber(s) { const m = String(s ?? '').trim().match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/); return m ? parseFloat(m[0]) : undefined; }

  // "MNEM.UNIT  DATA : DESCRIPTION". The description follows the last colon, so values may contain colons (times, "Lat:34").
  function parseHeaderLine(l) {
    const i = l.indexOf('.'); if (i < 0) return null;
    const mnem = l.slice(0, i).trim(); if (!mnem) return null;
    const rest = l.slice(i + 1); const ci = rest.lastIndexOf(':');
    const body = ci >= 0 ? rest.slice(0, ci) : rest, desc = ci >= 0 ? rest.slice(ci + 1).trim() : '';
    const m = body.match(/^(\S*)\s*(.*)$/);
    return { mnem, unit: m[1], value: (m[2] || '').trim(), desc };
  }

  // Parse problems are collected, not thrown: diagnoseLAS turns them into messages with the offending line.
  function parseLAS(text) {
    const lines = String(text).split(/\r?\n/);
    const H = { version: {}, well: {}, params: {}, curves: [], other: [], tops: [] };
    const rows = [], rowLine = []; let sec = '', wrap = false, buf = [], version = '';
    const issues = { badRows: [], badRowCount: 0, widthRows: [], widthCount: 0, badHeader: [], sections: [], firstDataLine: 0, dataLines: 0 };
    for (let ln = 0; ln < lines.length; ln++) {
      const raw = lines[ln], l = raw.trim(); if (!l) continue;
      if (l[0] === '~') { sec = l[1] ? l[1].toUpperCase() : ''; if (/^~TOP/i.test(l)) sec = 'T'; issues.sections.push({ name: l.split(/\s/)[0], line: ln + 1 }); continue; }
      if (sec === 'A') {
        if (l[0] === '#') continue;
        issues.dataLines++; if (!issues.firstDataLine) issues.firstDataLine = ln + 1;
        const words = l.split(/[\s,]+/).filter(Boolean), toks = words.map(Number);
        const bad = toks.findIndex(Number.isNaN);
        if (bad >= 0) { issues.badRowCount++; if (issues.badRows.length < 3) issues.badRows.push({ line: ln + 1, text: raw, token: words[bad] }); continue; }
        if (wrap) { buf.push(...toks); if (buf.length >= H.curves.length) { rows.push(buf.slice(0, H.curves.length)); rowLine.push(ln + 1); buf = []; } }
        else { rows.push(toks); rowLine.push(ln + 1); if (H.curves.length && toks.length !== H.curves.length) { issues.widthCount++; if (issues.widthRows.length < 3) issues.widthRows.push({ line: ln + 1, text: raw, n: toks.length }); } }
        continue;
      }
      if (sec === 'O') { H.other.push(raw); continue; }
      if (l[0] === '#') { H.other.push(raw); continue; }   // survey column headers are often comments placed before ~Other
      if (sec === 'T') { const m = l.match(/^(.*?)[\s,]+([-+]?\d+\.?\d*)\s*$/); if (m) H.tops.push({ name: m[1].trim(), md: +m[2] }); continue; }
      const h = parseHeaderLine(l);
      if (!h) { if (/^[VWPC]$/.test(sec) && issues.badHeader.length < 3) issues.badHeader.push({ line: ln + 1, text: raw, sec }); continue; }
      if (sec === 'V') { H.version[h.mnem.toUpperCase()] = h.value; if (h.mnem.toUpperCase() === 'WRAP') wrap = /yes/i.test(h.value); if (h.mnem.toUpperCase() === 'VERS') version = h.value; }
      else if (sec === 'W' || sec === 'P') {
        // LAS 1.2 ~W often reads "COMP. COMPANY: Acme": the label sits where the value belongs and the value after the colon.
        if (sec === 'W' && !/^(STRT|STOP|STEP|NULL)$/i.test(h.mnem) && h.desc && LABEL_WORDS.test(h.value.replace(/:$/, '').toUpperCase()) && !LABEL_WORDS.test(h.desc.toUpperCase())) {
          [h.value, h.desc] = [h.desc, h.value];
        }
        (sec === 'W' ? H.well : H.params)[h.mnem.toUpperCase()] = h;
      }
      else if (sec === 'C') H.curves.push({ mnemonic: h.mnem, unit: h.unit, description: h.desc });
    }
    const nullv = leadingNumber(H.well.NULL?.value) ?? -999.25;
    const isNull = v => v === undefined || Math.abs(v - nullv) < 1e-6 || NULLS.some(n => Math.abs(v - n) < 1e-6);
    // Unique mnemonics: a repeated GR becomes GR:2, the convention the alias lookup already strips.
    const seen = {};
    for (const c of H.curves) { const k = c.mnemonic.toUpperCase(); seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) c.mnemonic += ':' + seen[k]; }
    let n = rows.length;
    const curves = H.curves.map((c, j) => { const a = new Float64Array(n); let nulls = 0; for (let i = 0; i < n; i++) { let v = rows[i][j]; if (isNull(v)) { v = NaN; nulls++; } a[i] = v; } return { ...c, data: a, nulls }; });
    // Depth must increase for every downstream search; many logs are recorded bottom-up.
    let reversed = false;
    if (curves.length && n > 1 && curves[0].data[0] > curves[0].data[n - 1]) { for (const c of curves) c.data.reverse(); rowLine.reverse(); reversed = true; }
    // Drop rows whose depth is missing, which would break monotonic depth.
    if (curves.length && curves[0].data.some(Number.isNaN)) {
      const keep = []; curves[0].data.forEach((d, i) => { if (Number.isFinite(d)) keep.push(i); });
      issues.noDepthRows = n - keep.length;
      for (const c of curves) c.data = Float64Array.from(keep, i => c.data[i]); n = keep.length;
      const rl = keep.map(i => rowLine[i]); rowLine.length = 0; rowLine.push(...rl);
    }
    issues.rowLine = rowLine;
    return { header: H, curves, wrap, nullv, rows: n, version, reversed, issues };
  }

  /* ---------- Diagnosis: say why a file will not load, show the line, suggest the fix ---------- */
  const LAS_TEMPLATE = `~VERSION INFORMATION
 VERS.            2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0
 WRAP.             NO : ONE LINE PER DEPTH STEP
~WELL INFORMATION
 STRT.FT       5000.0 : START DEPTH
 STOP.FT       5001.0 : STOP DEPTH
 STEP.FT          0.5 : STEP
 NULL.        -999.25 : NULL VALUE
 WELL.    BOGGESS 17H : WELL NAME
 API .  4706101812-01 : API NUMBER (10 digits + 2-digit sidetrack)
~CURVE INFORMATION
 DEPT.FT              : MEASURED DEPTH
 GR  .GAPI            : GAMMA RAY
 RHOB.G/C3            : BULK DENSITY
~A
 5000.0   85.2   2.51
 5000.5  -999.25 2.49
 5001.0   90.1   2.53`;
  const REEXPORT = 'Re-export it as LAS 2.0 from the logging or mapping software, or convert it with lasio (Python).';

  // Binary formats seen in place of LAS. bytes: the first bytes of the file, when the caller has them.
  function sniffBinary(text, name = '', bytes) {
    const b = bytes ? Array.from(bytes.slice(0, 16)) : Array.from(String(text).slice(0, 16), c => c.charCodeAt(0) & 0xff);
    const starts = sig => sig.every((v, i) => b[i] === v);
    const head = String(text).slice(0, 400), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
    const kinds = [
      [head.startsWith('%PDF') || ext === 'pdf', 'a PDF', 'A PDF log is a picture of the curves, not the numbers. Ask the vendor or the state agency for the LAS or DLIS version of the same log.'],
      [starts([0x50, 0x4b, 3, 4]) || /^(xlsx|docx|zip)$/.test(ext), 'a ZIP archive or Excel/Word file (.xlsx, .docx, .zip)', 'Unzip it and open the .las files inside, or from Excel save the sheet as CSV (point data) and export logs as LAS 2.0.'],
      [starts([0xd0, 0xcf, 0x11, 0xe0]) || /^(xls|doc)$/.test(ext), 'an older Excel or Word file (.xls, .doc)', 'Save the sheet as CSV, or export the log as LAS 2.0.'],
      [/V1\.00RECORD/.test(head) || ext === 'dlis', 'a DLIS file (RP66 binary)', 'Weller reads LAS text. Convert DLIS to LAS 2.0 with dlisio + lasio (Python), Schlumberger Log Data Toolbox, or ask for the LAS deliverable.'],
      [ext === 'lis' || ext === 'tap', 'a LIS file (binary)', 'Convert LIS to LAS 2.0 (dlisio reads LIS), or ask for the LAS deliverable.'],
      [starts([0x49, 0x49, 0x2a, 0]) || starts([0x4d, 0x4d, 0, 0x2a]) || /^tiff?$/.test(ext), 'a TIFF image (a raster log)', 'A raster log has no curve values. Digitize it (NeuraLog, Petra, or similar) or find the LAS.'],
      [starts([0x89, 0x50, 0x4e, 0x47]) || starts([0xff, 0xd8, 0xff]) || /^(png|jpe?g|gif)$/.test(ext), 'an image', 'An image has no curve values. Find the LAS for this log.'],
    ];
    for (const [hit, type, fix] of kinds) if (hit) return { type, fix };
    const sample = String(text).slice(0, 4000); let odd = 0;
    for (const ch of sample) { const c = ch.charCodeAt(0); if (c === 0 || c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) odd++; }
    if (sample.length && odd / sample.length > 0.02) return { type: 'a binary file', fix: 'LAS is plain text you can read in a text editor. ' + REEXPORT };
    return null;
  }

  const clip = s => { s = String(s).replace(/\t/g, ' '); return s.length > 110 ? s.slice(0, 107) + '…' : s; };
  function diagnoseLAS(text, name = '', bytes) {
    const P = []; const add = (level, cat, title, o = {}) => P.push({ level, cat, title, ...o });
    const bin = sniffBinary(text, name, bytes);
    if (bin) { add('error', 'File type', `This is ${bin.type}, not a LAS text file`, { fix: bin.fix }); return { problems: P, parsed: null }; }
    const src = String(text), lines = src.split(/\r?\n/);
    const firstLines = lines.map((t, i) => ({ line: i + 1, text: t })).filter(x => x.text.trim()).slice(0, 3);
    if (!src.trim()) { add('error', 'No data', 'The file is empty'); return { problems: P, parsed: null }; }
    if (!/^\s*~/m.test(src)) {
      const delim = /[,;\t|]/.test(firstLines[0]?.text || '');
      add('error', 'File type', delim ? 'A delimited table (CSV/TXT), not a LAS file' : 'No LAS sections (~V, ~W, ~C, ~A) in the file', {
        detail: delim ? 'LAS marks its sections with lines starting with ~. This file starts with a table row.' : 'LAS files start with ~VERSION and carry ~WELL, ~CURVE and ~A sections.',
        snippet: firstLines,
        fix: delim ? 'Point data (depth plus values, e.g. core) and tops (well, top name, depth) load as CSV with a header row naming the depth column. For continuous logs, export LAS 2.0.' : REEXPORT, template: !delim });
      return { problems: P, parsed: null };
    }
    const p = parseLAS(src), I = p.issues, secs = I.sections.map(s => s.name.toUpperCase());
    const has = c => I.sections.some(s => s.name.toUpperCase()[1] === c);
    const secLine = c => I.sections.find(s => s.name.toUpperCase()[1] === c)?.line;
    if (/^3/.test(p.version) || secs.some(s => /^~LOG_/.test(s))) {
      add('error', 'File type', `LAS ${p.version || '3.0'} is not supported yet`, { detail: 'LAS 3.0 keeps curves in ~Log_Definition and ~Log_Data sections, which this reader does not parse.',
        snippet: I.sections.slice(0, 5).map(s => ({ line: s.line, text: lines[s.line - 1] })), fix: 'Save it as LAS 2.0. In lasio: las = lasio.read(f); las.write(out, version=2.0).' });
      return { problems: P, parsed: p };
    }
    if (!has('C')) add('error', 'Parsing', 'No ~Curve section', { detail: 'The ~Curve section names each data column (DEPT, GR, …). Without it the numbers cannot be assigned to curves.', snippet: I.sections.map(s => ({ line: s.line, text: lines[s.line - 1] })), fix: 'Add a ~CURVE INFORMATION section before ~A with one line per column, depth first.', template: true });
    else if (!p.header.curves.length) add('error', 'Parsing', '~Curve section lists no curves', { line: secLine('C'), detail: 'Each curve line needs MNEMONIC.UNIT then a colon, e.g. "GR .GAPI : Gamma ray".', snippet: I.badHeader.filter(b => b.sec === 'C').map(b => ({ line: b.line, text: b.text })), template: true });
    if (!has('A')) add('error', 'No data', 'No ~A (data) section', { detail: 'The file has a header but no curve values. It may be a header-only file or cut off during download.', snippet: I.sections.map(s => ({ line: s.line, text: lines[s.line - 1] })), fix: 'Download the file again, or ask for the complete LAS.' });
    else if (!I.dataLines) add('error', 'No data', 'The ~A section is empty', { line: secLine('A'), detail: 'No rows follow the ~A line; the file may be truncated.', fix: 'Download the file again, or ask for the complete LAS.' });
    else if (!p.rows && I.badRowCount) add('error', 'Parsing', `None of the ${I.dataLines.toLocaleString()} data lines are all numbers`, {
      detail: `Values like "${I.badRows[0].token}" cannot be read as numbers. LAS data must be numeric, separated by spaces.`, snippet: I.badRows.map(r => ({ line: r.line, text: r.text, mark: r.token })),
      fix: /\d,\d/.test(I.badRows[0].token) ? 'The file uses a comma as the decimal mark. Re-export with a period as the decimal separator.' : 'Replace text values with the NULL value (e.g. -999.25) or remove text columns, then re-export.' });
    if (P.some(x => x.level === 'error')) return { problems: P, parsed: p };

    // Loadable from here on: the rest are warnings shown with the result.
    const nc = p.header.curves.length, names = p.header.curves.map(c => c.mnemonic);
    if (I.badRowCount) add('warn', 'Parsing', `${I.badRowCount.toLocaleString()} data line${I.badRowCount > 1 ? 's' : ''} skipped: not all numbers`, { snippet: I.badRows.map(r => ({ line: r.line, text: r.text, mark: r.token })), fix: 'Replace text in the data with the NULL value.' });
    if (I.widthCount) {
      const most = I.widthCount > p.rows / 2;
      add(most ? 'error' : 'warn', 'Parsing', `${I.widthCount.toLocaleString()} of ${p.rows.toLocaleString()} data lines have a different number of values than the ${nc} curves in ~Curve`, {
        detail: `~Curve lists ${nc}: ${names.slice(0, 12).join(', ')}${nc > 12 ? ', …' : ''}. Line ${I.widthRows[0].line} has ${I.widthRows[0].n}. Values would land in the wrong curves.`,
        snippet: I.widthRows.map(r => ({ line: r.line, text: r.text })),
        fix: /\d,\d/.test(I.widthRows[0].text) && I.widthRows[0].n % nc === 0 ? 'Values like "1000,5" use a comma as the decimal mark, which LAS reads as a column break. Re-export with a period as the decimal separator.' : I.widthRows[0].n < nc && !p.wrap ? 'If each depth spans several lines, set "WRAP. YES" in ~Version. Otherwise add or remove ~Curve lines so they match the columns.' : 'Make the ~Curve list match the data columns, one curve per column in order, depth first.' });
      if (most) return { problems: P, parsed: p };
    }
    if (!p.rows) { add('error', 'No data', 'No rows with a depth value'); return { problems: P, parsed: p }; }
    const dm = String(names[0] || '').toUpperCase();
    if (/^(TIME|ETIM|DATE|TIM)/.test(dm)) { add('error', 'No data', `Indexed by ${names[0]}, not depth`, { detail: 'Time-based drilling or mud-log exports cannot be placed on a depth track.', fix: 'Export the depth-based version of the log (index DEPT or MD).' }); return { problems: P, parsed: p }; }
    if (!/^(DEPT|DEPTH|MD|DEP|MDEPTH|TDEP|DMEA|BDEP|MDEP|TVD)/.test(dm)) add('warn', 'Header', `First curve is ${names[0]}, read as depth`, { detail: 'LAS puts depth in the first column. If this column is not depth, every track will be misplaced.' });
    const vals = p.curves.slice(1);
    if (vals.length && vals.every(c => c.nulls >= p.rows)) {
      add('error', 'No data', `Every value is null (${p.nullv})`, { detail: `${p.rows.toLocaleString()} rows of depth, but ${vals.map(c => c.mnemonic).slice(0, 8).join(', ')} are all ${p.nullv} or another null sentinel.`,
        snippet: [I.rowLine[0], I.rowLine[p.rows >> 1]].filter(Boolean).map(l => ({ line: l, text: lines[l - 1] })), fix: 'Check NULL in ~Well matches the data, or that the export included the curve values.' });
      return { problems: P, parsed: p };
    }
    if (!vals.length) add('warn', 'No data', 'Only a depth column, no curves');
    const empty = vals.filter(c => c.nulls >= p.rows).map(c => c.mnemonic);
    if (empty.length) add('warn', 'No data', `${empty.length} curve${empty.length > 1 ? 's are' : ' is'} all null: ${empty.slice(0, 10).join(', ')}${empty.length > 10 ? ', …' : ''}`);
    const d = p.curves[0].data; let back = -1, dup = 0;
    for (let i = 1; i < d.length; i++) { if (d[i] < d[i - 1] && back < 0) back = i; if (d[i] === d[i - 1]) dup++; }
    if (back >= 0) add('warn', 'Parsing', 'Depth goes backwards partway through', { detail: 'Usually two logging runs concatenated in one file. Displays will jump at the reversal.', snippet: [back - 1, back].map(i => ({ line: I.rowLine[i], text: lines[I.rowLine[i] - 1] })), fix: 'Split the runs into separate LAS files; files with the same API are merged into one well.' });
    else if (dup > 3) add('warn', 'Parsing', `${dup} repeated depth values`, { detail: 'Repeated depths usually mean overlapping runs in one file.' });
    const strt = leadingNumber(p.header.well.STRT?.value), stop = leadingNumber(p.header.well.STOP?.value), step = Math.abs(leadingNumber(p.header.well.STEP?.value) || 0);
    const lo = d[0], hi = d[d.length - 1], tol = Math.max(step * 2, 1);
    if (Number.isFinite(strt) && Number.isFinite(stop) && (Math.abs(Math.min(strt, stop) - lo) > tol || Math.abs(Math.max(strt, stop) - hi) > tol))
      add('warn', 'Header', `STRT/STOP (${strt}–${stop}) do not match the data (${lo}–${hi})`, { detail: 'The file may be truncated, or the header copied from another run. Data depths are used.' });
    if (I.badHeader.length) add('warn', 'Parsing', `${I.badHeader.length} header line${I.badHeader.length > 1 ? 's' : ''} not in MNEM.UNIT VALUE : DESCRIPTION form, ignored`, { snippet: I.badHeader.map(b => ({ line: b.line, text: b.text })) });
    return { problems: P, parsed: p };
  }

  /* ---------- API / UWI identity: which files belong to the same borehole ---------- */
  // US API: 2 state + 3 county + 5 well, then 2 sidetrack (wellbore) and 2 event digits. Files of one borehole share the
  // first 12; the event code (a recompletion or re-log) does not make a new hole. A 10-digit API is the original hole (00).
  function apiKey(api) {
    const s = String(api || '').trim(); if (!s) return null;
    let d = s.replace(/\D/g, '');
    if (d.length % 2 === 1 && d[0] === '0' && d.length >= 11) d = d.slice(1);   // "049-021-…": 3-digit state code
    if (/[A-Z]/i.test(s.replace(/^API\s*/i, '')) || d.length < 10 || d.length > 14 || d.length % 2) return { well: s.toUpperCase().replace(/\s+/g, ''), bore: '', key: s.toUpperCase().replace(/\s+/g, ''), us: false };
    const bore = d.slice(10, 12) || '00';
    return { well: d.slice(0, 10), bore, key: d.slice(0, 10) + '-' + bore, us: true, explicitBore: d.length >= 12 };
  }
  function fmtApi(k) { return k?.us ? `${k.well.slice(0, 2)}-${k.well.slice(2, 5)}-${k.well.slice(5)}-${k.bore}` : (k?.key || ''); }

  /* ---------- Merge files of one well onto one depth grid ---------- */
  function medianStep(d) { const s = []; for (let i = 1; i < d.length; i++) { const x = d[i] - d[i - 1]; if (x > 1e-9) s.push(x); } return s.length ? median(s) : 0; }
  // Linear interpolation of (dep, val) at grid depths, blank beyond the source's range or across its gaps.
  function resample(dep, val, grid, maxGap) {
    const out = new Float64Array(grid.length).fill(NaN), n = dep.length; if (!n) return out;
    let k = 0;
    for (let i = 0; i < grid.length; i++) {
      const z = grid[i]; if (z < dep[0] - 1e-6 || z > dep[n - 1] + 1e-6) continue;
      while (k < n - 2 && dep[k + 1] < z - 1e-9) k++;
      if (Math.abs(dep[k] - z) < 1e-6) { out[i] = val[k]; continue; }
      if (k + 1 < n && Math.abs(dep[k + 1] - z) < 1e-6) { out[i] = val[k + 1]; continue; }
      const a = dep[k], b = dep[k + 1]; if (b === undefined || b - a > maxGap) continue;
      const t = (z - a) / (b - a), va = val[k], vb = val[k + 1];
      out[i] = Number.isFinite(va) && Number.isFinite(vb) ? va + t * (vb - va) : (t < 0.5 ? va : vb);
    }
    return out;
  }
  const UNIT_K = { ft: { ft: 1, m: 0.3048 }, m: { m: 1, ft: 1 / 0.3048 } };
  // parts: normalized wells, first one wins headers and overlapping values. Pure: parts are not modified.
  function mergeWells(parts) {
    const base = parts[0], unit = base.depthUnit || 'ft', notes = [];
    const logs = w => w.curves.slice(1).filter(c => !c.computed && !c.sparse);
    if (parts.length === 1) return { ...base, curves: [base.curves[0], ...logs(base)], notes: [...(base.notes || [])], sources: [base.fileName] };
    const k = parts.map(p => UNIT_K[unit][p.depthUnit || 'ft']);
    const deps = parts.map((p, j) => { const d = p.curves[0].data; return k[j] === 1 ? d : d.map(v => v * k[j]); });
    let step = Math.min(...deps.map(medianStep).filter(x => x > 0)); if (!Number.isFinite(step)) step = unit === 'm' ? 0.1524 : 0.5;
    const top = Math.min(...deps.map(d => d[0])), bot = Math.max(...deps.map(d => d[d.length - 1]));
    while ((bot - top) / step > 2e6) step *= 2;
    const n = Math.round((bot - top) / step) + 1, grid = new Float64Array(n);
    for (let i = 0; i < n; i++) grid[i] = +(top + i * step).toFixed(6);
    const out = new Map(); const byMnem = {};
    parts.forEach((p, j) => {
      if (j && (p.depthUnit || 'ft') !== unit) notes.push(`${p.fileName} depths converted ${p.depthUnit} → ${unit}`);
      const maxGap = Math.max(medianStep(deps[j]) * 3, step * 1.5);
      for (const c of logs(p)) {
        const m = c.mnemonic.toUpperCase().replace(/:\d+$/, ''), u = String(c.unit || '').toUpperCase(), key = m + '|' + u;
        const data = resample(deps[j], c.data, grid, maxGap);
        let t = out.get(key);
        if (!t) {
          byMnem[m] = (byMnem[m] || 0) + 1;
          t = { mnemonic: byMnem[m] > 1 ? c.mnemonic.replace(/:\d+$/, '') + ':' + byMnem[m] : c.mnemonic.replace(/:\d+$/, ''), unit: c.unit, description: c.description, note: c.note, data, sources: [p.fileName] };
          out.set(key, t); continue;
        }
        let filled = 0, overlap = 0;
        for (let i = 0; i < n; i++) { if (!Number.isFinite(data[i])) continue; if (Number.isFinite(t.data[i])) overlap++; else { t.data[i] = data[i]; filled++; } }
        if (filled) t.sources.push(p.fileName);
        if (overlap > 2) notes.push(`${t.mnemonic}: ${p.fileName} overlaps ${(overlap * step).toFixed(0)} ${unit} of ${t.sources[0]}; kept ${t.sources[0]}`);
      }
    });
    const curves = [{ ...base.curves[0], data: grid, nulls: 0 }, ...[...out.values()].map(c => { let nulls = 0; for (const v of c.data) if (!Number.isFinite(v)) nulls++; return { ...c, nulls }; })];
    const blank = v => v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
    const fill = (a, b) => { const r = { ...a }; for (const [key, v] of Object.entries(b || {})) if (blank(r[key]) && !blank(v)) r[key] = v; return r; };
    const w = { ...base };
    for (const p of parts.slice(1)) for (const f of ['name', 'api', 'field', 'company', 'county', 'state', 'neutronMatrix']) if (blank(w[f]) && !blank(p[f])) w[f] = p[f];
    w.location = parts.reduce((a, p) => fill(a, p.location), { ...base.location });
    w.elevation = parts.reduce((a, p) => fill(a, p.elevation), { ...base.elevation });
    w.meta = parts.reduce((a, p) => fill(a, p.meta), { ...base.meta });
    w.params = parts.reduce((a, p) => fill(a, p.params), { ...base.params });
    const tops = [];
    parts.forEach((p, j) => { for (const t of p.tops || []) if (!tops.some(x => x.name === t.name)) tops.push({ ...t, md: t.md * k[j] }); });
    const sj = parts.findIndex(p => p.survey), sv = parts[sj]?.survey;
    w.survey = sv && k[sj] !== 1 ? { ...sv, md: sv.md.map(v => v * k[sj]), tvd: sv.tvd.map(v => v * k[sj]) } : sv || null;
    return Object.assign(w, { curves, tops, notes: [...new Set([...parts.flatMap(p => p.notes || []), ...notes])], rows: n, wrap: false, reversed: false, sources: parts.map(p => p.fileName), stepMerged: step });
  }

  /* ---------- Directional survey from ~Other, and TVD by minimum curvature ---------- */
  function parseSurvey(otherLines) {
    let cols = null; const md = [], inc = [], azi = [], tvd = [];
    for (const raw of otherLines) {
      const l = raw.replace(/^#/, '').trim(); if (!l) continue;
      const toks = l.split(/[\s,]+/);
      if (toks.every(t => Number.isFinite(+t))) {
        if (!cols) continue;
        const v = toks.map(Number); if (v.length < 3) continue;
        md.push(v[cols.md]); inc.push(v[cols.inc]); azi.push(v[cols.azi]); tvd.push(cols.tvd >= 0 ? v[cols.tvd] : NaN);
        continue;
      }
      const up = toks.map(t => t.toUpperCase());
      const find = re => up.findIndex(t => re.test(t));
      const iMd = find(/^(MD|DEPTH|DEPT|MEAS)/), iInc = find(/^(INC|INCL|INCLINATION|DEV)/), iAzi = find(/^(AZ|AZM|AZI|AZIM|AZIMUTH)/);
      if (iMd >= 0 && iInc >= 0 && iAzi >= 0) {
        cols = { md: iMd, inc: iInc, azi: iAzi, tvd: find(/^TVD$/) };
      }
    }
    if (md.length < 2) return null;
    const s = { md: Float64Array.from(md), inc: Float64Array.from(inc), azi: Float64Array.from(azi), tvd: Float64Array.from(tvd) };
    if (s.tvd.some(v => !Number.isFinite(v))) s.tvd = minCurvatureTVD(s.md, s.inc, s.azi);
    return s;
  }

  function minCurvatureTVD(md, inc, azi) {
    const r = Math.PI / 180, tvd = new Float64Array(md.length);
    tvd[0] = md[0] * Math.cos(inc[0] * r);   // tie-in: straight hole from surface to the first station
    for (let i = 1; i < md.length; i++) {
      const i1 = inc[i - 1] * r, i2 = inc[i] * r, a1 = azi[i - 1] * r, a2 = azi[i] * r, dmd = md[i] - md[i - 1];
      const cosDL = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
      const dl = Math.acos(Math.min(1, Math.max(-1, cosDL)));
      const rf = dl > 1e-9 ? (2 / dl) * Math.tan(dl / 2) : 1;
      tvd[i] = tvd[i - 1] + (dmd / 2) * (Math.cos(i1) + Math.cos(i2)) * rf;
    }
    return tvd;
  }

  // TVD at each log depth: interpolate the survey; above it, parallel to the first station; below it, along the last inclination.
  function tvdAt(survey, depth) {
    const { md, tvd, inc } = survey, n = md.length, out = new Float64Array(depth.length);
    let k = 0;
    for (let i = 0; i < depth.length; i++) {
      const d = depth[i];
      if (d <= md[0]) { out[i] = tvd[0] - (md[0] - d); continue; }
      if (d >= md[n - 1]) { out[i] = tvd[n - 1] + (d - md[n - 1]) * Math.cos(inc[n - 1] * Math.PI / 180); continue; }
      while (k < n - 2 && md[k + 1] < d) k++;
      const t = (d - md[k]) / (md[k + 1] - md[k]); out[i] = tvd[k] + t * (tvd[k + 1] - tvd[k]);
    }
    return out;
  }

  /* ---------- Well normalization ---------- */
  function normalizeWell(p, fileName) {
    const W = p.header.well, P = p.header.params;
    const h = k => W[k] ?? P[k];
    const g = k => h(k)?.value;
    const num = (...ks) => { for (const k of ks) { const v = leadingNumber(g(k)); if (v !== undefined && !(k === 'EKB' && v === 0)) return v; } return undefined; };
    const notes = [];
    const dep = p.curves[0]; const du = String(dep?.unit || '').toUpperCase();
    const depthUnit = /^(M|METER|METERS|METRES?)$/.test(du) ? 'm' : 'ft';
    for (const c of p.curves) {
      const m = c.mnemonic.toUpperCase().replace(/:\d+$/, ''), u = (c.unit || '').toUpperCase();
      if (/^(NPHI|TNPH|NPOR|PHIN|CNC|HNPO|NPHS|NPHL|TNPS)/.test(m)) { const med = median(c.data); if (/PU|%/.test(u) || med > 1.5) { c.data = c.data.map(v => v / 100); c.unit = 'V/V'; c.note = 'converted from pu'; } }
      if (/^(DT|DTC|DTCO|AC)$/.test(m) && /US\/M|USEC\/M/.test(u)) { c.data = c.data.map(v => v / 3.28084); c.unit = 'US/F'; c.note = 'converted from us/m'; }
    }
    const tops = [
      ...Object.values(P).filter(x => /^TOP_/.test(x.mnem.toUpperCase())).map(x => ({ name: x.mnem.slice(4).replace(/_/g, ' ').replace(/\w\S*/g, s => s[0] + s.slice(1).toLowerCase()), md: leadingNumber(x.value), source: 'import' })),
      ...p.header.tops.map(t => ({ ...t, source: 'import' })),
    ].filter(t => Number.isFinite(t.md));
    const all = [...Object.values(W), ...Object.values(P)].map(x => `${x.mnem} ${x.value} ${x.desc}`).join(' | ');
    let kb = num('EKB', 'KB', 'EDF', 'DF', 'ELEV', 'EREF'), gl = num('EGL', 'GL', 'EPD');
    if (kb === undefined) { const m = all.match(/(-?\d+(?:\.\d+)?)\s*'?\s*(?:KB|RKB|DF)\b/i); if (m) { kb = parseFloat(m[1]); notes.push('KB read from free text'); } }
    if (gl === undefined) { const m = all.match(/(-?\d+(?:\.\d+)?)\s*[?']?\s*GL\b/i); if (m) gl = parseFloat(m[1]); }
    // A land rig floor sits a few to ~40 ft above ground. Anything outside 0-60 ft (0-18 m) is a header error.
    let kbSuspect = false;
    if (kb !== undefined && gl !== undefined) { const lim = depthUnit === 'm' ? 18 : 60; if (kb - gl < 0 || kb - gl > lim) { notes.push(`KB ${kb} is ${Math.round(kb - gl)} ${depthUnit} from GL ${gl}; ignored, depths hung on GL until corrected`); kbSuspect = true; } }
    let lat = num('LATI', 'LAT', 'LATITUDE'), lon = num('LONG', 'LON', 'LONGITUDE');
    if (lat === undefined) { const m = all.match(/LAT[A-Z]*\s*[:=]?\s*(-?\d+\.\d+)/i); if (m) lat = parseFloat(m[1]); }
    if (lon === undefined) { const m = all.match(/LON[A-Z]*\s*[:=]?\s*(-?\d+\.\d+)/i); if (m) lon = parseFloat(m[1]); }
    const westUS = /CALIFORNIA|COLORADO|WYOMING|UTAH|TEXAS|OKLAHOMA|KANSAS|NEW MEXICO|NORTH DAKOTA|MONTANA|\b(CA|CO|WY|UT|TX|OK|KS|NM|ND|MT)\b|UNITED STATES|USA/i.test(all);
    if (lon !== undefined && lon > 0 && westUS) { lon = -lon; notes.push('longitude sign corrected to west'); }
    const crsM = all.match(/NAD\s*(27|83)/i); const zoneM = all.match(/ZONE\s*(\d)/i);
    const crs = g('GDAT') || (crsM ? `NAD${crsM[1]}${zoneM ? ' · State Plane Zone ' + zoneM[1] : ''}` : 'unknown');
    const matr = String(g('MATR') || g('NMAT') || g('DPOR') || '').toUpperCase();
    const neutronMatrix = /SAND|SS|QUARTZ/.test(matr) ? 'sandstone' : /DOL/.test(matr) ? 'dolomite' : /LIME|LS|CALC/.test(matr) ? 'limestone' : null;
    const survey = parseSurvey(p.header.other);
    const clean = s => String(s || '').replace(/^(WELL|COMPANY|FIELD|API NUMBER):\s*/i, '').trim();
    const api = clean(g('API') || g('APIN') || g('UWI'));
    return {
      id: 'u' + Math.random().toString(36).slice(2, 8), name: clean(g('WELL')) || fileName.replace(/\.las$/i, ''),
      api: /enter|^-$/i.test(api) ? '' : api, fileName,
      location: { lat, lon, crs }, elevation: { kb: kbSuspect ? undefined : kb, kbRecorded: kb, gl, kbSuspect, unit: depthUnit },
      field: clean(g('FLD')), company: clean(g('COMP')), county: clean(g('CNTY') || g('COUN')), state: clean(g('STAT') || g('PROV')),
      meta: { location: clean(g('LOC')), spud: clean(g('SPUD') || g('SPD') || g('SPDT')), logDate: clean(g('DATE')), service: clean(g('SRVC')), country: clean(g('CTRY')) },
      notes, depthUnit, curves: p.curves, tops, wrap: p.wrap, nullv: p.nullv, rows: p.rows, reversed: p.reversed,
      neutronMatrix, survey,
      params: { bht: num('BHT', 'MXT', 'BHTEMP'), td: num('TDL', 'TDD', 'TD'), bitSize: num('BS', 'BIT'), rmf: num('RMF'), rm: num('RM', 'RMS') },
    };
  }

  // The elevation that depths hang from: KB when plausible, else GL (flagged), else none.
  function datumElevation(w) { const e = w.elevation || {}; return Number.isFinite(e.kb) ? e.kb : Number.isFinite(e.gl) ? e.gl : undefined; }

  root.WellerLAS = { parseLAS, diagnoseLAS, sniffBinary, apiKey, fmtApi, mergeWells, resample, LAS_TEMPLATE, normalizeWell, parseSurvey, minCurvatureTVD, tvdAt, datumElevation, median, leadingNumber, parseHeaderLine };
})(typeof globalThis !== 'undefined' ? globalThis : this);
