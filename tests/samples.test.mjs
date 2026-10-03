import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../app/js/apicodes.js';
import '../app/js/las.js';
import '../app/js/tables.js';
const T = globalThis.WellerTables, { parseLAS, normalizeWell } = globalThis.WellerLAS;

// Synthetic Mattson 12-32 core data (scripts/make_niobrara_points.py): each file guesses as points, matches the
// well from its LAS (by name + API, API only, name only), and stays in typical Niobrara lab ranges.
const dir = new URL('../samples/niobrara/', import.meta.url);
const read = f => T.readDelimited(fs.readFileSync(new URL(f, dir), 'utf8'));
const las = f => normalizeWell(parseLAS(fs.readFileSync(new URL(`../app/data/niobrara/${f}`, import.meta.url), 'utf8')), f);
const wells = [las('2120933C.las'), las('2121022A.las'), las('2121045D.las')].map((w, i) => ({ ...w, id: 'w' + i }));
const col = (t, name) => t.rows.map(r => r[t.columns.indexOf(name)]).filter(v => v !== '').map(Number);
const within = (t, name, lo, hi) => { const v = col(t, name); assert.ok(v.length && Math.min(...v) >= lo && Math.max(...v) <= hi, `${name}: ${Math.min(...v)}..${Math.max(...v)}`); };

const FILES = { 'Mattson_12-32_core_RCA.csv': 7, 'Mattson_12-32_geomech.csv': 8, 'Mattson_12-32_XRD.csv': 11 };
for (const [f, nValues] of Object.entries(FILES)) test(`${f}: points with the right value columns, all rows on Mattson 12-32`, () => {
  const t = read(f), g = T.guess(t);
  assert.equal(g.kind, 'points'); assert.equal(g.map.ref, 'MD');
  assert.equal(t.columns[g.map.top], 'md_ft'); assert.equal(t.columns[g.map.label], 'lithofacies');
  assert.equal(g.map.values.length, nValues, g.map.values.map(i => t.columns[i]).join());
  const recs = T.mapRecords(t, 'points', g.map, f);
  assert.equal(recs.length, t.rows.length);
  for (const r of recs) { assert.equal(T.matchWell(wells, r)?.name, 'Mattson 12-32'); assert.ok(r.top >= 6500 && r.top <= 7300); }
});

test('typical Niobrara ranges', () => {
  const rca = read('Mattson_12-32_core_RCA.csv');
  within(rca, 'porosity (%)', 1, 15); within(rca, 'perm (mD)', 1e-6, 0.01); within(rca, 'grain_den (g/cc)', 2.55, 2.75);
  within(rca, 'bulk_den (g/cc)', 2.25, 2.7); within(rca, 'sw (%)', 10, 95); within(rca, 'toc (wt%)', 0.3, 7);
  const gm = read('Mattson_12-32_geomech.csv');
  within(gm, 'vp (ft/s)', 9000, 17500); within(gm, 'ym_static (Mpsi)', 1, 8); within(gm, 'pr_static', 0.15, 0.35); within(gm, 'ucs (psi)', 3000, 25000);
  // Dynamic moduli agree with the velocities and density they came from
  const [vp, vs, rho, E, nu] = ['vp (ft/s)', 'vs (ft/s)', 'plug_bulk_den (g/cc)', 'ym_dyn (Mpsi)', 'pr_dyn'].map(c => col(gm, c));
  vp.forEach((p, i) => { const n = (p ** 2 - 2 * vs[i] ** 2) / (2 * (p ** 2 - vs[i] ** 2)), e = 2 * rho[i] * 1000 * (vs[i] * 0.3048) ** 2 * (1 + n) / 6894.757e3 / 1e3;
    assert.ok(Math.abs(n - nu[i]) < 0.002 && Math.abs(e - E[i]) < 0.02, `row ${i}`); });
  const xrd = read('Mattson_12-32_XRD.csv'), mins = xrd.columns.filter(c => /wt%/.test(c) && c !== 'total_clay (wt%)');
  xrd.rows.forEach((r, i) => { const v = mins.map(c => +r[xrd.columns.indexOf(c)]);
    assert.ok(Math.abs(v.reduce((a, b) => a + b) - 100) < 0.11, `row ${i} sums to 100`);
    assert.ok(Math.abs(v.slice(-4).reduce((a, b) => a + b) - +r[xrd.columns.indexOf('total_clay (wt%)')]) < 0.11, `row ${i} clay`); });
  within(xrd, 'calcite (wt%)', 15, 90); within(xrd, 'total_clay (wt%)', 3, 55);
});
