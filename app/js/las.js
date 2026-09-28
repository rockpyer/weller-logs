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

  function parseLAS(text) {
    const lines = String(text).split(/\r?\n/);
    const H = { version: {}, well: {}, params: {}, curves: [], other: [], tops: [] };
    const rows = []; let sec = '', wrap = false, buf = [], version = '';
    for (const raw of lines) {
      const l = raw.trim(); if (!l) continue;
      if (l[0] === '~') { sec = l[1].toUpperCase(); if (/^~TOP/i.test(l)) sec = 'T'; continue; }
      if (sec === 'A') {
        if (l[0] === '#') continue;
        const toks = l.split(/[\s,]+/).filter(Boolean).map(Number); if (toks.some(Number.isNaN)) continue;
        if (wrap) { buf.push(...toks); if (buf.length >= H.curves.length) { rows.push(buf.slice(0, H.curves.length)); buf = []; } } else rows.push(toks);
        continue;
      }
      if (sec === 'O') { H.other.push(raw); continue; }
      if (l[0] === '#') { H.other.push(raw); continue; }   // survey column headers are often comments placed before ~Other
      if (sec === 'T') { const m = l.match(/^(.*?)[\s,]+([-+]?\d+\.?\d*)\s*$/); if (m) H.tops.push({ name: m[1].trim(), md: +m[2] }); continue; }
      const h = parseHeaderLine(l); if (!h) continue;
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
    if (curves.length && n > 1 && curves[0].data[0] > curves[0].data[n - 1]) { for (const c of curves) c.data.reverse(); reversed = true; }
    // Drop rows whose depth is missing, which would break monotonic depth.
    if (curves.length && curves[0].data.some(Number.isNaN)) {
      const keep = []; curves[0].data.forEach((d, i) => { if (Number.isFinite(d)) keep.push(i); });
      for (const c of curves) c.data = Float64Array.from(keep, i => c.data[i]); n = keep.length;
    }
    return { header: H, curves, wrap, nullv, rows: n, version, reversed };
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

  root.WellerLAS = { parseLAS, normalizeWell, parseSurvey, minCurvatureTVD, tvdAt, datumElevation, median, leadingNumber, parseHeaderLine };
})(typeof globalThis !== 'undefined' ? globalThis : this);
