/* Well(er) Logs view tools: the curve editor (click a curve in a track header), the depth ruler, saved views and the
   PNG export dialog. Uses the state and drawing functions in core.js. */
const WV=WellerViews;
S.savedViews=S.savedViews||[];
const hexOf=c=>c&&String(c).startsWith('var(')?cssVarHex(c.slice(4,-1)):(c||'#333333');
const zoomPop=(pop,r)=>{ pop.hidden=false; const pw=pop.offsetWidth, ph=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(innerWidth-pw-8,r.left))+'px'; pop.style.top=Math.max(8,r.bottom+ph+8>innerHeight?r.top-ph-6:r.bottom+6)+'px'; };

/* ---------- Curve editor: one curve's name, line, scale, wrap and fill. Changes apply at once, in every well. ---------- */
const CP={tid:null,ci:-1,wid:null,shown:null};
const cpPop=document.createElement('div'); cpPop.id='curvePop'; cpPop.className='pop'; cpPop.setAttribute('role','dialog'); cpPop.setAttribute('aria-label','Edit curve'); cpPop.hidden=true; document.body.appendChild(cpPop);
function cpTarget(){ const t=S.tracks.find(t=>t.id===CP.tid), c=t?.curves[CP.ci]; return c?{t,c}:null; }
function cpRow(){ return document.querySelector(`#logPanel [data-cedit="${CP.tid}:${CP.ci}"][data-wid="${CP.wid}"]`)||document.querySelector(`#logPanel [data-cedit="${CP.tid}:${CP.ci}"]`); }
function openCurvePop(row){ const [tid,ci]=row.dataset.cedit.split(':'); Object.assign(CP,{tid,ci:+ci,wid:row.dataset.wid}); hideTip(); drawCurvePop(); zoomPop(cpPop,row.getBoundingClientRect()); cpPop.querySelector('#cpName')?.focus(); }
function closeCurvePop(){ cpPop.hidden=true; CP.tid=null; }
function drawCurvePop(){ const T=cpTarget(); if(!T) return closeCurvePop(); const {t,c}=T, w=wellById(CP.wid)||wellById(S.selected)||S.wells[0], cur=w&&resolveCurve(w,c), row=cpRow();
  CP.shown={min:row?+row.dataset.cmin:c.min,max:row?+row.dataset.cmax:c.max};
  const fill=c.fill&&c.fill!=='none', grad=c.fillStyle==='gradient', ls=WV.styleOf(c.dash), lw=c.lw??WV.DEFAULT_WIDTH;
  const opts=(list,v)=>list.map(([k,l])=>`<option value="${esc(k)}"${String(k)===String(v)?' selected':''}>${esc(l)}</option>`).join('');
  const curves=w?w.curves.slice(1).filter(x=>!x.events):[];
  setHTML(cpPop,`<h4><span><b style="color:${visibleColor(c.color)}">${esc(c.name||cur?.mnemonic||c.label)}</b> <small class="hint">${esc(cur?.unit||c.unit||'')}</small></span><button type="button" class="x" data-close aria-label="Close">×</button></h4>
    <div class="cpgrid">
      <label for="cpName">Display name</label><input type="text" id="cpName" value="${esc(c.name||'')}" placeholder="${esc(cur?.mnemonic||c.label)}" spellcheck="false">
      <label for="cpCurve">Curve</label><select id="cpCurve">${cur?'':`<option value="" selected>${esc(c.label)} (not in ${esc(w?.name||'this well')})</option>`}${curves.map(x=>`<option value="${esc(x.mnemonic)}"${x===cur?' selected':''}>${esc(x.mnemonic)}${x.unit?' ('+esc(x.unit)+')':''}${x.sparse?' · points':''}</option>`).join('')}</select>
      <label>Line</label><span class="cprow"><button type="button" class="swatchbtn" id="cpColor" data-color="${hexOf(c.color)}" style="background:${hexOf(c.color)}" title="Line color"></button><select id="cpStyle" aria-label="Line style">${opts(WV.LINE_STYLES.map(s=>[s.key,s.label]),ls)}</select><select id="cpWidth" aria-label="Line width">${opts(WV.LINE_WIDTHS.map(x=>[x,x+' px']),lw)}</select></span>
      <label for="cpMin">Left</label><input type="number" id="cpMin" step="any" value="${CP.shown.min}">
      <label for="cpMax">Right</label><span class="cprow"><input type="number" id="cpMax" step="any" value="${CP.shown.max}"><button type="button" class="small" id="cpAuto" title="Scale from ${esc(w?.name||'this well')}'s data (2nd to 98th percentile)"${cur&&!cur.sparse?'':' disabled'}>Auto</button></span>
      <label for="cpLog">Log scale</label><input type="checkbox" id="cpLog"${c.log?' checked':''}>
      <label for="cpWrap">Wrap around</label><input type="checkbox" id="cpWrap"${!t.nowrap&&!c.nowrap?' checked':''}${t.nowrap?' disabled title="Wrap is off for the whole track (track ⚙)"':' title="Values past the scale continue from the other edge, dotted"'}>
    </div>
    <div class="cpsec"><b>Fill</b>${fill?`<button type="button" class="small" id="cpNoFill">Remove</button>`:`<button type="button" class="small" id="cpAddFill">+ Add</button>`}</div>
    ${fill?`<div class="cpgrid">
      <label for="cpFillSide">Side</label><select id="cpFillSide">${opts([['left','Left of curve'],['right','Right of curve']],c.fill)}</select>
      <label for="cpFillStyle">Color</label><select id="cpFillStyle">${opts([['solid','Solid'],['gradient','By value']],grad?'gradient':'solid')}</select>
      <label>${grad?'Left · right':'Fill'}</label><span class="cprow"><button type="button" class="swatchbtn" id="cpFill1" data-color="${hexOf(c.fillColor||c.color)}" style="background:${hexOf(c.fillColor||c.color)}" title="${grad?'Color at the left scale value':'Fill color'}"></button>${grad?`<button type="button" class="swatchbtn" id="cpFill2" data-color="${hexOf(c.fillColor2||c.fillColor||c.color)}" style="background:${hexOf(c.fillColor2||c.fillColor||c.color)}" title="Color at the right scale value"></button>`:''}<label class="mini">opacity <input type="number" id="cpFillOp" min="0" max="1" step="0.05" value="${c.fillOpacity??.35}"></label></span>
    </div>`:'<p class="hint cpnone">No fill</p>'}
    <div class="cpfoot"><button type="button" class="small danger" id="cpRemove">Remove from track</button><span class="hint">${esc(t.name)} · every well</span></div>`); }
