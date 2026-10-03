import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../app/js/las.js';
import '../app/js/qc.js';
const { parseLAS, normalizeWell, diagnoseLAS } = globalThis.WellerLAS;
const { despike, checkCurve, normCoeffs, writeLAS } = globalThis.WellerQC;

const ramp = (n, f) => Float64Array.from({ length: n }, (_, i) => f(i));

test('despike replaces isolated spikes with the local median and leaves a clean log alone', () => {
  const d = ramp(200, i => 60 + 10 * Math.sin(i / 7)); const clean = despike(d);
  assert.equal(clean.idx.length, 0);
  d[50] = 900; d[120] = -300; const r = despike(d);
  assert.deepEqual(r.idx, [50, 120]); assert.ok(Math.abs(r.data[50] - 60 - 10 * Math.sin(50 / 7)) < 3);
  assert.equal(d[50], 900, 'input untouched');
  const res = ramp(200, i => 10 ** (1 + 0.2 * Math.sin(i / 9))); res[80] = 5000; const rl = despike(res, { log: true });
  assert.deepEqual(rl.idx, [80]); assert.ok(rl.data[80] > 5 && rl.data[80] < 20); assert.equal(rl.data[81], res[81]);
});

test('curve checks: coverage, gaps, flat runs, spikes, range and units', () => {
  const dep = ramp(400, i => 1000 + i * 0.5);
  const gr = ramp(400, i => i < 100 ? NaN : 80 + 20 * Math.sin(i / 9));
  for (let i = 200; i < 210; i++) gr[i] = NaN;           // a 5 ft gap
  for (let i = 300; i < 340; i++) gr[i] = 75;            // 20 ft flat
  const r = checkCurve(dep, { data: gr, unit: 'GAPI' }, 'GR');
  const by = Object.fromEntries(r.checks.map(c => [c.key, c]));
  assert.equal(by.coverage.level, 'ok'); assert.ok(Math.abs(by.coverage.value - 0.75) < 0.01);
  assert.equal(by.gaps.value, 1); assert.equal(by.flat.level, 'warn'); assert.equal(by.range.level, 'ok'); assert.equal(by.unit.level, 'ok');
  const rh = checkCurve(dep, { data: ramp(400, () => 2450), unit: 'KG/M3' }, 'RHOB');
  assert.equal(rh.checks.find(c => c.key === 'range').level, 'bad'); assert.equal(rh.checks.find(c => c.key === 'unit').level, 'warn');
  assert.equal(checkCurve(dep, { data: ramp(400, () => NaN) }, 'GR').score, 0);
});

test('drilling curves: flat runs and spikes are information, not a failing verdict', () => {
  const dep = ramp(400, i => 1000 + i * 0.5), rpm = ramp(400, i => i < 50 ? 0 : 26);
  const r = checkCurve(dep, { data: rpm, unit: '-' }, 'RPM'), flat = r.checks.find(c => c.key === 'flat');
  assert.equal(flat.level, 'info'); assert.match(flat.text, /^steady at 26 from 1,025 to 1,199\.5$/);
  assert.equal(r.verdict, 'ok'); assert.ok(!r.checks.some(c => c.key === 'unit'), 'no resistivity unit check on RPM');
  const gr = checkCurve(dep, { data: ramp(400, () => 75), unit: 'GAPI' }, 'GR');
  assert.equal(gr.verdict, 'warn'); assert.ok(gr.issues.some(t => t.startsWith('Flat runs')));
  assert.equal(checkCurve(dep, { data: ramp(400, () => NaN) }, 'GR').verdict, 'bad');
});

test('GR normalization maps this well P5-P95 onto the reference P5-P95', () => {
  const ref = ramp(1000, i => 20 + (i % 100) * 1.2), src = ref.map(v => v * 1.5 + 10);
  const k = normCoeffs(src, ref); assert.ok(Math.abs(k.a - 1 / 1.5) < 1e-9); assert.ok(Math.abs(k.a * src[37] + k.b - ref[37]) < 1e-9);
  assert.equal(normCoeffs(ramp(5, i => i), ref), null);
});

test('LAS 2.0 export reads back: header, curves, nulls, tops, survey, computed curves', () => {
  const text = fs.readFileSync(new URL('../app/data/niobrara/400709586.las', import.meta.url), 'utf8');
  const w = normalizeWell(parseLAS(text), '400709586.las');
  w.tops = [{ name: 'Fort Hays', md: 7234.5 }, { name: 'Niobrara', md: 6900 }];
  w.curves.push({ mnemonic: 'VSH_GR', unit: 'v/v', description: 'Shale volume', data: w.curves[1].data.map(v => v / 200), computed: true });
  w.curves.push({ mnemonic: 'GR:2', unit: 'Ω·m', description: 'dup', data: w.curves[1].data });
  const out = writeLAS(w, { notes: ['Interpretation: Archie a=1 m=2 n=2'] });
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(out), 'ASCII only');
  const r = diagnoseLAS(out, 'out.las'); assert.equal(r.problems.filter(p => p.level === 'error').length, 0, JSON.stringify(r.problems));
  const b = normalizeWell(r.parsed, 'out.las');
  assert.equal(b.name, w.name); assert.equal(b.api, w.api); assert.equal(b.elevation.kb, w.elevation.kb); assert.equal(b.depthUnit, w.depthUnit);
  assert.equal(b.location.lat, w.location.lat);
  assert.deepEqual(b.tops.map(t => [t.name, t.md]).sort(), [['Fort Hays', 7234.5], ['Niobrara', 6900]]);
  assert.ok(b.survey && Math.abs(b.survey.tvd.at(-1) - w.survey.tvd.at(-1)) < 0.01, 'survey round-trips');
  assert.equal(b.rows, w.rows);
  const names = b.curves.map(c => c.mnemonic);
  assert.ok(names.includes('VSH_GR') && names.includes('GR_2'), names.join(' '));
  for (let j = 1; j < w.curves.length - 2; j++) { const a = w.curves[j].data, c = b.curves[j].data;
    for (let i = 0; i < a.length; i += 97) assert.ok(Number.isNaN(a[i]) ? Number.isNaN(c[i]) : Math.abs(a[i] - c[i]) <= Math.abs(a[i]) * 1e-6 + 1e-9, `${w.curves[j].mnemonic}[${i}]`); }
  assert.match(out, /OHMM/); assert.match(out, /computed by Well\(er\) Logs/); assert.match(out, /# Interpretation/);
  assert.equal(writeLAS(w, { computed: false }).includes('VSH_GR'), false);
});

test('LAS export of a vertical well keeps location, elevations and neutron matrix', () => {
  const w = normalizeWell(parseLAS(fs.readFileSync(new URL('../app/data/niobrara/2120933C.las', import.meta.url), 'utf8')), 'v.las');
  const b = normalizeWell(parseLAS(writeLAS(w)), 'out.las');
  assert.ok(Number.isFinite(w.location.lat) && Number.isFinite(w.elevation.kb));
  assert.ok(Math.abs(b.location.lat - w.location.lat) < 1e-6 && Math.abs(b.location.lon - w.location.lon) < 1e-6);
  assert.equal(b.elevation.kb, w.elevation.kb); assert.equal(b.elevation.gl, w.elevation.gl); assert.equal(b.neutronMatrix, w.neutronMatrix);
  assert.equal(b.api, w.api); assert.equal(b.curves.length, w.curves.length);
});
