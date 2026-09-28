import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/js/las.js';
const { parseLAS, normalizeWell, diagnoseLAS, apiKey, mergeWells } = globalThis.WellerLAS;

const las = ({ api = '47-061-01812', unit = 'F', rows, curves = ['DEPT .F', 'GR .GAPI'], extra = '' }) => `~V
VERS. 2.0 :
WRAP. NO :
~W
NULL. -999.25 :
WELL. BOGGESS 17H :
API . ${api} :
${extra}~C
${curves.map(c => c.replace('.F', '.' + unit)).join(' :\n')} :
~A
${rows.map(r => r.join(' ')).join('\n')}
`;
const well = (o, name = 't.las') => normalizeWell(parseLAS(las(o)), name);
const errs = r => r.problems.filter(p => p.level === 'error');

test('binary and non-LAS files say what they are', () => {
  assert.match(errs(diagnoseLAS('%PDF-1.7 ...', 'log.pdf'))[0].title, /PDF/);
  assert.match(errs(diagnoseLAS('xx', 'a.xlsx', Uint8Array.of(0x50, 0x4b, 3, 4)))[0].title, /ZIP|Excel/);
  assert.match(errs(diagnoseLAS('\u0000\u0001garbage\u0000\u0000\u0000', 'x.bin'))[0].title, /binary/);
  const csv = errs(diagnoseLAS('depth,gr\n1000,50\n1001,60', 'x.txt'))[0];
  assert.match(csv.title, /delimited/i); assert.equal(csv.snippet[0].line, 1);
});

const LAS3 = `~Version
VERS.  3.0 : CWLS LOG ASCII STANDARD - VERSION 3.0
WRAP.  NO  : ONE LINE PER DEPTH STEP
DLM .  COMMA : DELIMITING CHARACTER
~Well
STRT.M    1670.0 : First Index Value
STOP.M    1670.5 : Last Index Value
STEP.M    0.25   : STEP
NULL.     -999.25 : NULL VALUE
WELL.     "ANY ET AL 12-34-12-34" : WELL
UWI .     100123401234W500 : UNIQUE WELL ID
~Log_Parameter
BS  .MM   200.0 : Bit Size {F10.1} | Log_Definition
~Log_Definition
DEPT .M     : Depth {F10.3}
DT   .US/M  : Sonic {F10.1}
RHOB .K/M3  : Density {F10.1}
FACI .      : Facies {S}
~Log_Data | Log_Definition
1670.000, 123.45, 2550.0, "Shale A"
1670.250, 123.45, 2550.0, Sand
1670.500, -999.25, 2560.0, Sand
~Core_Definition
CORT.M : Core top
~Core_Data | Core_Definition
1670.1
~Tops_Definition
TOPN. : Top name {S}
TOPT.M : Top depth {F}
~Tops_Data | Tops_Definition
"Viking Sand", 1670.2
~Inclinometry_Definition
MD  .M : Measured depth
INC .DEG : Inclination
AZI .DEG : Azimuth
~Inclinometry_Data | Inclinometry_Definition
0, 0, 0
1000, 10, 45
1700, 30, 45
`;
test('LAS 3.0: log data, quoted text, tops and inclinometry are read', () => {
  const r = diagnoseLAS(LAS3, 'x.las');
  assert.equal(errs(r).length, 0, JSON.stringify(errs(r)));
  assert.ok(r.problems.some(p => /skipped Core/.test(p.title)));
  const w = normalizeWell(r.parsed, 'x.las');
  assert.equal(w.name, 'ANY ET AL 12-34-12-34');
  assert.deepEqual(w.curves.map(c => c.mnemonic), ['DEPT', 'DT', 'RHOB', 'FACI']);
  assert.equal(w.rows, 3); assert.equal(w.curves[2].data[2], 2560); assert.ok(Number.isNaN(w.curves[1].data[2]));
  assert.equal(w.depthUnit, 'm'); assert.equal(w.tops[0].name, 'Viking Sand'); assert.equal(w.tops[0].md, 1670.2);
  assert.ok(w.survey && w.survey.md.length === 3);
});

test('missing sections, empty data and text in data are errors with the line', () => {
  assert.match(errs(diagnoseLAS('~V\nVERS. 2.0 :\n~W\nWELL. X :\n~A\n1 2\n', 'x.las'))[0].title, /~Curve/);
  assert.match(errs(diagnoseLAS('~V\nVERS. 2.0 :\n~C\nDEPT .F :\n', 'x.las'))[0].title, /~A/);
  const t = diagnoseLAS(las({ rows: [['1000,5', '50,2'], ['1001,0', '60,1']] }), 'x.las');
  const e = errs(t)[0]; assert.match(e.title, /2 of 2 data lines/); assert.equal(e.snippet[0].line, 12); assert.match(e.fix, /decimal/);
  const u = errs(diagnoseLAS(las({ rows: [[1000, 'abc'], [1001, 'def']] }), 'x.las'))[0]; assert.match(u.title, /all numbers/); assert.equal(u.snippet[0].mark, 'abc');
});

test('column count mismatch shows the line and suggests WRAP', () => {
  const r = diagnoseLAS(las({ curves: ['DEPT .F', 'GR .GAPI', 'RHOB .G/C3'], rows: [[1000, 50], [1001, 60], [1002, 70]] }), 'x.las');
  const e = errs(r)[0]; assert.match(e.title, /3 of 3 data lines/); assert.equal(e.snippet[0].line, 13); assert.match(e.fix, /WRAP/);
});