// Structural changes redraw the editor; plain value edits only refresh the scale it shows.
function cpApply(redraw){ render(); if(!cpTarget()) return closeCurvePop(); if(redraw) drawCurvePop(); else { const row=cpRow(); if(row){ $('cpMin').value=row.dataset.cmin; $('cpMax').value=row.dataset.cmax; } } }
cpPop.addEventListener('change',e=>{ const T=cpTarget(); if(!T) return; const {t,c}=T, id=e.target.id, v=e.target.value, w=wellById(CP.wid)||wellById(S.selected)||S.wells[0];
  if(id==='cpName'){ const n=v.trim(); if(n) c.name=n; else delete c.name; return cpApply(true); }
  if(id==='cpCurve'){ if(!v) return; const mu=v.toUpperCase(), same=c.aliases.some(a=>a.toUpperCase()===mu); c.aliases=[v,...c.aliases.filter(a=>a.toUpperCase()!==mu)];
    // Another curve of the same kind keeps the track's standard scale; a different kind gets its own range and unit.
    if(!same){ c.label=v; c.exact=true; const x=w?.curves.find(x=>x.mnemonic===v); if(x){ const r=autoScale(x,c.log); if(r) [c.min,c.max]=c.min>c.max?[r[1],r[0]]:r; c.unit=x.unit||''; delete c.auto; c.matchNeutron=false; } }
    return cpApply(true); }
  if(id==='cpStyle'){ const d=WV.dashFor(v,c.dash); if(d) c.dash=d; else delete c.dash; return cpApply(false); }
  if(id==='cpWidth'){ const n=+v; if(n===WV.DEFAULT_WIDTH) delete c.lw; else c.lw=n; return cpApply(false); }
  if(id==='cpMin'||id==='cpMax'){ const a=parseFloat($('cpMin').value), b=parseFloat($('cpMax').value); if(!Number.isFinite(a)||!Number.isFinite(b)||a===b) return;
    c.min=a; c.max=b; delete c.auto; c.matchNeutron=false; if(c.log&&!logOK(c)) fixLogScale(c); return cpApply(false); }
  if(id==='cpLog'){ c.log=e.target.checked; if(c.log&&!logOK(c)) fixLogScale(c); return cpApply(true); }
  if(id==='cpWrap'){ if(e.target.checked) delete c.nowrap; else c.nowrap=true; return cpApply(false); }
  if(id==='cpFillSide'){ c.fill=v; return cpApply(false); }
  // By value starts as a ramp from a pale tint of the line color to the line color, so it reads at once.
  if(id==='cpFillStyle'){ c.fillStyle=v; if(v==='gradient'&&(!c.fillColor2||c.fillColor2===c.fillColor)){ const col=hexOf(c.color); c.fillColor=d3.interpolateRgb(col,'#ffffff')(0.8); c.fillColor=d3.color(c.fillColor).formatHex(); c.fillColor2=col; c.fillOpacity=Math.max(c.fillOpacity??.35,.6); } return cpApply(true); }
  if(id==='cpFillOp'){ const o=parseFloat(v); if(Number.isFinite(o)) c.fillOpacity=Math.max(0,Math.min(1,o)); return cpApply(false); } });
