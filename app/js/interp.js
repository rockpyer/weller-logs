/* Deterministic interpretation: Vshale, porosity, Sw, TOC and net flags, added to each well as computed curves.
   Equations live in petro.js (unit-tested). This file chooses inputs, applies parameters and writes the curves. */

const INTERP_CURVES = ['VSH_GR', 'VSH_SP', 'PHID', 'PHIT_ND', 'PHIT', 'PHIE', 'PHI_SW', 'SW', 'BVW', 'TOC_DLR', 'FLAG_BH', 'FLAG_WO', 'NET_RES', 'NET_PAY'];
const DRHO_ALIASES = ['DRHO', 'HDRA', 'ZCOR', 'DCOR', 'CORR', 'DRH'];
// NMR total porosity (CMR, MRIL and generic names).
const NMR_PHI = ['TCMR', 'MPHS', 'PHIT_NMR', 'MPHI', 'CMRP', 'TPOR', 'MRP', 'NMR_PHIT', 'MSIG'];

function interpDefaults() {
  return {
    enabled: true,
    vshMethod: 'linear',          // linear | larionov-tertiary | larionov-older | clavier
    matrix: 'auto',               // auto = the neutron's recorded matrix, else sandstone | limestone | dolomite
    rhoFl: 1.0,
    porMethod: 'average',         // average | rms | density
    a: 1, m: 2, n: 2,
    rw: 0.05, rwTemp: 75, surfaceT: 60,
    swMethod: 'archie',           // archie | simandoux
    swPhi: 'effective',           // effective (shaly sands) | total (organic mudrocks, chalk-marl)
    cut: { vsh: 0.5, phi: 0.06, sw: 0.6 },
    toc: { enabled: true, lom: 10, baselineZone: 'auto' },
    wells: {},                    // per-well overrides: { [id]: { grClean, grShale } }
  };
}

function curveBy(w, aliases) { return resolveCurve(w, { aliases }); }

// GR baselines. Clean: P2 of GR. Shale: P95 of GR after excluding "hot" samples above median + 2.5 MAD.
// Uranium-rich organic shales (Sharon Springs, Niobrara marls) read far above ordinary shale; left in, they push the
// shale baseline up and make true shale look clean.
function grBaselines(w) {
  const o = S.interp.wells[w.id] || {}; const gr = curveBy(w, A.GR);
  if (!gr || gr.sparse) return { clean: o.grClean, shale: o.grShale };
  if (!w._grP) {
    const v = Array.from(gr.data).filter(Number.isFinite), med = WellerLAS.median(v), mad = WellerLAS.median(v.map(x => Math.abs(x - med)));
    const hot = med + 2.5 * mad, cool = v.filter(x => x <= hot);
    w._grP = { p2: WellerPetro.percentile(v, 0.02), p95: WellerPetro.percentile(cool, 0.95), hot, hotFrac: 1 - cool.length / v.length };
  }
  return { clean: o.grClean ?? Math.round(w._grP.p2), shale: o.grShale ?? Math.round(w._grP.p95), auto: o.grClean == null || o.grShale == null, hot: w._grP.hot, hotFrac: w._grP.hotFrac };
}

function matrixDensity(w) {
  const m = S.interp.matrix === 'auto' ? (w.neutronMatrix || 'limestone') : S.interp.matrix;
  return { name: m, rho: WellerPetro.MATRIX[m] || 2.71 };
}

function addComputed(w, mnemonic, unit, description, data) {
  w.curves = w.curves.filter(c => !(c.computed && c.mnemonic === mnemonic));
  w.curves.push({ mnemonic, unit, description, data, computed: true, nulls: 0 });
}

/* Works down to whatever the well has. Vshale: GR, else SP. Porosity: neutron-density or density, else NMR, sonic,
   or neutron alone. With no porosity log, net sand comes from Vshale alone and net pay from the resistivity index. */
