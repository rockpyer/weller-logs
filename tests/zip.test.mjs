import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/js/zip.js';
import '../app/js/tables.js';
const { zip, crc32, uniqueNames } = globalThis.WellerZip;

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('zip round-trips through the xlsx unzip reader', async () => {
  const bytes = zip([{ name: 'las/A.las', data: '~V\nVERS. 2.0 :\n' }, { name: 'tops.csv', data: 'well,top\nA,Niobrara\n' }, { name: 'img.png', data: Uint8Array.of(137, 80, 78, 71) }]);
  const z = await globalThis.WellerTables.unzip(bytes.buffer);
  assert.deepEqual(Object.keys(z).sort(), ['img.png', 'las/A.las', 'tops.csv']);
  assert.equal(await z['tops.csv'](), 'well,top\nA,Niobrara\n');
});

test('duplicate names get a suffix', () => {
  assert.deepEqual(uniqueNames(['A.las', 'B.las', 'a.las']), ['A.las', 'B.las', 'a_2.las']);
});
