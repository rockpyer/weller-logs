/* Well(er) Logs: TIFF mudlog decoding off the main thread. Decodes each page once, then cuts it into horizontal strips
   (bands) at display resolution plus a quarter-resolution overview, encoded as WebP (JPEG where WebP encoding is
   missing). The full-size RGBA image is never built: rows are expanded a few thousand at a time. */
importScripts('../vendor/pako.min.js', '../vendor/UTIF.js');

const encode = async (cv) => {
  let b = await cv.convertToBlob({ type: 'image/webp', quality: 0.82 });
  if (b.type !== 'image/webp') b = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return b;
};

self.onmessage = async (e) => {
  const { buf, maxW = 2000, band = 2048, loF = 4, maxDecodedMB = 600 } = e.data;
  const t0 = performance.now();
  try {
    const ifds = UTIF.decode(buf).filter((d) => d.t256 && d.t257);
    // Reduced-resolution copies (NewSubfileType bit 0) are thumbnails, not pages.
    const pages = ifds.filter((d) => !(d.t254 && d.t254[0] & 1));
    if (!pages.length) throw new Error('No image found in this TIFF.');
    const meta = pages.map((d) => { const W = d.t256[0], H = d.t257[0], f = Math.max(1, Math.ceil(W / maxW)); return { W, H, f, w: Math.floor(W / f), h: Math.floor(H / f) }; });
    const dpi = pages[0].t282 ? pages[0].t282[0] : null;
    self.postMessage({ type: 'meta', pages: meta.map(({ w, h, f, W, H }) => ({ w, h, f, W, H })), dpi });
    for (let p = 0; p < pages.length; p++) {
      const ifd = pages[p], m = meta[p];
      const bps = ifd.t258 ? Math.min(32, ifd.t258[0]) : 1, spp = ifd.t258 ? ifd.t258.length : 1;
      if (m.W * m.H * (bps * spp) / 8 / 1048576 > maxDecodedMB) throw new Error(`Page ${p + 1} is ${m.W}×${m.H} px at ${bps * spp} bits per pixel, too large to decode in the browser.`);
      self.postMessage({ type: 'progress', page: p, stage: 'decode' });
      UTIF.decodeImage(buf, ifd, ifds);
      const bpl = Math.ceil(m.W * bps * spp / 8), data = ifd.data;
      const hi = new OffscreenCanvas(m.w, band), hc = hi.getContext('2d');
      const lo = new OffscreenCanvas(Math.max(1, Math.round(m.w / loF)), band), lc = lo.getContext('2d');
      hc.imageSmoothingQuality = lc.imageSmoothingQuality = 'high';
      let loIdx = 0, loFilled = 0;
      const nb = Math.ceil(m.h / band);
      for (let b = 0; b < nb; b++) {
        const r0 = b * band, rows = Math.min(band, m.h - r0);
        hc.fillStyle = '#fff'; hc.fillRect(0, 0, m.w, band);
        // Expand source rows in pieces of at most ~4k rows so memory stays bounded.
        const s0 = r0 * m.f, s1 = Math.min(m.H, (r0 + rows) * m.f), piece = Math.max(m.f, Math.floor(4096 / m.f) * m.f);
        for (let s = s0; s < s1; s += piece) {
          const n = Math.min(piece, s1 - s);
          const sub = { width: m.W, height: n, data: data.subarray(s * bpl, (s + n) * bpl), t262: ifd.t262, t258: ifd.t258, t320: ifd.t320, t338: ifd.t338 };
          const rgba = UTIF.toRGBA8(sub);
          const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer, 0, m.W * n * 4), m.W, n));
          hc.drawImage(bmp, 0, 0, m.W, n, 0, (s - s0) / m.f, m.w, n / m.f); bmp.close();
        }
        const blob = await encode(rows < band ? copyRows(hi, rows) : hi);
        self.postMessage({ type: 'band', page: p, level: 0, idx: b, rows, blob });
        // Quarter-resolution overview, filled band by band.
        const ly = Math.round(loFilled);
        lc.drawImage(hi, 0, 0, m.w, rows, 0, ly, lo.width, rows / loF); loFilled += rows / loF;
        if (loFilled >= band - 0.5 || b === nb - 1) {
          const lr = Math.ceil(loFilled);
          self.postMessage({ type: 'band', page: p, level: 1, idx: loIdx++, rows: lr, blob: await encode(lr < band ? copyRows(lo, lr) : lo) });
          lc.fillStyle = '#fff'; lc.fillRect(0, 0, lo.width, band); loFilled = 0;
        }
        self.postMessage({ type: 'progress', page: p, stage: 'bands', done: b + 1, of: nb });
      }
      ifd.data = null;
    }
    self.postMessage({ type: 'done', ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message || String(err) });
  }
};
function copyRows(cv, rows) { const c = new OffscreenCanvas(cv.width, Math.max(1, rows)); c.getContext('2d').drawImage(cv, 0, 0); return c; }
