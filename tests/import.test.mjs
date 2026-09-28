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

test('LAS 3.0 is named, not reported as generic failure', () => {
  const r = diagnoseLAS('~Version\nVERS. 3.0 :\n~Log_Definition\nDEPT .F :\n~Log_Data\n1 2\n', 'x.las');
  assert.match(errs(r)[0].title, /LAS 3\.0/);
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
