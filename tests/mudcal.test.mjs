import test from 'node:test';
import assert from 'node:assert/strict';
import cal from '../app/js/mudcal.js';
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const word = (s, x, y, h = 10) => ({ s, x, y, w: s.length * h * 0.55, h });

test('depth labels: consensus fit ignores stray numbers', () => {
  // Labels every 100 ft, 145 px apart, in one column; gas units, a rig number and OCR noise elsewhere.
  const items = [];
  for (let k = 1; k <= 20; k++) items.push(word(String(k * 100), 180, 700 + (k - 1) * 145));
  items.push(word('587', 680, 470), word('100', 338, 315), word('600', 415, 1515), word('2015', 638, 104), word('1003', 395, 900));
  const f = cal.fitDepthLabels(items, { pxPerIn: 200, width: 2290 });
  assert.ok(f, 'fit found');
  assert.equal(f.n, 20); assert.equal(f.step, 100);
  near(f.b, 100 / 145, 1e-9);
  near(f.a + f.b * (700 + 5), 100, 1e-6);   // label centre
});

test('depth labels: comma thousands and a page with too few numbers', () => {
  const items = [];
  for (let k = 0; k < 22; k++) items.push(word((1220 + k * 10).toLocaleString('en-US'), 400, 50 + k * 75, 12));
  const f = cal.fitDepthLabels(items, { pxPerIn: 160, width: 1275 });
  assert.equal(f.vMin, 1220); assert.equal(f.vMax, 1430); near(f.b, 10 / 75, 1e-9);
  assert.equal(cal.fitDepthLabels([word('100', 10, 10), word('200', 10, 60)], {}), null);
  assert.equal(cal.numberOf('1,250'), 1250); assert.equal(cal.numberOf("7608'"), 7608); assert.ok(Number.isNaN(cal.numberOf('12.5 ppg')));
});

test('consistent fits drop a page whose scale disagrees', () => {
  const g = { a: 0, b: 0.133 }, bad = { a: 0, b: 0.5 };
  assert.deepEqual(cal.consistentFits([g, g, bad, g, null]), [g, g, null, g, null]);
});

test('calibration: two ties, text fit, one tie, continuation, skip', () => {
  const pages = [
    { h: 1000, skip: true },                                   // header page
    { h: 1000, ties: [{ y: 100, md: 500 }, { y: 900, md: 600 }] },
    { h: 1000 },                                               // continues at the same scale
    { h: 1000, ties: [{ y: 0, md: 800 }] },                    // one tie: scale from the page above
    { h: 1000, fit: { a: 1000, b: 0.2 }, ties: [{ y: 500, md: 1110 }] }, // text scale, shifted to the tie
  ];
  const s = cal.solvePages(pages);
  assert.equal(s[0], null);
  near(cal.mdAt(s[1], 500), 550); near(cal.yAt(s[1], 550), 500);
  near(cal.mdAt(s[2], 0), cal.mdAt(s[1], 1000)); near(s[2].segs[0].b, 0.125); assert.ok(s[2].cont);
  near(cal.mdAt(s[3], 0), 800); near(s[3].segs[0].b, 0.125);
  near(cal.mdAt(s[4], 500), 1110); near(s[4].segs[0].b, 0.2);
  assert.ok(cal.solvePages([{ h: 10, ties: [{ y: 0, md: 100 }, { y: 5, md: 90 }] }])[0].bad);
  // Nothing before the first calibrated page is drawn.
  assert.deepEqual(cal.solvePages([{ h: 10 }, { h: 10 }]), [null, null]);
});

test('calibration: piecewise ties invert exactly', () => {
  const s = cal.solvePages([{ h: 1000, ties: [{ y: 0, md: 0 }, { y: 400, md: 100 }, { y: 1000, md: 400 }] }])[0];
  for (const y of [-50, 0, 200, 400, 700, 1000, 1200]) near(cal.yAt(s, cal.mdAt(s, y)), y, 1e-9);
  near(cal.mdAt(s, 700), 250);
});

test('header: label and value on one line, label beside value, inline elevations', () => {
  // Layout 1: "Label value" as one run (MPlot).
  const a = cal.parseHeader([word('Well Name Confidential', 100, 100), word('Ground Elevation 6172', 100, 130), word('State UT', 100, 160), word('Company Acme Oil', 100, 190)], { width: 1275 });
  assert.equal(a.gl, 6172); assert.equal(a.state, 'UT'); assert.equal(a.company, 'Acme Oil'); assert.ok(a.nameHidden);
  // Layout 2: labels in one column, values in the next (scanned header, OCR).
  const b = cal.parseHeader([
    word('WELL:', 24, 182), word('Fernando Fee 32G', 73, 180), word('API#:', 24, 212), word('04-037-30374', 73, 212),
    word('COMPANY: Southern California Gas Company', 24, 250), word('LOCATION: 34.313458’N, 118.540391’w', 24, 275),
    word("ELEVATION: 1998.78'GL, 2021.28'KB", 267, 300),
  ], { width: 1831 });
  assert.equal(b.name, 'Fernando Fee 32G'); assert.equal(b.api, '04-037-30374'); assert.equal(b.company, 'Southern California Gas Company');
  assert.equal(b.gl, 1998.78); assert.equal(b.kb, 2021.28); assert.deepEqual(b.location, { lat: 34.313458, lon: -118.540391 });
  // Metric depth columns are flagged.
  assert.equal(cal.parseHeader([word('To (m)', 10, 10)], {}).unit, 'm');
});

test('lat/long needs a hemisphere or a location label', () => {
  assert.deepEqual(cal.latLon('Lat 40.123456 Long -104.654321'), { lat: 40.123456, lon: -104.654321 });
  assert.deepEqual(cal.latLon('33.8912 S 151.2034 E'), { lat: -33.8912, lon: 151.2034 });
  assert.equal(cal.latLon('Gas 12.345 units, 67.891 ppm'), null);
});

test('line snapping picks a dark ruled row near the click', () => {
  const rows = new Float32Array(21).fill(0.05); rows[14] = 0.8;
  assert.equal(cal.snapRow(rows, 10, 8), 14);
  assert.equal(cal.snapRow(new Float32Array(21).fill(0.05), 10, 8), 10);
});
