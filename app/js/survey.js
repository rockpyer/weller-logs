/* Directional surveys from their own files: CSV, tab-delimited, fixed-width text reports, pasted cells or .xlsx sheets.
   Columns are found by name (MD, Inc, Azi, and TVD, N/S, E/W when given), wherever the header row sits below a
   preamble. Units, well name and API come from the header cells, a units row, the preamble or the file name.
   Pure functions: runs in the browser (global WellerSurvey) and in Node (tests). */
(function (root) {
  const LAS = () => root.WellerLAS;

  // What a column holds. Azimuth before inclination: "Deviation Azimuth" is an azimuth.
  function colKind(raw) {
    const n = String(raw || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[_.:#°]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return null;
    if (/^(well|well ?name|wellname|wellbore( name)?|borehole( name)?|lease)$/.test(n)) return 'well';
    if (/^(api|uwi|api ?(no|number|#|10|12|14)?|uwi ?(no|number)?)$/.test(n)) return 'api';
    if (/tvd ?ss|subsea|ss ?tvd|elev/.test(n)) return null;
    if (/^(az|azi|azm|azim|azimuth|azimuth \w+|grid az\w*|true az\w*|corr\w* az\w*|dev\w* az\w*|hole az\w*|direction|dir|drift dir\w*|bearing)$/.test(n) || /azimuth/.test(n)) return 'azi';
    if (/^(inc|incl|inclination|inclination \w+|dev|deviation|drift|drift angle|hole angle|angle)$/.test(n) || /^incl/.test(n)) return 'inc';
    if (/^(tvd|tvd \w+|true vertical depth|true vert\w* depth)$/.test(n)) return 'tvd';
    if (/^(md|md \w+|measured depth|meas depth|meas|measured|depth|dept|dmea|svy depth|survey depth|station md|course md|mdepth|depth md)$/.test(n)) return 'md';
    if (/^(\+?n ?\/? ?-?s|ns|n s|north|northing|north offset|local n\w*|n offset|\+n|dy|lat\w* offset|northing offset)$/.test(n)) return 'north';
    if (/^(\+?e ?\/? ?-?w|ew|e w|east|easting|east offset|local e\w*|e offset|\+e|dx|dep\w* offset|easting offset)$/.test(n)) return 'east';
    return null;
  }
  // Numbers as written in reports: "1,234.5", "12.3 N", "45.6S" (south is negative), "-".
  function num(v) {
    const s = String(v ?? '').replace(/,(?=\d{3}\b)/g, '').trim(); if (!s) return NaN;
    const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([NSEW])?$/i); if (!m) return NaN;
    return /[SW]/i.test(m[2] || '') ? -m[1] : +m[1];
  }
  const unitIn = s => { const m = String(s || '').match(/\b(ft|feet|foot|usft|m|meters?|metres?)\b/i); return m ? (/^(f|us)/i.test(m[1]) ? 'ft' : 'm') : ''; };

  // Split one line: tab, then semicolon or comma (quotes respected), else runs of spaces (fixed-width reports).
  function cells(line, delim) {
    if (delim === 'ws') { const out = []; const re = /\S+/g; let m;
      while ((m = re.exec(line))) { const p = out[out.length - 1];
        if (p && /^[NSEW]$/i.test(m[0]) && /\d$/.test(p.v)) { p.v += m[0]; p.b = m.index + 1; } else out.push({ v: m[0], a: m.index, b: m.index + m[0].length }); }   // "43.60 S"
      return out; }
    const out = []; let f = '', q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
      if (c === '"' && f.trim() === '') { q = true; f = ''; } else if (c === delim) { out.push({ v: f.trim() }); f = ''; } else f += c; }
    out.push({ v: f.trim() }); return out;
  }
  function pickDelim(lines) {
    const sample = lines.slice(0, 200), cnt = ch => sample.filter(l => l.includes(ch)).length;
    if (cnt('\t') > sample.length / 4) return '\t';
    if (cnt(',') > sample.length / 2) return ',';
    if (cnt(';') > sample.length / 2) return ';';
    return 'ws';
  }

  // Header row: the first line naming a measured depth and either inclination and azimuth, or TVD with N/S and E/W.
  function findHeader(rows) {
    for (let k = 0; k < Math.min(rows.length, 300); k++) {
      const kinds = rows[k].map(c => colKind(c.v)), has = x => kinds.includes(x);
      if (has('md') && ((has('inc') && has('azi')) || (has('tvd') && has('north') && has('east')))) return { k, kinds };
    }
    return null;
  }
  // Preamble lines such as "Well Name: Horsetail 2D", "API #, 05-123-45678", "Depth units = feet", "Azimuths to true north".
  function preamble(lines, cellRows, upto) {
    const out = {};
    for (let k = 0; k < upto; k++) {
      const l = lines[k].trim(); if (!l) continue;
      let key, val; const m = l.match(/^([A-Za-z][\w .\/#()-]{0,40}?)\s*[:=]\s*(.+)$/);
      if (m) { key = m[1]; val = m[2]; } else { const c = cellRows[k].map(x => x.v).filter(Boolean); if (c.length === 2) [key, val] = c; }
      const azr = l.match(/\b(true|grid|magnetic)\s+north\b/i); if (azr && !out.azRef) out.azRef = azr[1].toLowerCase();
      if (!key) continue; const kk = key.toLowerCase().trim(); val = String(val).trim().replace(/^"|"$/g, '');
      if (!out.name && /^(well|well ?name|wellbore|borehole|lease ?(name)?( ?\/ ?well)?)( name)?$/.test(kk)) out.name = val;
      else if (!out.api && /^(api|uwi)\b/.test(kk)) out.api = val;
      else if (!out.unit && /unit/.test(kk) && /(depth|length|distance|units?$)/.test(kk)) out.unit = unitIn(val);
      else if (!out.azRef && /(azimuth|north) ?(ref|reference)|north reference/.test(kk)) { const r = val.match(/true|grid|magnetic/i); if (r) out.azRef = r[0].toLowerCase(); }
    }
    return out;
  }
  // "05123456780000_Horsetail 2D survey.csv" -> API and name.
  function fromFileName(name) {
    const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\s*›.*$/, '').replace(/\.[a-z0-9]+$/i, '');
    const api = (base.match(/(?<![\d-])(\d{2}-?\d{3}-?\d{5}(?:-?\d{2}){0,2})(?![\d])/) || [])[1] || '';
    const words = base.replace(api, ' ').replace(/[_]+/g, ' ').replace(/\b(final|definitive|directional|dir|survey|surveys|svy|deviation|report|data|export|plan|actual|mwd|gyro|copy)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return { api, name: words };
  }

  /* Read a survey file. Returns { surveys: [{ name, api, unit, azRef, md, inc, azi, tvd, north, east, notes }], problems }.
     Several wells in one sheet are split on a well or API column. */
  function readSurvey(text, fileName = '') {
    text = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = text.split('\n').filter(l => !/^\s*~/.test(l)), delim = pickDelim(lines.filter(l => l.trim()));
    const cellRows = lines.map(l => cells(l.replace(/^\s*#/, ' '), delim));
    const h = findHeader(cellRows);
    if (!h) return { surveys: [], problems: ['No header row naming MD with Inc and Azi (or with TVD, N/S and E/W)'] };
    const pre = preamble(lines, cellRows, h.k), head = cellRows[h.k], idx = {};
    h.kinds.forEach((k, i) => { if (k && idx[k] == null) idx[k] = i; });
    let unit = unitIn(head[idx.md]?.v) || pre.unit || '';
    // Fixed-width reports: header words do not always split like the numbers, so each column takes the number under it.
    const align = delim === 'ws';
    const at = (row, k) => {
      if (idx[k] == null) return undefined;
      if (!align || row.length === head.length) return row[idx[k]]?.v;
      const c = head[idx[k]], mid = (c.a + c.b) / 2; let best, bd = Infinity;
      for (const x of row) { const d = mid < x.a ? x.a - mid : mid > x.b ? mid - x.b : 0; if (d < bd) { bd = d; best = x; } }
      return bd < 12 ? best?.v : undefined;
    };
    const groups = new Map(), notes = [];
    for (let k = h.k + 1; k < cellRows.length; k++) {
      const row = cellRows[k]; if (!row.some(c => c.v)) continue;
      const md = num(at(row, 'md'));
      if (!Number.isFinite(md)) { if (k <= h.k + 2 && !unit) unit = unitIn(at(row, 'md') || row.map(c => c.v).join(' ')); continue; }   // units row
      const key = (idx.well != null ? at(row, 'well') : '') + '\u0000' + (idx.api != null ? at(row, 'api') : '');
      let g = groups.get(key); if (!g) groups.set(key, g = { name: idx.well != null ? at(row, 'well') : '', api: idx.api != null ? at(row, 'api') : '', rows: [] });
      g.rows.push({ md, inc: num(at(row, 'inc')), azi: num(at(row, 'azi')), tvd: num(at(row, 'tvd')), north: num(at(row, 'north')), east: num(at(row, 'east')) });
    }
    const fn = fromFileName(fileName), surveys = [], problems = [];
    for (const g of groups.values()) {
      const r = g.rows.sort((a, b) => a.md - b.md).filter((x, i, a) => i === 0 || x.md > a[i - 1].md);
      const name = g.name || pre.name || fn.name, api = g.api || pre.api || fn.api;
      if (r.length < 2) { problems.push(`${name || 'Survey'}: fewer than two stations`); continue; }
      const s = { name, api, unit, azRef: pre.azRef || '', notes: [...notes] };
      for (const k of ['md', 'inc', 'azi', 'tvd', 'north', 'east']) s[k] = r.map(x => x[k]);
      const all = a => a.every(Number.isFinite);
      if (!(all(s.inc) && all(s.azi))) {
        // Only MD, TVD and offsets: inclination and azimuth follow from the steps between stations.
        if (!(all(s.tvd) && all(s.north) && all(s.east))) { problems.push(`${name || 'Survey'}: inclination or azimuth missing on some stations`); continue; }
        const D = 180 / Math.PI;
        s.inc = s.md.map((m, i) => { const j = Math.max(1, i); const dm = s.md[j] - s.md[j - 1], dv = s.tvd[j] - s.tvd[j - 1]; return dm > 0 ? Math.acos(Math.max(-1, Math.min(1, dv / dm))) * D : 0; });
        s.azi = s.md.map((m, i) => { const j = Math.max(1, i); return (Math.atan2(s.east[j] - s.east[j - 1], s.north[j] - s.north[j - 1]) * D + 360) % 360; });
        s.notes.push('inclination and azimuth derived from TVD and offsets');
      }
      s.azi = s.azi.map(a => ((a % 360) + 360) % 360);
      if (s.inc.some(v => v < 0 || v > 180)) { problems.push(`${name || 'Survey'}: inclination outside 0–180°`); continue; }
      // Grid northings and eastings (state plane, UTM) are not offsets from the wellhead.
      for (const k of ['north', 'east']) if (s[k].some(v => Math.abs(v) > 1e5)) { s[k] = s[k].map(() => NaN); s.notes.push(`${k === 'north' ? 'N/S' : 'E/W'} looks like a grid coordinate, not an offset; recomputed`); }
      surveys.push(s);
    }
    return { surveys, problems };
  }
  function isSurvey(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').slice(0, 300), d = pickDelim(lines.filter(l => l.trim()));
    return !!findHeader(lines.map(l => cells(l.replace(/^\s*#/, ' '), d)));
  }

  /* Survey for a well, in the well's depth unit: TVD, offsets and dogleg by minimum curvature. Where the file gives
     TVD and offsets at the first station they tie it in (surveys often start below surface); the rest is recomputed,
     and the largest disagreement with the file's own TVD is reported. */
  function build(rec, wellUnit) {
    const k = rec.unit && wellUnit && rec.unit !== wellUnit ? (rec.unit === 'm' ? 1 / 0.3048 : 0.3048) : 1;
    const sc = a => Float64Array.from(a, v => v * k), md = sc(rec.md), inc = Float64Array.from(rec.inc), azi = Float64Array.from(rec.azi);
    const tvdF = sc(rec.tvd || []), nF = sc(rec.north || []), eF = sc(rec.east || []);
    const tie = Number.isFinite(tvdF[0]) && md[0] > 0 ? { tvd: tvdF[0], north: Number.isFinite(nF[0]) ? nF[0] : 0, east: Number.isFinite(eF[0]) ? eF[0] : 0 } : null;
    const mc = LAS().minCurvature(md, inc, azi, tie);
    let diff = 0; for (let i = 0; i < md.length; i++) if (Number.isFinite(tvdF[i])) diff = Math.max(diff, Math.abs(tvdF[i] - mc.tvd[i]));
    const notes = [...(rec.notes || [])];
    if (diff > 2) notes.push(`TVD recomputed by minimum curvature differs from the file's by up to ${diff.toFixed(1)} ${wellUnit || rec.unit || ''}`.trim());
    if (k !== 1) notes.push(`depths converted from ${rec.unit} to ${wellUnit}`);
    return { md, inc, azi, tvd: mc.tvd, north: mc.north, east: mc.east, dls: mc.dls, source: rec.source || '', azRef: rec.azRef || '', imported: true, notes };
  }

  // Offsets at a measured depth (linear between stations; straight along the last station below it).
  function offsetAt(s, md) {
    const n = s.md.length; if (!s.north || !n) return null;
    if (md <= s.md[0]) { const f = s.md[0] > 0 ? Math.max(0, md) / s.md[0] : 0; return { north: s.north[0] * f, east: s.east[0] * f, tvd: s.tvd[0] - (s.md[0] - md) }; }
    if (md >= s.md[n - 1]) { const r = Math.PI / 180, d = md - s.md[n - 1], h = d * Math.sin(s.inc[n - 1] * r);
      return { north: s.north[n - 1] + h * Math.cos(s.azi[n - 1] * r), east: s.east[n - 1] + h * Math.sin(s.azi[n - 1] * r), tvd: s.tvd[n - 1] + d * Math.cos(s.inc[n - 1] * r) }; }
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s.md[m] <= md) lo = m; else hi = m; }
    const t = (md - s.md[lo]) / (s.md[hi] - s.md[lo]), L = (a) => a[lo] + t * (a[hi] - a[lo]);
    return { north: L(s.north), east: L(s.east), tvd: L(s.tvd) };
  }
  // The saved form of an imported survey (plain arrays for the project file).
  const toJSON = rec => rec && { name: rec.name, api: rec.api, unit: rec.unit, azRef: rec.azRef, source: rec.source, notes: rec.notes, md: [...rec.md], inc: [...rec.inc], azi: [...rec.azi], tvd: rec.tvd ? [...rec.tvd] : undefined, north: rec.north ? [...rec.north] : undefined, east: rec.east ? [...rec.east] : undefined };

  root.WellerSurvey = { readSurvey, isSurvey, build, offsetAt, colKind, fromFileName, toJSON, num };
})(typeof globalThis !== 'undefined' ? globalThis : this);