function computeInterp(w) {
  w.curves = w.curves.filter(c => !c.computed);
  w.interpNotes = [];
  if (!S.interp.enabled) return;
  const P = WellerPetro, I = S.interp, dep = depthOf(w), n = dep.length;
  const gr = curveBy(w, A.GR), sp = curveBy(w, A.SP), rhob = curveBy(w, A.RHOB), nphi = curveBy(w, A.NPHI), rt = curveBy(w, A.RD), dt = curveBy(w, A.DT), nmr = curveBy(w, NMR_PHI);
  const cal = curveBy(w, A.CAL), drho = curveBy(w, DRHO_ALIASES);
  const ok = c => c && !c.sparse;
  const tvd = tvdOf(w) || dep;
  const { clean, shale } = grBaselines(w);
  const mat = matrixDensity(w);
  const nan = () => new Float64Array(n).fill(NaN);
  const vsh = nan(), phid = nan(), phit = nan(), phie = nan(), sw = nan(), bvw = nan();
  const bh = new Float64Array(n), wo = new Float64Array(n), nres = new Float64Array(n), npay = new Float64Array(n);
  const bht = w.params?.bht, td = tvd[n - 1];
  // Vshale source
  let vshSrc = null, spB = null;
  if (ok(gr) && Number.isFinite(clean) && Number.isFinite(shale)) vshSrc = 'GR';
  else if (ok(sp)) { spB = { sand: P.percentile(sp.data, 0.02), shale: P.percentile(sp.data, 0.9) }; vshSrc = 'SP';
    w.interpNotes.push(`no GR: Vshale from SP, clean line ${spB.sand.toFixed(0)} mV, shale ${spB.shale.toFixed(0)} mV (P2 / P90). SP drift or fresh formation water makes this rough.`); }
  // Porosity source
  const nmrScale = ok(nmr) && WellerLAS.median(nmr.data) > 1.5 ? 0.01 : 1;
  const porSrc = ok(rhob) ? (I.porMethod === 'density' || !ok(nphi) ? 'density' : 'neutron-density') : ok(nmr) ? 'NMR' : ok(dt) ? 'sonic' : ok(nphi) ? 'neutron' : null;
  const dtMa = P.DT_MATRIX[mat.name] || 55.5;
  if (porSrc === 'sonic') w.interpNotes.push(`no density or NMR: porosity from sonic (Raymer-Hunt-Gardner, DT matrix ${dtMa} us/ft). Reads high in gas and uncompacted shale.`);
  if (porSrc === 'neutron') w.interpNotes.push('neutron is the only porosity log: PHIT is apparent neutron porosity, which reads high in shale and low in gas');
  if (porSrc === 'NMR') w.interpNotes.push(`porosity from NMR ${nmr.mnemonic}, lithology-independent`);
  // Bit size from the header, else estimated as the caliper's gauge (P10), to find washouts.
  let bit = w.params?.bitSize;
  if (!Number.isFinite(bit) && ok(cal)) { bit = P.percentile(cal.data, 0.1); if (Number.isFinite(bit)) w.interpNotes.push(`no bit size in header: gauge taken as caliper P10, ${bit.toFixed(2)} in`); }
  for (let i = 0; i < n; i++) {
    if (vshSrc === 'GR') vsh[i] = P.vsh(gr.data[i], clean, shale, I.vshMethod);
    else if (vshSrc === 'SP') { const ix = P.vshSP(sp.data[i], spB.sand, spB.shale); vsh[i] = Number.isFinite(ix) ? P.vsh(spB.sand + ix * 100, spB.sand, spB.sand + 100, I.vshMethod) : NaN; }
    if (ok(rhob)) phid[i] = P.phiDensity(rhob.data[i], mat.rho, I.rhoFl);
    const pn = ok(nphi) ? nphi.data[i] : NaN;
    phit[i] = porSrc === 'density' ? phid[i] : porSrc === 'neutron-density' ? P.phiND(pn, phid[i], I.porMethod)
      : porSrc === 'NMR' ? nmr.data[i] * nmrScale : porSrc === 'sonic' ? P.phiSonic(dt.data[i], dtMa) : porSrc === 'neutron' ? pn : NaN;
    if (Number.isFinite(phit[i])) phit[i] = P.clamp(phit[i], 0, 0.5);
    phie[i] = Number.isFinite(vsh[i]) ? phit[i] * (1 - vsh[i]) : phit[i];
    const c = ok(cal) ? cal.data[i] : NaN;
    wo[i] = P.washout(c, bit) ? 1 : 0;
    bh[i] = P.badHole(c, bit, ok(drho) ? drho.data[i] : NaN) ? 1 : 0;
  }
  const phiS = i => I.swPhi === 'total' ? phit[i] : phie[i];
  let rsh = NaN;
  if (I.swMethod === 'simandoux' && ok(rt)) { const v = []; for (let i = 0; i < n; i++) if (vsh[i] > 0.8 && rt.data[i] > 0) v.push(rt.data[i]); rsh = WellerLAS.median(v); }
  if (ok(rt) && porSrc) for (let i = 0; i < n; i++) {
    const T = P.tempAtDepth(tvd[i], I.surfaceT, bht, td); const rwT = P.rwAtTemp(I.rw, I.rwTemp, T);
    sw[i] = I.swMethod === 'simandoux' ? P.swSimandoux(rt.data[i], phiS(i), rwT, vsh[i], rsh, I.a, I.m) : P.swArchie(rt.data[i], phiS(i), rwT, I.a, I.m, I.n);
    bvw[i] = phiS(i) * sw[i];
  }
  // Net flags. Without porosity: net sand is Vshale alone, and pay needs Rt above R0 by the resistivity index for the Sw cutoff,
  // R0 taken as the P10 resistivity of the net sands, which assumes the well has some water-bearing sand.
  let r0 = NaN;
  if (!porSrc && ok(rt) && vshSrc) { const v = []; for (let i = 0; i < n; i++) if (vsh[i] < I.cut.vsh && !bh[i] && rt.data[i] > 0) v.push(rt.data[i]); if (v.length >= 50) r0 = P.percentile(v, 0.1); }
  for (let i = 0; i < n; i++) {
    const res = !bh[i] && (porSrc ? (vsh[i] < I.cut.vsh || !Number.isFinite(vsh[i])) && phiS(i) >= I.cut.phi : !!vshSrc && vsh[i] < I.cut.vsh);
    nres[i] = res ? 1 : 0;
    npay[i] = res && (porSrc ? sw[i] <= I.cut.sw : P.swFromRI(ok(rt) ? rt.data[i] : NaN, r0, I.n) <= I.cut.sw) ? 1 : 0;
  }
  const PH = I.swPhi === 'total' ? 'PHIT' : 'PHIE';
  if (vshSrc === 'GR') addComputed(w, 'VSH_GR', 'V/V', `Vshale from GR (${I.vshMethod}, clean ${clean}, shale ${shale} API)`, vsh);
  if (vshSrc === 'SP') addComputed(w, 'VSH_SP', 'V/V', `Vshale from SP (${I.vshMethod}, clean ${spB.sand.toFixed(0)}, shale ${spB.shale.toFixed(0)} mV)`, vsh);
  if (ok(rhob)) addComputed(w, 'PHID', 'V/V', `Density porosity, matrix ${mat.rho} (${mat.name}), fluid ${I.rhoFl}`, phid);
  if (porSrc) {
    addComputed(w, ok(rhob) ? 'PHIT_ND' : 'PHIT', 'V/V', { density: 'Total porosity from density', 'neutron-density': `Neutron-density porosity (${I.porMethod})`, NMR: `Total porosity from NMR ${nmr?.mnemonic}`, sonic: `Sonic porosity, Raymer-Hunt-Gardner, DT matrix ${dtMa}`, neutron: 'Apparent neutron porosity' }[porSrc], phit);
    addComputed(w, 'PHIE', 'V/V', 'Effective porosity = PHIT x (1 - Vsh)', phie);
    addComputed(w, 'PHI_SW', 'V/V', `Porosity used for Sw (${PH})`, I.swPhi === 'total' ? phit : phie);
  }
  if (ok(rt) && porSrc) { addComputed(w, 'SW', 'V/V', `Water saturation, ${I.swMethod} on ${PH}, a ${I.a} m ${I.m} n ${I.n}, Rw ${I.rw} at ${I.rwTemp} F`, sw); addComputed(w, 'BVW', 'V/V', `Bulk volume water = ${PH} x Sw`, bvw); }
  if (ok(cal) && Number.isFinite(bit)) addComputed(w, 'FLAG_WO', '', `Washout: caliper > bit + 1 in (bit ${bit.toFixed(2)} in)`, wo);
  if (ok(cal) || ok(drho)) addComputed(w, 'FLAG_BH', '', 'Bad hole: washout, or |DRHO| > 0.15 g/cc', bh);
  if (porSrc) { addComputed(w, 'NET_RES', '', `Net reservoir: Vsh < ${I.cut.vsh}, ${PH} >= ${I.cut.phi} (${porSrc}), not bad hole`, nres); if (ok(rt)) addComputed(w, 'NET_PAY', '', `Net pay: net reservoir and Sw <= ${I.cut.sw}`, npay); }
  else if (vshSrc) {
    addComputed(w, 'NET_RES', '', `Net sand: Vsh < ${I.cut.vsh} from ${vshSrc}, not bad hole (no porosity log)`, nres);
    if (Number.isFinite(r0)) addComputed(w, 'NET_PAY', '', `Net pay: net sand with Rt >= ${(r0 / Math.pow(I.cut.sw, I.n)).toFixed(1)} ohm.m, resistivity index for Sw <= ${I.cut.sw} over R0 ${r0.toFixed(2)} (P10 of net-sand Rt; assumes some wet sand)`, npay);
    w.interpNotes.push('no porosity log: net sand from Vshale only' + (Number.isFinite(r0) ? `; pay where Rt is at least ${(1 / Math.pow(I.cut.sw, I.n)).toFixed(1)}x R0 ${r0.toFixed(2)} ohm.m` : ok(rt) ? '; too little clean sand to set R0, no pay flag' : ''));
  }
  if (I.toc.enabled && ok(rt) && ok(rhob)) computeTOC(w, rt, rhob, vsh);
  if (!Number.isFinite(bht)) w.interpNotes.push('no BHT in header: Rw not temperature-corrected');
  const gb = grBaselines(w); if (gb.auto && gb.hotFrac > 0.02) w.interpNotes.push(`${Math.round(gb.hotFrac * 100)}% of GR is above ${Math.round(gb.hot)} API (organic or uranium-rich) and left out of the shale baseline`);
  if (w.neutronMatrix && S.interp.matrix !== 'auto' && S.interp.matrix !== w.neutronMatrix) w.interpNotes.push(`neutron recorded on ${w.neutronMatrix}, density porosity on ${S.interp.matrix}: neutron-density mixes matrices`);
}

