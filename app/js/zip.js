/* Minimal ZIP writer (stored, no compression) for multi-file exports: all wells as LAS, the full project bundle.
   LAS and CSV are small next to the PNG, which is already compressed, so deflate would buy little. */
(function (root) {
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder();
  // DOS date and time, as ZIP stores them.
  const dos = d => [((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF];
  /* files: [{name, data}] with data a string or Uint8Array. Returns a Uint8Array. Names are UTF-8 (flag bit 11). */
  function zip(files, date = new Date()) {
    const [tm, dt] = dos(date), local = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      local.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const parts = [...local, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
    let p = 0; for (const a of parts) { out.set(a, p); p += a.length; }
    return out;
  }
  // Unique, filesystem-safe names within one archive: "A.las", "A_2.las".
  function uniqueNames(names) { const seen = new Map(); return names.map(n => { const k = n.toLowerCase(), i = (seen.get(k) || 0) + 1; seen.set(k, i); return i === 1 ? n : n.replace(/(\.[^.]+)?$/, m => `_${i}${m}`); }); }
  root.WellerZip = { zip, crc32, uniqueNames };
})(typeof window !== 'undefined' ? window : globalThis);
