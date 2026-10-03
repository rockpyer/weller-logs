/* Petrophysics: standard deterministic equations, pure and unit-tested. Browser global WellerPetro; Node via require.
   References
   - Archie, G.E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. Trans. AIME 146.
   - Simandoux, P. (1963). Dielectric measurements on porous media. Revue de l'IFP 18 (shaly-sand saturation).
   - Larionov, V.V. (1969). Borehole radiometry (Vsh from GR index, Tertiary and older rocks).
   - Arps, J.J. (1953). The effect of temperature on the density and electrical resistivity of sodium chloride solutions.
   - Raymer, L.L., Hunt, E.R., Gardner, J.S. (1980). An improved sonic transit time-to-porosity transform. SPWLA 21st Symposium.
   - Passey, Q.R. et al. (1990). A practical model for organic richness from porosity and resistivity logs. AAPG Bull. 74(12).
   Units: depth ft, temperature degF, resistivity ohm.m, density g/cc, porosity and saturation v/v. */
(function (root) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fin = Number.isFinite;

  // Gamma-ray index, then Vshale by the chosen transform.
  function igr(gr, grClean, grShale) { return clamp((gr - grClean) / (grShale - grClean), 0, 1); }
  function vsh(gr, grClean, grShale, method = 'linear') {
    if (!fin(gr)) return NaN; const i = igr(gr, grClean, grShale);
    switch (method) {
      case 'larionov-tertiary': return 0.083 * (Math.pow(2, 3.7 * i) - 1);
      case 'larionov-older': return 0.33 * (Math.pow(2, 2 * i) - 1);
      case 'clavier': return 1.7 - Math.sqrt(Math.max(0, 3.38 - (i + 0.7) ** 2));
      default: return i;
    }
  }

  // Vshale from SP between the clean-sand line and the shale baseline. Works for either deflection direction.
  function vshSP(sp, spSand, spShale) { return fin(sp) && fin(spSand) && fin(spShale) && spShale !== spSand ? clamp((sp - spSand) / (spShale - spSand), 0, 1) : NaN; }

  const MATRIX = { sandstone: 2.65, limestone: 2.71, dolomite: 2.87 };
  const DT_MATRIX = { sandstone: 55.5, limestone: 47.6, dolomite: 43.5 };   // us/ft

  // Sonic porosity, Raymer-Hunt-Gardner field form: phi = 0.625 (DT - DTma) / DT. Needs no compaction correction.
  function phiSonic(dt, dtMa = 55.5) { return fin(dt) && dt > 0 ? clamp(0.625 * (dt - dtMa) / dt, 0, 1) : NaN; }

  // Sw from the resistivity index when no porosity log exists: Sw = (R0 / Rt)^(1/n), R0 the water-bearing resistivity.
  function swFromRI(rt, r0, n = 2) { return fin(rt) && fin(r0) && rt > 0 && r0 > 0 ? clamp(Math.pow(r0 / rt, 1 / n), 0, 1) : NaN; }

  function phiDensity(rhob, rhoMa = 2.71, rhoFl = 1.0) { return fin(rhob) ? (rhoMa - rhob) / (rhoMa - rhoFl) : NaN; }

  // Neutron-density total porosity. Root-mean-square is the usual quick-look choice because it reads close to true
  // porosity in gas (neutron low, density porosity high) where the simple average reads low.
  function phiND(phiN, phiD, method = 'rms') {
    if (!fin(phiN) || !fin(phiD)) return fin(phiD) ? phiD : phiN;
    return method === 'average' ? (phiN + phiD) / 2 : Math.sqrt((phiN * phiN + phiD * phiD) / 2);
  }

  // Formation temperature from a linear gradient between surface and BHT at TD.
  function tempAtDepth(depth, surfaceT, bht, td) { return fin(bht) && fin(td) && td > 0 ? surfaceT + (bht - surfaceT) * depth / td : surfaceT; }

  // Arps: resistivity of a brine at T2 from its value at T1 (degF).
  function rwAtTemp(rw1, t1, t2) { return rw1 * (t1 + 6.77) / (t2 + 6.77); }

  function swArchie(rt, phi, rw, a = 1, m = 2, n = 2) {
    if (!fin(rt) || !fin(phi) || rt <= 0 || phi <= 0) return NaN;
    return clamp(Math.pow((a * rw) / (Math.pow(phi, m) * rt), 1 / n), 0, 1);
  }

  // Simandoux (1963) with n = 2, solved as a quadratic in Sw. Collapses to Archie when Vsh = 0.
  function swSimandoux(rt, phi, rw, vshale, rsh, a = 1, m = 2) {
    if (!fin(rt) || !fin(phi) || rt <= 0 || phi <= 0) return NaN;
    if (!fin(vshale) || vshale <= 0 || !fin(rsh) || rsh <= 0) return swArchie(rt, phi, rw, a, m, 2);
    const A = Math.pow(phi, m) / (a * rw), B = vshale / rsh, C = -1 / rt;
    return clamp((-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A), 0, 1);
  }

  // Passey et al. (1990) delta log R. Density version: dlogR = log10(Rt/Rbase) - 2.5 (RHOB - RHOBbase).
  // Sonic version: + 0.02 (DT - DTbase). TOC (wt%) = dlogR * 10^(2.297 - 0.1688 LOM).
  function deltaLogR(rt, rtBase, porosityLog, porosityBase, kind = 'density') {
    if (!fin(rt) || rt <= 0 || !fin(porosityLog)) return NaN;
    const k = kind === 'sonic' ? 0.02 : kind === 'neutron' ? 4.0 : -2.5;
    return Math.log10(rt / rtBase) + k * (porosityLog - porosityBase);
  }
  function tocPassey(dlogr, lom) { return fin(dlogr) ? Math.max(0, dlogr * Math.pow(10, 2.297 - 0.1688 * lom)) : NaN; }

  function washout(cal, bitSize, calTol = 1.0) { return fin(cal) && fin(bitSize) && cal - bitSize > calTol; }
  function badHole(cal, bitSize, drho, calTol = 1.0, drhoTol = 0.15) {
    return (fin(cal) && fin(bitSize) && cal - bitSize > calTol) || (fin(drho) && Math.abs(drho) > drhoTol);
  }

  function percentile(arr, p) {
    const v = Array.from(arr).filter(fin).sort((x, y) => x - y); if (!v.length) return NaN;
    const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo);
  }

  // Sw lines on a Pickett plot: log10(Rt) = log10(a Rw) - m log10(phi) - n log10(Sw)  ->  Rt at a given phi.
  function pickettRt(phi, sw, rw, a = 1, m = 2, n = 2) { return a * rw / (Math.pow(phi, m) * Math.pow(sw, n)); }

  /* Depth-weighted histogram for zone stats: the fraction of zone thickness in each bin, with the cumulative fraction
     and weighted P10, P50 and P90. Bins are equal in value, or in log10 for log curves. Values outside [min, max] are
     counted in below/above, not piled into the end bins. */
  function histogram(v, wt, { min, max, bins = 20, log = false }) {
    const f = log ? Math.log10 : x => x, lo = f(min), hi = f(max), step = (hi - lo) / bins;
    const h = new Float64Array(bins); let below = 0, above = 0, total = 0;
    const pairs = [];
    for (let i = 0; i < v.length; i++) { const x = v[i], w = wt ? wt[i] : 1; if (!fin(x) || !(w > 0) || (log && x <= 0)) continue;
      total += w; pairs.push([x, w]); const k = Math.floor((f(x) - lo) / step);
      if (k < 0) below += w; else if (k >= bins) { if (f(x) === hi) h[bins - 1] += w; else above += w; } else h[k] += w; }
    const edges = Array.from({ length: bins + 1 }, (_, k) => log ? 10 ** (lo + k * step) : lo + k * step);
    if (!total) return { edges, frac: [...h], cum: [...h], below: 0, above: 0, total: 0, p10: NaN, p50: NaN, p90: NaN };
    const frac = [...h].map(x => x / total); let c = below / total; const cum = frac.map(x => (c += x));
    pairs.sort((a, b) => a[0] - b[0]);
    const q = p => { let acc = 0; for (const [x, w] of pairs) { acc += w; if (acc >= p * total - 1e-12) return x; } return pairs[pairs.length - 1][0]; };
    return { edges, frac, cum, below: below / total, above: above / total, total, p10: q(.1), p50: q(.5), p90: q(.9) };
  }

  root.WellerPetro = { igr, vsh, vshSP, DT_MATRIX, phiSonic, swFromRI, washout, MATRIX, phiDensity, phiND, tempAtDepth, rwAtTemp, swArchie, swSimandoux, deltaLogR, tocPassey, badHole, percentile, pickettRt, histogram, clamp };
})(typeof globalThis !== 'undefined' ? globalThis : this);
