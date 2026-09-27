/* Weller Logs: state, LAS parsing, log rendering, files, project. */
const {parseLAS,normalizeWell}=WellerLAS;   // app/js/las.js

/* ---------- Curve aliases and default track presets ---------- */
// Mnemonic families. Merged with petroplots' alias table so templates resolve the same curves in both tools.
const A={
  GR:['GR','GRD','SGR','CGR','GRC','GAMMA','GRGC','GR_EDTC','ECGR','HSGR','GRS','GRR','HGR'], SP:['SP','SPC','SSP','SPR'], CAL:['CALI','CAL','CALS','HCAL','CALX','DCAL'],
  RD:['RDEEP','RT','RD','ILD','LLD','AT90','AHT90','AF90','RES_DEEP','M2R9','RLA5','RESD','RILD'], RM:['RMED','RM','ILM','LLM','AT30','AT60','AHT60','AF60','RES_MED','RLA3','RILM','M2R6'],
  RS:['RSHAL','RS','LLS','SFL','SFLU','MSFL','AT10','AHT10','AF10','RES_SHAL','RXO','RXOZ','RLA1','SN','M2R1'],
  RHOB:['RHOB','DEN','RHOZ','DENS','ZDEN','RHO'], NPHI:['NPHI','TNPH','NEU','PHIN','CNC','NPOR','HNPO','NPHI_LS'], DT:['DT','DTC','AC','SONIC','DT24','DTCO','DT4P'], PE:['PEF','PE','PEFZ','PDPE'],
  ROP:['ROP','ROPA','ROP_AVG'], WOB:['WOB','WOBA'], RPM:['RPM'], TG:['TG','TGU','TGAS','GAS','TOTGAS','GASU'], C1:['C1','CH4','METH','METHANE'], C2:['C2','C2H6','ETH'], C3:['C3','C3H8','PROP'],
  C4:['C4','NC4','IC4'], C5:['C5','NC5','IC5'], H2S:['H2S'], CO2:['CO2'],
};
// Cuttings percentages as logged on mud logs (Petrolog and similar). Order = stacking order, left to right.
const LITH=[
  {label:'Clay',aliases:['CLY','CLAY'],color:'#8C7B62'},{label:'Claystone',aliases:['CST','CLST'],color:'#A89A84'},{label:'Kaolinite',aliases:['KAO'],color:'#D9CFC0'},
  {label:'Siltstone',aliases:['SLT','SLTST','SILT'],color:'#B9B39A'},{label:'Fine sand',aliases:['FSD','FSND'],color:'#F2E3A8'},{label:'Med sand',aliases:['MSD','MSND'],color:'#E8D27E'},
  {label:'Coarse sand',aliases:['CSD','CSND'],color:'#D9BD5A'},{label:'Sandstone',aliases:['SSD','SST','SS'],color:'#E4C96A'},{label:'Limestone',aliases:['LS','LIME','LST'],color:'#9DBBD6'},
  {label:'Anhydrite',aliases:['ANHYDRITE','ANHY','ANH'],color:'#C9A7D6'},{label:'Cement',aliases:['CMT'],color:'#9A9A9A'}];
const cssVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function defaultTracks(){ return [
  {id:'t1',name:'GR / SP / Cal',width:190,panel:true,curves:[
    {label:'GR',aliases:A.GR,min:0,max:200,unit:'API',color:'var(--gr)',fill:'left',fillStyle:'gradient',fillColor:'#EDC84A',fillColor2:'#465445',fillOpacity:.6},
    {label:'SP',aliases:A.SP,min:-100,max:100,unit:'mV',color:'var(--sp)'},
    {label:'CAL',aliases:A.CAL,min:6,max:16,unit:'in',color:'var(--cal)',dash:'3 3'}]},
  {id:'t2',name:'Resistivity',width:190,panel:true,curves:[
    {label:'Deep',aliases:A.RD,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rdeep)'},
    {label:'Med',aliases:A.RM,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rmed)',dash:'5 3'},
    {label:'Shal',aliases:A.RS,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rshal)',dash:'2 2'}]},
  {id:'t3',name:'Density · Neutron',width:190,panel:true,crossover:['RHOB','NPHI'],curves:[
    {label:'RHOB',aliases:A.RHOB,min:1.95,max:2.95,unit:'g/cc',color:'var(--rhob)',matchNeutron:true},
    {label:'NPHI',aliases:A.NPHI,min:0.45,max:-0.15,unit:'v/v',color:'var(--nphi)',dash:'5 3'},
    {label:'PEF',aliases:A.PE,min:0,max:10,unit:'b/e',color:'var(--pef)',dash:'1 2'},
    {label:'DT',aliases:A.DT,min:140,max:40,unit:'µs/ft',color:'var(--dt)'}]},
  {id:'t6',name:'Lith',width:56,type:'lith',panel:true,curves:[{label:'GR',aliases:A.GR,min:0,max:200}]},
  {id:'t8',name:'Vsh',width:84,curves:[{label:'VSH',aliases:['VSH_GR','VSH','VCL','VSHALE','VCLAY'],min:0,max:1,unit:'v/v',color:'var(--vsh)',fill:'left',fillColor:'#465445',fillOpacity:.45}]},
  {id:'t9',name:'Porosity · BVW',width:120,curves:[
    {label:'PHI',aliases:['PHI_SW','PHIE','PORE','PHIEF'],min:0.5,max:0,unit:'v/v',color:'var(--phie)',fill:'right',fillColor:'#2A9D8F',fillOpacity:.5},
    {label:'BVW',aliases:['BVW'],min:0.5,max:0,unit:'v/v',color:'var(--sw)',fill:'right',fillColor:'#0353A4',fillOpacity:.55},
    {label:'PHIE',aliases:['PHIE','PORE','PHIEF'],min:0.5,max:0,unit:'v/v',color:'var(--muted)',dash:'2 2'}]},
  {id:'t10',name:'Sw',width:84,curves:[{label:'SW',aliases:['SW','SWT','SWE','SUWI'],min:1,max:0,unit:'v/v',color:'var(--sw)'}]},
  {id:'t11',name:'TOC',width:84,curves:[{label:'TOC',aliases:['TOC_DLR','TOC'],min:0,max:10,unit:'wt%',color:'var(--toc)',fill:'left',fillColor:'#7A5C3E',fillOpacity:.45}]},
  {id:'t12',name:'Flags',width:40,type:'flags',curves:[
    {label:'Net reservoir',aliases:['NET_RES'],color:'#EDC84A'},{label:'Net pay',aliases:['NET_PAY'],color:'#C1121F'},{label:'Bad hole',aliases:['FLAG_BH'],color:'#9AA5AB'}]},
  {id:'t4',name:'Drilling',width:130,curves:[
    {label:'ROP',aliases:A.ROP,min:0,max:300,unit:'ft/hr',color:'var(--rop)'},
    {label:'WOB',aliases:A.WOB,min:0,max:50,unit:'klb',color:'var(--wob)',dash:'3 3'}]},
  {id:'t5',name:'Gas',width:150,curves:[
    {label:'TG',aliases:A.TG,min:1,max:10000,log:true,unit:'units',color:'var(--tg)'},
    {label:'C1',aliases:A.C1,min:1,max:100000,log:true,unit:'ppm',color:'var(--c1)',fill:'left',fillStyle:'gradient',fillColor:'#FCE8D5',fillColor2:'#E4572E',fillOpacity:.75},
    {label:'C2',aliases:A.C2,min:1,max:100000,log:true,unit:'ppm',color:'var(--c2)',dash:'4 2'}]},
  {id:'t7',name:'Cuttings %',width:110,type:'lithpct',curves:LITH.map(l=>({...l,min:0,max:100,unit:'%'}))},
];}
function loadTrackDefaults(){ try{ const d=JSON.parse(localStorage.getItem('weller.trackDefaults2')||'null'); if(Array.isArray(d)&&d.length) return d; }catch(e){} return defaultTracks(); }
const norm=s=>s.toUpperCase().replace(/[:_-]\d+$/,'');
function resolveCurve(well,cfg){ for(const a of cfg.aliases){ const c=well.curves.find(c=>norm(c.mnemonic)===a.toUpperCase()); if(c) return c; } return null; }

/* ---------- State ---------- */
const S={ mode:'single', wells:[], selected:null, panel:[], showEmpty:false, tracks:loadTrackDefaults(), view:{top:0,bottom:6000,pxPerFt:0.35}, datum:'MD', picking:false, hiddenPoints:[], stats:null, basemap:'map', interp:interpDefaults(), corr:{gap:64,spacing:'equal',scale:0.75} };
const $=id=>document.getElementById(id);
function presetWell(cfg){ const w={...WellerSynth.makeWell(cfg),preset:cfg.id}; for(const p of w.points) w.curves.push(makePointCurve(p.mnemonic,p.unit,p.description,p.md,p.data)); delete w.points; return w; }
function loadPresets(){ S.wells=WellerSynth.PRESET_WELLS.map(presetWell); S.selected=S.wells[0].id; S.panel=['w1','w2','w4']; S.datum='MD'; pointSeriesNames().forEach(placePointSeries); computeAllInterp(); }
const wellById=id=>S.wells.find(w=>w.id===id);
const depthOf=w=>w.curves[0].data;
function wellRange(w){ const d=depthOf(w); return [d[0],d[d.length-1]]; }
/* ---------- Depth frames: MD, TVDSS, or flattened on a top. Deviated wells use TVD from their survey. ---------- */
function tvdOf(w){ if(!w.survey) return null; const d=depthOf(w); if(!w._tvd||w._tvd.length!==d.length) w._tvd=WellerLAS.tvdAt(w.survey,d); return w._tvd; }
function mdToTvd(w,md){ return w.survey?WellerLAS.tvdAt(w.survey,Float64Array.of(md))[0]:md; }
function frameOf(w){
  const dep=depthOf(w), mode=S.mode==='single'?'MD':S.datum, md={kind:'MD',z:m=>m,arr:dep,mono:true,note:''};
  if(mode==='MD') return md;
  const tvd=tvdOf(w), base=tvd?(m=>mdToTvd(w,m)):(m=>m), src=tvd||dep;
  const mono=!tvd||src.every((v,i)=>i===0||v>=src[i-1]-1e-9);
  if(mode==='TVDSS'){ const e=WellerLAS.datumElevation(w); if(!Number.isFinite(e)) return {...md,note:'no elevation, shown in MD'};
    const hungGL=!Number.isFinite(w.elevation?.kb); return {kind:'TVDSS',z:m=>base(m)-e,arr:src.map(v=>v-e),mono,note:(hungGL?'hung on GL':'')+(tvd?(hungGL?', ':'')+'TVD from survey':'')}; }
  const t=w.tops.find(t=>t.name===mode); if(!t) return {...md,note:`no ${mode} top, shown in MD`};
  const zt=base(t.md); return {kind:'FLAT',z:m=>base(m)-zt,arr:src.map(v=>v-zt),mono,note:tvd?'TVD from survey':''};
}
function mdAtZ(w,F,z){ const a=F.arr,d=depthOf(w); let i=F.mono?d3.bisectLeft(a,z):a.findIndex(v=>v>=z); if(i<=0) return d[0]; if(i<0||i>=a.length) return d[d.length-1];
  const t=(z-a[i-1])/((a[i]-a[i-1])||1); return d[i-1]+t*(d[i]-d[i-1]); }
function visibleRange(F,top,bot){ const a=F.arr; let i0,i1;
  if(F.mono){ i0=Math.max(0,d3.bisectLeft(a,top)-1); i1=Math.min(a.length-1,d3.bisectRight(a,bot)+1); }
  else { i0=a.findIndex(v=>v>=top); if(i0<0) i0=a.length-1; i0=Math.max(0,i0-1); i1=a.length-1; while(i1>0&&a[i1]>bot) i1--; i1=Math.min(a.length-1,i1+1); }
  return [i0,Math.max(i0,i1)]; }

/* Density scale matched to the neutron's recorded matrix, so the crossover reads the same in every well. */
const ND_RHOB={limestone:[1.95,2.95],sandstone:[1.90,2.90],dolomite:[2.12,3.12]};
const MATRIX_TAG={limestone:'LS',sandstone:'SS',dolomite:'DOL'};
function effCfg(w,cfg){
  if(cfg.matchNeutron&&A.RHOB.includes((cfg.aliases||[])[0])){ const m=w.neutronMatrix||'limestone'; const [a,b]=ND_RHOB[m]; return {...cfg,min:a,max:b,tag:MATRIX_TAG[m]+' scale'}; }
  if(A.NPHI.includes((cfg.aliases||[])[0])&&w.neutronMatrix) return {...cfg,tag:MATRIX_TAG[w.neutronMatrix]};
  return cfg; }

/* ---------- Rendering ---------- */
function visibleTracks(w){ return S.tracks.filter(t=>(S.mode==='single'||t.panel)&&(S.showEmpty||t.curves.some(c=>resolveCurve(w,c)))); }
function fmtDepth(v){ return Math.round(v).toLocaleString(); }
function tickInterval(px){ for(const i of [10,20,25,50,100,200,250,500,1000,2000]) if(i*px>=44) return i; return 5000; }
const trackW=t=>Math.round((t.width||190)*(S.mode==='corr'?(S.corr?.scale??0.75):1));
function render(){
  const statsMode=S.mode==='stats'; $('statsView').hidden=!statsMode; $('logView').hidden=statsMode;
  if(statsMode){ renderSidebar(); renderStats(); autosave(); return; }
  const panel=$('logPanel'); panel.querySelectorAll('.column,.gaplbl').forEach(c=>c.remove()); const ov=$('overlay'); ov.innerHTML=''; ov.setAttribute('width',0); ov.setAttribute('height',0);
  const wells=S.mode==='single'?[wellById(S.selected)].filter(Boolean):S.panel.map(wellById).filter(Boolean);
  $('datumWrap').hidden=S.mode!=='corr'; $('spacingWrap').hidden=S.mode!=='corr';
  $('vbWell').textContent=S.mode==='single'?(wells[0]?.name||'No well'):`Section A–A′ · ${wells.length} wells`;
  $('scaleLbl').textContent=`${(100*S.view.pxPerFt).toFixed(0)} px / 100 ft`;
  const {top,bottom,pxPerFt}=S.view; const H=Math.max(10,(bottom-top)*pxPerFt); const y=d3.scaleLinear([top,bottom],[0,H]);
  const tickI=tickInterval(pxPerFt), minorI=tickI/5, zc=zoneColorMap();
  const gaps=S.mode==='corr'?wellGaps(wells):[];
  const cols=[];
  wells.forEach((w,k)=>{
    const F=frameOf(w);
    const col=document.createElement('div'); col.className='column'; col.dataset.well=w.id; if(k>0&&S.mode==='corr') col.style.marginLeft=gaps[k-1].px+'px';
    const head=document.createElement('div'); head.className='colhead';
    const warn=(w.notes||[]).some(n=>/ignored|corrected/.test(n));
    head.innerHTML=`<span>${esc(w.name)}${w.synthetic?' <small>synthetic</small>':''}${warn?' <small class="warn" title="'+esc(w.notes.join('; '))+'">⚠ header</small>':''}</span><small>${esc(w.api||'')}${F.note?' · '+F.note:''}</small>`;
    col.appendChild(head);
    const tr=document.createElement('div'); tr.className='tracks';
    tr.appendChild(depthTrack(w,F,y,H,tickI,minorI,zc));
    for(const t of visibleTracks(w)) tr.appendChild(logTrack(w,t,F,y,H,tickI,minorI));
    col.appendChild(tr); panel.insertBefore(col,ov); cols.push({w,el:col,F});
  });
  const heads=[...panel.querySelectorAll('.thead')]; heads.forEach(h=>h.style.height=''); const mh=Math.max(0,...heads.map(h=>h.offsetHeight)); heads.forEach(h=>h.style.height=mh+'px');
  S._ctx={cols,y};
  if(S.mode==='corr') drawCorrelations(cols,y,gaps,zc); else S._corrWarn='';
  renderSidebar();
  autosave();
}
function haversineKm(a,b){ const r=Math.PI/180, dLat=(b[0]-a[0])*r, dLon=(b[1]-a[1])*r; const h=Math.sin(dLat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLon/2)**2; return 12742*Math.asin(Math.sqrt(h)); }
function wellGaps(wells){ const out=[]; const base=S.corr?.gap??64;
  const d=wells.slice(1).map((w,i)=>{ const a=wgs84Of(wells[i]), b=wgs84Of(w); return a&&b?haversineKm(a,b):null; });
  const dmax=Math.max(0,...d.filter(v=>v!=null));
  d.forEach(km=>out.push({km,px:S.corr?.spacing==='distance'&&km!=null&&dmax>0?Math.round(36+220*km/dmax):base}));
  return out; }
function depthTrack(w,F,y,H,tickI,minorI,zc){
  const div=document.createElement('div'); div.className='track'; div.style.width='64px';
  const u=w.depthUnit||'ft', lbl=F.kind==='MD'?`MD ${u}`:F.kind==='TVDSS'?`TVDSS ${u}`:`${u} from ${S.datum}`;
  div.innerHTML=`<div class="thead"><div class="tn">Depth</div><div class="scale" style="color:var(--muted)"><span></span><span class="c">${lbl}</span><span></span></div></div>`;
  const svg=d3.create('svg').attr('width',64).attr('height',H).attr('class','depthsvg');
  // Zone strip: the same zone colors as the stats tab and the correlation fills.
  for(const z of zonesOf(w)){ if(z.name==='Whole well') continue; const y0=y(F.z(z.top)), y1=y(F.z(z.base)); if(y1<0||y0>H) continue;
    svg.append('rect').attr('x',0).attr('width',7).attr('y',Math.max(0,y0)).attr('height',Math.max(0,Math.min(H,y1)-Math.max(0,y0))).attr('fill',zc.get(z.name)||'transparent').append('title').text(z.name); }
  const [t,b]=[S.view.top,S.view.bottom]; const start=Math.ceil(t/minorI)*minorI;
  for(let v=start;v<=b;v+=minorI){ const major=Math.abs(v/tickI-Math.round(v/tickI))<1e-6; svg.append('line').attr('x1',major?40:52).attr('x2',64).attr('y1',y(v)).attr('y2',y(v)).attr('class','grid'+(major?' s':''));
    if(major) svg.append('text').attr('x',38).attr('y',y(v)+3.5).attr('text-anchor','end').attr('class','depth').text(fmtDepth(v)); }
  for(const tp of w.tops){ const yy=y(F.z(tp.md)); if(yy<0||yy>H) continue; svg.append('line').attr('x1',8).attr('x2',64).attr('y1',yy).attr('y2',yy).attr('class','top').attr('data-top',tp.name); }
  const node=svg.node(); attachTopDrag(node,w,F,y); div.appendChild(node); return div;
}
const fillHex=c=>c&&c.startsWith('var(')?cssVarHex(c.slice(4,-1)):c;
function scaleFor(c,width){ return c.log?d3.scaleLog([c.min,c.max],[0,width]).clamp(true):d3.scaleLinear([c.min,c.max],[0,width]).clamp(true); }
const LITHO={Sandstone:'#EDC84A',Siltstone:'#C0CCC6',Shale:'#465445',Marl:'#A2DBDB','Limestone / chalk':'#4E86C4'};   // petroplots LITHOLOGY colors
function quickLith(vsh,pe){ if(!Number.isFinite(vsh)) return null;
  if(Number.isFinite(pe)){ if(pe>=4&&vsh<0.4) return 'Limestone / chalk'; if(pe>=3.5&&vsh<0.75) return 'Marl'; if(pe<2.6&&vsh<0.4) return 'Sandstone'; if(vsh<0.4) return 'Siltstone'; }
  return vsh<0.4?'Sandstone':vsh<0.65?'Siltstone':'Shale'; }
function logTrack(w,t,F,y,H,tickI,minorI){
  const width=trackW(t), dep=depthOf(w), zA=F.arr; const div=document.createElement('div'); div.className='track'; div.style.width=width+'px';
  const head=document.createElement('div'); head.className='thead';
  head.innerHTML=`<div class="tn"><span>${esc(t.name)}</span><button title="Edit track" data-edit="${t.id}">⚙</button></div>`;
  const resolved=t.curves.map(c=>{ const curve=resolveCurve(w,c); return {cfg:curve?effCfg(w,c):c,curve}; });
  const gr=resolveCurve(w,{aliases:A.GR}), pe=resolveCurve(w,{aliases:A.PE});
  if(t.type==='lithpct'){ const have=resolved.filter(r=>r.curve&&!r.curve.sparse); head.innerHTML+=`<div class="scale" style="color:var(--muted)"><span>0</span><span class="c">${have.length?have.length+' components':'no cuttings curves'}</span><span class="r">100%</span></div><div class="legend">${have.map(r=>`<i style="background:${r.cfg.color}" title="${r.cfg.label} (${r.curve.mnemonic})"></i>`).join('')}</div>`; }
  else if(t.type==='lith') head.innerHTML+=`<div class="scale" style="color:var(--muted)"><span></span><span class="c">${pe&&!pe.sparse?'GR + PE':'GR'} quick look</span><span></span></div><div class="legend">${Object.entries(LITHO).filter(([k])=>pe&&!pe.sparse||!/Marl|Lime/.test(k)).map(([k,c])=>`<i style="background:${c}" title="${k}"></i>`).join('')}</div>`;
  else if(t.type==='flags') head.innerHTML+=`<div class="legend">${resolved.filter(r=>r.curve).map(r=>`<i style="background:${r.cfg.color}" title="${r.cfg.label}: ${esc(r.curve.description||'')}"></i>`).join('')}</div>`;
  else for(const {cfg,curve} of resolved){ const s=document.createElement('div'); s.className='scale'; s.style.color=cfg.color; s.style.opacity=curve?1:.35; s.title=curve?.description||'';
    s.innerHTML=`<span>${cfg.min}</span><span class="c">${curve?curve.mnemonic:cfg.label+' (none)'}${cfg.unit?' '+cfg.unit:''}${cfg.tag?' · '+cfg.tag:''}</span><span class="r">${cfg.max}</span><span class="bar${curve?.sparse?' pts':cfg.dash?' dash':''}"></span>`; head.appendChild(s); }
  div.appendChild(head);
  const svg=d3.create('svg').attr('width',width).attr('height',H).classed('pick',S.picking);
  const [top,bot]=[S.view.top,S.view.bottom];
  for(let v=Math.ceil(top/minorI)*minorI;v<=bot;v+=minorI){ const major=Math.abs(v/tickI-Math.round(v/tickI))<1e-6; svg.append('line').attr('x1',0).attr('x2',width).attr('y1',y(v)).attr('y2',y(v)).attr('class','grid'+(major?' s':'')); }
  const first=resolved[0]?.cfg||t.curves[0];
  if(t.type==='lithpct'){ for(let i=1;i<10;i++){ const x=width*i/10; svg.append('line').attr('x1',x).attr('x2',x).attr('y1',0).attr('y2',H).attr('class','grid'+(i%5===0?' s':'')); } }
  else if(first&&!t.type){ if(first.log){ const dec=Math.round(Math.log10(Math.max(first.max,first.min)/Math.min(first.max,first.min))); const sx=scaleFor(first,width); const lo=Math.min(first.min,first.max);
      for(let d=0;d<=dec;d++){ const base=lo*10**d; for(let m=1;m<10;m++){ const v=base*m; if(v>Math.max(first.min,first.max)*1.0001) break; svg.append('line').attr('x1',sx(v)).attr('x2',sx(v)).attr('y1',0).attr('y2',H).attr('class','grid'+(m===1?' s':'')); } } }
    else for(let i=0;i<=10;i++){ const x=width*i/10; svg.append('line').attr('x1',x).attr('x2',x).attr('y1',0).attr('y2',H).attr('class','grid'+(i%5===0?' s':'')); } }
  const step=dep.length>1?Math.abs(dep[1]-dep[0]):1; const stride=Math.max(1,Math.floor(1/(S.view.pxPerFt*step)/2));
  const [i0,i1]=visibleRange(F,top,bot); const idx=d3.range(i0,i1+1,stride);
  const Y=i=>y(zA[i]);
  const band=(g,a,b,x,wd,fill,title)=>{ const y0=Y(a), h=Math.max(.6,Y(b)-y0); const r=g.append('rect').attr('x',x).attr('y',y0).attr('width',wd).attr('height',h).attr('fill',fill); if(title) r.append('title').text(title); };
  if(t.type==='lithpct'){ const have=resolved.filter(r=>r.curve&&!r.curve.sparse); if(have.length){ const g=svg.append('g'); const sx=width/100;
      for(let k=0;k<idx.length;k++){ const i=idx[k], j=idx[k+1]??Math.min(i1,i+stride); let x=0;
        for(const r of have){ const v=r.curve.data[i]; if(!Number.isFinite(v)||v<=0) continue; band(g,i,j,x,v*sx,r.cfg.color); x+=v*sx; } } } }
  else if(t.type==='lith'){ if(gr&&!gr.sparse){ const g=svg.append('g'); const bl=grBaselines(w); const vs=resolveCurve(w,{aliases:['VSH_GR']}); let run=null;
      const cls=i=>quickLith(vs?vs.data[i]:WellerPetro.igr(gr.data[i],bl.clean??20,bl.shale??130),pe&&!pe.sparse?pe.data[i]:NaN);
      const flush=(k,a,b)=>{ if(k) band(g,a,b,0,width,LITHO[k],k); };
      for(const i of idx){ const k=cls(i); if(!run||run.k!==k){ if(run) flush(run.k,run.a,i); run={k,a:i}; } }
      if(run) flush(run.k,run.a,i1); } }
  else if(t.type==='flags'){ const have=resolved.filter(r=>r.curve&&!r.curve.sparse); const wd=width/Math.max(1,have.length);
    have.forEach((r,c)=>{ const g=svg.append('g'); let a=null; for(const i of idx){ const on=r.curve.data[i]>0.5; if(on&&a===null) a=i; if(!on&&a!==null){ band(g,a,i,c*wd,wd,r.cfg.color); a=null; } } if(a!==null) band(g,a,i1,c*wd,wd,r.cfg.color); }); }
  else {
    if(t.crossover){ const ra=resolved.find(r=>r.cfg.label===t.crossover[0]), rb=resolved.find(r=>r.cfg.label===t.crossover[1]);
      if(ra?.curve&&rb?.curve&&!ra.curve.sparse&&!rb.curve.sparse){ const sa=scaleFor(ra.cfg,width), sb=scaleFor(rb.cfg,width);
        const area=d3.area().defined(i=>Number.isFinite(ra.curve.data[i])&&Number.isFinite(rb.curve.data[i])&&sa(ra.curve.data[i])<sb(rb.curve.data[i]))
          .x0(i=>sa(ra.curve.data[i])).x1(i=>sb(rb.curve.data[i])).y(Y);
        svg.append('path').attr('d',area(idx)).attr('fill','var(--gas)').attr('opacity',.45); } }
    for(const {cfg,curve} of resolved){ if(!curve) continue; const sx=scaleFor(cfg,width); if(curve.sparse){ drawPoints(svg,cfg,curve,sx,y,F,top,bot); continue; } const ok=i=>Number.isFinite(curve.data[i])&&!(cfg.log&&curve.data[i]<=0);
      if(cfg.fill&&cfg.fill!=='none'){ let fillRef=cfg.fillColor||cfg.color;
        if(cfg.fillStyle==='gradient'){ const gid='g'+t.id+'_'+cfg.label.replace(/\W/g,'')+'_'+w.id, mix=d3.interpolateRgb(fillHex(cfg.fillColor||cfg.color),fillHex(cfg.fillColor2||cfg.color));
          const gr2=svg.append('defs').append('linearGradient').attr('id',gid).attr('gradientUnits','userSpaceOnUse').attr('x1',0).attr('x2',0).attr('y1',0).attr('y2',H);
          for(const i of idx){ if(!ok(i)) continue; const yy=Y(i); if(yy<0||yy>H) continue; gr2.append('stop').attr('offset',(yy/H).toFixed(5)).attr('stop-color',mix(sx(curve.data[i])/width)); }
          fillRef=`url(#${gid})`; }
        const area=d3.area().defined(ok).x0(cfg.fill==='left'?0:width).x1(i=>sx(curve.data[i])).y(Y); svg.append('path').attr('d',area(idx)).attr('fill',fillRef).attr('opacity',cfg.fillOpacity??.35); }
      const line=d3.line().defined(ok).x(i=>sx(curve.data[i])).y(Y);
      svg.append('path').attr('d',line(idx)).attr('fill','none').attr('stroke',cfg.color).attr('stroke-width',1.2).attr('stroke-dasharray',cfg.dash||null); }
  }
  const firstVis=visibleTracks(w)[0];
  for(const tp of w.tops){ const yy=y(F.z(tp.md)); if(yy<0||yy>H) continue; svg.append('line').attr('x1',0).attr('x2',width).attr('y1',yy).attr('y2',yy).attr('class','top').attr('data-top',tp.name);
    if(t===firstVis) svg.append('text').attr('x',3).attr('y',yy-3).attr('class','toplbl').attr('data-top',tp.name).text(tp.name); }
  const node=svg.node();
  node.addEventListener('mousemove',e=>{ if(S.drag) return; const r=node.getBoundingClientRect(); const z=y.invert(e.clientY-r.top); showCursor(e.clientY-$('logPanel').getBoundingClientRect().top,mdAtZ(w,F,z),z,F,w,resolved); });
  node.addEventListener('mouseleave',()=>{ $('cursor').style.display='none'; });
  node.addEventListener('click',e=>{ if(!S.picking) return; const r=node.getBoundingClientRect(); const md=Math.round(mdAtZ(w,F,y.invert(e.clientY-r.top))*2)/2; placeTop(w,md); });
  attachTopDrag(node,w,F,y);
  div.appendChild(node); return div;
}
/* Drag a top line to move it. Hovering within 5 px of a top shows a resize cursor. */
function attachTopDrag(node,w,F,y){
  const near=e=>{ const r=node.getBoundingClientRect(), py=e.clientY-r.top; let best=null,bd=6; for(const tp of w.tops){ const d=Math.abs(y(F.z(tp.md))-py); if(d<bd){ bd=d; best=tp; } } return best; };
  node.addEventListener('pointermove',e=>{ if(!S.drag&&!S.picking) node.style.cursor=near(e)?'ns-resize':''; });
  node.addEventListener('pointerdown',e=>{ if(S.picking||e.button!==0) return; const tp=near(e); if(!tp) return; e.preventDefault();
    const col=node.closest('.column'), r=node.getBoundingClientRect(); S.drag={w,tp,F,y,col,top:r.top,md:tp.md};
    node.setPointerCapture(e.pointerId); document.body.classList.add('dragging'); });
  node.addEventListener('pointermove',e=>{ const D=S.drag; if(!D||D.w!==w) return;
    const z=D.y.invert(e.clientY-D.top); D.md=Math.round(mdAtZ(w,D.F,z)*2)/2; const yy=D.y(D.F.z(D.md));
    D.col.querySelectorAll(`[data-top="${CSS.escape(D.tp.name)}"]`).forEach(el=>{ if(el.tagName==='line'){ el.setAttribute('y1',yy); el.setAttribute('y2',yy); } else el.setAttribute('y',yy-3); });
    $('stNote').textContent=`${D.tp.name}: ${D.md.toFixed(1)} ${w.depthUnit||'ft'} MD in ${w.name}`; });
  const end=e=>{ const D=S.drag; if(!D||D.w!==w) return; S.drag=null; document.body.classList.remove('dragging');
    if(Math.abs(D.md-D.tp.md)>=0.5){ D.tp.md=D.md; D.tp.source='user'; w._grP=null; if(S.interp?.enabled) computeInterp(w); } render(); };
  node.addEventListener('pointerup',end); node.addEventListener('pointercancel',end);
}
function showCursor(yPx,md,z,F,w,resolved){ const dep=depthOf(w); const c=$('cursor'); c.style.display='block'; c.style.top=(yPx)+'px';
  const i=Math.min(dep.length-1,Math.max(0,d3.bisectCenter(dep,md))); const u=w.depthUnit||'ft';
  $('stCursor').innerHTML=`<b>${esc(w.name)}</b> MD ${md.toFixed(1)} ${u}${F.kind!=='MD'?` · ${F.kind==='TVDSS'?'TVDSS':'rel.'} ${z.toFixed(1)}`:''}`;
  $('stVals').innerHTML=resolved.filter(r=>r.curve).map(r=>{ const c=r.curve; if(c.sparse){ const k=nearestPoint(c,md); return k<0?'':`${c.mnemonic} <b>${fmtVal(c.data[k],r.cfg)}</b> @${c.md[k]}`; } return `${c.mnemonic} <b>${fmtVal(c.data[i],r.cfg)}</b>`; }).filter(Boolean).join(' · '); }
function drawCorrelations(cols,y,gaps,zc){
  const ov=d3.select('#overlay'), panel=$('logPanel'), panelR=panel.getBoundingClientRect();
  const geo=cols.map(c=>{ const r=c.el.getBoundingClientRect(); const trk=c.el.querySelector('.tracks svg').getBoundingClientRect(); return {l:r.left-panelR.left,r:r.right-panelR.left,y0:trk.top-panelR.top,c}; });
  ov.attr('width',panelR.width).attr('height',panelR.height);
  const labelled=new Set(), warn=[], names=[...new Set(cols.flatMap(c=>c.w.tops.map(t=>t.name)))];
  for(let i=0;i<geo.length-1;i++){ const a=geo[i],b=geo[i+1];
    const yOf=(g,n)=>{ const t=g.c.w.tops.find(t=>t.name===n); return t?g.y0+y(g.c.F.z(t.md)):null; };
    const shared=names.filter(n=>yOf(a,n)!==null&&yOf(b,n)!==null).sort((p,q)=>yOf(a,p)-yOf(a,q));
    // Tops must keep their order from one well to the next; a crossing means a mis-pick or a fault.
    const bad=new Set(); for(let k=0;k<shared.length;k++) for(let j=k+1;j<shared.length;j++) if(yOf(b,shared[j])<yOf(b,shared[k])-0.5){ bad.add(shared[k]); bad.add(shared[j]); }
    if(bad.size) warn.push(`${[...bad].join(' / ')} cross between ${a.c.w.name} and ${b.c.w.name}`);
    shared.forEach((n,k)=>{ const nx=shared[k+1]; const ya=yOf(a,n), yb=yOf(b,n);
      if(!bad.size){ const bottomA=nx?yOf(a,nx):a.y0+y(S.view.bottom), bottomB=nx?yOf(b,nx):b.y0+y(S.view.bottom);
        ov.append('polygon').attr('class','fm').attr('fill',zc.get(n)||'var(--grid)').attr('points',`${a.r},${ya} ${b.l},${yb} ${b.l},${bottomB} ${a.r},${bottomA}`); }
      ov.append('line').attr('class','corr'+(bad.has(n)?' bad':'')).attr('x1',a.r).attr('y1',ya).attr('x2',b.l).attr('y2',yb);
      if(!labelled.has(n)&&b.l-a.r>34){ labelled.add(n); ov.append('text').attr('x',a.r+4).attr('y',ya-4).text(n); } });
    const missing=names.filter(n=>(yOf(a,n)===null)!==(yOf(b,n)===null)&&cols.slice(i).some(c=>c.w.tops.some(t=>t.name===n))&&cols.slice(0,i+1).some(c=>c.w.tops.some(t=>t.name===n)));
    if(missing.length) warn.push(`${missing.join(', ')} not picked in ${(yOf(a,missing[0])===null?a:b).c.w.name}`);
    const g=gaps[i]; if(g?.km!=null&&b.l-a.r>30){ const lbl=document.createElement('div'); lbl.className='gaplbl'; lbl.style.left=(a.r)+'px'; lbl.style.width=(b.l-a.r)+'px'; lbl.style.top=(geo[i].y0-54)+'px';
      lbl.textContent=g.km<1.6?`${Math.round(g.km*3280.84).toLocaleString()} ft`:`${(g.km*0.621371).toFixed(1)} mi`; lbl.title=`${g.km.toFixed(2)} km between wellheads`; panel.appendChild(lbl); }
  }
  S._corrWarn=warn.join(' · '); if(warn.length) $('stNote').textContent='⚠ '+S._corrWarn;
}
function placeTop(w,md){ const name=$('topName').value.trim(); if(!name) return; const ex=w.tops.find(t=>t.name===name); if(ex) ex.md=md; else w.tops.push({name,md,source:'user'}); S.picking=false; $('btnPick').classList.remove('primary'); $('stNote').textContent=`${name} set at ${md} ft in ${w.name}`; if(S.interp?.enabled) computeInterp(w); render(); }

/* ---------- Sidebar: map, wells, tracks, tops ---------- */
function clickWell(id){ if(S.mode==='corr'){ const i=S.panel.indexOf(id); if(i>=0) S.panel.splice(i,1); else S.panel.push(id); } else S.selected=id; render(); }
// Rebuild a list only when its markup changed, so a click in progress never loses its target.
function setHTML(el,html){ if(el._html!==html){ el.innerHTML=html; el._html=html; } }
function renderSidebar(){
  renderMap();
  $('wellCount').textContent=S.wells.length;
  setHTML($('wellList'),S.wells.map(w=>{ const [a,b]=wellRange(w); return `<li data-well="${w.id}" class="${w.id===S.selected?'sel':''}"><span class="dot${S.mode==='corr'&&S.panel.includes(w.id)?' in':''}"></span><span>${w.name}</span><span class="meta">${w.curves.filter(c=>!c.sparse).length-1} crv${w.curves.some(c=>c.sparse)?' · pts':''} · ${fmtDepth(b)} ${w.depthUnit}</span><button class="small" data-wellset="${w.id}" title="Well settings">⚙</button></li>`; }).join(''));
  setHTML($('trackList'),S.tracks.map((t,i)=>`<div class="trackrow"><span class="sw">${t.curves.slice(0,4).map(c=>`<i style="background:${c.color||'var(--muted)'}"></i>`).join('')}</span><span class="nm">${t.name}</span><label title="Show in correlation panel" style="display:${S.mode==='corr'?'inline':'none'};font-size:11px;color:var(--muted)"><input type="checkbox" data-panel="${i}"${t.panel?' checked':''}> panel</label><button class="small" data-up="${i}" title="Move left">◂</button><button class="small" data-dn="${i}" title="Move right">▸</button><button class="small" data-edit="${t.id}">⚙</button></div>`).join(''));
  renderPointList(); renderInterpPanel();
  const w=S.mode==='corr'?wellById(S.panel[S.panel.length-1]||S.selected):wellById(S.selected);
  $('topsWell').textContent=w?w.name:'';
  setHTML($('topsTable'),w?[...w.tops].sort((a,b)=>a.md-b.md).map(t=>`<tr><td>${t.name}</td><td style="text-align:right">${t.md.toFixed(1)}</td><td><button class="small" data-deltop="${t.name}">×</button></td></tr>`).join(''):'');
  const names=[...new Set(S.wells.flatMap(w=>[...w.tops].sort((a,b)=>a.md-b.md).map(t=>t.name)))];
  $('topNames').innerHTML=names.map(n=>`<option value="${n}">`).join('');
  const dsel=$('datum'); const cur=S.datum; dsel.innerHTML=`<option value="MD">Measured depth</option><option value="TVDSS">Sea level (TVDSS)</option>`+names.map(n=>`<option value="${n}">Flatten on ${n}</option>`).join(''); dsel.value=names.includes(cur)||cur==='MD'||cur==='TVDSS'?cur:'MD';
  $('spacing').value=S.corr.spacing; $('winTop').value=S.view.top; $('winBot').value=S.view.bottom; $('showEmpty').checked=S.showEmpty;
  const sw=wellById(S.selected); if(sw) $('stFile').innerHTML=`<b>${sw.fileName||sw.name+'.las (synthetic)'}</b> · ${sw.rows||depthOf(sw).length} rows · KB ${sw.elevation.kb??'?'} ft · null ${sw.nullv??-999.25}${sw.wrap?' · wrapped':''}`;
}

/* ---------- Color popover: pick a swatch and it closes (native pickers stay open on macOS) ---------- */
const SWATCHES=['#172029','#4A5560','#6B7680','#9AA6B2','#D5DBE2','#FFFFFF','#8C7B62','#A89A84',
  '#C62828','#E4572E','#EF6C00','#F7A04A','#F2D16B','#E9D8A6','#FCE8D5','#D9BD5A',
  '#2E7D32','#5FBF66','#6B7A5E','#1baf7a','#1565C0','#2a78d6','#6AA6E8','#9DBBD6',
  '#6A1B9A','#9085e9','#C084E8','#e87ba4','#B4541E','#7A8A6A','#3E4B57','#000000'];
let colorTarget=null;
function openColorPop(btn){ colorTarget=btn; const pop=$('colorPop'), r=btn.getBoundingClientRect(), cur=(btn.dataset.color||'').toLowerCase();
  pop.querySelector('.grid').innerHTML=SWATCHES.map(c=>`<button type="button" data-pick="${c}" style="background:${c}" title="${c}" aria-label="${c}"${c.toLowerCase()===cur?' class="on"':''}></button>`).join('');
  $('cpHex').value=btn.dataset.color||''; $('cpNative').value=/^#[0-9a-f]{6}$/i.test(btn.dataset.color)?btn.dataset.color:'#333333';
  pop.hidden=false; const pw=pop.offsetWidth, ph=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(innerWidth-pw-8,r.left))+'px'; pop.style.top=(r.bottom+ph+8>innerHeight?r.top-ph-4:r.bottom+4)+'px';
  pop.querySelector('button').focus(); }
function pickColor(c){ if(colorTarget&&/^#[0-9a-f]{6}$/i.test(c)){ colorTarget.dataset.color=c; colorTarget.style.background=c; } closeColorPop(); }
function closeColorPop(){ $('colorPop').hidden=true; colorTarget?.focus(); colorTarget=null; }
document.addEventListener('click',e=>{ const sb=e.target.closest('.swatchbtn'); if(sb){ openColorPop(sb); return; }
  const pk=e.target.closest('[data-pick]'); if(pk){ pickColor(pk.dataset.pick); return; }
  if(!$('colorPop').hidden&&!e.target.closest('#colorPop')) closeColorPop(); },true);
$('cpHex').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); let v=e.target.value.trim(); if(!v.startsWith('#')) v='#'+v; pickColor(v); } });
$('cpNative').addEventListener('change',e=>pickColor(e.target.value));
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!$('colorPop').hidden){ e.stopPropagation(); closeColorPop(); } },true);