cpPop.addEventListener('colorpicked',e=>{ const T=cpTarget(); if(!T) return; const {c}=T, id=e.target.id;
  if(id==='cpColor') c.color=e.detail; else if(id==='cpFill1') c.fillColor=e.detail; else if(id==='cpFill2') c.fillColor2=e.detail; else return; cpApply(true); });
cpPop.addEventListener('click',e=>{ e.stopPropagation(); const b=e.target.closest('button'); if(b?.dataset.close!==undefined) return closeCurvePop(); const T=cpTarget(); if(!b||!T) return; const {t,c}=T, w=wellById(CP.wid)||wellById(S.selected)||S.wells[0];
  if(b.id==='cpAuto'){ const cur=w&&resolveCurve(w,c), r=cur&&!cur.sparse&&autoScale(cur,c.log); if(r){ [c.min,c.max]=c.min>c.max?[r[1],r[0]]:r; delete c.auto; c.matchNeutron=false; cpApply(false); } }
  if(b.id==='cpAddFill'){ c.fill='left'; c.fillStyle=c.fillStyle||'solid'; c.fillColor=c.fillColor||hexOf(c.color); c.fillOpacity=c.fillOpacity??.35; cpApply(true); }
  if(b.id==='cpNoFill'){ c.fill='none'; cpApply(true); }
  if(b.id==='cpRemove'){ const label=c.name||c.label; t.curves.splice(CP.ci,1); const gone=!t.curves.length; if(gone) S.tracks=S.tracks.filter(x=>x!==t); closeCurvePop(); render();
    $('stNote').textContent=`${label} removed from ${t.name}${gone?', and the empty track with it':''} · Cmd/Ctrl+Z undoes`; } });
$('logPanel').addEventListener('click',e=>{ const row=e.target.closest('[data-cedit]'); if(!row) return; if(!cpPop.hidden&&row.dataset.cedit===`${CP.tid}:${CP.ci}`) return closeCurvePop(); openCurvePop(row); });

/* ---------- Depth ruler: drag on any log to read the interval's MD, true vertical thickness and TVDSS ---------- */
S.measuring=false; S.measure=null;
function setMeasuring(on){ S.measuring=!!on&&(S.mode==='single'||S.mode==='corr'); if(S.measuring&&S.picking) setPicking(false);
  $('btnMeasure').setAttribute('aria-pressed',S.measuring); document.body.classList.toggle('measuring',S.measuring);
  if(!S.measuring){ S.measure=null; drawMeasure(); } else $('stNote').textContent='Measure: drag on a log to read the interval · M or Esc ends'; }
