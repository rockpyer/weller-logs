import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../app/js/las.js';
import '../app/js/survey.js';
import '../app/js/grid.js';
const { readSurvey, isSurvey, build, offsetAt, fromFileName } = globalThis.WellerSurvey;
const { minCurvature, normalizeWell, parseLAS } = globalThis.WellerLAS;
const G = globalThis.WellerGrid;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('minimum curvature reproduces the vendor offsets of the Weld County horizontal', () => {
  const w = normalizeWell(parseLAS(fs.readFileSync('app/data/niobrara/400709586.las', 'utf8')), '400709586.las');
  const s = w.survey, n = s.md.length - 1;
  assert.ok(s.north && s.east, 'LAS survey carries offsets');
  const mc = minCurvature(s.md, s.inc, s.azi, { tvd: s.tvd[0], north: s.north[0], east: s.east[0] });
  close(mc.tvd[n], s.tvd[n], 0.5, 'TVD at TD'); close(mc.north[n], s.north[n], 1, 'N at TD'); close(mc.east[n], s.east[n], 1, 'E at TD');
  assert.ok(s.north[n] < -4000, 'the lateral runs south');
});

test('minimum curvature: a 90° build to the east ends at radius R east and R down', () => {
  const R = 1000 * 180 / Math.PI / 90 * (Math.PI / 2);   // 1000 ft of arc for 90°: R = 2000/π
  const mc = minCurvature(Float64Array.of(0, 1000), Float64Array.of(0, 90), Float64Array.of(90, 90));
  close(mc.tvd[1], 2000 / Math.PI, 0.01); close(mc.east[1], 2000 / Math.PI, 0.01); close(mc.north[1], 0, 1e-9); close(mc.dls[1], 9, 1e-9);
  assert.ok(R > 0);
});

test('CSV survey with a preamble, units in the header and offsets', () => {
  const csv = 'Well Name: Test 1H\nAPI: 05-123-45678\nAzimuth reference: Grid North\n\nMD (ft),Inc (°),Azi (°),TVD (ft),N/S (ft),E/W (ft),DLS (°/100ft)\n0,0,0,0,0,0,0\n1000,0,0,1000,0,0,0\n2000,10,90,1994.93,0,87.16,1\n';
  assert.ok(isSurvey(csv));
  const { surveys: [s], problems } = readSurvey(csv, 'x.csv');
  assert.deepEqual(problems, []);
  assert.equal(s.name, 'Test 1H'); assert.equal(s.api, '05-123-45678'); assert.equal(s.unit, 'ft'); assert.equal(s.azRef, 'grid');
  assert.deepEqual(s.md, [0, 1000, 2000]); assert.deepEqual(s.azi, [0, 0, 90]);
  const b = build(s, 'ft'); close(b.east[2], 87.05, 0.05); close(b.tvd[2], 1994.93, 0.05);
});

test('fixed-width report: header words wider than numbers, units row, N/S letters', () => {
  const txt = `Company: Acme\n Well: Smith 1-23\n\n    Measured   Incl    Azimuth     TVD      N/S       E/W\n    Depth\n      ft       deg     deg        ft       ft        ft\n     0.00     0.00     0.00      0.00     0.00 N    0.00 E\n  1000.00     5.00   180.00    999.37    43.60 S    0.00 E\n`;
  const { surveys: [s] } = readSurvey(txt, 'whatever.txt');
  assert.equal(s.name, 'Smith 1-23'); assert.deepEqual(s.md, [0, 1000]); assert.deepEqual(s.inc, [0, 5]); assert.deepEqual(s.north, [0, -43.6]);
});

test('meters convert to the well unit; several wells split on a well column; sorted by MD', () => {
  const tsv = 'Well\tMD [m]\tIncl\tAzim\nA-1\t300\t2\t45\nA-1\t0\t0\t0\nB-2\t0\t0\t0\nB-2\t300\t0\t0\n';
  const { surveys } = readSurvey(tsv, 'pad.tsv');
  assert.equal(surveys.length, 2); assert.equal(surveys[0].name, 'A-1'); assert.deepEqual(surveys[0].md, [0, 300]);
  const b = build(surveys[0], 'ft'); close(b.md[1], 984.25, 0.01);
});

test('MD, TVD and offsets without angles: inclination and azimuth are derived', () => {
  const csv = 'MD,TVD,+N/-S,+E/-W\n0,0,0,0\n1000,1000,0,0\n1100,1099.5,0,-10\n';
  const { surveys: [s] } = readSurvey(csv, '0512345678_Jones 4-5 survey.csv');
  assert.equal(s.api, '0512345678'); assert.equal(s.name, 'Jones 4-5');
  close(s.azi[2], 270, 1e-6); assert.ok(s.inc[2] > 5 && s.inc[2] < 6);
  assert.ok(s.notes.some(n => /derived/.test(n)));
});

test('grid coordinates are not taken as offsets; a file without a survey header is not a survey', () => {
  const csv = 'MD,INC,AZI,Northing,Easting\n0,0,0,1650000,3100000\n500,1,10,1650001,3100000\n';
  const { surveys: [s] } = readSurvey(csv);
  assert.ok(s.north.every(Number.isNaN)); assert.ok(s.notes.some(n => /grid coordinate/.test(n)));
  assert.ok(!isSurvey('well,top,md\nA,Niobrara,6500\n'));
  assert.equal(fromFileName('Horsetail 02D directional survey.xlsx').name, 'Horsetail 02D');
});

test('offsetAt interpolates and extrapolates along the last station', () => {
  const b = build({ md: [0, 1000, 2000], inc: [0, 0, 90], azi: [0, 0, 0] }, 'ft');
  close(offsetAt(b, 1000).north, 0, 1e-9); const e = offsetAt(b, 2500); close(e.north - b.north[2], 500, 1e-6); close(e.tvd, b.tvd[2], 1e-6);
});

test('thin-plate grid honors the wells, stays inside the hull and reproduces a plane', () => {
  const pts = [[0, 0], [1000, 0], [0, 1000], [1000, 1000], [500, 300]].map(([x, y], i) => ({ x, y, v: 100 + 0.02 * x - 0.01 * y, id: 'w' + i }));
  const g = G.gridSurface(pts, { cells: 40 });
  for (const p of pts) close(g.f(p.x, p.y), p.v, 0.05);
  close(g.f(250, 750), 100 + 5 - 7.5, 0.05, 'plane');
  const far = G.hullDistance(g.hull, 5000, 5000); assert.ok(far > 4000);
  assert.ok(G.gridSurface(pts.slice(0, 2)).reason);
  assert.ok(G.gridSurface([0, 1, 2].map(i => ({ x: i * 100, y: i * 100, v: i, id: i }))).reason, 'collinear wells');
  assert.equal(G.mergeClose([{ x: 0, y: 0, v: 10, id: 'a' }, { x: 5, y: 0, v: 20, id: 'b' }])[0].v, 15);
  assert.equal(G.niceStep(0, 87), 10); assert.equal(G.niceStep(312, 337), 2.5);
});