/* ---------- Track editor ---------- */
let editing=null;
function openTrackDlg(id){ const t=S.tracks.find(t=>t.id===id); if(!t) return; editing=JSON.parse(JSON.stringify(t)); $('tdName').value=editing.name; $('tdWidth').value=editing.width||190; drawTdCurves(); $('trackDlg').hidden=false; }
function drawTdCurves(){ const w=wellById(S.selected)||S.wells[0]; const tb=$('tdCurves'); tb.innerHTML='';
  const toHex=c=>c.startsWith('var(')?cssVarHex(c.slice(4,-1)):c;
  editing.curves.forEach((c,i)=>{ const tr=document.createElement('tr'); const cur=resolveCurve(w,c);
    tr.innerHTML=`<td><select data-i="${i}" class="tdm">${w.curves.slice(1).map(x=>`<option value="${x.mnemonic}"${cur&&cur.mnemonic===x.mnemonic?' selected':''}>${x.mnemonic} (${x.unit||'-'})${x.sparse?' · points':''}</option>`).join('')}${cur?'':`<option selected value="">${c.label} (not in well)</option>`}</select><div class="hint" style="font-size:10px">${c.label}</div></td>
      <td><input type="number" class="tdmin" data-i="${i}" value="${c.min}" step="any"></td><td><input type="number" class="tdmax" data-i="${i}" value="${c.max}" step="any"><button class="small tdauto" data-i="${i}" title="Set scale from this well's data (p2 to p98)">auto</button></td>
      <td><input type="checkbox" class="tdlog" data-i="${i}"${c.log?' checked':''}></td><td><button type="button" class="swatchbtn tdcol" data-i="${i}" data-color="${toHex(c.color||'#333333')}" style="background:${toHex(c.color||'#333333')}" title="Line color"></button></td>
      <td><input type="checkbox" class="tddash" data-i="${i}"${c.dash?' checked':''}></td>
      <td><select class="tdfill" data-i="${i}"><option value="none"${!c.fill||c.fill==='none'?' selected':''}>None</option><option value="left"${c.fill==='left'?' selected':''}>Left of curve</option><option value="right"${c.fill==='right'?' selected':''}>Right of curve</option></select>
          <select class="tdfs" data-i="${i}"><option value="solid"${c.fillStyle!=='gradient'?' selected':''}>Solid</option><option value="gradient"${c.fillStyle==='gradient'?' selected':''}>Color by value</option></select></td>
      <td><button type="button" class="swatchbtn tdfc" data-i="${i}" data-color="${toHex(c.fillColor||c.color||'#cccccc')}" style="background:${toHex(c.fillColor||c.color||'#cccccc')}" title="Fill color. Gradient: color at the left scale value"></button><button type="button" class="swatchbtn tdfc2" data-i="${i}" data-color="${toHex(c.fillColor2||c.fillColor||c.color||'#cccccc')}" style="background:${toHex(c.fillColor2||c.fillColor||c.color||'#cccccc')}" title="Gradient color at the right scale value"></button></td>
      <td><input type="number" class="tdfo" data-i="${i}" value="${c.fillOpacity??.35}" min="0" max="1" step="0.05" style="width:4em"></td>
      <td><button class="small tdrm" data-i="${i}">×</button></td>`; tb.appendChild(tr); }); }
