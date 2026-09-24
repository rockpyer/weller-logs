/* Synthetic LA Basin wells for demo and tests. Works in browser (global WellerSynth) and Node. */
(function (root) {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Formations in the LA Basin, top to bottom. Character drives the synthetic curves.
  const FORMATIONS = [
    { name: 'Pico',    vsh: 0.62, sandFrac: 0.30, bed: [8, 50],  gas: 0.05 },
    { name: 'Repetto', vsh: 0.35, sandFrac: 0.55, bed: [5, 40],  gas: 0.35 },
    { name: 'Puente',  vsh: 0.85, sandFrac: 0.12, bed: [10, 80], gas: 0.10 },
  ];

  function makeWell(cfg) {
    const rnd = mulberry32(cfg.seed);
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const step = 0.5, start = 100, stop = cfg.td || 6000;
    const n = Math.floor((stop - start) / step) + 1;
    const depth = new Float64Array(n);
    for (let i = 0; i < n; i++) depth[i] = start + i * step;

    // Build a bed stack: each bed has vsh, gas flag.
    const beds = [];
    let d = start;
    const topsMD = cfg.tops; // {Pico, Repetto, Puente}
    function fmAt(z) {
      if (z >= topsMD.Puente) return FORMATIONS[2];
      if (z >= topsMD.Repetto) return FORMATIONS[1];
      if (z >= topsMD.Pico) return FORMATIONS[0];
      return { name: 'Alluvium', vsh: 0.45, sandFrac: 0.5, bed: [10, 60], gas: 0 };
    }
    while (d < stop) {
      const fm = fmAt(d);
      const th = fm.bed[0] + rnd() * (fm.bed[1] - fm.bed[0]);
      const sand = rnd() < fm.sandFrac;
      const vsh = sand ? 0.08 + rnd() * 0.2 : Math.min(0.98, fm.vsh + 0.15 + gauss() * 0.08);
      const gas = sand && rnd() < fm.gas;
      beds.push({ top: d, base: d + th, vsh, gas, fm: fm.name });
      d += th;
    }

    const C = {};
    const names = ['GR', 'SP', 'CALI', 'ILD', 'ILM', 'SFL', 'RHOB', 'NPHI', 'DT', 'ROP', 'WOB', 'TG', 'C1', 'C2'];
    names.forEach(k => C[k] = new Float64Array(n));
    let bi = 0, wob = 18 + rnd() * 8;
    for (let i = 0; i < n; i++) {
      const z = depth[i];
      while (bi < beds.length - 1 && z >= beds[bi].base) bi++;
      const b = beds[bi];
      // Smooth bed boundaries slightly (tool response ~2 ft).
      const prev = beds[Math.max(0, bi - 1)];
      const w = Math.min(1, (z - b.top) / 2);
      const vsh = b.vsh * w + prev.vsh * (1 - w);
      const gas = b.gas;
      const phi = Math.max(0.05, (0.36 - 0.03 * z / 1000) * (1 - 0.65 * vsh));
      const sw = gas ? 0.25 + rnd() * 0.1 : 1;
      const hot = b.fm === 'Puente' ? 18 : 0;
      C.GR[i] = 18 + 112 * vsh + hot + gauss() * 4;
      C.SP[i] = 8 - 85 * (1 - vsh) + gauss() * 2;
      C.CALI[i] = 8.5 + (vsh > 0.7 ? 0.4 + rnd() * 1.6 : rnd() * 0.15);
      const rw = 0.28;
      let rt = vsh > 0.6 ? 1.2 + vsh * 2 + gauss() * 0.15 : rw / (phi * phi * sw * sw) * (1 + vsh);
      rt = Math.max(0.3, rt);
      C.ILD[i] = rt * (1 + gauss() * 0.04);
      C.ILM[i] = rt * (gas ? 0.75 : 1.05) * (1 + gauss() * 0.04);
      const rxo = 0.7 / (phi * phi) * (1 + vsh);
      C.SFL[i] = (vsh > 0.6 ? rt : rxo * 0.8 + rt * 0.2) * (1 + gauss() * 0.05);
      C.RHOB[i] = 2.68 * (1 - phi) + (gas ? 0.35 : 1.02) * phi + vsh * 0.02 + gauss() * 0.012;
      C.NPHI[i] = phi + 0.16 * vsh - (gas ? 0.10 : 0) + gauss() * 0.008;
      C.DT[i] = 55 + 130 * phi + 12 * vsh + gauss() * 1.5;
      C.ROP[i] = Math.max(5, (vsh > 0.6 ? 45 : 110) * (1 - z / 9000) + gauss() * 8);
      wob += gauss() * 0.3; wob = Math.min(38, Math.max(8, wob));
      C.WOB[i] = wob;
      const c1bg = 60 + rnd() * 120;
      const c1 = gas ? 25000 + rnd() * 50000 : (vsh < 0.3 ? 600 + rnd() * 2500 : c1bg);
      C.C1[i] = c1 * Math.exp(gauss() * 0.25);
      C.C2[i] = C.C1[i] * (gas ? 0.09 : 0.03) * Math.exp(gauss() * 0.3);
      C.TG[i] = (C.C1[i] + C.C2[i] * 2) / 45;
    }
    const curves = [
      { mnemonic: 'DEPT', unit: 'FT', description: 'Measured depth', data: depth },
      { mnemonic: 'GR', unit: 'GAPI', description: 'Gamma ray', data: C.GR },
      { mnemonic: 'SP', unit: 'MV', description: 'Spontaneous potential', data: C.SP },
      { mnemonic: 'CALI', unit: 'IN', description: 'Caliper', data: C.CALI },
      { mnemonic: 'ILD', unit: 'OHMM', description: 'Deep induction', data: C.ILD },
      { mnemonic: 'ILM', unit: 'OHMM', description: 'Medium induction', data: C.ILM },
      { mnemonic: 'SFL', unit: 'OHMM', description: 'Spherically focused', data: C.SFL },
      { mnemonic: 'RHOB', unit: 'G/C3', description: 'Bulk density', data: C.RHOB },
      { mnemonic: 'NPHI', unit: 'V/V', description: 'Neutron porosity (ls)', data: C.NPHI },
      { mnemonic: 'DT', unit: 'US/F', description: 'Sonic', data: C.DT },
      { mnemonic: 'ROP', unit: 'FT/HR', description: 'Rate of penetration', data: C.ROP },
      { mnemonic: 'WOB', unit: 'KLB', description: 'Weight on bit', data: C.WOB },
      { mnemonic: 'TG', unit: 'UNITS', description: 'Total gas', data: C.TG },
      { mnemonic: 'C1', unit: 'PPM', description: 'Methane', data: C.C1 },
      { mnemonic: 'C2', unit: 'PPM', description: 'Ethane', data: C.C2 },
    ];
    // Add a few gaps (tool off bottom / bad data) to prove null handling.
    [[0.31, 0.315], [0.72, 0.722]].forEach(([a, b]) => {
      for (let i = Math.floor(n * a); i < Math.floor(n * b); i++) { C.RHOB[i] = NaN; C.NPHI[i] = NaN; C.DT[i] = NaN; }
    });
    return {
      id: cfg.id, name: cfg.name, api: cfg.api, synthetic: true,
      location: { lat: cfg.lat, lon: cfg.lon, crs: 'EPSG:4267 (NAD27)' },
      elevation: { kb: cfg.kb, gl: cfg.kb - 12, unit: 'ft' },
      depthUnit: 'ft', curves,
      tops: Object.entries(cfg.tops).map(([name, md]) => ({ name, md, source: 'import' })),
    };
  }

  const PRESET_WELLS = [
    { id: 'w1', name: 'Inglewood 12-A', api: '04-037-00012', seed: 11, lat: 33.925, lon: -118.375, kb: 215, tops: { Pico: 1250, Repetto: 2900, Puente: 4400 } },
    { id: 'w2', name: 'Torrance 7',     api: '04-037-00007', seed: 23, lat: 33.845, lon: -118.335, kb: 95,  tops: { Pico: 1500, Repetto: 3300, Puente: 4900 } },
    { id: 'w3', name: 'Dominguez 22',   api: '04-037-00022', seed: 37, lat: 33.862, lon: -118.232, kb: 60,  tops: { Pico: 1650, Repetto: 3450, Puente: 5050 } },
    { id: 'w4', name: 'Long Beach 3-B', api: '04-037-00003', seed: 41, lat: 33.780, lon: -118.185, kb: 40,  tops: { Pico: 1750, Repetto: 3600, Puente: 5250 } },
  ];

  function toLAS(well) {
    const dep = well.curves[0].data;
    const L = [];
    L.push('~VERSION INFORMATION');
    L.push(' VERS.                 2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0');
    L.push(' WRAP.                  NO : ONE LINE PER DEPTH STEP');
    L.push('~WELL INFORMATION');
    const pad = (a, b, c) => ` ${a.padEnd(10)} ${b.padEnd(20)} : ${c}`;
    L.push(pad('STRT.FT', String(dep[0].toFixed(2)), 'START DEPTH'));
    L.push(pad('STOP.FT', String(dep[dep.length - 1].toFixed(2)), 'STOP DEPTH'));
    L.push(pad('STEP.FT', (dep[1] - dep[0]).toFixed(2), 'STEP'));
    L.push(pad('NULL.', '-999.25', 'NULL VALUE'));
    L.push(pad('WELL.', well.name, 'WELL'));
    L.push(pad('COMP.', 'SYNTHETIC DEMO', 'COMPANY'));
    L.push(pad('FLD.', 'LOS ANGELES BASIN', 'FIELD'));
    L.push(pad('CNTY.', 'LOS ANGELES', 'COUNTY'));
    L.push(pad('STAT.', 'CALIFORNIA', 'STATE'));
    L.push(pad('API.', well.api, 'API NUMBER'));
    L.push(pad('EKB.FT', String(well.elevation.kb), 'KB ELEVATION'));
    L.push(pad('EGL.FT', String(well.elevation.gl), 'GL ELEVATION'));
    L.push(pad('LATI.DEG', String(well.location.lat), 'LATITUDE'));
    L.push(pad('LONG.DEG', String(well.location.lon), 'LONGITUDE'));
    L.push(pad('GDAT.', 'NAD27', 'GEODETIC DATUM'));
    L.push('~CURVE INFORMATION');
    well.curves.forEach(c => L.push(pad(`${c.mnemonic}.${c.unit}`, '', c.description)));
    L.push('~PARAMETER INFORMATION');
    well.tops.forEach(t => L.push(pad(`TOP_${t.name.toUpperCase()}.FT`, String(t.md), `Formation top: ${t.name}`)));
    L.push('~OTHER');
    L.push(' Synthetic well generated for the Weller Logs demo. Not a real well.');
    L.push('~A  ' + well.curves.map(c => c.mnemonic.padStart(10)).join(''));
    for (let i = 0; i < dep.length; i++) {
      L.push(well.curves.map(c => { const v = c.data[i]; return (Number.isFinite(v) ? v.toFixed(4) : '-999.25').padStart(10); }).join(''));
    }
    return L.join('\n') + '\n';
  }

  root.WellerSynth = { makeWell, PRESET_WELLS, toLAS, FORMATIONS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