window.setMeasuring=setMeasuring;
function measureText(M,w){ const m=WV.measure(M.md0,M.md1,w.survey?(md=>mdToTvd(w,md)):null,WellerLAS.datumElevation(w)), u=dispU();
  return {m,html:`<b>${fmtD(m.dMD,w,1)} ${u}</b> MD`+(m.dTVD!=null&&Math.abs(m.dTVD-m.dMD)>0.05?`<br><b>${fmtD(m.dTVD,w,1)} ${u}</b> TVT`:'')+`<small>MD ${fmtD(m.top,w,1)} – ${fmtD(m.base,w,1)}</small>`+(m.ssTop!=null?`<small>TVDSS ${fmtD(m.ssTop,w,1)} – ${fmtD(m.ssBase,w,1)}</small>`:''),
    text:`${w.name}: ${fmtD(m.dMD,w,1)} ${u} MD`+(m.dTVD!=null?` · ${fmtD(m.dTVD,w,1)} ${u} TVT`:'')+` · MD ${fmtD(m.top,w,1)}–${fmtD(m.base,w,1)}`+(m.ssTop!=null?` · TVDSS ${fmtD(m.ssTop,w,1)}–${fmtD(m.ssBase,w,1)}`:'')}; }
function drawMeasure(){ const panel=$('logPanel'), M=S.measure, ctx=S._ctx, c=M&&ctx?.cols.find(c=>c.w.id===M.wid); let el=panel.querySelector('.measure');
  if(!c||S.mode==='stats'||S.mode==='mud'||S.mode==='map'){ el?.remove(); return; }
  if(!el){ el=document.createElement('div'); el.className='measure'; el.innerHTML='<div class="ml"></div>'; panel.appendChild(el); }
  const pr=panel.getBoundingClientRect(), sr=c.el.querySelector('.tracks svg').getBoundingClientRect(), cr=c.el.getBoundingClientRect();
  const ya=ctx.y(c.F.z(M.md0)), yb=ctx.y(c.F.z(M.md1));
  Object.assign(el.style,{left:(cr.left-pr.left)+'px',width:cr.width+'px',top:(sr.top-pr.top+Math.min(ya,yb))+'px',height:Math.max(1,Math.abs(ya-yb))+'px'});
  const T=measureText(M,c.w), ml=el.querySelector('.ml'); ml.innerHTML=T.html;
  ml.style.left=Math.max(4,Math.min(cr.width-ml.offsetWidth-4,(M.x??cr.width)+12))+'px'; return T; }
window.drawMeasure=drawMeasure;
{ const panel=$('logPanel');
  panel.addEventListener('pointerdown',e=>{ if(!S.measuring||e.button!==0) return; const node=e.target.closest('.tracks svg'), c=node&&S._ctx?.cols.find(c=>c.el===node.closest('.column')); if(!c) return;
    e.preventDefault(); e.stopPropagation(); const mdAt=ev=>snapMD(mdAtZ(c.w,c.F,S._ctx.y.invert(ev.clientY-node.getBoundingClientRect().top)));
    S.measure={wid:c.w.id,md0:mdAt(e),md1:mdAt(e),x:e.clientX-c.el.getBoundingClientRect().left}; drawMeasure(); node.setPointerCapture(e.pointerId);
    const mv=ev=>{ S.measure.md1=mdAt(ev); const T=drawMeasure(); if(T) $('stNote').textContent=T.text; };
    const up=()=>{ node.removeEventListener('pointermove',mv); const T=drawMeasure(); if(T) $('stNote').textContent=T.text; };
    node.addEventListener('pointermove',mv); node.addEventListener('pointerup',up,{once:true}); node.addEventListener('pointercancel',up,{once:true}); },true); }
$('btnMeasure').onclick=()=>setMeasuring(!S.measuring);
// Capture phase: Esc first closes an open popover (core's handler), and only a second Esc ends measuring.
document.addEventListener('keydown',e=>{ if(e.metaKey||e.ctrlKey||e.altKey) return; const el=e.target; if(el.matches?.('input,textarea,select,[contenteditable]')||document.querySelector('.modal:not([hidden])')) return;
  if(S.mode!=='single'&&S.mode!=='corr') return;
  if(e.key==='m'||e.key==='M'){ e.preventDefault(); setMeasuring(!S.measuring); }
  else if(e.key==='Escape'&&S.measuring&&!document.querySelector('.pop:not([hidden])')) setMeasuring(false); },true);

