import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/js/apicodes.js';
import '../app/js/las.js';
import '../app/js/tables.js';
const T = globalThis.WellerTables;

const well = (id, name, api, extra = {}) => ({ id, name, api, tops: [], elevation: {}, location: {}, depthUnit: 'F', ...extra });
const tsv = rows => rows.map(r => r.join('\t')).join('\n') + '\n';

// The tops sheet as exported: extra columns, "Marker / Formation Top", "Top (ft MD)", a 9-digit API (leading zero lost).
const TOPS = tsv([
  ['Well Name', 'API 10', 'Short Name', 'Spud Date', 'In Scope', 'Marker / Formation Top', 'Marker Type', 'Top (ft MD)', 'Top (ft TVD)'],
  ['WEZU 24 F', '403730580', 'WEZU 24 F', 'Jul-22', 'In Scope', 'BFW', 'Base BFW', '652', '652'],
  ['WEZU 24 F', '403730580', 'WEZU 24 F', 'Jul-22', 'In Scope', 'T. UCZ', 'Formation top', '4470', '4471'],
  ['WEZU C-7', '403724344', 'WEZU C-7', 'May-11', 'AOR', 'T. Yule (TIZ)', 'Formation top', '6343', '6343'],
  ['WEZU C-7', '403724344', 'WEZU C-7', 'May-11', 'AOR', 'T. Yule (TIZ)', 'Formation top', '6375', '6375'],
  ['WEZU C-7', '403724344', 'WEZU C-7', 'May-11', 'AOR', 'T. Yule (TIZ)', 'Formation top', '6375', '6375'],
  ['WEZU C-7', '403724344', 'WEZU C-7', 'May-11', 'AOR', 'BFW', 'Base BFW', '680', '680'],
  ['WEZU C-7', '403724344', 'WEZU C-7', 'May-11', 'AOR', 'BFW', 'Base BFW', '680', '680'],
]);
const HEADER = tsv([
  ['Well Name', 'API 10', 'Short Name', 'API 12', 'Field', 'Well Type', 'Status', 'In Scope', 'Spud Date', 'GL (ft)', 'KB (ft)', 'KB-GL (ft)', 'Depth Datum', 'TD TVD (ft)', 'TD MD (ft)', 'Latitude', 'Longitude', 'X (ftUS)', 'Y (ftUS)', 'CRS'],
  ['WEZU 24 F', '403730580', 'WEZU 24 F', '040373058000', 'Honor Rancho', 'Injection/Withdrawal', 'Out of Service - RTS', 'In Scope', '2022-07-25', '1290.1', '1313.5', '23.4', 'KB elev, ft (Petrel operator datum)', '9260', '9536', '34.450897', '-118.597364', '6381581.22', '1987007.10', 'NAD83 / California State Plane Zone 5 (ftUS) [EPSG:2229]'],
  ['WEZU 18 E', '403730575', 'WEZU 18 E', '040373057500', 'Honor Rancho', 'Injection/Withdrawal', 'Active', 'In Scope', '2021-09-29', '1250.7', '', '23.6', '', '9270', '9736', '34.451652', '-118.591667', '', '', ''],
]);

test('delimiters: tab, comma and quoted commas', () => {
  assert.equal(T.readDelimited('a\tb\n1\t2').delim, '\t');
  const c = T.readDelimited('well,top,md\n"A, 1",BFW,686\n');
  assert.deepEqual(c.rows[0], ['A, 1', 'BFW', '686']);
  assert.equal(T.readDelimited('a;b\n1;2').delim, ';');
});

test('a tops sheet with extra columns is tops; MD is "Top (ft MD)", not the TVD column', () => {
  const t = T.readTable(TOPS, 'tops.tsv');
  assert.equal(t.kind, 'tops');
  assert.equal(t.cls.name.raw, 'Marker / Formation Top');
  assert.equal(t.cls.md.raw, 'Top (ft MD)');
  assert.equal(t.records[0].md, 652);
});

test('a well-header sheet is recognized column by column; unknown columns are kept as attributes', () => {
  const t = T.readTable(HEADER, 'h.tsv'), r = t.records[0];
  assert.equal(t.kind, 'header');
  assert.equal(r.api, '040373058000');   // the longer of API 10 and API 12
  assert.equal(r.vals.kb[0].v, 1313.5); assert.equal(r.vals.gl[0].v, 1290.1); assert.equal(r.vals.kbgl[0].v, 23.4);
  assert.equal(r.vals.lat[0].v, 34.450897); assert.equal(r.vals.lon[0].v, -118.597364);
  assert.equal(r.vals.tdMD[0].v, 9536); assert.equal(r.vals.tdTVD[0].v, 9260);
  assert.equal(r.vals.spud[0].v, '2022-07-25');
  assert.ok(r.vals.xyCrs && !r.vals.crs, 'a state-plane CRS belongs to X/Y, not lat/long');
  assert.equal(r.attrs['In Scope'], 'In Scope');
});

test('rows match wells by API (9, 10 or 12 digits) or by name ignoring spaces', () => {
  const w = [well('a', 'WEZU 24F', '040373058000'), well('b', 'Wezu 18E', '')];
  assert.equal(T.matchWell(w, { api: T.cleanApi('403730580') })?.id, 'a');
  assert.equal(T.matchWell(w, { name: 'WEZU 18 E', api: '' })?.id, 'b');
  assert.equal(T.matchWell(w, { name: 'nope', api: '0403799999' }), null);
});