test('all-null data is an error, a partly bad file loads with warnings', () => {
  assert.match(errs(diagnoseLAS(las({ rows: [[1000, -999.25], [1001, -999.25]] }), 'x.las'))[0].title, /null/);
  const r = diagnoseLAS(las({ rows: [[1000, 50], [1001, 'n/a'], [1002, 70], [1003, 80]] }), 'x.las');
  assert.equal(errs(r).length, 0); assert.ok(r.problems.some(p => p.level === 'warn' && /skipped/.test(p.title)));
  assert.equal(r.parsed.rows, 3);
});

test('API keys: 10-digit is the original hole, sidetracks differ, event codes do not', () => {
  assert.equal(apiKey('47-061-01812').key, '4706101812-00');
  assert.equal(apiKey('47061018120000').key, '4706101812-00');
  assert.equal(apiKey('47-061-01812-00-03').key, '4706101812-00');
  assert.equal(apiKey('47-061-01812-01').key, '4706101812-01');
  assert.equal(apiKey('049-021-21034').key, '4902121034-00');
  assert.equal(apiKey('100/06-12-034-05W4/00').us, false);
  assert.equal(apiKey(''), null);
});

test('two logging runs merge onto one grid; the first file wins overlaps', () => {
  const a = well({ rows: [[1000, 10], [1000.5, 11], [1001, 12]] }, 'run1.las');
  const b = well({ curves: ['DEPT .F', 'GR .GAPI', 'RHOB .G/C3'], rows: [[1001, 99, 2.5], [1001.5, 14, 2.4], [1002, 15, 2.3]] }, 'run2.las');
  const m = mergeWells([a, b]);
  assert.deepEqual(Array.from(m.curves[0].data), [1000, 1000.5, 1001, 1001.5, 1002]);
  const gr = m.curves.find(c => c.mnemonic === 'GR'), rhob = m.curves.find(c => c.mnemonic === 'RHOB');
  assert.deepEqual(Array.from(gr.data), [10, 11, 12, 14, 15]);
  assert.ok(Number.isNaN(rhob.data[0])); assert.equal(rhob.data[4], 2.3);
  assert.deepEqual(m.sources, ['run1.las', 'run2.las']);
  assert.equal(a.curves[1].data.length, 3, 'parts are not modified');
});

test('merge converts metres to the first file\'s feet and keeps same-mnemonic different-unit curves apart', () => {
  const a = well({ rows: [[1000, 10], [1001, 11]] }, 'a.las');
  const b = well({ unit: 'M', curves: ['DEPT .F', 'GR .CPS'], rows: [[304.8, 500], [305.1048, 510]] }, 'b.las');
  const m = mergeWells([a, b]);
  assert.equal(m.depthUnit, 'ft'); assert.ok(m.curves.some(c => c.mnemonic === 'GR:2'));
  assert.ok(m.notes.some(n => /converted m → ft/.test(n)));
});

test('coordinates in degrees-minutes-seconds with hemisphere letters', () => {
  const { parseCoord } = globalThis.WellerLAS;
  assert.ok(Math.abs(parseCoord('041° 02\' 31.040" N').v - 41.04196) < 1e-4);
  assert.ok(Math.abs(parseCoord('104� 26\' 37.660" W').v + 104.44379) < 1e-4);
  assert.equal(parseCoord('-104.5').v, -104.5);
  const w = well({ rows: [[1000, 1], [1001, 2]], extra: 'LAT . 41 2 31.04 N :\nLONG. 104 26 37.66 W :\n' });
  assert.ok(Math.abs(w.location.lon + 104.4438) < 1e-3); assert.ok(!w.notes.some(n => /corrected/.test(n)));
});

test('mud-log drill time (min/ft) becomes ROP in ft/hr', () => {
  const w = well({ curves: ['DEPT .F', 'ROP .min_/_ft'], rows: [[1000, 2], [1001, 0.5]] });
  assert.deepEqual(Array.from(w.curves[1].data), [30, 120]); assert.equal(w.curves[1].unit, 'ft/hr');
});

test('a TVD curve stands in for a survey', () => {
  const rows = Array.from({ length: 50 }, (_, i) => [1000 + i * 10, Math.min(1000 + i * 10, 1200 + (i * 10 - 200) * 0.2), 50]);
  const w = well({ curves: ['DEPT .F', 'TVD .F', 'GR .GAPI'], rows });
  assert.ok(w.survey); assert.ok(w.survey.tvd.at(-1) < w.survey.md.at(-1));
});

test('overlapping curves from different tools stay separate; a CBL gamma ray is marked cased', () => {
  const rows = Array.from({ length: 40 }, (_, i) => [1000 + i, 50 + i]);
  const a = well({ rows }, 'mudlog.las');
  const b = well({ curves: ['DEPT .F', 'GR .GAPI', 'CCL .'], rows: rows.map(r => [r[0], r[1] / 2, 0]) }, 'cbl.las');
  assert.ok(b.curves.find(c => c.mnemonic === 'GR').cased);
  const m = mergeWells([a, b]);
  assert.deepEqual(m.curves.filter(c => /^GR/.test(c.mnemonic)).map(c => [c.mnemonic, !!c.cased]), [['GR', false], ['GR:2', true]]);
});

test('well names compare without case or punctuation', () => {
  const { nameKey } = globalThis.WellerLAS;
  assert.equal(nameKey('CARPENTER 126-0408H'), nameKey('Carpenter 126 0408H'));
});
