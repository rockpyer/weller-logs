/* LAS 1.2 / 2.0 reader and well normalizer. Pure functions: runs in the browser (global WellerLAS) and in Node (tests).
   Handles the quirks real files carry: LAS 1.2 headers with label and value swapped, parameters filed in ~P instead
   of ~W, numbers followed by words ("41.31 degrees"), bottom-up depth order, wrapped data, several null sentinels,
   neutron matrix from the header, directional surveys in ~Other, and implausible KB elevations. */
(function (root) {
  // Numeric null sentinels beyond the header's NULL, from lasio's 'common' policy plus integer overflow codes.
  const NULLS = [-999.25, -999, -9999, -999.99, -99999, 1e30, -1e30, 9999.25, -9999.25, 999.25, 2147483647, -2147483647, -2147483648];
  // Text a logging or export program writes for "no value". Read as null, not as a bad row.
  const TEXT_NULL = /^(NA|N\/A|NAN|-?INF|\+INF|-?INFINITY|\(NULL\)|NULL|NONE|-|--|IND|IO)$/i;
  const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  // "-999.25-999.25" or "12.5-3.4": fixed-width exports whose columns ran together. Split at each sign after a digit.
  function runOn(t) { if (!/^[-+]?[\d.]/.test(t) || !/\d[-+]\d|\d[-+]\.\d/.test(t.replace(/[eE][-+]\d/g, 'e0'))) return null;
    const parts = t.match(NUM); return parts && parts.join('') === t ? parts.map(Number) : null; }
  const LABEL_WORDS = /^(WELL|COMPANY|FIELD|LOCATION|COUNTY|STATE|PROVINCE|COUNTRY|NATION|SERVICE COMPANY|LATITUDE|LONGITUDE|API NUMBER|UWI|UNIQUE WELL ID|LOG DATE|DATE|LICENSE|LICENCE NUMBER|RANGE|TOWNSHIP|SECTION)$/;

  function median(a) { const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return NaN; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
  // "41.31", "041° 02' 31.040\" N", "104 26 37.66 W", "-104.4438". Returns signed decimal degrees and whether a hemisphere was given.
  function parseCoord(s) {
    const t = String(s ?? '').replace(/\uFFFD/g, ' ').trim(); if (!t) return undefined;
    const hemi = (t.match(/\b([NSEW])\b\s*$/i) || t.match(/^\s*([NSEW])\b/i) || [])[1]?.toUpperCase();
    const nums = (t.match(/[-+]?\d+(?:\.\d+)?/g) || []).map(Number); if (!nums.length) return undefined;
    const dms = nums.length >= 2 && /['’′"”″°º]|\d\s+\d/.test(t) && nums[1] < 60 && (nums[2] ?? 0) < 60;
    let v = dms ? Math.abs(nums[0]) + nums[1] / 60 + (nums[2] ?? 0) / 3600 : Math.abs(nums[0]);
    if (nums[0] < 0 || hemi === 'S' || hemi === 'W') v = -v;
    return { v, hemi: !!hemi || nums[0] < 0, dms };
  }
  function leadingNumber(s) { const m = String(s ?? '').trim().match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/); return m ? parseFloat(m[0]) : undefined; }

  // "MNEM.UNIT  DATA : DESCRIPTION". The description follows the last colon, so values may contain colons (times, "Lat:34").
  function parseHeaderLine(l) {
    const i = l.indexOf('.'); if (i < 0) return null;
    const mnem = l.slice(0, i).trim(); if (!mnem) return null;
    const rest = l.slice(i + 1); const ci = rest.lastIndexOf(':');
    const body = ci >= 0 ? rest.slice(0, ci) : rest, desc = ci >= 0 ? rest.slice(ci + 1).replace(/\{[^}]*\}/g, '').replace(/\|.*$/, '').trim() : '';
    const m = body.match(/^(\S*)\s*(.*)$/);
    return { mnem, unit: m[1], value: (m[2] || '').trim().replace(/^"(.*)"$/, '$1'), desc };
  }

  // Section letter for LAS 1.2/2.0 (~V ~W ~P ~C ~O ~A) and LAS 3.0 (~Log_Definition, ~Log_Data | Log_Definition,
  // ~Inclinometry_Data, ~Tops_Data…). LAS 3 sets other than Log, Tops and Inclinometry are skipped ('X').
  function sectionOf(l) {
    const n = l.slice(1).split(/[\s|]/)[0].toUpperCase();
    if (n === 'TOPS' || n === 'TOPS_DATA') return 'T';
    if (/^(LOG_)?DEFINITION$|^CURVE/.test(n) || n === 'C') return 'C';
    if (/^LOG_DATA$|^A/.test(n)) return 'A';
    if (/^LOG_PARAMETER$|^PARAM/.test(n) || n === 'P') return 'P';
    if (/^(INCLINOMETRY|DIRECTIONAL|DEVIATION|SURVEY)_DEFINITION$/.test(n)) return 'SD';
    if (/^(INCLINOMETRY|DIRECTIONAL|DEVIATION|SURVEY)_DATA$/.test(n)) return 'SA';
    if (/^TOPS_DEFINITION$/.test(n)) return 'X';
    if (/_(DEFINITION|DATA|PARAMETER)$/.test(n)) return 'X';
    return n[0] || '';
  }
  // Split a data row on the LAS 3 delimiter; quoted strings may hold spaces or commas.
  function splitRow(l, dlm) {
    if (dlm === 'COMMA') return (l.match(/"[^"]*"|[^,]+/g) || []).map(t => t.trim().replace(/^"|"$/g, ''));
    if (dlm === 'TAB') return l.split('\t').map(t => t.trim());
    return (l.match(/"[^"]*"|[^\s,]+/g) || []).map(t => t.replace(/^"|"$/g, ''));
  }
  // Parse problems are collected, not thrown: diagnoseLAS turns them into messages with the offending line.
  // opts.nullv overrides NULL from ~Well (the "Keep zeros as data" choice for files that declare NULL. 0).
  function parseLAS(text, opts = {}) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);   // byte-order mark; old Mac line ends
    const H = { version: {}, well: {}, params: {}, curves: [], other: [], tops: [] };
    const rows = [], rowLine = []; let sec = '', wrap = false, buf = [], version = '', dlm = 'SPACE', las3 = false, survCols = [], survHead = false;
    const issues = { badRows: [], badRowCount: 0, widthRows: [], widthCount: 0, badHeader: [], sections: [], skipped: [], textCols: 0, firstDataLine: 0, dataLines: 0, runOn: 0, textNulls: 0, decimalComma: false, looseHeader: 0, runOnLine: 0 };
    let comma = null;   // decimal comma in ~A, decided on the first data line that has a comma
    for (let ln = 0; ln < lines.length; ln++) {
      const raw = lines[ln], l = raw.trim(); if (!l) continue;
      if (l[0] === '~') { sec = sectionOf(l); if (sec === 'X') issues.skipped.push(l.slice(1).split(/[\s|]/)[0]); issues.sections.push({ name: l.split(/\s/)[0], line: ln + 1, sec }); continue; }
      if (sec === 'X') continue;
      if (sec === 'SD') { const h = parseHeaderLine(l); if (h) survCols.push(h.mnem); continue; }
      if (sec === 'SA') { if (!survHead && survCols.length) { H.other.push(survCols.join(' ')); survHead = true; } H.other.push(splitRow(l, dlm).join(' ')); continue; }
      if (sec === 'A') {
        if (l[0] === '#') continue;
        issues.dataLines++; if (!issues.firstDataLine) issues.firstDataLine = ln + 1;
        let words;
        if (las3) words = splitRow(l, dlm);
        else {
          // "1000,5  85,2": a comma decimal mark, when splitting on spaces alone gives one value per curve.
          if (comma === null && l.includes(',')) { const ws = l.split(/\s+/).filter(Boolean); comma = !wrap && H.curves.length > 1 && ws.length === H.curves.length && ws.some(t => /^[-+]?\d+,\d+$/.test(t)) && ws.every(t => !/,.*,/.test(t)); if (comma) issues.decimalComma = true; }
          words = comma ? l.split(/\s+/).filter(Boolean).map(t => t.replace(',', '.')) : l.split(/[\s,]+/).filter(Boolean);
          // Text nulls become the null value; run-together numbers are split into their columns.
          const fixed = [];
          for (const w of words) { if (TEXT_NULL.test(w)) { fixed.push('NaN'); issues.textNulls++; continue; } if (Number.isNaN(Number(w))) { const r = runOn(w); if (r) { fixed.push(...r.map(String)); issues.runOn++; if (!issues.runOnLine) issues.runOnLine = ln + 1; continue; } } fixed.push(w); }
          words = fixed;
        }
        const toks = words.map(w => w === '' || w === 'NaN' ? NaN : Number(w));
        // LAS 3 allows text columns (dates, lithology names): blank them, keep the row. Depth must still be a number.
        if (las3 && Number.isFinite(toks[0])) toks.forEach((v, i) => { if (Number.isNaN(v)) { toks[i] = NaN; issues.textCols++; } });
        const bad = las3 ? (Number.isFinite(toks[0]) ? -1 : 0) : words.findIndex((w, i) => Number.isNaN(toks[i]) && w !== 'NaN');
        if (bad >= 0) { issues.badRowCount++; if (issues.badRows.length < 3) issues.badRows.push({ line: ln + 1, text: raw, token: words[bad] }); continue; }
        if (wrap) { buf.push(...toks); if (buf.length >= H.curves.length) { rows.push(buf.slice(0, H.curves.length)); rowLine.push(ln + 1); buf = []; } }
        else { rows.push(toks); rowLine.push(ln + 1); if (H.curves.length && toks.length !== H.curves.length) { issues.widthCount++; if (issues.widthRows.length < 3) issues.widthRows.push({ line: ln + 1, text: raw, n: toks.length }); } }
        continue;
      }
      if (sec === 'O') { H.other.push(raw); continue; }
      if (l[0] === '#') { H.other.push(raw); continue; }   // survey column headers are often comments placed before ~Other
      if (sec === 'T') { if (las3) { const t = splitRow(l, dlm), k = t.findIndex(x => x !== '' && Number.isFinite(+x)), nm = t.find(x => x && !Number.isFinite(+x)); if (k >= 0 && nm) H.tops.push({ name: nm, md: +t[k] }); continue; }
        const m = l.match(/^(.*?)[\s,]+([-+]?\d+\.?\d*)\s*$/); if (m) H.tops.push({ name: m[1].trim(), md: +m[2] }); continue; }
      let h = parseHeaderLine(l);
      // A header line with no period after the mnemonic ("STRT 1000 : start"): read the first word as the mnemonic.
      if (!h && /^[VWPC]$/.test(sec)) { const m = l.match(/^([A-Za-z][\w-]*)\s+([^:]*?)\s*:\s*(.*)$/) || l.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
        if (m) { h = m.length === 4 ? { mnem: m[1], unit: '', value: m[2].trim(), desc: m[3].trim() } : { mnem: m[1], unit: '', value: '', desc: m[2].trim() }; issues.looseHeader++; } }
      if (!h) { if (/^[VWPC]$/.test(sec) && issues.badHeader.length < 3) issues.badHeader.push({ line: ln + 1, text: raw, sec }); continue; }
      if (sec === 'V') { const k = h.mnem.toUpperCase(); H.version[k] = h.value; if (k === 'WRAP') wrap = /yes/i.test(h.value); if (k === 'VERS') { version = h.value; las3 = /^3/.test(h.value); } if (k === 'DLM') dlm = h.value.toUpperCase(); }
      else if (sec === 'W' || sec === 'P') {
        // LAS 1.2 ~W often reads "COMP. COMPANY: Acme": the label sits where the value belongs and the value after the colon.
        if (sec === 'W' && !/^(STRT|STOP|STEP|NULL)$/i.test(h.mnem) && h.desc && LABEL_WORDS.test(h.value.replace(/:$/, '').toUpperCase()) && !LABEL_WORDS.test(h.desc.toUpperCase())) {
          [h.value, h.desc] = [h.desc, h.value];
        }
        (sec === 'W' ? H.well : H.params)[h.mnem.toUpperCase()] = h;
      }
      else if (sec === 'C') H.curves.push({ mnemonic: h.mnem, unit: h.unit, description: h.desc });
    }
    const headerNull = leadingNumber(H.well.NULL?.value), nullv = opts.nullv ?? headerNull ?? -999.25;
    const isNull = v => v === undefined || Number.isNaN(v) || Math.abs(v - nullv) < 1e-6 || NULLS.some(n => Math.abs(v - n) < 1e-6);
    // Unique mnemonics: a repeated GR becomes GR:2, the convention the alias lookup already strips.
    const seen = {};
    for (const c of H.curves) { const k = c.mnemonic.toUpperCase(); seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) c.mnemonic += ':' + seen[k]; }
    let n = rows.length;
    const curves = H.curves.map((c, j) => { const a = new Float64Array(n); let nulls = 0, byNull = 0; for (let i = 0; i < n; i++) { let v = rows[i][j]; if (isNull(v)) { if (v === nullv && !NULLS.includes(v)) byNull++; v = NaN; nulls++; } a[i] = v; } return { ...c, data: a, nulls, byNull }; });
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
    return { header: H, curves, wrap, nullv, headerNull, rows: n, version, reversed, issues, las3 };
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
  function diagnoseLAS(text, name = '', bytes, opts = {}) {
    const P = []; const add = (level, cat, title, o = {}) => P.push({ level, cat, title, ...o });
    const bin = sniffBinary(text, name, bytes);
    if (bin) { add('error', 'File type', `This is ${bin.type}, not a LAS text file`, { fix: bin.fix }); return { problems: P, parsed: null }; }
    const src = String(text).replace(/^\uFEFF/, ''), lines = src.split(/\r\n|\r|\n/);
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
    const p = parseLAS(src, opts), I = p.issues, secs = I.sections.map(s => s.name.toUpperCase());
    const has = c => I.sections.some(s => s.sec === c);
    const secLine = c => I.sections.find(s => s.sec === c)?.line;
    if (p.las3 && I.skipped.length) add('info', 'Parsing', `LAS 3.0: read the Log data; skipped ${[...new Set(I.skipped)].join(', ')}`, { detail: 'Core, test and other LAS 3 data sets are not shown as logs.' });
    if (p.las3 && I.textCols) add('info', 'Parsing', `LAS 3.0 text values left blank (${I.textCols.toLocaleString()} cells)`);
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
    if (I.decimalComma) add('info', 'Parsing', 'Comma decimal marks (1000,5) read as periods');
    if (I.runOn) add('info', 'Parsing', `${I.runOn.toLocaleString()} run-together value${I.runOn > 1 ? 's' : ''} split into columns`, { detail: 'Fixed-width exports can print "-999.25-999.25" with no space between columns.', snippet: [{ line: I.runOnLine, text: lines[I.runOnLine - 1] }] });
    if (I.textNulls) add('info', 'Parsing', `${I.textNulls.toLocaleString()} text value${I.textNulls > 1 ? 's' : ''} (NA, INF, NULL…) read as null`);
    if (I.looseHeader) add('info', 'Parsing', `${I.looseHeader} header line${I.looseHeader > 1 ? 's' : ''} without a period after the mnemonic, read anyway`);
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
    // NULL. 0 (some Petrolog mud-log exports): every true zero (0% lithology, 0 ppm gas) would read as missing.
    if (p.nullv === 0) {
      const hit = vals.filter(c => c.byNull).sort((a, b) => b.byNull - a.byNull), total = hit.reduce((s, c) => s + c.byNull, 0);
      if (total) add('warn', 'Header', `NULL is 0: ${total.toLocaleString()} zero reading${total > 1 ? 's' : ''} treated as missing`, {
        detail: `Most affected: ${hit.slice(0, 6).map(c => `${c.mnemonic} (${c.byNull.toLocaleString()})`).join(', ')}${hit.length > 6 ? ', …' : ''}. Export LAS writes these as -999.25, so a measured zero and "not measured" can no longer be told apart. LAS 2.0 asks for a NULL value that cannot occur in the data.`,
        fix: 'NULL is 0, so every zero reading is treated as missing. If zeros are real readings, set NULL to -999.25.', action: { kind: 'keepZeros', label: 'Keep zeros as data' } });
    } else if (p.headerNull === 0 && opts.nullv !== undefined) add('info', 'Header', `NULL. 0 in ~Well ignored: zeros kept as data, only ${p.nullv} and the standard sentinels are null`, { action: { kind: 'zerosNull', label: 'Treat zeros as null' } });
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
  // Well names compare without case, spaces or punctuation: "CARPENTER 126-0408H" = "Carpenter 126 0408H".
  function nameKey(n) { return String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function fmtApi(k) { return k?.us ? `${k.well.slice(0, 2)}-${k.well.slice(2, 5)}-${k.well.slice(5)}-${k.bore}` : (k?.key || ''); }

  // State and county named by a US API number: 2-digit API state code, then the FIPS county code (not in Alaska).
  function apiPlace(api) {
    const k = apiKey(api), C = root.WellerAPICodes; if (!k?.us || !C) return null;
    const sc = k.well.slice(0, 2), cc = k.well.slice(2, 5), st = C.states[sc]; if (!st) return null;
    const m = new RegExp('(?:^|\\|)' + cc + '([^|]*)').exec(C.counties[sc] || '');
    return { state: st[0] || st[1], stateName: st[1], county: m ? m[1] : '', stateCode: sc, countyCode: cc };
  }
  // Fill a blank or code-only ("04", "037") state and county from the API. Names typed or read from the file stay.
  function fillPlace(w) {
    const p = apiPlace(w.api); if (!p) return [];
    const code = v => /^\s*\d{0,3}\s*$/.test(String(v ?? '')), did = [];
    if (code(w.state) && p.state) { did.push(`state ${p.state}`); w.state = p.state; }
    if (code(w.county) && p.county) { const was = String(w.county ?? '').trim(); did.push(`county ${p.county}` + (was && +was !== +p.countyCode ? ` (header said ${was}, API says ${p.countyCode})` : '')); w.county = p.county; }
    return did;
  }

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
  const unitKey = u => { const x = String(u || '').toUpperCase().replace(/[^A-Z/%]/g, ''); return /^(UNITS?|U|)$/.test(x) ? '' : /^(API|GAPI|APIGR)$/.test(x) ? 'API' : /^(FTHR|FT\/HR|FT\/H)$/.test(x) ? 'FT/HR' : x; };
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
    const out = new Map(); const byMnem = {}, spliced = {}, both = {};
    parts.forEach((p, j) => {
      if (j && (p.depthUnit || 'ft') !== unit) notes.push(`${p.fileName} depths converted ${p.depthUnit} → ${unit}`);
      const maxGap = Math.max(medianStep(deps[j]) * 3, step * 1.5);
      for (const c of logs(p)) {
        const m = c.mnemonic.toUpperCase().replace(/:\d+$/, ''), u = unitKey(c.unit), key = m + '|' + u + '|' + (c.cased ? 'c' : '');
        const data = resample(deps[j], c.data, grid, maxGap);
        // Same curve, same unit: splice when the runs barely overlap (run 1 above run 2). Where they overlap a lot they
        // are different tools or passes (mud-log vs wireline GR), so both are kept and the user picks.
        let t = out.get(key), overlap = 0, have = 0, add = 0;
        if (t) { for (let i = 0; i < n; i++) { const a = Number.isFinite(t.data[i]), b = Number.isFinite(data[i]); if (a) have++; if (b) add++; if (a && b) overlap++; }
          if (overlap > Math.max(20, 0.1 * Math.min(have, add))) { const ok = p.fileName + '|' + t.sources[0]; (both[ok] = both[ok] || { a: t.sources[0], b: p.fileName, list: [], ov: 0 }).list.push(c.mnemonic.replace(/:\d+$/, '')); both[ok].ov = Math.max(both[ok].ov, overlap * step); t = null; } }
        if (!t) {
          byMnem[m] = (byMnem[m] || 0) + 1;
          t = { mnemonic: byMnem[m] > 1 ? c.mnemonic.replace(/:\d+$/, '') + ':' + byMnem[m] : c.mnemonic.replace(/:\d+$/, ''), unit: c.unit, description: c.description, note: c.note, cased: c.cased, data, sources: [p.fileName] };
          out.set(out.has(key) ? key + '#' + byMnem[m] : key, t); continue;
        }
        for (let i = 0; i < n; i++) if (Number.isFinite(data[i]) && !Number.isFinite(t.data[i])) t.data[i] = data[i];
        t.sources.push(p.fileName); const sk = p.fileName + '|' + t.sources[0]; (spliced[sk] = spliced[sk] || { a: t.sources[0], b: p.fileName, list: [], ov: 0 }).list.push(t.mnemonic); spliced[sk].ov = Math.max(spliced[sk].ov, overlap * step);
      }
    });
    for (const x of Object.values(both)) notes.push(`${x.b} overlaps ${x.a} over ${x.ov.toFixed(0)} ${unit} on ${x.list.length > 6 ? x.list.slice(0, 6).join(', ') + ` and ${x.list.length - 6} more` : x.list.join(', ')}: kept both`);
    for (const x of Object.values(spliced)) notes.push(`spliced ${x.list.join(', ')} from ${x.b} onto ${x.a}${x.ov > step * 2 ? ` (${x.ov.toFixed(0)} ${unit} overlap, ${x.a} kept)` : ''}`);
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

  /* ---------- MWD / LWD sensor offsets ----------
     Each sensor in a drilling string sits some distance behind the bit. Deliverables are normally shifted to sensor depth,
     but some are indexed at bit depth and carry the offsets in the header ("GR offset 45 ft", "bit to sensor"). */
  const OFF_TEXT = /OFFSET|OFFS\b|OFST|DIST(ANCE)?\s*(TO|FROM)\s*BIT|BIT\s*TO\s*(SENSOR|MEAS)|SENSOR\s*(TO\s*BIT|OFFSET|DIST)|MEAS(URE)?\s*POINT|\bBTS\b|MEMORY\s*OFFSET/i;
  const OFF_TOOLS = [['GR', /GR|GAMMA|GAM\b/i, /^(GR|GAM|SGR|CGR|GMG|GGR)/i], ['Resistivity', /RES|EWR|PHASE|ATTEN|\bRT\b|PROPAG/i, /^(R\d|RT|RES|RP|RA|P\d\d|A\d\d|RAC|RPC)/i],
    ['Density', /DEN|RHOB|AZD/i, /^(RHOB|DEN|DRHO|DCOR|PEF|DPOR|DPR)/i], ['Neutron', /NEU|NPHI|CTN|POROSITY/i, /^(NPHI|NPR|NEU|TNPH|NPOR)/i],
    ['Sonic', /SONIC|ACOUST|\bDT\b/i, /^(DT|AC)/i], ['Survey', /DIR|INC|SURV|D&I|\bMWD\b/i, /^(INC|AZI|DEVI)/i], ['Pressure', /PWD|PRESS|ECD/i, /^(ECD|APWD|PWD|ESD)/i]];
  function sensorOffsets(p, depthUnit) {
    const out = [], H = p.header, lim = depthUnit === 'm' ? 60 : 200;
    for (const x of [...Object.values(H.well), ...Object.values(H.params)]) {
      const text = `${x.mnem} ${x.desc}`; if (!OFF_TEXT.test(text) && !/(_OFF|OFF|OFST)$/i.test(x.mnem)) continue;
      const v = leadingNumber(x.value); if (!Number.isFinite(v) || v <= 0 || v > lim) continue;
      const t = OFF_TOOLS.find(([, re]) => re.test(text));
      out.push({ tool: t ? t[0] : 'Sensor', off: v, source: `${x.mnem}${x.unit ? '.' + x.unit : ''} ${x.value} : ${x.desc}`.trim(), curves: t ? p.curves.slice(1).filter(c => t[2].test(c.mnemonic)).map(c => c.mnemonic) : [] });
    }
    // Index recorded at the bit rather than at each sensor?
    const ref = [H.params.DREF?.value, H.params.DREF?.desc, H.well.DREF?.value, p.curves[0]?.description, H.params.INDX?.value, H.version.INDX?.value].join(' ');
    return { list: out, atBit: /\bBIT\b/i.test(ref) && !/SENSOR|CORRECT/i.test(ref) };
  }
  // Move one curve from bit depth to sensor depth: the value logged at bit depth D was measured at D - off.
  function shiftCurve(dep, data, off) { const d = Array.from(dep, v => v - off), st = medianStep(dep) || 1; return resample(d, data, dep, st * 3); }

  /* ---------- Well normalization ---------- */
  function normalizeWell(p, fileName) {
    const W = p.header.well, P = p.header.params;
    const h = k => W[k] ?? P[k];
    const g = k => h(k)?.value;
    // A generic ELEV/EREF that labels its numbers ("1313.49 GL, 1336.99' KB") is read by label below, not by its first number.
    const labeled = k => /^(ELEV|EREF)$/.test(k) && /\b(KB|RKB|DF|GL)\b/i.test(String(g(k) || ''));
    const num = (...ks) => { for (const k of ks) { if (labeled(k)) continue; const v = leadingNumber(g(k)); if (v !== undefined && !(k === 'EKB' && v === 0)) return v; } return undefined; };
    const notes = [];
    const dep = p.curves[0]; const du = String(dep?.unit || '').toUpperCase();
    const depthUnit = /^(M|METER|METERS|METRES?)$/.test(du) ? 'm' : 'ft';
    for (const c of p.curves) {
      const m = c.mnemonic.toUpperCase().replace(/:\d+$/, ''), u = (c.unit || '').toUpperCase();
      // Neutron and logged density porosity in porosity units become v/v. NPRL/NPRS/NPRD and DPRL/DPRS/DPRD are the
      // limestone, sandstone and dolomite versions many LWD and wireline vendors deliver side by side.
      if (/^(NPHI|TNPH|NPOR|PHIN|CNC|HNPO|NPHS|NPHL|TNPS|NPR[LSD]|DPHI|DPOR|DPR[LSD]|DPHZ)/.test(m)) { const med = median(c.data); if (/PU|%/.test(u) || med > 1.5) { c.data = c.data.map(v => v / 100); c.unit = 'V/V'; c.note = 'converted from pu'; } }
      if (/^(DT|DTC|DTCO|AC)$/.test(m) && /US\/M|USEC\/M/.test(u)) { c.data = c.data.map(v => v / 3.28084); c.unit = 'US/F'; c.note = 'converted from us/m'; }
      // Mud loggers often record drill time (minutes per foot) under ROP; tracks expect ft/hr.
      if (/^ROP/.test(m) && /^MIN/.test(u.replace(/[_\s]/g, ''))) { c.data = c.data.map(v => v > 0 ? 60 / v : NaN); c.unit = depthUnit === 'm' ? 'm/hr' : 'ft/hr'; c.note = 'converted from drill time (min/' + depthUnit + ')'; }
    }
    // A cement-bond or casing-inspection run logs gamma ray through casing, which reads low and shifted.
    const casedHole = p.curves.some(c => /^(CCL|CBL|BONDIX|BI|VDL|AMP|AMP3FT|AMPS\d|TT3FT|TT)$/i.test(c.mnemonic.replace(/:\d+$/, '')));
    if (casedHole) for (const c of p.curves) if (/^(GR|GRC|SGR|CGR|GRCO|GAMMA)/i.test(c.mnemonic)) { c.cased = true; c.description = ((c.description || '') + ' (cased hole)').trim(); }
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
    const coord = (...ks) => { for (const k of ks) { const c = parseCoord(g(k)); if (c) return c; } return undefined; };
    const cLat = coord('LATI', 'LAT', 'LATITUDE'), cLon = coord('LONG', 'LON', 'LONGITUDE');
    let lat = cLat?.v, lon = cLon?.v;
    if (cLat?.dms || cLon?.dms) notes.push('location read from degrees-minutes-seconds');
    if (lat === undefined) { const m = all.match(/LAT[A-Z]*\s*[:=]?\s*(-?\d+\.\d+)/i); if (m) lat = parseFloat(m[1]); }
    if (lon === undefined) { const m = all.match(/LON[A-Z]*\s*[:=]?\s*(-?\d+\.\d+)/i); if (m) lon = parseFloat(m[1]); }
    const westUS = /CALIFORNIA|COLORADO|WYOMING|UTAH|TEXAS|OKLAHOMA|KANSAS|NEW MEXICO|NORTH DAKOTA|MONTANA|\b(CA|CO|WY|UT|TX|OK|KS|NM|ND|MT)\b|UNITED STATES|USA/i.test(all);
    if (lon !== undefined && lon > 0 && westUS && !cLon?.hemi) { lon = -lon; notes.push('longitude read as west (no sign in the header)'); }
    const crsM = all.match(/NAD\s*(27|83)/i); const zoneM = all.match(/ZONE\s*(\d)/i);
    const crs = g('GDAT') || (crsM ? `NAD${crsM[1]}${zoneM ? ' · State Plane Zone ' + zoneM[1] : ''}` : 'unknown');
    const matr = String(g('MATR') || g('NMAT') || g('DPOR') || '').toUpperCase();
    const mn = new Set(p.curves.map(c => c.mnemonic.toUpperCase())), nprM = ['NPRL', 'NPRS', 'NPRD'].find(m => mn.has(m));   // same order as the NPHI aliases
    const neutronMatrix = !matr && nprM ? { L: 'limestone', S: 'sandstone', D: 'dolomite' }[nprM[3]] : /SAND|SS|QUARTZ/.test(matr) ? 'sandstone' : /DOL/.test(matr) ? 'dolomite' : /LIME|LS|CALC/.test(matr) ? 'limestone' : null;
    let survey = parseSurvey(p.header.other);
    // No survey but a TVD curve (common in MWD deliverables): use it for TVD. Inclination follows from dTVD/dMD.
    const tvdC = !survey && p.curves.find(c => /^(TVD|TVDM|TVD_MD)$/i.test(c.mnemonic));
    if (tvdC) { const md = [], tvd = [], d = p.curves[0].data, stride = Math.max(1, Math.floor(d.length / 2000));
      for (let i = 0; i < d.length; i += stride) if (Number.isFinite(tvdC.data[i]) && tvdC.data[i] <= d[i] + 1) { md.push(d[i]); tvd.push(tvdC.data[i]); }
      if (md.length > 2 && tvd[tvd.length - 1] < md[md.length - 1] - 1) {
        const inc = md.map((m, i) => { const j = Math.min(i + 1, md.length - 1), k = j === i ? i - 1 : i; const dm = md[j] - md[k]; return dm > 0 ? Math.acos(Math.max(-1, Math.min(1, (tvd[j] - tvd[k]) / dm))) * 180 / Math.PI : 0; });
        survey = { md: Float64Array.from(md), tvd: Float64Array.from(tvd), inc: Float64Array.from(inc), azi: new Float64Array(md.length), fromCurve: tvdC.mnemonic };
        notes.push(`TVD from the ${tvdC.mnemonic} curve`); } }
    const offsets = sensorOffsets(p, depthUnit);
    if (offsets.list.length && offsets.atBit) for (const o of offsets.list) for (const m of o.curves) { const c = p.curves.find(x => x.mnemonic === m); if (c) { c.data = shiftCurve(p.curves[0].data, c.data, o.off); c.note = `shifted ${o.off} ${depthUnit} from bit to sensor depth`; o.applied = true; } }
    const clean = s => String(s || '').replace(/^(WELL|COMPANY|FIELD|API NUMBER):\s*/i, '').trim();
    let api = [g('API'), g('APIN'), g('UWI')].map(clean).find(v => v && !/enter|^-$/i.test(v)) || '', name = clean(g('WELL')) || fileName.replace(/\.las$/i, '');
    // Regulator downloads (CalGEM, WOGCC, …) name files by API. Vendors copy ~Well from the neighbouring well, so a file-name
    // API that names a different well wins, and the well name after it too, or the file merges into the wrong well.
    const fn = String(fileName || '').match(/^(\d{10}(?:\d{2}){0,2})(?=\D|$)[\s_-]*([^_]*)/), fk = fn && apiKey(fn[1]), hk = apiKey(api);
    if (fk && !hk) { api = fn[1]; notes.push(`API ${fmtApi(fk)} read from the file name`); }
    else if (fk && hk?.us && hk.well !== fk.well) {
      const fname = fn[2].replace(/\.las$/i, '').trim(), useName = /[A-Z]/i.test(fname) && /\d/.test(fname) && nameKey(fname) !== nameKey(name);
      notes.push(`header API ${fmtApi(hk)}${useName ? ` and name ${name}` : ''} disagree with the file name (${fmtApi(fk)}${useName ? ' ' + fname : ''}); file name used, header ignored`);
      api = fn[1]; if (useName) name = fname; }
    const w = {
      id: 'u' + Math.random().toString(36).slice(2, 8), name,
      api, fileName,
      location: { lat, lon, crs }, elevation: { kb: kbSuspect ? undefined : kb, kbRecorded: kb, gl, kbSuspect, unit: depthUnit },
      field: clean(g('FLD')), company: clean(g('COMP')), county: clean(g('CNTY') || g('COUN')), state: clean(g('STAT') || g('PROV')),
      meta: { location: clean(g('LOC')), spud: clean(g('SPUD') || g('SPD') || g('SPDT')), logDate: clean(g('DATE')), service: clean(g('SRVC')), country: clean(g('CTRY')) },
      notes, depthUnit, curves: p.curves, tops, wrap: p.wrap, nullv: p.nullv, rows: p.rows, reversed: p.reversed,
      neutronMatrix, survey, casedHole, sensorOffsets: offsets,
      params: { bht: num('BHT', 'MXT', 'BHTEMP'), td: num('TDL', 'TDD', 'TD'), bitSize: num('BS', 'BIT'), rmf: num('RMF'), rm: num('RM', 'RMS') },
    };
    const place = fillPlace(w); if (place.length) notes.push(place.join(', ') + ' from the API number');
    return w;
  }

  // The elevation that depths hang from: KB when plausible, else GL (flagged), else none.
  function datumElevation(w) { const e = w.elevation || {}; return Number.isFinite(e.kb) ? e.kb : Number.isFinite(e.gl) ? e.gl : undefined; }

  root.WellerLAS = { parseLAS, diagnoseLAS, sniffBinary, apiKey, apiPlace, fillPlace, nameKey, parseCoord, fmtApi, mergeWells, resample, shiftCurve, sensorOffsets, LAS_TEMPLATE, normalizeWell, parseSurvey, minCurvatureTVD, tvdAt, datumElevation, median, leadingNumber, parseHeaderLine };
})(typeof globalThis !== 'undefined' ? globalThis : this);
