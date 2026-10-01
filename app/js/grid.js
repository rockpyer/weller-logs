/* Gridding for thickness and structure maps: a thin-plate spline through well values, kept to the area the wells
   cover (their convex hull plus a margin). Coordinates are meters on a local plane. Pure functions: runs in the
   browser (global WellerGrid) and in Node (tests). */
(function (root) {
  // Wells closer than this share one value (pad wells, or a vertical and its sidetrack): the mean of their values.
  const MERGE_M = 15;

  function mergeClose(pts) {
    const out = [];
    for (const p of pts) { const q = out.find(o => Math.hypot(o.x - p.x, o.y - p.y) < MERGE_M);
      if (q) { q.n++; q.v += (p.v - q.v) / q.n; q.ids.push(...(p.ids || [p.id])); } else out.push({ x: p.x, y: p.y, v: p.v, n: 1, ids: [...(p.ids || [p.id])] }); }
    return out;
  }

  // Andrew's monotone chain; counter-clockwise, no repeated end point.
  function convexHull(pts) {
    const P = [...pts].sort((a, b) => a.x - b.x || a.y - b.y); if (P.length < 3) return P;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of P.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const area = h => h.reduce((s, p, i) => { const q = h[(i + 1) % h.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
  // Distance from (x, y) to the hull: 0 inside.
  function hullDistance(h, x, y) {
    let inside = h.length >= 3, d = Infinity;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length], ex = b.x - a.x, ey = b.y - a.y, L = ex * ex + ey * ey;
      if ((ex * (y - a.y) - ey * (x - a.x)) < 0) inside = false;
      const t = L ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / L)) : 0;
      d = Math.min(d, Math.hypot(x - a.x - t * ex, y - a.y - t * ey));
    }
    return inside ? 0 : d;
  }

  // Gaussian elimination with partial pivoting; A is an array of rows, solved in place.
  function solve(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
    return x;
  }

  /* Thin-plate spline z = a0 + a1·x + a2·y + Σ wᵢ·φ(rᵢ), φ(r) = r² log r. Coordinates are scaled to the data's extent so
     the system stays well conditioned. smooth > 0 relaxes the fit at the wells slightly (regularization λ). */
  function fitTPS(pts, smooth = 1e-4) {
    const n = pts.length; if (n < 3) return null;
    const cx = pts.reduce((s, p) => s + p.x, 0) / n, cy = pts.reduce((s, p) => s + p.y, 0) / n;
    const L = Math.max(1, ...pts.map(p => Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy))));
    const X = pts.map(p => (p.x - cx) / L), Y = pts.map(p => (p.y - cy) / L);
    const phi = r2 => r2 > 0 ? 0.5 * r2 * Math.log(r2) : 0;
    const A = [], b = [];
    for (let i = 0; i < n; i++) { const row = new Array(n + 3).fill(0);
      for (let j = 0; j < n; j++) row[j] = phi((X[i] - X[j]) ** 2 + (Y[i] - Y[j]) ** 2) + (i === j ? smooth : 0);
      row[n] = 1; row[n + 1] = X[i]; row[n + 2] = Y[i]; A.push(row); b.push(pts[i].v); }
    for (const f of [() => 1, i => X[i], i => Y[i]]) { const row = new Array(n + 3).fill(0); for (let i = 0; i < n; i++) row[i] = f(i); A.push(row); b.push(0); }
    const sol = solve(A, b); if (!sol) return null;
    return (x, y) => { const u = (x - cx) / L, v = (y - cy) / L; let z = sol[n] + sol[n + 1] * u + sol[n + 2] * v;
      for (let i = 0; i < n; i++) z += sol[i] * phi((u - X[i]) ** 2 + (v - Y[i]) ** 2); return z; };
  }

  /* Grid a set of { x, y, v, id } (meters). Returns null with a reason when the wells cannot carry a surface.
     cells: grid cells along the longer side. Values outside the hull plus margin are NaN. */
  function gridSurface(input, { cells = 160, margin = 0.15 } = {}) {
    const pts = mergeClose(input.filter(p => [p.x, p.y, p.v].every(Number.isFinite)));
    if (pts.length < 3) return { reason: `${pts.length} well location${pts.length === 1 ? '' : 's'} with a value; contours need 3`, pts };
    const hull = convexHull(pts), ext = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), eyt = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
    const size = Math.max(ext, eyt);
    if (hull.length < 3 || Math.abs(area(hull)) < 0.002 * size * size) return { reason: 'the wells lie on a line; contours need wells off that line', pts };
    const f = fitTPS(pts); if (!f) return { reason: 'the wells do not constrain a surface', pts };
    const pad = Math.max(200, margin * size);
    const x0 = Math.min(...pts.map(p => p.x)) - pad, y0 = Math.min(...pts.map(p => p.y)) - pad, w = ext + 2 * pad, h = eyt + 2 * pad;
    const d = Math.max(w, h) / cells, nx = Math.max(2, Math.ceil(w / d) + 1), ny = Math.max(2, Math.ceil(h / d) + 1);
    // Row 0 is the north edge, as an image is drawn.
    const values = new Float64Array(nx * ny), raw = new Float64Array(nx * ny);
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * d, y = y0 + (ny - 1 - j) * d, z = f(x, y), k = j * nx + i; raw[k] = z;
      const inside = hullDistance(hull, x, y) <= pad; values[k] = inside ? z : NaN;
      if (inside) { if (z < min) min = z; if (z > max) max = z; }
    }
    return { pts, hull, pad, f, x0, y0, d, nx, ny, values, raw, min, max };
  }

  // A round contour interval giving about `target` lines over the range: 1, 2, 2.5 or 5 times a power of ten.
  function niceStep(min, max, target = 10) {
    const span = Math.abs(max - min); if (!(span > 0)) return 1;
    const raw = span / target, p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
  }

  root.WellerGrid = { mergeClose, convexHull, hullDistance, fitTPS, gridSurface, niceStep, solve };
})(typeof globalThis !== 'undefined' ? globalThis : this);
