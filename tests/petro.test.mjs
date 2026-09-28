import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/js/petro.js';
const P = globalThis.WellerPetro;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('gamma-ray index and Vshale transforms', () => {
  near(P.igr(75, 25, 125), 0.5);
  near(P.vsh(75, 25, 125, 'linear'), 0.5);
  near(P.vsh(75, 25, 125, 'larionov-tertiary'), 0.083 * (2 ** 1.85 - 1));
  near(P.vsh(75, 25, 125, 'larionov-older'), 0.33 * (2 - 1));
  near(P.vsh(0, 25, 125), 0);
  near(P.vsh(500, 25, 125), 1);
  assert.ok(Number.isNaN(P.vsh(NaN, 25, 125)));
  // Clavier passes through (0,0) and (1,1) within rounding.
  near(P.vsh(25, 25, 125, 'clavier'), 0, 0.01);
  near(P.vsh(125, 25, 125, 'clavier'), 1, 0.01);
});

test('density porosity', () => {
  near(P.phiDensity(2.71, 2.71, 1.0), 0);
  near(P.phiDensity(2.368, 2.71, 1.0), 0.2);
  near(P.phiDensity(2.32, 2.65, 1.0), 0.2);
});

test('neutron-density porosity', () => {
  near(P.phiND(0.2, 0.2), 0.2);
  near(P.phiND(0.1, 0.3), Math.sqrt(0.05));
  near(P.phiND(0.1, 0.3, 'average'), 0.2);
  near(P.phiND(NaN, 0.25), 0.25);
});

test('Arps temperature correction', () => {
  near(P.rwAtTemp(0.1, 75, 75), 0.1);
  near(P.rwAtTemp(0.1, 75, 175), 0.1 * 81.77 / 181.77);
});

test('temperature gradient from BHT', () => {
  near(P.tempAtDepth(0, 60, 180, 8000), 60);
  near(P.tempAtDepth(4000, 60, 180, 8000), 120);
});

test('Archie: textbook case and limits', () => {
  // phi 0.2, Rw 0.05, Rt 20, a=1 m=2 n=2: Sw = sqrt(0.05 / (0.04*20)) = 0.25
  near(P.swArchie(20, 0.2, 0.05), 0.25);
  near(P.swArchie(0.5, 0.2, 0.05), 1);
  assert.ok(Number.isNaN(P.swArchie(20, 0, 0.05)));
});

test('Simandoux reduces to Archie with no shale and lowers Sw with shale', () => {
  near(P.swSimandoux(20, 0.2, 0.05, 0, 3), 0.25);
  const s = P.swSimandoux(20, 0.2, 0.05, 0.3, 3);
  assert.ok(s < 0.25 && s > 0);
  // It satisfies 1/Rt = phi^m Sw^2/(a Rw) + Vsh Sw / Rsh
  near(0.04 * s * s / 0.05 + 0.3 * s / 3, 1 / 20);
});

test('Passey delta log R and TOC', () => {
  near(P.deltaLogR(10, 1, 2.40, 2.40), 1);                       // one cycle of resistivity, no density change
  near(P.deltaLogR(10, 1, 2.00, 2.40), 1 + 1.0);                  // 0.4 g/cc lighter adds one cycle
  near(P.deltaLogR(10, 1, 100, 50, 'sonic'), 2);
  near(P.tocPassey(1, 10), 10 ** (2.297 - 1.688));
  near(P.tocPassey(-0.2, 10), 0);
});

test('bad hole flags', () => {
  assert.equal(P.badHole(9.2, 7.875, 0.02), true);
  assert.equal(P.badHole(8.2, 7.875, 0.2), true);
  assert.equal(P.badHole(8.2, 7.875, 0.05), false);
});

test('Pickett Rt line inverts Archie', () => {
  const rt = P.pickettRt(0.2, 0.25, 0.05);
  near(P.swArchie(rt, 0.2, 0.05), 0.25);
});

test('reduced log suites: SP Vshale, sonic porosity, resistivity-index Sw, washout', () => {
  near(P.vshSP(-60, -80, -20), 1 / 3);
  near(P.vshSP(-80, -80, -20), 0);
  near(P.vshSP(10, -80, -20), 1);
  near(P.vshSP(40, 60, 0), 1 / 3);                    // reversed SP: sand line to the right
  assert.ok(Number.isNaN(P.vshSP(-50, -20, -20)));
  near(P.phiSonic(90, 55.5), 0.625 * 34.5 / 90);
  near(P.phiSonic(50, 55.5), 0);
  near(P.swFromRI(4, 1, 2), 0.5);
  near(P.swFromRI(0.5, 1, 2), 1);
  assert.ok(P.washout(10, 8.75));
  assert.ok(!P.washout(9.5, 8.75));
  assert.ok(!P.washout(12, NaN));
});
