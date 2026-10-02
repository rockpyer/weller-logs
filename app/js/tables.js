/* Tables: tops and well-header spreadsheets (CSV, tab-delimited, pasted cells or .xlsx) read into well records.
   Columns are recognized by name, so a sheet exported from Petrel, Petra or a state database loads without
   renaming. Rows from several files merge; values that agree collapse, values that differ become conflicts for the
   person to settle. Pure functions: runs in the browser (global WellerTables) and in Node (tests). */
(function (root) {
  const LAS = () => root.WellerLAS;

  /* ---------- Delimited text ---------- */
  // Tab, semicolon or comma, picked from the header line. Quoted fields may hold the delimiter, quotes and line breaks.
  function readDelimited(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const head = text.split('\n').find(l => l.trim()) || '';
    const count = ch => head.split(ch).length - 1;
    const delim = count('\t') > 0 && count('\t') >= count(',') ? '\t' : count(';') > count(',') ? ';' : ',';
    const out = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
      if (c === '"' && f === '') q = true;
      else if (c === delim) { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); out.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); out.push(row); }
    const rows = out.map(r => r.map(v => v.trim())).filter(r => r.some(v => v !== ''));
    const columns = rows.shift() || [];
    return { delim, columns, rows: rows.map(r => columns.map((_, i) => r[i] ?? '')) };
  }
  function toCSV(t) { const q = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v; return [t.columns, ...t.rows].map(r => r.map(q).join(',')).join('\n') + '\n'; }

  /* ---------- Column names ---------- */
  // "Top (ft MD)" -> "top ft md"; the unit in brackets is kept separately.
  const normCol = c => String(c || '').toLowerCase().replace(/[_/\\|()[\]{}.,:#–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
  function unitOf(c) { const m = String(c).match(/\b(ft|feet|foot|m|meters?|metres?)\b/i); return m ? (/^f/i.test(m[1]) ? 'ft' : 'm') : ''; }
  const has = (c, re) => re.test(' ' + c + ' ');

  // Header fields, in the order they are tried. kind: text, num (elevation or depth, unit-aware), deg, xy, date.
  const HEADER_FIELDS = [
    { key: 'name', label: 'Well name', kind: 'text', re: /^(well|well ?name|wellname|name|well id|well label|borehole( name)?|wellbore( name)?)$/ },
    { key: 'alias', label: 'Short name', kind: 'text', re: /^(short ?name|alias|common name|well short name|lease ?name)$/ },
    { key: 'api', label: 'API', kind: 'text', re: / (api|uwi)( |\d)/ },
    { key: 'company', label: 'Operator', kind: 'text', re: / (operator|company) / },
    { key: 'field', label: 'Field', kind: 'text', re: /^field( name)?$/ },
    { key: 'county', label: 'County', kind: 'text', re: /^(county|parish|borough)( name)?$/ },
    { key: 'state', label: 'State', kind: 'text', re: /^(state|province)( name)?$/ },
    { key: 'kbgl', label: 'KB above GL', kind: 'num', re: / (kb ?(gl|minus gl|above gl|to gl)|gl ?kb|air gap|rig height|kb height|kelly height) / },
    { key: 'datumRef', label: 'Depth datum', kind: 'text', re: / ((depth|elevation|log|reference|vertical|permanent) datum|datum (type|reference|vertical|depth|elev\w*)) / },
    { key: 'kb', label: 'KB', kind: 'num', re: / (kb|rkb|kbe|ekb|kelly|rotary table|rt elev\w*) / },
    { key: 'gl', label: 'GL', kind: 'num', re: / (gl|gle|egl|ground|ground level|surface elev\w*) / },
    { key: 'lat', label: 'Latitude', kind: 'deg', re: /^(surface |shl |bh |top hole )?(lat|latitude)( |$)/ },
    { key: 'lon', label: 'Longitude', kind: 'deg', re: /^(surface |shl |bh |top hole )?(lon|long|longitude)( |$)/ },
    { key: 'x', label: 'Surface X', kind: 'xy', re: /^(surface |shl )?(x|easting|x coord\w*)( |$)/ },
    { key: 'y', label: 'Surface Y', kind: 'xy', re: /^(surface |shl )?(y|northing|y coord\w*)( |$)/ },
    { key: 'crs', label: 'CRS', kind: 'text', re: / (crs|epsg|coordinate (system|reference)|projection|geodetic datum|horizontal datum|spatial reference|datum) / },
    { key: 'spud', label: 'Spud', kind: 'date', re: / spud/ },
    { key: 'completed', label: 'Completed', kind: 'date', re: / (completion|completed) date | completed / },
    { key: 'status', label: 'Status', kind: 'text', re: / status / },
    { key: 'type', label: 'Type', kind: 'text', re: /^(well )?(type|purpose|class|classification|well type)( |$)/ },
    { key: 'tdTVD', label: 'TD (TVD)', kind: 'num', re: / (td|total depth|total vertical depth) .*tvd | tvd td | tvd total depth / },
    { key: 'tdMD', label: 'TD (MD)', kind: 'num', re: / (td|total depth|tmd|drilled depth|driller td|logger td) / },
  ];
  const FIELD = Object.fromEntries(HEADER_FIELDS.map(f => [f.key, f]));

  // One field per column (first match); a second API column is kept too, since a sheet often has API 10 and API 12.
  function classifyColumns(columns) {
    const out = columns.map((raw, i) => ({ i, raw, n: normCol(raw), unit: unitOf(raw), key: null }));
    for (const c of out) { const f = HEADER_FIELDS.find(f => has(c.n, f.re) || f.re.test(c.n)); if (f) c.key = f.key; }
    // Tops: a top name and its measured depth. "Top (ft MD)" is a depth, not a name.
    for (const c of out) {
      const depthy = has(c.n, / (md|tvd|tvdss|depth|ft|m|elev\w*|subsea|ss) /);
      if (has(c.n, / tvd(ss)? | subsea | ss /) && has(c.n, / (top|pick|marker|depth) /)) c.top = 'tvd';
      else if (has(c.n, / (md|measured depth|measured) /) || /^(depth|top depth|depth ft|md ft|top md|pick depth|marker depth)$/.test(c.n)) c.top = 'md';
      else if (!depthy && /^(top|tops|formation|formation top|marker|pick|horizon|surface|zone|unit|formation name|top name|marker name|marker formation top|formation marker|stratigraphic unit)$/.test(c.n)) c.top = 'name';
      else if (!depthy && /^(marker|top|pick|horizon|formation)/.test(c.n) && !/ (type|kind|class|source|comment|note|interpreter|quality|color|colour) /.test(' ' + c.n + ' ')) c.top = c.top || 'name?';
    }
    return out;
  }
  const textual = (t, i) => { const v = t.rows.map(r => r[i]).filter(Boolean); return v.length > 0 && v.filter(x => !Number.isFinite(+x)).length / v.length > 0.6; };

  // What a table holds: tops (top name + MD), header (one row per well), points (depth + values) or nothing usable.
  function classify(t) {
    const cols = classifyColumns(t.columns);
    const name = cols.find(c => c.top === 'name' && textual(t, c.i)) || cols.find(c => c.top === 'name?' && textual(t, c.i));
    const md = cols.find(c => c.top === 'md' && c !== name);
    if (name && md) return { kind: 'tops', cols, name, md, tvd: cols.find(c => c.top === 'tvd') };
    const id = cols.some(c => c.key === 'name' || c.key === 'api' || c.key === 'alias');
    const fields = new Set(cols.filter(c => c.key && !['name', 'alias', 'api'].includes(c.key)).map(c => c.key));
    if (id && fields.size >= 2 && !cols.some(c => /^(md|depth|dept|sample depth|md ft|depth ft)$/.test(c.n))) return { kind: 'header', cols };
    if (cols.some(c => /^(md|depth|md ft|md \w+|depth \w+|depth_ft|measured|sample depth)/.test(c.n))) return { kind: 'points', cols };
    return { kind: 'unknown', cols };
  }

  /* ---------- Values ---------- */
  // A US API that lost its leading zero in a spreadsheet (California is 04): 9, 11 or 13 digits.
  function cleanApi(v) { const s = String(v || '').trim(); if (!s) return ''; const d = s.replace(/\D/g, '');
    return /^[\d\s-]+$/.test(s) && [9, 11, 13].includes(d.length) && d[0] !== '0' ? '0' + d : s; }
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');
  // ISO where the date is unambiguous (2021-04-22, 4/22/2021, 22-Apr-2021, an Excel serial); else the text as written.
  function cleanDate(v) {
    const s = String(v ?? '').trim(); if (!s) return '';
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;   // US order
    if ((m = s.match(/^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s,]+(\d{4})$/i)) && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
    if (/^\d{5}(\.\d+)?$/.test(s) && +s > 10000 && +s < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return d.toISOString().slice(0, 10); }
    return s;
  }
  function num(v) { const s = String(v ?? '').replace(/,/g, '').trim(); if (!s) return NaN; const m = s.match(/^[-+]?\d*\.?\d+(e[-+]?\d+)?/i); return m ? +m[0] : NaN; }
  const FT = 0.3048;
  function convert(v, from, to) { if (!from || !to || from === to) return v; return from === 'm' ? v / FT : v * FT; }
  // Coordinates within ~5 m and elevations within 0.05 ft are the same well spot, not a choice to make.
  const TOL = { num: 0.05, deg: 5e-5, xy: 0.05 };
  // Two values are the same when numbers agree within the field's tolerance or text agrees ignoring case and spacing.
  function same(kind, a, b) {
    if (a === b) return true; if (a == null || b == null || a === '' || b === '') return false;
    if (TOL[kind] != null) return Math.abs(+a - +b) <= TOL[kind];
    if (kind === 'api') { const A = LAS().apiKey(a), B = LAS().apiKey(b); return !!A && !!B && A.well === B.well && (A.bore === B.bore || !A.explicitBore || !B.explicitBore); }
    // "Honor Rancho" and "Honor Rancho, Los Angeles County, CA" name the same thing: the longer one adds detail.
    const A = String(a).trim().replace(/\s+/g, ' ').toLowerCase(), B = String(b).trim().replace(/\s+/g, ' ').toLowerCase();
    return A === B || (A.length > 2 && B.length > 2 && (A.startsWith(B + ',') || B.startsWith(A + ',')));
  }
  const fmt = (kind, v) => v == null || v === '' ? '—' : kind === 'num' || kind === 'xy' ? String(Math.round(+v * 100) / 100) : kind === 'deg' ? (+v).toFixed(6) : String(v);

  /* ---------- Rows -> records ---------- */
  function ident(t, cols, r) {
    const get = k => cols.filter(c => c.key === k).map(c => r[c.i]).filter(Boolean);
    const apis = get('api').map(cleanApi).sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length);
    return { name: get('name')[0] || '', alias: get('alias')[0] || '', api: apis[0] || '' };
  }
  // A projected CRS belongs to X/Y; a geographic one (NAD27, NAD83, WGS84) to latitude and longitude.
  const PRIORITY = /\b(final|truth|verified|approved|corrected|preferred|official|qc|qcd)\b/;
  const projected = s => /(state ?plane|utm|zone|ftus|us ?ft|feet|meters|metre|spcs|lambert|mercator|albers|\/\s*\w)/i.test(s);

  // Header rows: one record per row with the recognized fields and the other columns as named attributes.
  function headerRecords(t, cls, source) {
    return t.rows.map((r, k) => {
      const id = ident(t, cls.cols, r), cand = {}, attrs = {};
      for (const c of cls.cols) {
        const v = r[c.i]; if (v === '' || v == null) continue;
        if (!c.key) { attrs[c.raw.trim() || `Column ${c.i + 1}`] = v; continue; }
        if (['name', 'api'].includes(c.key)) continue;
        const f = FIELD[c.key]; let x;
        if (f.kind === 'num') { x = num(v); if (c.key === 'kbgl') x = Math.abs(x); }   // "GL-KB" is often written as a positive height
        else if (f.kind === 'deg') x = LAS().parseCoord(v)?.v;
        else if (f.kind === 'xy') x = num(v);
        else if (f.kind === 'date') x = cleanDate(v);
        else if (c.key === 'alias') { if (LAS().nameKey(v) === LAS().nameKey(id.name)) continue; x = v; }
        else x = v;
        if (typeof x === 'number' && !Number.isFinite(x)) continue;
        (cand[c.key] = cand[c.key] || []).push({ v: x, unit: c.unit, col: c.raw.trim(), prio: PRIORITY.test(c.n) });
      }
      // Two columns for one field ("GLE - extracted", "GL - final truth"): a column marked final, verified or
      // corrected wins; otherwise each distinct value is offered, named by its column.
      const vals = {};
      for (const [k, L] of Object.entries(cand)) { const P = L.filter(x => x.prio), use = P.length ? P.slice(0, 1) : L, out = [];
        for (const x of use) if (!out.some(y => same(FIELD[k].kind, y.v, x.v))) out.push(x);
        if (out.length === 1 || L.length === 1) out.forEach(x => delete x.col);
        vals[k] = out; }
      if (vals.crs) { const geo = vals.crs.filter(x => !projected(x.v)), proj = vals.crs.filter(x => projected(x.v)); delete vals.crs; if (geo.length) vals.crs = geo; if (proj.length) vals.xyCrs = proj; }
      return { ...id, vals, attrs, source, line: k + 2 };
    });
  }
  function topRecords(t, cls, source) {
    return t.rows.map((r, k) => ({ ...ident(t, cls.cols, r), top: r[cls.name.i], md: num(r[cls.md.i]), unit: cls.md.unit, source, line: k + 2 }))
      .filter(x => x.top && Number.isFinite(x.md));
  }

  /* ---------- Matching rows to open wells ---------- */
  // API first (same borehole: first 10 digits, and the sidetrack code when both give one), then name or short name.
  function matchWell(wells, rec) {
    const k = rec.api && LAS().apiKey(rec.api);
    if (k?.us) { const hit = wells.filter(w => { const wk = LAS().apiKey(w.api); return wk?.us && wk.well === k.well && (!k.explicitBore || !wk.explicitBore || wk.bore === k.bore); });
      if (hit.length === 1) return hit[0];
      if (hit.length > 1) { const byBore = hit.filter(w => LAS().apiKey(w.api).bore === (k.bore || '00')); if (byBore.length === 1) return byBore[0]; } }
    for (const n of [rec.name, rec.alias]) { if (!n) continue; const nk = LAS().nameKey(n); const w = wells.find(w => LAS().nameKey(w.name) === nk || LAS().nameKey(w.header?.alias) === nk); if (w) return w; }
    return null;
  }

  /* ---------- Plan: what changes, what agrees, what needs a choice ---------- */
  // Each item: well, field, current value, the distinct values the files give (with where each came from).
  // Items with one value that equals the current one are dropped; one new value onto a blank is a fill; everything
  // else is a conflict. A conflict's default is the value most rows agree on (ties: the first), never a blank.
  function current(w, key) {
    const e = w.elevation || {}, l = w.location || {}, h = w.header || {};
    if (key === 'kb' || key === 'gl') return e[key]; if (key === 'lat' || key === 'lon' || key === 'crs') return l[key];
    if (['company', 'field', 'county', 'state', 'api'].includes(key)) return w[key] || undefined;
    if (key === 'spud') return h.spud || w.meta?.spud || undefined;
    if (key === 'tdMD') return h.tdMD ?? (Number.isFinite(w.params?.td) ? w.params.td : undefined);
    return h[key];
  }
  const blank = v => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));

  function plan(wells, tables) {
    const items = new Map(), unmatched = new Map(), notes = []; let rows = 0, dups = 0;
    const add = (w, key, label, kind, value, src) => {
      const id = w.id + '\u0000' + key; let it = items.get(id);
      if (!it) items.set(id, it = { wid: w.id, well: w.name, key, label, kind, current: key.startsWith('top:') ? w.tops.find(t => t.name === key.slice(4))?.md : current(w, key), values: [] });
      const ex = it.values.find(x => same(kind, x.value, value));
      if (ex) { ex.n++; if (!ex.from.includes(src)) ex.from.push(src); dups++; } else it.values.push({ value, n: 1, from: [src] });
    };
    for (const t of tables) {
      const short = t.source.replace(/^.*[\\/]/, '');
      if (t.kind === 'tops') for (const r of t.records) {
        rows++; const w = matchWell(wells, r); if (!w) { unmatched.set(r.name || r.alias || r.api || '?', (unmatched.get(r.name || r.alias || r.api || '?') || 0) + 1); continue; }
        add(w, 'top:' + r.top, r.top, 'num', convert(r.md, r.unit, unitKey(w)), `${short}:${r.line}`);
      }
      if (t.kind === 'header') for (const r of t.records) {
        rows++; const w = matchWell(wells, r); if (!w) { const n = r.name || r.alias || r.api || '?'; unmatched.set(n, (unmatched.get(n) || 0) + 1); continue; }
        const src = `${short}:${r.line}`;
        if (r.api) add(w, 'api', 'API', 'api', r.api, src);
        for (const [k, L] of Object.entries(r.vals)) { const f = FIELD[k] || { label: k === 'xyCrs' ? 'X/Y CRS' : k, kind: 'text' };
          for (const o of L) add(w, k, f.label, f.kind === 'date' ? 'text' : f.kind, f.kind === 'num' ? convert(o.v, o.unit, unitKey(w)) : o.v, o.col ? `${src} (${o.col})` : src); }
        for (const [k, v] of Object.entries(r.attrs)) add(w, 'attr:' + k, k, 'text', v, src);
      }
    }
    const fills = [], conflicts = [], same_ = [];
    for (const it of items.values()) {
      it.values.sort((a, b) => b.n - a.n);
      const cur = blank(it.current) ? null : it.current;
      // An API that names the same borehole with more digits is an upgrade, not a disagreement.
      if (it.key === 'api' && cur != null && it.values.length === 1 && same('api', cur, it.values[0].value)) {
        if (it.values[0].value.replace(/\D/g, '').length > String(cur).replace(/\D/g, '').length) fills.push({ ...it, value: it.values[0].value }); else same_.push(it); continue; }
      if (it.values.length === 1 && (cur == null || same(it.kind, cur, it.values[0].value))) { if (cur == null) fills.push({ ...it, value: it.values[0].value }); else same_.push(it); continue; }
      const opts = it.values.map(x => ({ value: x.value, label: fmt(it.kind, x.value), from: x.from, n: x.n }));
      if (cur != null && !opts.some(o => same(it.kind, o.value, cur))) opts.unshift({ value: cur, label: fmt(it.kind, cur), current: true, from: [], n: 0 });
      else if (cur != null) opts.find(o => same(it.kind, o.value, cur)).current = true;
      const fileOpts = opts.filter(o => !o.current || o.n);
      const pick = fileOpts.length > 1 && fileOpts[0].n === fileOpts[1].n && cur != null ? opts.findIndex(o => o.current) : opts.indexOf(fileOpts[0]);
      conflicts.push({ ...it, options: opts, choice: pick < 0 ? 0 : pick });
    }
    // KB from GL plus the rig height, and a check when all three are given.
    for (const w of wells) {
      const val = k => { const it = items.get(w.id + '\u0000' + k); return it ? (fills.find(f => f.wid === w.id && f.key === k)?.value ?? (blank(it.current) ? undefined : it.current)) : current(w, k); };
      const kb = val('kb'), gl = val('gl'), kbgl = val('kbgl');
      if (Number.isFinite(gl) && Number.isFinite(kbgl) && !Number.isFinite(kb) && !conflicts.some(c => c.wid === w.id && c.key === 'kb')) { fills.push({ wid: w.id, well: w.name, key: 'kb', label: 'KB', kind: 'num', value: Math.round((gl + kbgl) * 100) / 100, derived: 'GL + KB above GL' }); }
      else if ([kb, gl, kbgl].every(Number.isFinite) && Math.abs(kb - gl - kbgl) > 0.5) notes.push(`${w.name}: KB ${fmt('num', kb)} minus GL ${fmt('num', gl)} is ${fmt('num', kb - gl)}, but the sheet gives KB above GL as ${fmt('num', kbgl)}`);
    }
    return { fills, conflicts, same: same_, unmatched: [...unmatched].map(([name, n]) => ({ name, n })), rows, dups, notes };
  }
  const unitKey = w => /^m/i.test(w.depthUnit || '') ? 'm' : 'ft';

  // Write one chosen value into the well where the app keeps it.
  function applyValue(w, key, value) {
    if (key.startsWith('top:')) { const name = key.slice(4), t = w.tops.find(t => t.name === name); if (t) t.md = value; else w.tops.push({ name, md: value, source: 'import' }); return; }
    if (key.startsWith('attr:')) { (w.attrs = w.attrs || {})[key.slice(5)] = value; return; }
    if (key === 'kb' || key === 'gl') { (w.elevation = w.elevation || {})[key] = value; return; }
    if (key === 'lat' || key === 'lon' || key === 'crs') { (w.location = w.location || {})[key] = value; return; }
    if (['company', 'field', 'county', 'state', 'api'].includes(key)) { w[key] = value; return; }
    (w.header = w.header || {})[key] = value;
  }

  /* ---------- What is this table? A guess plus a column map the person can correct ---------- */
  // Kinds: tops, header, events (labeled depths: corrosion, perforations, shows; one depth or a top and base),
  // points (depth plus numeric measurements: core, XRD, pressures), survey (MD, inclination, azimuth).
  // sure: false means the import asks "What's in this file?" before loading anything.
  const DATEY = /\b(date|time|year|day)\b/;
  function guess(t) {
    const cls = classify(t), cols = cls.cols, n = t.rows.length;
    const vals = i => t.rows.map(r => r[i]).filter(v => v !== '' && v != null);
    const numeric = i => { const v = vals(i); return v.length > 0 && v.filter(x => Number.isFinite(num(x)) && /^[-+]?[\d.,]+(e[-+]?\d+)?$/i.test(x.replace(/\s/g, ''))).length / v.length > 0.8; };
    const find = (re, ok = () => true) => cols.find(c => re.test(c.n) && ok(c));
    const idCol = k => cols.find(c => c.key === k);
    const well = idCol('name'), api = idCol('api'), alias = idCol('alias');
    const used = new Set([well, api, alias].filter(Boolean));
    const depthy = c => numeric(c.i) && !used.has(c);
    const inc = find(/^(inc|incl|inclination|dev|deviation|hole angle)( deg\w*)?$/, depthy), azi = find(/^(az|azi|azm|azim|azimuth)( deg\w*| true| grid)?$/, depthy);
    const isBase = c => / (base|bottom|btm|bot|end|to) /.test(' ' + c.n + ' ');
    const depthCols = cols.filter(c => depthy(c) && c !== inc && c !== azi && / (md|tvd|tvdss|sstvd|subsea|ss|depth|dept|measured|top|base|bottom|btm|from|to) /.test(' ' + c.n + ' ') && !/ (elev\w*|kb|gl|td) /.test(' ' + c.n + ' '));
    const top = depthCols.find(c => !isBase(c) && / md /.test(' ' + c.n + ' ')) || depthCols.find(c => !isBase(c)) || null;
    // TVDSS (TVD minus KB, positive down) before TVD: "TVD SS" names both.
    const refOf = c => / md /.test(' ' + c.n + ' ') ? 'MD' : / (tvdss|tvd ss|sstvd|ss tvd|subsea|sub sea|ss) /.test(' ' + c.n + ' ') ? 'TVDSS' : / tvd /.test(' ' + c.n + ' ') ? 'TVD' : 'MD';
    const base = depthCols.find(c => c !== top && isBase(c) && (!top || refOf(top) === refOf(c))) || null;
    const ref = top ? refOf(top) : 'MD';
    if (top) used.add(top); if (base) used.add(base);
    // The class column: text with few distinct values, preferably named like one ("Point_Label", "Event", "Type").
    const textCols = cols.filter(c => !used.has(c) && !numeric(c.i) && !DATEY.test(c.n) && vals(c.i).length);
    const distinct = c => new Set(vals(c.i)).size;
    const labelRe = /\b(label|class|category|code|event|feature|point|kind|type|description|desc|marker|top|formation|name|show|remark)\b/;
    const fewish = c => distinct(c) <= Math.max(2, Math.min(40, n / 2));
    const label = textCols.find(c => labelRe.test(c.n) && fewish(c)) || textCols.find(fewish) || textCols[0] || null;
    const values = cols.filter(c => !used.has(c) && c !== inc && c !== azi && numeric(c.i) && !DATEY.test(c.n) && c.key !== 'api').map(c => c.i);
    const map = { well: well?.i ?? null, api: api?.i ?? null, alias: alias?.i ?? null, label: label?.i ?? null, top: top?.i ?? null, base: base?.i ?? null, ref, inc: inc?.i ?? null, azi: azi?.i ?? null, values };
    // A tops sheet repeats each top once per well. A label repeated many times in one well is events, not tops.
    const repeats = () => { if (map.label == null) return 0; const k = new Map(); for (const r of t.rows) { const key = (r[map.well] ?? r[map.api] ?? '') + '\u0000' + r[map.label]; k.set(key, (k.get(key) || 0) + 1); } return d3median([...k.values()]); };
    let kind, sure = false;
    if (cls.kind === 'tops') { map.label = cls.name.i; map.top = cls.md.i; map.ref = 'MD'; kind = repeats() > 2 ? 'events' : 'tops'; sure = kind === 'tops'; }
    else if (cls.kind === 'header') { kind = 'header'; sure = true; }
    else if (inc && azi && top) kind = 'survey';
    else if (top && map.label != null && (!values.length || base)) kind = 'events';
    else if (top && values.length) kind = 'points';
    else if (top) kind = 'events';
    else kind = 'unknown';
    return { kind, sure, map, cls, columns: t.columns };
  }
  const d3median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // Records for a kind and a column map (from guess(), possibly corrected by the person).
  // Well identity comes from the map, so a column the header rules missed can still name the well.
  function mapRecords(t, kind, map, source) {
    const cell = (r, i) => i == null || i < 0 ? '' : String(r[i] ?? '').trim();
    const id = r => ({ name: cell(r, map.well), alias: cell(r, map.alias), api: cleanApi(cell(r, map.api)) });
    const skip = new Set([map.well, map.api, map.alias, map.label, map.top, map.base, map.inc, map.azi, ...(map.values || [])].filter(i => i != null));
    if (kind === 'header') {
      const cols = classifyColumns(t.columns).map(c => ({ ...c, key: ['name', 'api', 'alias'].includes(c.key) ? null : c.key }));
      for (const k of ['well', 'api', 'alias']) if (map[k] != null && cols[map[k]]) cols[map[k]].key = k === 'well' ? 'name' : k;
      return headerRecords(t, { cols }, source);
    }
    const out = [];
    t.rows.forEach((r, k) => {
      const line = k + 2, top = num(cell(r, map.top));
      if (!Number.isFinite(top)) return;
      if (kind === 'tops') { const name = cell(r, map.label); if (name) out.push({ ...id(r), top: name, md: top, unit: unitOf(t.columns[map.top] || ''), source, line }); return; }
      if (kind === 'survey') { const inc = num(cell(r, map.inc)), azi = num(cell(r, map.azi)); if (Number.isFinite(inc) && Number.isFinite(azi)) out.push({ ...id(r), md: top, inc, azi, line }); return; }
      const base = num(cell(r, map.base));
      const note = t.columns.map((c, i) => skip.has(i) || !cell(r, i) ? '' : `${c}: ${cell(r, i)}`).filter(Boolean).join(' · ');
      const rec = { ...id(r), top, base: Number.isFinite(base) ? base : top, label: cell(r, map.label), note, line };
      if (kind === 'points') rec.values = Object.fromEntries((map.values || []).map(i => [t.columns[i], num(cell(r, i))]));
      out.push(rec);
    });
    return out;
  }

  // Read a table's text and turn it into records. kind 'points' and 'unknown' carry the table for the caller.
  function readTable(text, source) {
    const t = readDelimited(text), cls = classify(t);
    if (cls.kind === 'tops') return { kind: 'tops', source, records: topRecords(t, cls, source), table: t, cls };
    if (cls.kind === 'header') return { kind: 'header', source, records: headerRecords(t, cls, source), table: t, cls };
    return { kind: cls.kind, source, table: t, cls };
  }
  const isTable = text => { const t = readDelimited(text); return t.columns.length >= 2 && t.rows.length >= 1; };

  /* ---------- .xlsx: every sheet becomes a table (tab-delimited text), dates as ISO ---------- */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw'); const s = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function unzip(buf) {
    const b = new Uint8Array(buf), dv = new DataView(buf), files = {};
    let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a ZIP file');
    let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true), dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = b.subarray(start, start + size);
      files[name] = async () => dec.decode(method === 0 ? raw : await inflateRaw(raw));
    }
    return files;
  }
  const DATE_FMTS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
  async function readXlsx(buf, parseXML) {
    const z = await unzip(buf), get = async n => z[n] ? parseXML(await z[n]()) : null;
    const strings = [...((await get('xl/sharedStrings.xml'))?.getElementsByTagName('si') || [])].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
    const styles = await get('xl/styles.xml'), custom = {};
    for (const f of styles?.getElementsByTagName('numFmt') || []) custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || '';
    const xfs = styles?.getElementsByTagName('cellXfs')[0], dateXf = [...(xfs?.getElementsByTagName('xf') || [])].map(x => { const id = +x.getAttribute('numFmtId'); return DATE_FMTS.has(id) || (custom[id] != null && /[dy]/i.test(custom[id].replace(/\[[^\]]*\]|"[^"]*"/g, ''))); });
    const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels'), target = {};
    for (const r of rels?.getElementsByTagName('Relationship') || []) target[r.getAttribute('Id')] = r.getAttribute('Target').replace(/^\/?(xl\/)?/, 'xl/');
    const sheets = [...(wb?.getElementsByTagName('sheet') || [])].map(s => ({ name: s.getAttribute('name'), path: target[s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')] }));
    const col = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const out = [];
    for (const s of sheets) {
      const doc = await get(s.path); if (!doc) continue; const grid = [];
      for (const row of doc.getElementsByTagName('row')) {
        const r = []; for (const c of row.getElementsByTagName('c')) {
          const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '', i = col(c.getAttribute('r') || 'A');
          let val = t === 's' ? strings[+v] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
          if (!t && v !== '' && dateXf[+c.getAttribute('s') || 0]) val = cleanDate(v);
          r[i] = String(val).replace(/[\t\n\r]+/g, ' ');
        }
        grid[(+row.getAttribute('r') || grid.length + 1) - 1] = r;
      }
      const rows = grid.filter(r => r && r.some(v => v)); if (rows.length < 2) continue;
      const w = Math.max(...rows.map(r => r.length));
      out.push({ name: s.name, text: rows.map(r => Array.from({ length: w }, (_, i) => r[i] ?? '').join('\t')).join('\n') + '\n' });
    }
    return out;
  }

  root.WellerTables = { convert, unitKey, readDelimited, toCSV, classifyColumns, classify, guess, mapRecords, readTable, isTable, plan, applyValue, matchWell, cleanApi, cleanDate, same, fmt, readXlsx, unzip, HEADER_FIELDS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
