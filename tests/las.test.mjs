import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../app/js/las.js';
const { parseLAS, normalizeWell, minCurvatureTVD, tvdAt, datumElevation } = globalThis.WellerLAS;
const load = (text, name = 't.las') => normalizeWell(parseLAS(text), name);

const LAS12 = `~VERSION INFORMATION
VERS.           1.2   :CWLS Log ASCII Standard - VERSION 1.2
WRAP.           NO    :One Line per depth step
~WELL INFORMATION
STRT .F      1000.0 :START DEPTH
STOP .F      1001.0 :STOP DEPTH
STEP .F         0.5 :STEP
NULL .      -999.25 :NULL VALUE
COMP .             COMPANY:  Bear Oil & Gas, Inc.
WELL .                WELL:  Mattson 12-32
STAT .               STATE:  Wyoming
LATI .DEG         LATITUDE:  41.310000 degrees
LONG .DEG        LONGITUDE:  -104.15000 degrees
API  .          API NUMBER:  49-021-20933-0000
~PARAMETER INFORMATION
EKB .F    5303.0 :Elevation of Kelly Bushing
EGL .F    5291.0 :Elevation of Ground Level
BHT .DEGF  164.0 :Bottom Hole Temperature
MATR .     SAND  :Rock Matrix for Neutron Porosity Corrections
~CURVE INFORMATION
DEPT .F    :Depth
GR   .GAPI :Gamma ray
NPHI .V/V  :Neutron
~A  DEPT GR NPHI
1000.0  50.0  0.20
1000.5 -999.25 0.21
1001.0  70.0  -9999
`;

test('LAS 1.2 header with label and value swapped reads the value', () => {
  const w = load(LAS12);
  assert.equal(w.name, 'Mattson 12-32');
  assert.equal(w.company, 'Bear Oil & Gas, Inc.');
  assert.equal(w.api, '49-021-20933-0000');
});

test('numbers followed by words, parameters from ~P, neutron matrix', () => {
  const w = load(LAS12);
  assert.equal(w.location.lat, 41.31);
  assert.equal(w.location.lon, -104.15);
  assert.equal(w.elevation.kb, 5303);
  assert.equal(w.elevation.gl, 5291);
  assert.equal(w.params.bht, 164);
  assert.equal(w.neutronMatrix, 'sandstone');
});

test('LAS 2.0 value : label order is left alone', () => {
  const w = load(LAS12.replace('VERS.           1.2', 'VERS.           2.0').replace('WELL .                WELL:  Mattson 12-32', 'WELL.  Marquardt 43 31 :WELL'));
  assert.equal(w.name, 'Marquardt 43 31');
});

test('null sentinels become NaN, including a second sentinel', () => {
  const p = parseLAS(LAS12);
  assert.ok(Number.isNaN(p.curves[1].data[1]));
  assert.ok(Number.isNaN(p.curves[2].data[2]));
  assert.equal(p.curves[1].data[2], 70);
});

test('bottom-up logs are reversed to increasing depth', () => {
  const up = LAS12.replace(/~A[\s\S]*$/, '~A  DEPT GR NPHI\n1001.0 70 0.2\n1000.5 60 0.2\n1000.0 50 0.2\n');
  const p = parseLAS(up);
  assert.deepEqual(Array.from(p.curves[0].data), [1000, 1000.5, 1001]);
  assert.deepEqual(Array.from(p.curves[1].data), [50, 60, 70]);
  assert.equal(p.reversed, true);
});

test('wrapped data are reassembled', () => {
  const wr = LAS12.replace('WRAP.           NO', 'WRAP.           YES').replace(/~A[\s\S]*$/, '~A\n1000.0\n50 0.2\n1000.5\n60 0.21\n');
  const p = parseLAS(wr);
  assert.equal(p.rows, 2);
  assert.equal(p.curves[1].data[1], 60);
});

test('implausible KB is rejected and depths hang on GL', () => {
  const w = load(LAS12.replace('EKB .F    5303.0', 'EKB .F   10594.0'));
  assert.equal(w.elevation.kb, undefined);
  assert.equal(w.elevation.kbSuspect, true);
  assert.equal(datumElevation(w), 5291);
  assert.match(w.notes.join(' '), /ignored/);
});

test('percent neutron is converted to v/v', () => {
  const w = load(LAS12.replace('NPHI .V/V', 'NPHI .PU').replace(/~A[\s\S]*$/, '~A\n1000 50 20\n1000.5 50 22\n1001 50 24\n'));
  assert.equal(w.curves[2].data[0], 0.2);
});

test('repeated mnemonics get a run suffix', () => {
  const p = parseLAS(LAS12.replace('NPHI .V/V  :Neutron', 'GR .GAPI :Gamma ray run 2'));
  assert.equal(p.curves[2].mnemonic, 'GR:2');
});

test('minimum curvature: a vertical hole keeps TVD equal to MD', () => {
  const tvd = minCurvatureTVD(Float64Array.of(0, 1000, 2000), Float64Array.of(0, 0, 0), Float64Array.of(0, 0, 0));
  assert.deepEqual(Array.from(tvd), [0, 1000, 2000]);
});

test('minimum curvature: a 90 degree build over a quarter circle', () => {
  // Radius R = 2000/pi ft; building from 0 to 90 degrees drops TVD by exactly R.
  const R = 2000 / Math.PI;
  const tvd = minCurvatureTVD(Float64Array.of(0, 1000), Float64Array.of(0, 90), Float64Array.of(0, 0));
  assert.ok(Math.abs(tvd[1] - R) < 1e-6, `${tvd[1]} vs ${R}`);
});

test('survey in ~Other with its header in a comment is parsed (Weld County horizontal)', () => {
  const text = fs.readFileSync(new URL('../app/data/niobrara/400709586.las', import.meta.url), 'utf8');
  const w = load(text, '400709586.las');
  assert.equal(w.name, 'Horsetail 02D-00204');
  assert.ok(w.survey && w.survey.md.length > 50);
  assert.equal(w.survey.tvd[0], 4638.17);
  const tvd = tvdAt(w.survey, Float64Array.of(4679, 4771));
  assert.ok(Math.abs(tvd[1] - 4730.10) < 1e-6);
});

test('every bundled Niobrara file parses with increasing depth and a name', () => {
  const dir = new URL('../app/data/niobrara/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.las'))) {
    const p = parseLAS(fs.readFileSync(new URL(f, dir), 'utf8'));
    const w = normalizeWell(p, f);
    const d = p.curves[0].data;
    assert.ok(p.rows > 1000, f);
    for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1], `${f} depth not increasing at ${i}`);
    assert.ok(w.name && !/^WELL$/i.test(w.name), f);
  }
});