function autoScale(curve,log){ const v=Array.from(curve.data).filter(x=>Number.isFinite(x)&&(!log||x>0)).sort((a,b)=>a-b); if(v.length<10) return null;
  const lo=v[Math.floor(v.length*.02)], hi=v[Math.floor(v.length*.98)]; if(log){ return [10**Math.floor(Math.log10(lo)),10**Math.ceil(Math.log10(hi))]; }
  const [a,b]=d3.scaleLinear().domain([lo,hi]).nice(5).domain(); return [a,b]; }
function cssVarHex(name){ const v=cssVar(name); if(/^#/.test(v)) return v; const m=v.match(/\d+/g); return m?'#'+m.slice(0,3).map(n=>(+n).toString(16).padStart(2,'0')).join(''):'#333333'; }
function readTd(){ editing.name=$('tdName').value; editing.width=+$('tdWidth').value||190;
  document.querySelectorAll('#tdCurves tr').forEach((tr,i)=>{ const c=editing.curves[i]; const m=tr.querySelector('.tdm').value; if(m){ const mu=m.toUpperCase(); if(!c.aliases.some(a=>a.toUpperCase()===mu)) c.label=m; c.aliases=[m,...c.aliases.filter(a=>a.toUpperCase()!==mu)]; }
    const mn=+tr.querySelector('.tdmin').value, mx=+tr.querySelector('.tdmax').value; if(c.matchNeutron&&(mn!==c.min||mx!==c.max)) c.matchNeutron=false; c.min=mn; c.max=mx; c.log=tr.querySelector('.tdlog').checked; c.color=tr.querySelector('.tdcol').dataset.color; c.dash=tr.querySelector('.tddash').checked?'4 3':undefined;
    c.fill=tr.querySelector('.tdfill').value; c.fillStyle=tr.querySelector('.tdfs').value; c.fillColor=tr.querySelector('.tdfc').dataset.color; c.fillColor2=tr.querySelector('.tdfc2').dataset.color; c.fillOpacity=+tr.querySelector('.tdfo').value; }); }
document.addEventListener('change',e=>{ if(e.target.dataset.panel!==undefined){ S.tracks[+e.target.dataset.panel].panel=e.target.checked; render(); } });
document.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(b.dataset.edit) openTrackDlg(b.dataset.edit);
  if(b.dataset.up!==undefined){ const i=+b.dataset.up; if(i>0){ [S.tracks[i-1],S.tracks[i]]=[S.tracks[i],S.tracks[i-1]]; render(); } }
  if(b.dataset.dn!==undefined){ const i=+b.dataset.dn; if(i<S.tracks.length-1){ [S.tracks[i+1],S.tracks[i]]=[S.tracks[i],S.tracks[i+1]]; render(); } }
  if(b.dataset.deltop){ const w=S.mode==='corr'?wellById(S.panel[S.panel.length-1]||S.selected):wellById(S.selected); w.tops=w.tops.filter(t=>t.name!==b.dataset.deltop); render(); }
  if(b.classList.contains('tdrm')){ readTd(); editing.curves.splice(+b.dataset.i,1); drawTdCurves(); }
  if(b.classList.contains('tdauto')){ readTd(); const c=editing.curves[+b.dataset.i]; const w=wellById(S.selected)||S.wells[0]; const cur=resolveCurve(w,c); const r=cur&&autoScale(cur,c.log); if(r){ [c.min,c.max]=(c.min>c.max)?[r[1],r[0]]:r; drawTdCurves(); } }
  if(b.dataset.wellset) openWellDlg(b.dataset.wellset);
});
$('tdSaveDefaults').onclick=()=>{ readTd(); const i=S.tracks.findIndex(t=>t.id===editing.id); const set=S.tracks.map(t=>t.id===editing.id?editing:t); if(i<0) set.push(editing); try{ localStorage.setItem('weller.trackDefaults2',JSON.stringify(set)); $('stNote').textContent='Track defaults saved for new projects'; }catch(e){ $('stNote').textContent='Could not save defaults (storage blocked)'; } };
$('tdResetDefaults').onclick=()=>{ try{ localStorage.removeItem('weller.trackDefaults2'); }catch(e){} S.tracks=defaultTracks(); $('trackDlg').hidden=true; render(); };
$('tdAddCurve').onclick=()=>{ readTd(); const w=wellById(S.selected)||S.wells[0]; const c=w.curves[1]; editing.curves.push({label:c.mnemonic,aliases:[c.mnemonic],min:0,max:100,color:'#333333'}); drawTdCurves(); };
$('tdSave').onclick=()=>{ readTd(); const i=S.tracks.findIndex(t=>t.id===editing.id); if(i>=0) S.tracks[i]=editing; else S.tracks.push(editing); $('trackDlg').hidden=true; render(); };
$('tdCancel').onclick=()=>{ $('trackDlg').hidden=true; };
$('tdDelete').onclick=()=>{ S.tracks=S.tracks.filter(t=>t.id!==editing.id); $('trackDlg').hidden=true; render(); };
$('btnAddTrack').onclick=()=>{ editing={id:'t'+Date.now().toString(36),name:'New track',width:160,curves:[]}; $('tdName').value=editing.name; $('tdWidth').value=160; drawTdCurves(); $('trackDlg').hidden=false; };