test('plan: repeated rows collapse, disagreements become choices, blanks fill', () => {
  const w = [well('a', 'WEZU 24F', '040373058000', { tops: [{ name: 'BFW', md: 660 }] }), well('c', 'WEZU C-7', '0403724344')];
  const p = T.plan(w, [T.readTable(TOPS, 'tops.tsv')]);
  assert.deepEqual(p.fills.map(f => `${f.well} ${f.label} ${f.value}`).sort(), ['WEZU 24F T. UCZ 4470', 'WEZU C-7 BFW 680']);
  const yule = p.conflicts.find(c => c.label === 'T. Yule (TIZ)');
  assert.equal(yule.options[yule.choice].value, 6375, 'the value most rows give is preselected');
  const bfw = p.conflicts.find(c => c.wid === 'a' && c.label === 'BFW');
  assert.ok(bfw.options.some(o => o.current && o.value === 660), 'the current value is offered');
  T.applyValue(w[0], 'top:BFW', 652); assert.equal(w[0].tops[0].md, 652);
});

test('plan: header fills, KB from GL plus rig height, longer API is an upgrade', () => {
  const w = [well('a', 'WEZU 24F', '0403730580', { elevation: { kb: 1309.6, gl: 1286 } }), well('e', 'WEZU 18E', '040373057500')];
  const p = T.plan(w, [T.readTable(HEADER, 'h.tsv')]);
  const f = k => p.fills.find(x => x.wid === 'e' && x.key === k);
  assert.equal(f('kb').value, 1274.3);
  assert.ok(p.fills.some(x => x.wid === 'a' && x.key === 'api' && x.value === '040373058000'));
  const kb = p.conflicts.find(c => c.wid === 'a' && c.key === 'kb');
  assert.deepEqual(kb.options.map(o => o.value).sort(), [1309.6, 1313.5]);
  for (const x of p.fills) T.applyValue(w.find(y => y.id === x.wid), x.key, x.value);
  assert.equal(w[1].header.status, 'Active'); assert.equal(w[1].location.lat, 34.451652);
});

test('two files merge: the same value from both is one value, not a conflict', () => {
  const w = [well('a', 'WEZU 24F', '')];
  const csv = 'well,top,md\nWEZU 24F,BFW,652\n';
  const p = T.plan(w, [T.readTable(TOPS, 'a.tsv'), T.readTable(csv, 'b.csv')]);
  const bfw = p.fills.find(f => f.label === 'BFW');
  assert.equal(bfw.value, 652); assert.equal(p.conflicts.filter(c => c.wid === 'a').length, 0);
});

test('dates: ISO, US, day-month-year and Excel serials', () => {
  assert.equal(T.cleanDate('4/22/2021'), '2021-04-22');
  assert.equal(T.cleanDate('22-Apr-2021'), '2021-04-22');
  assert.equal(T.cleanDate('44308'), '2021-04-22');
  assert.equal(T.cleanDate('Dec-20'), 'Dec-20');
});

test('real sheet headers: GL-KB is rig height, vertical datum is not the CRS, the "final truth" GL wins', () => {
  const H = ['Well Name', 'API 10', 'Short Name', 'Active Wellbore (API 12)', 'Field Name', 'Well Type', 'Well Status', 'In Scope', 'Spud Date', 'GLE (ft) - Claude extracted', 'GL (ft) from blender - Final Truth', 'KB (ft)', 'GL-KB (ft)', 'Datum (Vertical)', 'Conductor Depth (ft)', 'Surface Csg Depth (ft)', 'Surface Csg Size (in)', 'Production Csg Depth (ft)', 'TD (ft MD)', 'Latitude', 'Longitude', 'X', 'Y', 'CRS (Horizontal)', 'Coord Source', 'Wellbore Config (Vert/Dev/Horiz)'];
  const row = ['WEZU 24 G', '403730579', 'WEZU 24 G', '040373057900', 'Honor Rancho', 'Injection/Withdrawal', 'Out of Service - RTS', 'In Scope', '2022-10-19', '1290.0', '1290.4', '1313.5', '23.5', 'KB elev, ft (Petrel operator datum)', '103', '1148', '13.375', '9333', '9614', '34.450867', '-118.597236', '6381619.63', '1986995.94', 'NAD83 / California State Plane Zone 5 (ftUS) [EPSG:2229]', '', ''];
  const t = T.readTable(tsv([H, row]), 'h.tsv'), keys = Object.fromEntries(t.cls.cols.map(c => [c.raw, c.key]));
  assert.equal(keys['GL-KB (ft)'], 'kbgl'); assert.equal(keys['Datum (Vertical)'], 'datumRef'); assert.equal(keys['TD (ft MD)'], 'tdMD');
  const v = t.records[0].vals;
  assert.deepEqual(v.gl.map(x => x.v), [1290.4]);
  assert.equal(v.datumRef[0].v, 'KB elev, ft (Petrel operator datum)'); assert.ok(!v.crs && v.xyCrs);
  assert.equal(t.records[0].attrs['Production Csg Depth (ft)'], '9333');
  // Without a "final" column, two GL columns that differ are both offered.
  const t2 = T.readTable(tsv([['Well', 'GL (ft) A', 'GL (ft) B', 'KB'], ['W1', '100', '101', '120']]), 'g.tsv');
  const p = T.plan([well('a', 'W1', '')], [t2]);
  assert.deepEqual(p.conflicts.find(c => c.key === 'gl').options.map(o => o.value), [100, 101]);
});