/* ---------- Saved views: section, hang, tracks and zoom under a name. Saved with the project and the session. ---------- */
const viewsMenu=$('viewsMenu');
function depthTopNow(){ return S.view.top+$('logScroll').scrollTop/S.view.pxPerFt; }
function ratioText(v){ const w=wellById(v.selected)||S.wells[0]; return Number.isFinite(v.pxPerFt)&&v.pxPerFt>0?`1:${Math.round(ratioK(w)/v.pxPerFt).toLocaleString()}`:''; }
function defaultViewName(){ if(S.mode!=='corr') return wellById(S.selected)?.name||'Log view'; const h={MD:'MD',GL:'ground level',TVDSS:'sea level'}[S.datum]||S.datum; return `Section · ${DEPTH_DATUMS.includes(S.datum)?h:'flat on '+h}`; }
function drawViewsMenu(){ const L=S.savedViews||[];
  setHTML(viewsMenu,`<div class="vmhead"><b>Saved views</b><span class="hint">saved with the project</span></div>`+
    (L.length?L.map(v=>`<div class="vmrow${v.id===S.activeView?' on':''}"><button type="button" role="menuitem" data-view="${v.id}"><b>${esc(v.name)}</b><span>${esc(WV.describeView(v,wellById(v.selected)?.name))}${ratioText(v)?' · '+ratioText(v):''}</span></button><button type="button" class="small x" data-vupd="${v.id}" title="Replace “${esc(v.name)}” with what is on screen now">⟳</button><button type="button" class="small x" data-vdel="${v.id}" title="Delete “${esc(v.name)}”">×</button></div>`).join('')
      :'<p class="hint vmempty">None yet. A view keeps the section, hang, tracks, scale and depth on screen.</p>')+
    `<hr><div class="vmsave"><input type="text" id="vmName" placeholder="${esc(defaultViewName())}" aria-label="Name for the current view"><button type="button" class="small primary" id="vmSave">Save view</button></div>`); }
function applySavedView(v){ if(S.picking) setPicking(false); closeCurvePop();
  const dropped=WV.applyView(S,v,id=>!!wellById(id)); S.activeView=v.id; S.measure=null; if(v.mode==='corr'&&!S.panel.length&&S.selected) S.panel=[S.selected];
  setMode(v.mode); if(Number.isFinite(v.depthTop)){ const sc=$('logScroll'); sc.scrollTop=Math.max(0,(v.depthTop-S.view.top)*S.view.pxPerFt); S.view.scroll=sc.scrollTop; }
  $('stNote').textContent=`View: ${v.name}`+(dropped?` · ${dropped} well${dropped>1?'s':''} in it ${dropped>1?'are':'is'} no longer open`:''); }
$('btnViews').onclick=e=>{ e.stopPropagation(); if(!viewsMenu.hidden){ viewsMenu.hidden=true; return; } drawViewsMenu(); placePop(viewsMenu,e.currentTarget); };
viewsMenu.addEventListener('click',e=>{ e.stopPropagation(); const b=e.target.closest('button'); if(!b) return; const L=S.savedViews||(S.savedViews=[]);
  if(b.dataset.view){ const v=L.find(v=>v.id===b.dataset.view); viewsMenu.hidden=true; if(v) applySavedView(v); return; }
  if(b.dataset.vdel){ const v=L.find(v=>v.id===b.dataset.vdel); S.savedViews=L.filter(x=>x!==v); if(S.activeView===v?.id) S.activeView=null; autosave(); drawViewsMenu(); $('stNote').textContent=`Deleted view “${v?.name}” · Cmd/Ctrl+Z undoes`; return; }
  if(b.dataset.vupd){ const i=L.findIndex(v=>v.id===b.dataset.vupd); if(i<0) return; L[i]={...WV.captureView(S,L[i].name,depthTopNow()),id:L[i].id}; S.activeView=L[i].id; autosave(); drawViewsMenu(); $('stNote').textContent=`Updated view “${L[i].name}”`; return; }
  if(b.id==='vmSave') saveCurrentView(); });
viewsMenu.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.id==='vmName'){ e.preventDefault(); saveCurrentView(); } });
function saveCurrentView(){ const name=$('vmName').value.trim()||defaultViewName(), v=WV.captureView(S,name,depthTopNow());
  S.savedViews=[...(S.savedViews||[]),v]; S.activeView=v.id; autosave(); drawViewsMenu(); $('stNote').textContent=`Saved view “${v.name}”: it is kept in the session and in the project when you save`; }