let wellEditing=null;
function openWellDlg(id){ const w=wellById(id); if(!w) return; wellEditing=w; $('wdName').value=w.name; $('wdApi').value=w.api||''; $('wdField').value=w.field||''; $('wdKb').value=w.elevation.kb??''; $('wdGl').value=w.elevation.gl??''; $('wdUnit').value=w.depthUnit;
  $('wdLat').value=w.location.lat??''; $('wdLon').value=w.location.lon??''; $('wdCrs').value=w.location.crs||''; $('wdNotes').textContent=(w.notes||[]).join(' · '); $('wellDlg').hidden=false; }
$('wdSave').onclick=()=>{ const w=wellEditing; const n=v=>v===''?undefined:+v; w.name=$('wdName').value; w.api=$('wdApi').value; w.field=$('wdField').value; w.elevation.kb=n($('wdKb').value); w.elevation.gl=n($('wdGl').value); w.depthUnit=$('wdUnit').value;
  w.location.lat=n($('wdLat').value); w.location.lon=n($('wdLon').value); w.location.crs=$('wdCrs').value; $('wellDlg').hidden=true; render(); };
$('wdCancel').onclick=()=>{ $('wellDlg').hidden=true; };
$('wdRemove').onclick=()=>{ S.wells=S.wells.filter(w=>w!==wellEditing); S.panel=S.panel.filter(id=>wellById(id)); if(!wellById(S.selected)) S.selected=S.wells[0]?.id||null; $('wellDlg').hidden=true; render(); };