// Passey delta log R (density form). The baseline is where resistivity and density overlay in organic-lean shale:
// the median of Rt and RHOB in the chosen zone, or, on auto, the zone above the first top (e.g. Pierre shale above
// Sharon Springs), falling back to the lower-resistivity half of the shaly samples.
function computeTOC(w, rt, rhob, vsh) {
  const P = WellerPetro, dep = depthOf(w), n = dep.length, zones = zonesOf(w);
  let zone = S.interp.toc.baselineZone === 'auto' ? (zones.length > 1 ? zones[0] : null) : zones.find(z => z.name === S.interp.toc.baselineZone);
  const pick = [];
  for (let i = 0; i < n; i++) {
    if (!(rt.data[i] > 0) || !Number.isFinite(rhob.data[i])) continue;
    if (zone ? dep[i] >= zone.top && dep[i] < zone.base && (!(vsh[i] < 0.5)) : vsh[i] > 0.6) pick.push(i);
  }
  if (!zone && pick.length) { const cut = WellerLAS.median(pick.map(i => rt.data[i])); pick.splice(0, pick.length, ...pick.filter(i => rt.data[i] <= cut)); }
  if (pick.length < 20) { w.interpNotes.push('TOC skipped: no baseline shale found'); return; }
  const rtB = WellerLAS.median(pick.map(i => rt.data[i])), rhoB = WellerLAS.median(pick.map(i => rhob.data[i]));
  const toc = new Float64Array(n).fill(NaN);
  // Delta log R measures organic matter only in fine-grained rock. In a clean sand or chalk carrying oil or gas the same
  // separation comes from the hydrocarbons, so TOC is left blank where Vsh < 0.35 unless PE says carbonate mudrock.
  const pe = curveBy(w, A.PE), bh = w.curves.find(c => c.computed && c.mnemonic === 'FLAG_BH');
  for (let i = 0; i < n; i++) {
    const fine = vsh[i] >= 0.35 || (pe && !pe.sparse && pe.data[i] >= 3.5);
    toc[i] = fine && !(bh?.data[i] > 0.5) ? Math.min(20, P.tocPassey(P.deltaLogR(rt.data[i], rtB, rhob.data[i], rhoB, 'density'), S.interp.toc.lom)) : NaN;
  }
  addComputed(w, 'TOC_DLR', 'WT%', `TOC, Passey delta log R (density), LOM ${S.interp.toc.lom}, baseline Rt ${rtB.toFixed(2)} RHOB ${rhoB.toFixed(3)} from ${zone ? zone.name : 'lean shale'}`, toc);
  w.tocBaseline = { rt: rtB, rhob: rhoB, zone: zone?.name || 'auto' };
}

