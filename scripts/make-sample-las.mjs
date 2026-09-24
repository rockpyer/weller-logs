// Writes samples/*.las from the synthetic generator. Run: node scripts/make-sample-las.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import '../mockup/synth.js';
const { makeWell, PRESET_WELLS, toLAS } = globalThis.WellerSynth;
mkdirSync('samples', { recursive: true });
for (const cfg of PRESET_WELLS) {
  const w = makeWell(cfg);
  const f = `samples/${w.name.replace(/[^A-Za-z0-9]+/g, '_')}.las`;
  writeFileSync(f, toLAS(w));
  console.log('wrote', f, w.curves[0].data.length, 'rows');
}