/* ---------- PNG export: choose the depth range, scale, resolution and headers, with a preview ---------- */
const EXP={z0:0,z1:0,ratio:0,res:2,headers:true,light:true,busy:null,token:0};
const pngW0=()=>viewWells()[0];
function frameLabel(){ if(S.mode!=='corr') return 'MD'; return {MD:'MD',GL:'Below GL',TVDSS:'TVDSS'}[S.datum]||`From ${S.datum}`; }
function pngSetRange(z0,z1){ const w=pngW0(); EXP.z0=Math.min(z0,z1); EXP.z1=Math.max(z0,z1); $('pngZ0').value=+toDisp(EXP.z0,w).toFixed(1); $('pngZ1').value=+toDisp(EXP.z1,w).toFixed(1); }
function onScreenRange(){ const sc=$('logScroll'), svg=$('logPanel').querySelector('.tracks svg'); if(!svg) return [S.view.top,S.view.bottom];
  const sr=svg.getBoundingClientRect(), vr=sc.getBoundingClientRect(), H=+svg.getAttribute('height'), y=S._ctx.y;
  return [y.invert(Math.max(0,vr.top-sr.top)),y.invert(Math.min(H,vr.bottom-sr.top))]; }
function topZ(name){ const zs=(S._ctx?.cols||[]).map(c=>{ const t=c.w.tops.find(t=>t.name===name); return t?c.F.z(t.md):NaN; }).filter(Number.isFinite); return zs.length?d3.median(zs):NaN; }
async function withExportState(fn){ const w=pngW0(), sc=$('logScroll'), root=document.documentElement, keep={px:S.view.pxPerFt,scroll:sc.scrollTop,theme:root.dataset.theme};
  const px=EXP.ratio?ratioK(w)/EXP.ratio:keep.px, light=EXP.light&&keep.theme==='dark', changed=Math.abs(px-keep.px)>1e-9||light;
  // The page keeps data-theme equal to window.wellerTheme (index.html), so switch both for the export.
  const theme=t=>{ window.wellerTheme=t; root.dataset.theme=t; };
  if(changed){ S.view.pxPerFt=px; if(light) theme('light'); render(); }
  $('cursor').style.display='none';
  try{ return await fn(); } finally{ if(changed){ S.view.pxPerFt=keep.px; if(light) theme(keep.theme); render(); sc.scrollTop=keep.scroll; S.view.scroll=keep.scroll; } } }
// One render at a time; a change while one runs queues just the latest.
function pngPreview(){ const tok=++EXP.token; clearTimeout(EXP.t); EXP.t=setTimeout(async()=>{ await EXP.busy; if(tok!==EXP.token||$('pngDlg').hidden) return;
  $('pngPrev').classList.add('busy');
  EXP.busy=withExportState(async()=>{ const cv=await exportPNG({z0:EXP.z0,z1:EXP.z1,headers:EXP.headers,res:1,maxW:760,maxH:5000}); return {cv,full:pngFullSize()}; })
    .then(({cv,full})=>{ if(tok!==EXP.token) return; const box=$('pngPrev'); box.replaceChildren(cv); box.classList.remove('busy'); pngInfo(full); })
    .catch(err=>{ $('pngPrev').textContent='Preview failed: '+err.message; }); },180); }
// The image's size at full resolution, from the panel as it is laid out for export.
function pngFullSize(){ const panel=$('logPanel'), pr=panel.getBoundingClientRect(), svgs=[...panel.querySelectorAll('.tracks svg')]; if(!svgs.length) return null;
  const svgTop=Math.min(...svgs.map(n=>n.getBoundingClientRect().top-pr.top)), H=+svgs[0].getAttribute('height'), yOf=z=>Math.max(0,Math.min(H,(z-S.view.top)*S.view.pxPerFt));
  return WV.exportSize({width:panel.scrollWidth,headerH:EXP.headers?svgTop:0,y0:yOf(EXP.z0),y1:yOf(EXP.z1),res:EXP.res}); }
function pngInfo(Z){ if(!Z) return; const w=pngW0(), r=EXP.ratio||Math.round(ratioOf(w)), met=S.units==='metric', L=x=>met?`${(x*2.54).toFixed(1)} cm`:`${x.toFixed(1)} in`;
  $('pngInfo').innerHTML=`<b>${Z.w.toLocaleString()} × ${Z.h.toLocaleString()} px</b> · prints ${L(Z.printIn.w)} × ${L(Z.printIn.h)} at 1:${Math.round(r).toLocaleString()}`+(Z.reduced?`<br>⚠ Reduced to ${(Z.scale*96).toFixed(0)} px per inch to fit the browser's image limit. Export a shorter range or a smaller scale for full resolution.`:` · ${Math.round(Z.scale*96)} px per inch`); }