function computeAllInterp() { for (const w of S.wells) { try { computeInterp(w); } catch (e) { console.error(e); } } }

/* ---------- Sidebar form ---------- */
function renderInterpPanel() {
  const I = S.interp, w = wellById(S.selected), box = $('interpForm'); if (!box) return;
  const zones = w ? zonesOf(w).map(z => z.name) : [];
  const b = w ? grBaselines(w) : {};
  const sel = (id, v, opts) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}"${String(v) === String(k) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const num = (id, v, step, title) => `<input type="number" id="${id}" value="${v ?? ''}" step="${step}" title="${title || ''}">`;
  setHTML(box, `
    <label class="chk"><input type="checkbox" id="ipOn"${I.enabled ? ' checked' : ''}> Compute Vsh, porosity, Sw, TOC</label>
    <div class="ipgrid"${I.enabled ? '' : ' hidden'}>
      <label>Vsh ${sel('ipVsh', I.vshMethod, [['linear', 'Linear'], ['larionov-tertiary', 'Larionov, Tertiary'], ['larionov-older', 'Larionov, older'], ['clavier', 'Clavier']])}</label>
      <label title="${w ? w.name + ': ' + (b.auto ? 'auto P5 / P95 of GR' : 'set by you') : ''}">GR clean ${num('ipGrc', b.clean, 1)} shale ${num('ipGrs', b.shale, 1)}</label>
      <label>Matrix ${sel('ipMat', I.matrix, [['auto', 'Match neutron'], ['sandstone', 'Sandstone 2.65'], ['limestone', 'Limestone / chalk 2.71'], ['dolomite', 'Dolomite 2.87']])}</label>
      <label>Porosity ${sel('ipPor', I.porMethod, [['average', 'N-D average'], ['rms', 'N-D RMS (gas)'], ['density', 'Density only']])}</label>
      <label>Sw ${sel('ipSw', I.swMethod, [['archie', 'Archie'], ['simandoux', 'Simandoux']])} on ${sel('ipSwPhi', I.swPhi, [['effective', 'PHIE'], ['total', 'PHIT']])}</label>
      <label>a ${num('ipA', I.a, 0.01)} m ${num('ipM', I.m, 0.05)} n ${num('ipN', I.n, 0.05)}</label>
      <label title="Formation water resistivity at the stated temperature; corrected to each depth with Arps and a BHT gradient">Rw ${num('ipRw', I.rw, 0.005)} at ${num('ipRwT', I.rwTemp, 1)} °F</label>
      <label>Cutoffs Vsh &lt; ${num('ipCv', I.cut.vsh, 0.05)} PHIE ≥ ${num('ipCp', I.cut.phi, 0.01)} Sw ≤ ${num('ipCs', I.cut.sw, 0.05)}</label>
      <label title="Level of organic metamorphism: about 10-11 in the oil window. Set from vitrinite reflectance or Tmax.">TOC LOM ${num('ipLom', I.toc.lom, 0.5)} baseline ${sel('ipBase', I.toc.baselineZone, [['auto', 'Auto'], ...zones.map(z => [z, z])])}</label>
    </div>
    ${interpNotes(w).length ? `<button class="small notesbtn" id="btnNotes" aria-haspopup="dialog">ⓘ Notes · ${interpNotes(w).length}</button>` : ''}`);
  if (!$('notesPop').hidden) showNotes();
}
// Parameter sources and per-well caveats, shown in a popout beside the sidebar so the panel stays short.
function interpNotes(w) {
  const out = [];
  if (S.interp.source) out.push(S.interp.source);
  if (S.interp.sourceSw) out.push(S.interp.sourceSw);
  if (w) out.push(...(w.interpNotes || []));
  if (w?.tocBaseline) out.push(`TOC baseline: Rt ${w.tocBaseline.rt.toFixed(2)} Ω·m, RHOB ${w.tocBaseline.rhob.toFixed(3)} g/cc`);
  return out;
}
function showNotes() {
  const w = wellById(S.selected), pop = $('notesPop'), b = $('btnNotes');
  if (!b) { pop.hidden = true; return; }
  const link = t => esc(t).replace(/doi:([\w./]+\w)/, (m, d) => `<a href="https://doi.org/${d}" target="_blank" rel="noopener">${m}</a>`);
  pop.innerHTML = `<h4>Interpretation notes${w ? ' · ' + esc(w.name) : ''} <button class="x" data-close aria-label="Close">×</button></h4><ul>${interpNotes(w).map(n => `<li>${link(n)}</li>`).join('')}</ul>`;
  const side = document.querySelector('.side').getBoundingClientRect(), r = b.getBoundingClientRect();
  pop.hidden = false;
  const wide = innerWidth > 760, left = wide ? side.right + 10 : 16;
  pop.style.left = left + 'px'; pop.style.top = Math.max(8, Math.min(r.top - 8, innerHeight - pop.offsetHeight - 8)) + 'px';
}
document.addEventListener('click', e => { if (e.target.id === 'btnNotes') { e.stopPropagation(); $('notesPop').hidden ? showNotes() : ($('notesPop').hidden = true); } });

