import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/js/views.js';
const { styleOf, dashFor, measure, captureView, applyView, describeView, exportSize } = globalThis.WellerViews;

test('line styles name the built-in dash patterns', () => {
  assert.equal(styleOf(undefined), 'solid');
  assert.equal(styleOf('5 3'), 'dash');
  assert.equal(styleOf('1 2'), 'dot');
  assert.equal(styleOf('1 3'), 'dot');
  assert.equal(styleOf('6 2 1 2'), 'dashdot');
  assert.equal(dashFor('dash', '4 2'), '4 2', 'same style keeps its own pattern');
  assert.equal(dashFor('dot', '4 2'), '1 2');
  assert.equal(dashFor('solid', '4 2'), null);
});

test('a measurement gives MD, TVD thickness and subsea depths', () => {
  const m = measure(6530, 6412, md => md * 0.5, 5000);
  assert.equal(m.top, 6412); assert.equal(m.base, 6530); assert.equal(m.dMD, 118);
  assert.equal(m.dTVD, 59); assert.equal(m.ssTop, 3206 - 5000);
  const v = measure(100, 150, null, NaN);
  assert.equal(v.dTVD, undefined); assert.equal(v.ssTop, undefined);
  assert.equal(measure(100, 150, null, 20).ssBase, 130, 'vertical well: TVD is MD');
});

test('a saved view restores section, hang, tracks and zoom', () => {
  const S = { mode: 'corr', selected: 'a', panel: ['a', 'b', 'c'], datum: 'Niobrara', corr: { spacing: 'distance', gap: 64 },
    tracks: [{ id: 't1', curves: [{ label: 'GR', lw: 2 }] }], view: { pxPerFt: 0.4 }, showEmpty: false, depthLabels: { md: true, ss: false } };
  const v = captureView(S, '  Niobrara section ', 6200);
  assert.equal(v.name, 'Niobrara section'); assert.equal(v.depthTop, 6200);
  S.tracks[0].curves[0].lw = 1; S.panel = ['a']; S.datum = 'MD';   // later edits do not leak into the view
  assert.equal(v.tracks[0].curves[0].lw, 2);
  const T = { mode: 'single', panel: [], datum: 'MD', corr: { gap: 64, spacing: 'equal' }, tracks: [], views: { single: {}, corr: { pxPerFt: 0.1 } } };
  const dropped = applyView(T, v, id => id !== 'c');
  assert.equal(dropped, 1); assert.deepEqual(T.panel, ['a', 'b']); assert.equal(T.datum, 'Niobrara');
  assert.equal(T.corr.spacing, 'distance'); assert.equal(T.views.corr.pxPerFt, 0.4); assert.equal(T.views.corr.fitted, true);
  assert.equal(T.tracks[0].curves[0].lw, 2);
  assert.match(describeView(v), /Correlation · 3 wells · flattened on Niobrara/);
});

test('PNG export size crops to the depth window and respects canvas limits', () => {
  const a = exportSize({ width: 1000, headerH: 120, y0: 200, y1: 1200, res: 2 });
  assert.equal(a.w, 2000); assert.equal(a.h, 2240); assert.equal(a.reduced, false);
  const b = exportSize({ width: 1000, headerH: 0, y0: 0, y1: 40000, res: 2 });
  assert.equal(b.h, 16000); assert.equal(b.reduced, true);
  assert.equal(exportSize({ width: 960, headerH: 0, y0: 0, y1: 960 }).printIn.h, 10);
});

test('page ranges split a depth window into abutting pages', () => {
  const { pageRanges } = globalThis.WellerViews;
  // 1:240 (0.4 px per ft), 11 in page = 1056 px, 156 px headers, 20 px footer: 2200 ft per page.
  const p = pageRanges(1000, 6000, { pxPerUnit: 0.4, pageH: 1056, headerH: 156, footH: 20 });
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], [1000, 3200]); assert.deepEqual(p[1], [3200, 5400]); assert.deepEqual(p[2], [5400, 6000]);
  assert.equal(pageRanges(0, 2200, { pxPerUnit: 0.4, pageH: 880 }).length, 1);
  assert.deepEqual(pageRanges(0, 100, { pxPerUnit: 1, pageH: 50, headerH: 60 }), [], 'headers taller than the page');
});