function openPngDlg(){ const wells=viewWells(), w=wells[0]; if(!w){ $('stNote').textContent='Open a well first'; return; }
  const [lo,hi]=frameExtent(wells); pngSetRange(lo,hi); EXP.ratio=0; EXP.res=+$('pngRes').value||2; EXP.headers=$('pngHead').checked; EXP.light=$('pngLight').checked;
  $('pngZLbl').textContent=frameLabel(); $('pngU').textContent=dispU();
  const cur=Math.round(ratioOf(w)); $('pngScale').innerHTML=`<option value="0">As on screen (1:${cur.toLocaleString()})</option>`+SCALES[S.units].map(x=>`<option value="${x}">1:${x.toLocaleString()} · ${scaleHint(x)}</option>`).join('');
  const names=[...new Set(wells.flatMap(w=>[...w.tops].sort((a,b)=>a.md-b.md).map(t=>t.name)))], topOpts='<option value="">—</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('pngT0').innerHTML=topOpts; $('pngT1').innerHTML=topOpts; $('pngTops').hidden=!names.length;
  $('pngLightL').hidden=document.documentElement.dataset.theme!=='dark';
  $('pngPrev').replaceChildren(Object.assign(document.createElement('span'),{className:'hint',textContent:'Rendering preview…'})); $('pngInfo').textContent='';
  $('pngDlg').hidden=false; $('pngGo').focus(); pngPreview(); }
window.openPngDlg=openPngDlg;
$('pngDlg').addEventListener('change',e=>{ const id=e.target.id, w=pngW0();
  if(id==='pngZ0'||id==='pngZ1'){ const a=parseFloat($('pngZ0').value), b=parseFloat($('pngZ1').value); if(Number.isFinite(a)&&Number.isFinite(b)&&a!==b) pngSetRange(fromDisp(a,w),fromDisp(b,w)); $('pngT0').value=''; $('pngT1').value=''; }
  if(id==='pngT0'||id==='pngT1'){ const a=topZ($('pngT0').value), b=topZ($('pngT1').value), pad=fromDisp(10,w);
    if(Number.isFinite(a)&&Number.isFinite(b)) pngSetRange(Math.min(a,b)-pad,Math.max(a,b)+pad); else if(Number.isFinite(a)) pngSetRange(a-pad,Math.max(EXP.z1,a+pad)); else if(Number.isFinite(b)) pngSetRange(Math.min(EXP.z0,b-pad),b+pad); }
  if(id==='pngScale') EXP.ratio=+e.target.value||0;
  if(id==='pngRes') EXP.res=+e.target.value||2;
  if(id==='pngHead') EXP.headers=e.target.checked;
  if(id==='pngLight') EXP.light=e.target.checked;
  pngPreview(); });
$('pngAll').onclick=()=>{ const [lo,hi]=frameExtent(viewWells()); pngSetRange(lo,hi); $('pngT0').value=''; $('pngT1').value=''; pngPreview(); };
$('pngScreen').onclick=()=>{ const [a,b]=onScreenRange(); pngSetRange(a,b); $('pngT0').value=''; $('pngT1').value=''; pngPreview(); };
$('pngCancel').onclick=()=>{ $('pngDlg').hidden=true; EXP.token++; };
$('pngGo').onclick=async()=>{ const b=$('pngGo'); b.disabled=true; b.textContent='Rendering…'; EXP.token++; await EXP.busy;
  try{ const cv=await withExportState(()=>exportPNG({z0:EXP.z0,z1:EXP.z1,headers:EXP.headers,res:EXP.res})); const blob=await canvasBlob(cv), w=pngW0(), u=dispU();
    const name=`${($('vbWell').textContent||'panel').replace(/[^\w-]+/g,'_')}_${Math.round(toDisp(EXP.z0,w))}-${Math.round(toDisp(EXP.z1,w))}${u}.png`;
    downloadBlob(name,blob); $('pngDlg').hidden=true; $('stNote').textContent=`Exported ${name} (${cv.width.toLocaleString()} × ${cv.height.toLocaleString()} px)`; }
  catch(err){ $('stNote').textContent='PNG export failed: '+err.message; }
  finally{ b.disabled=false; b.textContent='Download PNG'; } };
