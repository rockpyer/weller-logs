/* View helpers with no DOM: curve line styles, depth measurements, saved views and PNG export sizing.
   Loaded by the app before tools.js and by the unit tests. */
(function (root) {
  // Line styles offered in the curve editor. Older tracks carry their own dash patterns; styleOf() names them.
  const LINE_STYLES = [
    { key: 'solid', label: 'Solid', dash: null },
    { key: 'dash', label: 'Dashed', dash: '5 3' },
    { key: 'dot', label: 'Dotted', dash: '1 2' },
    { key: 'dashdot', label: 'Dash-dot', dash: '6 2 1 2' },
  ];
  const LINE_WIDTHS = [0.75, 1, 1.2, 1.5, 2, 3];
  const DEFAULT_WIDTH = 1.2;
  function styleOf(dash) {
    const p = String(dash || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (!p.length || p.every(v => !v)) return 'solid';
    if (p.length >= 4) return 'dashdot';
    return p[0] <= 2 ? 'dot' : 'dash';
  }
  // A curve keeps its own pattern when the style does not change, so "5 3" and "4 2" stay distinct.
  function dashFor(key, current) {
    if (styleOf(current) === key) return current || null;
    return (LINE_STYLES.find(s => s.key === key) || LINE_STYLES[0]).dash;
  }

  /* An interval measured on a log: MD at both ends, true vertical thickness where a TVD function is given, and
     subsea depth (TVD minus the datum elevation, positive down) where the well has an elevation. */
  function measure(md0, md1, tvdAt, elev) {
    const top = Math.min(md0, md1), base = Math.max(md0, md1);
    const tvd = typeof tvdAt === 'function' ? [tvdAt(top), tvdAt(base)] : null;
    const out = { top, base, dMD: base - top };
    if (tvd && tvd.every(Number.isFinite)) { out.tvdTop = tvd[0]; out.tvdBase = tvd[1]; out.dTVD = Math.abs(tvd[1] - tvd[0]); }
    if (Number.isFinite(elev)) { const t = tvd || [top, base]; out.ssTop = t[0] - elev; out.ssBase = t[1] - elev; }
    return out;
  }

  /* Saved views: the section, hang, tracks and zoom under a name. Scroll is kept as the depth at the top of the
     window, so it survives a change in the depth window (a well added, another hang). */
  const clone = o => JSON.parse(JSON.stringify(o));
  function captureView(S, name, depthTop) {
    const mode = S.mode === 'corr' ? 'corr' : 'single';
    return {
      id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(name || '').trim() || 'View',
      mode, selected: S.selected, panel: [...(S.panel || [])], datum: S.datum, corr: clone(S.corr || {}),
      tracks: clone(S.tracks || []), pxPerFt: S.view?.pxPerFt, depthTop: Number.isFinite(depthTop) ? depthTop : null,
      showEmpty: !!S.showEmpty, depthLabels: clone(S.depthLabels || { md: true, ss: true }),
    };
  }
  // Applies a view to the state. Wells no longer open are dropped from the section; returns how many were.
  function applyView(S, v, hasWell) {
    const ok = id => !hasWell || hasWell(id);
    const panel = (v.panel || []).filter(ok), dropped = (v.panel || []).length - panel.length;
    S.panel = panel; if (v.selected && ok(v.selected)) S.selected = v.selected;
    if (v.datum) S.datum = v.datum;
    if (v.corr) S.corr = { ...S.corr, ...clone(v.corr) };
    if (Array.isArray(v.tracks) && v.tracks.length) S.tracks = clone(v.tracks);
    if (v.showEmpty !== undefined) S.showEmpty = !!v.showEmpty;
    if (v.depthLabels) S.depthLabels = clone(v.depthLabels);
    const key = v.mode === 'corr' ? 'corr' : 'single';
    S.views = S.views || {}; const zv = S.views[key] || (S.views[key] = {});
    if (Number.isFinite(v.pxPerFt) && v.pxPerFt > 0) { zv.pxPerFt = v.pxPerFt; zv.fitted = true; }
    return dropped;
  }
  function describeView(v, wellName) {
    const n = (v.panel || []).length;
    const hang = { MD: 'MD', GL: 'ground level', TVDSS: 'sea level' }[v.datum] || (v.datum ? 'flattened on ' + v.datum : 'MD');
    return v.mode === 'corr' ? `Correlation · ${n} well${n === 1 ? '' : 's'} · ${hang}` : `Logs · ${wellName || 'one well'}`;
  }

  /* PNG export size. The image is the headers (optional) plus the depth window, at res pixels per screen pixel,
     reduced to fit the canvas limits. Print size follows from 96 screen px per inch. */
  function exportSize({ width, headerH, y0, y1, res = 2, maxW = 8000, maxH = 16000 }) {
    const dataH = Math.max(1, y1 - y0), h = headerH + dataH;
    const scale = Math.max(0.05, Math.min(res, maxW / width, maxH / h));
    return { scale, w: Math.round(width * scale), h: Math.round(h * scale), dataH, reduced: scale < res - 1e-9, printIn: { w: width / 96, h: h / 96 } };
  }

  root.WellerViews = { LINE_STYLES, LINE_WIDTHS, DEFAULT_WIDTH, styleOf, dashFor, measure, captureView, applyView, describeView, exportSize };
})(typeof window !== 'undefined' ? window : globalThis);