let interpTimer = null;
document.addEventListener('change', e => {
  const id = e.target.id; if (!/^ip/.test(id)) return;
  const I = S.interp, v = e.target.type === 'checkbox' ? e.target.checked : e.target.value, f = +v;
  const w = wellById(S.selected);
  switch (id) {
    case 'ipOn': I.enabled = v; break; case 'ipVsh': I.vshMethod = v; break; case 'ipMat': I.matrix = v; break;
    case 'ipPor': I.porMethod = v; break; case 'ipSw': I.swMethod = v; break; case 'ipSwPhi': I.swPhi = v; break;
    case 'ipA': I.a = f || 1; break; case 'ipM': I.m = f || 2; break; case 'ipN': I.n = f || 2; break;
    case 'ipRw': I.rw = f || 0.05; break; case 'ipRwT': I.rwTemp = f || 75; break;
    case 'ipCv': I.cut.vsh = f; break; case 'ipCp': I.cut.phi = f; break; case 'ipCs': I.cut.sw = f; break;
    case 'ipLom': I.toc.lom = f || 10; break; case 'ipBase': I.toc.baselineZone = v; break;
    case 'ipGrc': case 'ipGrs': if (w) { const o = (I.wells[w.id] ||= {}); o[id === 'ipGrc' ? 'grClean' : 'grShale'] = v === '' ? undefined : f; } break;
  }
  clearTimeout(interpTimer); interpTimer = setTimeout(() => { computeAllInterp(); render(); }, 60);
});