/* ---------- Tops CSV, PNG export ---------- */
let hostedDownloads=null; (async()=>{ try{ if(window.claude?.use) hostedDownloads=await window.claude.use('downloads'); }catch(e){} })();
async function downloadBlob(name,blob){
  if(hostedDownloads){ try{ await hostedDownloads.save({filename:name,data:blob}); $('stNote').textContent='Saved '+name; }catch(err){ $('stNote').textContent=err.code==='declined'?'Save cancelled':'Save failed: '+(err.message||err.code); } return; }
  const a=$('pdDownload'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); }
function topsCSV(){ const L=['well,api,top,md_ft']; for(const w of S.wells) for(const t of w.tops) L.push([w.name,w.api||'',t.name,t.md].map(v=>/[",]/.test(String(v))?`"${String(v).replace(/"/g,'""')}"`:v).join(',')); return L.join('\n')+'\n'; }
function isTopsCSV(text){ const cols=(d3.csvParseRows(text.split(/\r?\n/)[0])[0]||[]).map(c=>c.toLowerCase().trim()); const hasTop=cols.some(c=>/^(top|formation|surface|marker|pick)/.test(c)); const extra=cols.filter(c=>!/^(well|well[_ ]?name|name|wellname|api|uwi|top|formation|surface|marker|pick|md|depth|md_ft|top_md|measured|source|comment|notes?)/.test(c)); return hasTop&&!extra.length; }
function importTopsCSV(text){ const rows=d3.csvParse(text); const cols=rows.columns.map(c=>c.toLowerCase().trim()); const find=re=>rows.columns[cols.findIndex(c=>re.test(c))];
  const cw=find(/^(well|well[_ ]?name|name|wellname)$/), ca=find(/api|uwi/), ct=find(/^(top|formation|surface|marker|pick)/), cm=find(/^(md|depth|md_ft|top_md|measured)/);
  if(!ct||!cm) throw new Error('need columns for top name and MD (found: '+rows.columns.join(', ')+')');
  let n=0, miss=new Set(); for(const r of rows){ const md=parseFloat(r[cm]); if(!Number.isFinite(md)) continue; const key=(cw&&r[cw]||'').trim(), api=(ca&&r[ca]||'').replace(/\D/g,'');
    let w=S.wells.find(x=>x.name.toLowerCase()===key.toLowerCase())||(api&&S.wells.find(x=>(x.api||'').replace(/\D/g,'')===api))||(!key&&S.mode==='single'?wellById(S.selected):null);
    if(!w){ miss.add(key||api||'?'); continue; } const name=r[ct].trim(); const ex=w.tops.find(t=>t.name===name); if(ex) ex.md=md; else w.tops.push({name,md,source:'import'}); n++; }
  return `${n} tops imported${miss.size?'; no matching well for: '+[...miss].join(', '):''}`; }
$('btnTopsExport').onclick=()=>downloadBlob('tops.csv',new Blob([topsCSV()],{type:'text/csv'}));
$('btnStatsExport').onclick=()=>downloadBlob('zone-stats.csv',new Blob([statsCSV()],{type:'text/csv'}));
$('btnPpExport').onclick=()=>downloadBlob('weller-curves-petroplots.csv',new Blob([petroplotsCSV()],{type:'text/csv'}));
function svgToImage(svgEl){ const clone=svgEl.cloneNode(true); const vars=['--grid','--grid-strong','--ink','--muted','--paper','--sand','--shale','--gas','--pico','--repetto','--puente','--gr','--sp','--cal','--rdeep','--rmed','--rshal','--rhob','--nphi','--dt','--rop','--wob','--tg','--c1','--c2'];
  const st=document.createElementNS('http://www.w3.org/2000/svg','style'); st.textContent=`.grid{stroke:${cssVar('--grid')};stroke-width:1}.grid.s{stroke:${cssVar('--grid-strong')}}.top{stroke:${cssVar('--ink')};stroke-width:1.2}text{font:10px "IBM Plex Mono",monospace;fill:${cssVar('--muted')}}.depth{fill:${cssVar('--ink')};font-size:11px}.toplbl{font:600 10px "IBM Plex Sans Condensed",sans-serif;fill:${cssVar('--ink')}}.corr{stroke:${cssVar('--ink')};stroke-width:1.2;stroke-dasharray:4 3;fill:none}.fm{opacity:.55}`;
  clone.insertBefore(st,clone.firstChild); clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  let xml=new XMLSerializer().serializeToString(clone); for(const v of vars) xml=xml.split(`var(${v})`).join(cssVar(v));
  return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml); }); }
async function exportPNG(){ const panel=$('logPanel'); const pr=panel.getBoundingClientRect(); const Wp=panel.scrollWidth, Hp=panel.scrollHeight;
  const scale=Math.min(2,16000/Hp,8000/Wp); const cv=document.createElement('canvas'); cv.width=Math.round(Wp*scale); cv.height=Math.round(Hp*scale); const ctx=cv.getContext('2d'); ctx.scale(scale,scale);
  ctx.fillStyle=cssVar('--ground'); ctx.fillRect(0,0,Wp,Hp); const rel=el=>{ const r=el.getBoundingClientRect(); return {x:r.left-pr.left,y:r.top-pr.top+panel.scrollTop*0,w:r.width,h:r.height}; };
  const mono='"IBM Plex Mono",monospace', cond='"IBM Plex Sans Condensed",sans-serif';
  for(const col of panel.querySelectorAll('.column')){ const c=rel(col); ctx.fillStyle=cssVar('--paper'); ctx.fillRect(c.x,c.y,c.w,c.h); ctx.strokeStyle=cssVar('--line'); ctx.strokeRect(c.x+.5,c.y+.5,c.w-1,c.h-1);
    const head=col.querySelector('.colhead'); const hr=rel(head); ctx.fillStyle=cssVar('--ink'); ctx.font=`600 14px ${cond}`; ctx.textBaseline='middle'; ctx.textAlign='left'; ctx.fillText(head.firstChild.textContent,hr.x+8,hr.y+hr.h/2);
    ctx.font=`11px ${mono}`; ctx.fillStyle=cssVar('--muted'); ctx.textAlign='right'; ctx.fillText(head.lastChild.textContent,hr.x+hr.w-8,hr.y+hr.h/2); ctx.beginPath(); ctx.moveTo(hr.x,hr.y+hr.h); ctx.lineTo(hr.x+hr.w,hr.y+hr.h); ctx.stroke();
    for(const tr of col.querySelectorAll('.track')){ const t=rel(tr); const th=tr.querySelector('.thead'); const thr=rel(th);
      ctx.textAlign='left'; ctx.fillStyle=cssVar('--muted'); ctx.font=`600 11px ${cond}`; ctx.fillText(th.querySelector('.tn').firstChild.textContent.toUpperCase(),thr.x+4,thr.y+10);
      let yy=thr.y+22; for(const sc of th.querySelectorAll('.scale')){ const col2=getComputedStyle(sc).color; const sp=sc.querySelectorAll('span'); ctx.font=`10px ${mono}`; ctx.fillStyle=col2; ctx.globalAlpha=parseFloat(getComputedStyle(sc).opacity)||1;
        ctx.textAlign='left'; ctx.fillText(sp[0].textContent,thr.x+4,yy); ctx.textAlign='center'; ctx.fillText(sp[1].textContent,thr.x+thr.w/2,yy); ctx.textAlign='right'; ctx.fillText(sp[2].textContent,thr.x+thr.w-4,yy);
        const bar=sc.querySelector('.bar'); if(bar){ ctx.strokeStyle=col2; ctx.lineWidth=2; ctx.setLineDash(bar.classList.contains('dash')?[4,3]:[]); ctx.beginPath(); ctx.moveTo(thr.x+4,yy+7); ctx.lineTo(thr.x+thr.w-4,yy+7); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth=1; }
        ctx.globalAlpha=1; yy+=20; }
      const leg=th.querySelector('.legend'); if(leg){ let lx=thr.x+4; for(const i of leg.querySelectorAll('i')){ ctx.fillStyle=getComputedStyle(i).backgroundColor; ctx.fillRect(lx,yy-6,9,9); lx+=11; } }
      ctx.strokeStyle=cssVar('--line'); ctx.beginPath(); ctx.moveTo(t.x+t.w,t.y); ctx.lineTo(t.x+t.w,t.y+t.h); ctx.moveTo(thr.x,thr.y+thr.h); ctx.lineTo(thr.x+thr.w,thr.y+thr.h); ctx.stroke();
      const svg=tr.querySelector('svg'); const sr=rel(svg); const img=await svgToImage(svg); ctx.drawImage(img,sr.x,sr.y,sr.w,sr.h); } }
  const ov=$('overlay'); if(ov.childNodes.length){ const img=await svgToImage(ov); ctx.drawImage(img,0,0); }
  return cv; }
$('btnPng').onclick=async()=>{ if(S.mode==='stats'){ $('stXp').toBlob(b=>downloadBlob(`crossplot_${S.stats.x}_${S.stats.y}.png`.replace(/[^\w.-]+/g,'_'),b),'image/png'); return; } $('stNote').textContent='Rendering PNG…'; $('cursor').style.display='none';
  try{ const cv=await exportPNG(); cv.toBlob(b=>{ downloadBlob(($('vbWell').textContent||'panel').replace(/[^\w-]+/g,'_')+'.png',b); },'image/png'); }
  catch(err){ $('stNote').textContent='PNG export failed: '+err.message; } };

/* ---------- View controls ---------- */
$('wellList').addEventListener('click',e=>{ const li=e.target.closest('li[data-well]'); if(li&&!e.target.closest('button')) clickWell(li.dataset.well); });
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
function setMode(m){ const was=S.mode; S.mode=m; document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-selected',b.dataset.mode===m)); if(m==='corr'&&S.panel.length===0) S.panel=[S.selected]; if(m!=='stats'&&was==='stats'){ render(); fitView(); } else render(); }
$('datum').onchange=e=>{ S.datum=e.target.value; fitView(); };
$('spacing').onchange=e=>{ S.corr.spacing=e.target.value; render(); };
$('winTop').onchange=e=>{ if(+e.target.value!==S.view.top){ S.view.top=+e.target.value; render(); } }; $('winBot').onchange=e=>{ if(+e.target.value!==S.view.bottom){ S.view.bottom=+e.target.value; render(); } };
$('btnFit').onclick=fitView;
$('showEmpty').onchange=e=>{ S.showEmpty=e.target.checked; render(); };
function fitView(){ if(S.mode==='stats') return render(); const wells=(S.mode==='single'?[wellById(S.selected)]:S.panel.map(wellById)).filter(Boolean); let lo=Infinity,hi=-Infinity;
  for(const w of wells){ const a=frameOf(w).arr; for(let i=0;i<a.length;i+=8){ if(a[i]<lo) lo=a[i]; if(a[i]>hi) hi=a[i]; } lo=Math.min(lo,a[0]); hi=Math.max(hi,a[a.length-1]); }
  // A correlation hung on a top opens on the interval around it, not the whole well.
  if(S.mode==='corr'&&!['MD','TVDSS'].includes(S.datum)&&Number.isFinite(lo)){ lo=Math.max(lo,-400); hi=Math.min(hi,1200); }
  if(!Number.isFinite(lo)) {lo=0;hi=1000;} S.view.top=Math.floor(lo/100)*100; S.view.bottom=Math.ceil(hi/100)*100;
  const vh=$('logScroll').clientHeight-80; S.view.pxPerFt=Math.max(0.05,vh/(S.view.bottom-S.view.top)*2); render(); }
function zoom(f,anchorPx){ const sc=$('logScroll'); const before=(anchorPx??sc.scrollTop+sc.clientHeight/2); const depthAt=S.view.top+before/S.view.pxPerFt; S.view.pxPerFt=Math.min(20,Math.max(0.02,S.view.pxPerFt*f)); render(); sc.scrollTop=(depthAt-S.view.top)*S.view.pxPerFt-(anchorPx??sc.clientHeight/2)+(anchorPx?0:0); }
$('zoomIn').onclick=()=>zoom(1.5); $('zoomOut').onclick=()=>zoom(1/1.5);
$('logScroll').addEventListener('wheel',e=>{ if(!(e.ctrlKey||e.metaKey)) return; e.preventDefault(); const r=$('logScroll').getBoundingClientRect(); const yIn=e.clientY-r.top; const sc=$('logScroll'); const depthAt=S.view.top+(sc.scrollTop+yIn-10)/S.view.pxPerFt; S.view.pxPerFt=Math.min(20,Math.max(0.02,S.view.pxPerFt*(e.deltaY<0?1.2:1/1.2))); render(); sc.scrollTop=(depthAt-S.view.top)*S.view.pxPerFt+10-yIn; },{passive:false});
$('btnPick').onclick=()=>{ if(!$('topName').value.trim()){ $('topName').focus(); return; } S.picking=!S.picking; $('btnPick').classList.toggle('primary',S.picking); render(); };

/* ---------- Browser cache of opened LAS text (IndexedDB), so a session resumes without re-picking files ---------- */
const lasCache={ db:null,
  open(){ return this.db||(this.db=new Promise((res,rej)=>{ try{ const r=indexedDB.open('weller',1); r.onupgradeneeded=()=>r.result.createObjectStore('las'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } })); },
  async put(name,text){ try{ const db=await this.open(); db.transaction('las','readwrite').objectStore('las').put({text,at:Date.now()},name); }catch(e){} },
  async get(name){ try{ const db=await this.open(); return await new Promise((res,rej)=>{ const r=db.transaction('las').objectStore('las').get(name); r.onsuccess=()=>res(r.result?.text||null); r.onerror=()=>rej(r.error); }); }catch(e){ return null; } } };

/* ---------- Files: one Open for LAS, projects, tops CSV and point-data CSV; drag and drop anywhere ---------- */
const OPEN_TYPES=[{description:'Well data',accept:{'text/plain':['.las','.LAS','.txt','.csv'],'application/json':['.lasproj','.json']}}];
$('btnOpen').onclick=async()=>{ if(window.showOpenFilePicker){ try{ const hs=await showOpenFilePicker({multiple:true,types:OPEN_TYPES}); const files=[]; for(const h of hs){ const f=await h.getFile(); files.push({name:f.name,text:await f.text(),handle:h}); } openFiles(files); }catch(e){} } else $('fileIn').click(); };
$('fileIn').onchange=async e=>{ const files=[]; for(const f of e.target.files) files.push({name:f.name,text:await f.text()}); openFiles(files); e.target.value=''; };
function kindOf(f){ const t=f.text.trimStart(); if(/\.(lasproj|json)$/i.test(f.name)||t[0]==='{') return 'project'; if(t[0]==='~'||/\.las$/i.test(f.name)||/^#[^\n]*\n\s*~/.test(t)) return 'las'; return isTopsCSV(f.text)?'tops':'points'; }
async function openFiles(files){ const by={project:[],las:[],tops:[],points:[]}; for(const f of files) by[kindOf(f)].push(f); const notes=[];
  for(const f of by.project){ try{ await loadProject(JSON.parse(f.text)); if(f.handle) S.fileHandle=f.handle; notes.push('Project '+f.name+' loaded'); }catch(err){ notes.push(`${f.name}: ${err.message}`); } }
  if(by.las.length) notes.push(...addLASFiles(by.las));
  for(const f of by.tops){ try{ notes.push(importTopsCSV(f.text)); }catch(err){ notes.push(`${f.name}: ${err.message}`); } }
  for(const f of by.points){ try{ notes.push('Points: '+importPointsCSV(f.text,f.name)); }catch(err){ notes.push(`${f.name}: ${err.message}`); } }
  render(); $('stNote').textContent=notes.filter(Boolean).join(' · '); }
function addLASFiles(files){ let first=null; const notes=[];
  for(const f of files){ try{ const p=parseLAS(f.text); if(!p.curves.length||!p.rows) throw new Error('no curve data found'); const w=normalizeWell(p,f.name); if(f.demo) w.demo=f.demo; S.wells.push(w); first=first||w.id; if(!f.demo) lasCache.put(f.name,f.text); computeInterp(w);
      if(!Number.isFinite(w.location.lat)) notes.push(`${w.name}: no location in header, not on map`); if(w.elevation.kb===undefined) notes.push(`${w.name}: no KB elevation, TVDSS unavailable`); const conv=w.curves.filter(c=>c.note).map(c=>c.mnemonic+' '+c.note); if(conv.length) notes.push(`${w.name}: ${conv.join(', ')}`); if(w.notes?.length) notes.push(`${w.name}: ${w.notes.join(', ')}`);
    }catch(err){ notes.push(`${f.name}: could not read (${err.message})`); } }
  if(first){ S.selected=first; if(S.mode==='corr') S.panel.push(first); if(S.mode!=='stats') fitView(); } return notes; }
let dragDepth=0;
addEventListener('dragenter',e=>{ if(e.dataTransfer?.types?.includes('Files')){ dragDepth++; document.body.classList.add('dropping'); } });
addEventListener('dragleave',()=>{ if(--dragDepth<=0){ dragDepth=0; document.body.classList.remove('dropping'); } });
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',async e=>{ e.preventDefault(); dragDepth=0; document.body.classList.remove('dropping'); const files=[]; for(const f of e.dataTransfer.files) files.push({name:f.name,text:await f.text()}); if(files.length) openFiles(files); });

/* ---------- Project save / load / autosave ---------- */
function projectJSON(){ return { version:2, app:'weller-logs', savedAt:new Date().toISOString(), mode:S.mode, selected:S.selected, panel:S.panel, datum:S.datum, view:S.view, tracks:S.tracks, hiddenPoints:S.hiddenPoints, stats:S.stats, basemap:S.basemap, interp:S.interp, corr:S.corr,
  wells:S.wells.map(w=>({id:w.id,name:w.name,api:w.api,field:w.field,preset:w.preset,demo:w.demo,fileName:w.fileName,location:w.location,elevation:w.elevation,depthUnit:w.depthUnit,tops:w.tops,points:pointsJSON(w),curveList:w.curves.filter(c=>!c.sparse).map(c=>c.mnemonic)})) }; }
async function loadProject(p){ if(!p||p.app!=='weller-logs') throw new Error('not a Weller Logs project'); const missing=[];
  const fromCache={}; for(const r of p.wells){ if(r.preset||S.wells.some(w=>w.fileName===r.fileName)) continue; const text=r.demo?await fetchText('data/'+r.demo):await lasCache.get(r.fileName); if(text){ try{ fromCache[r.fileName]=normalizeWell(parseLAS(text),r.fileName); }catch(e){} } }
  S.wells=p.wells.map(ref=>{ if(ref.preset){ const cfg=WellerSynth.PRESET_WELLS.find(c=>c.id===ref.preset); const w=presetWell(cfg); w.tops=ref.tops; w.elevation=ref.elevation; restorePoints(w,ref.points); return w; }
    const live=S.wells.find(w=>w.fileName===ref.fileName)||fromCache[ref.fileName]; if(live){ if(ref.demo) live.demo=ref.demo; Object.assign(live,{tops:ref.tops,elevation:ref.elevation,location:ref.location,name:ref.name,api:ref.api,field:ref.field,id:ref.id}); restorePoints(live,ref.points); return live; } missing.push(ref.fileName||ref.name); return null; }).filter(Boolean);
  S.tracks=p.tracks; S.view=p.view; S.datum=p.datum||'MD'; S.hiddenPoints=p.hiddenPoints||[]; S.stats={...statsDefaults(),...(p.stats||{})}; S.interp={...interpDefaults(),...(p.interp||{})}; S.corr={...S.corr,...(p.corr||{})}; if(!p.tracks.some(t=>t.id==='t8')) S.tracks=[...p.tracks,...defaultTracks().filter(t=>['t8','t9','t10','t11','t12'].includes(t.id))]; setBasemap(p.basemap||'map'); if((p.version||1)<2) pointSeriesNames().forEach(placePointSeries); S.panel=(p.panel||[]).filter(id=>wellById(id)); S.selected=wellById(p.selected)?p.selected:(S.wells[0]?.id||null);
  computeAllInterp(); setMode(p.mode||'single'); $('stNote').textContent=missing.length?`Re-open these LAS files to restore them: ${missing.join(', ')}`:'Project loaded'; }
function autosave(){ try{ localStorage.setItem('weller.session',JSON.stringify(projectJSON())); }catch(e){} }
const projName=()=>(wellById(S.selected)?.name||'project').replace(/\s+/g,'-')+'.lasproj';
async function saveProject(as){ const text=JSON.stringify(projectJSON(),null,1);
  if(window.showSaveFilePicker){ try{ if(as||!S.fileHandle) S.fileHandle=await showSaveFilePicker({suggestedName:projName(),types:[{description:'Weller Logs project',accept:{'application/json':['.lasproj']}}]});
      const w=await S.fileHandle.createWritable(); await w.write(text); await w.close(); $('stNote').textContent='Saved '+S.fileHandle.name; }catch(e){ if(e.name!=='AbortError') $('stNote').textContent='Save failed: '+e.message; } return; }
  downloadBlob(projName(),new Blob([text],{type:'application/json'})); }
$('btnSave').onclick=()=>saveProject(false);
document.addEventListener('keydown',e=>{ if(!(e.metaKey||e.ctrlKey)) return; const k=e.key.toLowerCase(); if(k==='o'){ e.preventDefault(); $('btnOpen').click(); } else if(k==='s'){ e.preventDefault(); saveProject(e.shiftKey); } else if(k==='e'){ e.preventDefault(); $('btnPng').click(); } });

/* ---------- Examples: real Denver Basin Niobrara logs, or the synthetic LA Basin set ---------- */
const NIOBRARA_FILES=['2120933C.las','2121045D.las','2121046D.las','2121038B.las','2121035D.las','2121034E.las','2121022A.las','400709586.las'];
async function fetchText(url){ try{ const r=await fetch(url); return r.ok?await r.text():null; }catch(e){ return null; } }
let undoProject=null;
async function loadExample(name){
  undoProject=S.wells.length?projectJSON():null;
  if(name==='labasin'){ S.tracks=loadTrackDefaults(); loadPresets(); S.mode='single'; setMode('single'); fitView(); exampleNote('Synthetic LA Basin wells loaded'); return true; }
  $('stNote').textContent='Loading Denver Basin Niobrara logs…';
  const texts=await Promise.all(NIOBRARA_FILES.map(f=>fetchText('data/niobrara/'+f)));
  if(texts.some(t=>!t)){ $('stNote').textContent='Could not load the example logs (open the app from a web server, not a file).'; return false; }
  S.wells=[]; S.tracks=loadTrackDefaults(); S.hiddenPoints=[];
  // Example parameters. Rw: max specific conductance 61.3 mS/cm at 25 C in Niobrara produced water, Weld County
  // (USGS data release doi:10.5066/P14CRSQQ); late-time samples approach formation water, giving Rw 0.16 ohm.m at 77 F.
  S.interp={...interpDefaults(),matrix:'auto',swPhi:'total',rw:0.16,rwTemp:77,
    source:'Example parameters: Rw 0.16 Ω·m at 77 °F from Niobrara produced water, Weld County (USGS doi:10.5066/P14CRSQQ); Sw on total porosity, as usual for chalk-marl source rocks. Replace with your own data.'};
  const notes=addLASFiles(NIOBRARA_FILES.map((f,i)=>({name:f,text:texts[i],demo:'niobrara/'+f})));
  const tops=await fetchText('data/niobrara/tops.csv'); if(tops) importTopsCSV(tops);
  computeAllInterp();
  // Section west to east through the pad.
  const vert=S.wells.filter(w=>Number.isFinite(w.location.lon)).sort((a,b)=>a.location.lon-b.location.lon);
  const horiz=S.wells.find(w=>w.survey);
  S.panel=[vert[0],vert[1],vert[3],vert[5],vert[6],horiz].filter(Boolean).map(w=>w.id); S.selected=(vert[3]||S.wells[0]).id;
  S.datum='Niobrara'; S.stats={...statsDefaults(),curve:'PHI',x:'NPHI',y:'RHOB',type:'nd'}; S.mode='corr'; setMode('corr'); fitView();
  exampleNote('Denver Basin Niobrara: 7 Laramie County, WY verticals (WOGCC) and 1 Weld County, CO horizontal. Tops are rule-based picks.'+(notes.length?' · '+notes.join(' · '):''));
  return true; }
function exampleNote(msg){ $('stNote').innerHTML=esc(msg)+(undoProject?' <button class="small" id="btnUndoEx">Undo</button>':''); }
document.addEventListener('click',async e=>{ if(e.target.id==='btnUndoEx'&&undoProject){ const p=undoProject; undoProject=null; await loadProject(p); } });
$('exampleSel').onchange=async e=>{ const v=e.target.value; e.target.value=''; if(v) await loadExample(v); };

/* ---------- Boot: resume-last-session prompt ---------- */
S.stats=statsDefaults();
let saved=null; try{ saved=JSON.parse(localStorage.getItem('weller.session')||'null'); }catch(e){}
if(saved&&saved.savedAt){ $('resumeWhen').textContent=new Date(saved.savedAt).toLocaleString(); $('resume').hidden=false; }
$('btnResume').onclick=async()=>{ $('resume').hidden=true; try{ await loadProject(saved); }catch(e){ $('stNote').textContent='Saved session could not be restored: '+e.message; } };
$('btnFresh').onclick=()=>{ $('resume').hidden=true; };
if('serviceWorker' in navigator&&/^https?:/.test(location.protocol)&&!/claude\.ai|claudeusercontent/.test(location.host)) navigator.serviceWorker.register('sw.js').catch(()=>{});
(async()=>{ if(!(await loadExample('niobrara'))){ loadPresets(); fitView(); } undoProject=null; })();
