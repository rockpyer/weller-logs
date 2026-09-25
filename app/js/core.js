/* Weller Logs: state, LAS parsing, log rendering, files, project. */
/* ---------- LAS parsing (LAS 1.2 / 2.0, wrapped or not) ---------- */
function parseLAS(text){
  const lines=text.split(/\r?\n/); let sec=''; const H={version:{},well:{},curves:[],params:{},other:[]}; const rows=[];
  const NULLS=new Set([-999.25,-999,-9999,-999.99,-99999,1e30]);
  let wrap=false, nullv=-999.25, buf=[];
  const parseHead=l=>{ // MNEM.UNIT  DATA : DESC
    const i=l.indexOf('.'); if(i<0) return null; const mnem=l.slice(0,i).trim();
    const rest=l.slice(i+1); const ci=rest.lastIndexOf(':'); const body=ci>=0?rest.slice(0,ci):rest, desc=ci>=0?rest.slice(ci+1).trim():'';
    const m=body.match(/^(\S*)\s*(.*)$/); if(!m) return null;
    return {mnem,unit:m[1],value:(m[2]||'').trim(),desc};
  };
  for(const raw of lines){
    const l=raw.trim(); if(!l||l.startsWith('#')) continue;
    if(l[0]==='~'){ sec=l[1].toUpperCase(); continue; }
    if(sec==='A'){ const toks=l.split(/\s+/).map(Number); if(toks.some(isNaN)) continue;
      if(wrap){ buf.push(...toks); if(buf.length>=H.curves.length){ rows.push(buf.slice(0,H.curves.length)); buf=[]; } } else rows.push(toks); continue; }
    const h=parseHead(l); if(!h) { if(sec==='O') H.other.push(l); continue; }
    if(sec==='V'){ H.version[h.mnem]=h.value; if(h.mnem==='WRAP') wrap=/yes/i.test(h.value); }
    else if(sec==='W'){ H.well[h.mnem.toUpperCase()]=h; if(h.mnem.toUpperCase()==='NULL') nullv=parseFloat(h.value)||nullv; }
    else if(sec==='C'){ H.curves.push({mnemonic:h.mnem,unit:h.unit,description:h.desc}); }
    else if(sec==='P'){ H.params[h.mnem.toUpperCase()]=h; }
  }
  NULLS.add(nullv);
  const n=rows.length; const curves=H.curves.map((c,j)=>{ const a=new Float64Array(n); let nulls=0; for(let i=0;i<n;i++){ let v=rows[i][j]; if(v===undefined||NULLS.has(v)||Math.abs(v-nullv)<1e-6){v=NaN;nulls++;} a[i]=v; } return {...c,data:a,nulls}; });
  return {header:H,curves,wrap,nullv,rows:n};
}
function normalizeWell(p,fileName){
  const W=p.header.well; const g=k=>W[k]?.value; const num=k=>{const t=(g(k)||'').trim(); return /^-?\d+(\.\d+)?$/.test(t)?parseFloat(t):undefined;};
  const dep=p.curves[0]; const depthUnit=/m/i.test(dep.unit)&&!/ft|f$/i.test(dep.unit)?'m':'ft';
  // Unit normalization for known curves.
  for(const c of p.curves){ const m=c.mnemonic.toUpperCase(), u=(c.unit||'').toUpperCase();
    if(/^(NPHI|TNPH|NPOR|PHIN|CNC|HNPO)/.test(m)){ const med=d3.median(c.data.filter(Number.isFinite)); if(/PU|%/.test(u)||(med>1.5)){ c.data=c.data.map(v=>v/100); c.unit='V/V'; c.note='converted from pu'; } }
    if(/^(DT|DTC|DTCO|AC)$/.test(m)&&/US\/M|USEC\/M/.test(u)){ c.data=c.data.map(v=>v/3.28084); c.unit='US/F'; c.note='converted from us/m'; }
  }
  const tops=Object.values(p.header.params).filter(h=>/^TOP_/.test(h.mnem.toUpperCase())).map(h=>({name:h.mnem.slice(4).replace(/_/g,' ').replace(/\w\S*/g,s=>s[0]+s.slice(1).toLowerCase()),md:parseFloat(h.value),source:'import'})).filter(t=>Number.isFinite(t.md));
  const notes=[]; const all=Object.values(W).map(h=>`${h.mnem} ${h.value} ${h.desc}`).join(' | ');
  let kb=num('EKB')??num('KB')??num('EDF')??num('DF')??num('ELEV'), gl=num('EGL')??num('GL');
  if(kb===undefined){ const m=all.match(/(-?\d+(?:\.\d+)?)\s*'?\s*(?:KB|RKB|DF)\b/i); if(m){ kb=parseFloat(m[1]); notes.push('KB read from free text'); } }
  if(gl===undefined){ const m=all.match(/(-?\d+(?:\.\d+)?)\s*[?']?\s*GL\b/i); if(m) gl=parseFloat(m[1]); }
  let lat=num('LATI')??num('LAT'), lon=num('LONG')??num('LON');
  if(lat===undefined){ const m=all.match(/LAT[A-Z]*\s*[:=]?\s*(-?\d+\.\d+)/i); if(m) lat=parseFloat(m[1]); }
  if(lon===undefined){ const m=all.match(/LON[A-Z]*\s*[:=]?\s*(-?\d+\.\d+)/i); if(m) lon=parseFloat(m[1]); }
  const inUS=/CALIFORNIA|\bCA\b|UNITED STATES|USA/i.test(all);
  if(lon!==undefined&&lon>0&&inUS){ lon=-lon; notes.push('longitude sign corrected to west'); }
  const crsM=all.match(/NAD\s*(27|83)/i); const zoneM=all.match(/ZONE\s*(\d)/i);
  const crs=g('GDAT')||(crsM?`NAD${crsM[1]}${zoneM?' · State Plane Zone '+zoneM[1]:''}`:'unknown');
  return { id:'u'+Math.random().toString(36).slice(2,8), name:g('WELL')||fileName.replace(/\.las$/i,''), api:g('API')||(g('UWI')&&!/enter/i.test(g('UWI'))?g('UWI'):''), fileName,
    location:{lat,lon,crs}, elevation:{kb,gl,unit:depthUnit}, field:g('FLD')||'', notes,
    depthUnit, curves:p.curves, tops, wrap:p.wrap, nullv:p.nullv, rows:p.rows };
}

/* ---------- Curve aliases and default track presets ---------- */
const A={
  GR:['GR','GRC','SGR','CGR','ECGR','HSGR','GAMMA','GRD','GRS','GRR'], SP:['SP','SPR','SPC'], CAL:['CALI','CAL','HCAL','CALX','CALS'],
  RD:['ILD','LLD','RT','AT90','AHT90','RLA5','RD','RESD','RILD','AF90','M2R9'], RM:['ILM','AT60','AHT60','RLA3','RM','RILM','AF60','M2R6'],
  RS:['SFL','SFLU','MSFL','LLS','AT10','AHT10','RXO','RS','RLA1','SN','AF10','M2R1'],
  RHOB:['RHOB','RHOZ','DEN','ZDEN','DENS'], NPHI:['NPHI','TNPH','NPOR','PHIN','CNC','HNPO','NPHI_LS'], DT:['DT','DTC','DTCO','AC','DT4P'], PE:['PE','PEF','PEFZ'],
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
    {label:'GR',aliases:A.GR,min:0,max:150,unit:'GAPI',color:'var(--gr)',fill:'left',fillStyle:'gradient',fillColor:'#F2DC8A',fillColor2:'#7A8A6A',fillOpacity:.45},
    {label:'SP',aliases:A.SP,min:-160,max:40,unit:'mV',color:'var(--sp)'},
    {label:'CAL',aliases:A.CAL,min:6,max:16,unit:'in',color:'var(--cal)',dash:'3 3'}]},
  {id:'t2',name:'Resistivity',width:190,panel:true,curves:[
    {label:'Deep',aliases:A.RD,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rdeep)'},
    {label:'Med',aliases:A.RM,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rmed)'},
    {label:'Shal',aliases:A.RS,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rshal)',dash:'4 2'}]},
  {id:'t3',name:'Porosity',width:190,crossover:['RHOB','NPHI'],curves:[
    {label:'RHOB',aliases:A.RHOB,min:1.95,max:2.95,unit:'g/cc',color:'var(--rhob)'},
    {label:'NPHI',aliases:A.NPHI,min:0.45,max:-0.15,unit:'v/v',color:'var(--nphi)',dash:'5 3'},
    {label:'DT',aliases:A.DT,min:140,max:40,unit:'µs/ft',color:'var(--dt)'}]},
  {id:'t4',name:'Drilling',width:130,curves:[
    {label:'ROP',aliases:A.ROP,min:0,max:300,unit:'ft/hr',color:'var(--rop)'},
    {label:'WOB',aliases:A.WOB,min:0,max:50,unit:'klb',color:'var(--wob)',dash:'3 3'}]},
  {id:'t5',name:'Gas',width:150,curves:[
    {label:'TG',aliases:A.TG,min:1,max:10000,log:true,unit:'units',color:'var(--tg)'},
    {label:'C1',aliases:A.C1,min:1,max:100000,log:true,unit:'ppm',color:'var(--c1)',fill:'left',fillStyle:'gradient',fillColor:'#FCE8D5',fillColor2:'#E4572E',fillOpacity:.6},
    {label:'C2',aliases:A.C2,min:1,max:100000,log:true,unit:'ppm',color:'var(--c2)',dash:'4 2'}]},
  {id:'t6',name:'Lith',width:70,type:'lith',panel:true,curves:[{label:'GR',aliases:A.GR,min:20,max:130}]},
  {id:'t7',name:'Cuttings %',width:110,type:'lithpct',curves:LITH.map(l=>({...l,min:0,max:100,unit:'%'}))},
];}
function loadTrackDefaults(){ try{ const d=JSON.parse(localStorage.getItem('weller.trackDefaults')||'null'); if(Array.isArray(d)&&d.length) return d; }catch(e){} return defaultTracks(); }
const norm=s=>s.toUpperCase().replace(/[:_-]\d+$/,'');
function resolveCurve(well,cfg){ for(const a of cfg.aliases){ const c=well.curves.find(c=>norm(c.mnemonic)===a.toUpperCase()); if(c) return c; } return null; }

/* ---------- State ---------- */
const S={ mode:'single', wells:[], selected:null, panel:[], showEmpty:false, tracks:loadTrackDefaults(), view:{top:0,bottom:6000,pxPerFt:0.35}, datum:'MD', picking:false, hiddenPoints:[], stats:null, basemap:'map' };
const $=id=>document.getElementById(id);
function presetWell(cfg){ const w={...WellerSynth.makeWell(cfg),preset:cfg.id}; for(const p of w.points) w.curves.push(makePointCurve(p.mnemonic,p.unit,p.description,p.md,p.data)); delete w.points; return w; }
function loadPresets(){ S.wells=WellerSynth.PRESET_WELLS.map(presetWell); S.selected=S.wells[0].id; S.panel=['w1','w2','w4']; pointSeriesNames().forEach(placePointSeries); }
const wellById=id=>S.wells.find(w=>w.id===id);
const depthOf=w=>w.curves[0].data;
function wellRange(w){ const d=depthOf(w); return [d[0],d[d.length-1]]; }
function offsetOf(w){ // plotted depth = md - offset
  if(S.mode==='single'||S.datum==='MD') return 0;
  if(S.datum==='TVDSS') return w.elevation.kb??0; // vertical-well assumption until surveys exist (phase 3)
  const t=w.tops.find(t=>t.name===S.datum); return t?t.md:NaN;
}

/* ---------- Rendering ---------- */
function visibleTracks(w){ return S.tracks.filter(t=>(S.mode==='single'||t.panel)&&(S.showEmpty||t.curves.some(c=>resolveCurve(w,c)))); }
function fmtDepth(v){ return Math.round(v).toLocaleString(); }
function tickInterval(px){ for(const i of [10,20,25,50,100,200,250,500,1000,2000]) if(i*px>=44) return i; return 5000; }
function render(){
  const statsMode=S.mode==='stats'; $('statsView').hidden=!statsMode; $('logView').hidden=statsMode;
  if(statsMode){ renderSidebar(); renderStats(); autosave(); return; }
  const panel=$('logPanel'); panel.querySelectorAll('.column').forEach(c=>c.remove()); const ov=$('overlay'); ov.innerHTML=''; ov.setAttribute('width',0); ov.setAttribute('height',0);
  const wells=S.mode==='single'?[wellById(S.selected)].filter(Boolean):S.panel.map(wellById).filter(Boolean);
  $('datumWrap').hidden=S.mode==='single';
  $('vbWell').textContent=S.mode==='single'?(wells[0]?.name||'No well'):`Section A–A′ · ${wells.length} wells`;
  $('scaleLbl').textContent=`${(100*S.view.pxPerFt).toFixed(0)} px / 100 ft`;
  const {top,bottom,pxPerFt}=S.view; const H=Math.max(10,(bottom-top)*pxPerFt); const y=d3.scaleLinear([top,bottom],[0,H]);
  const tickI=tickInterval(pxPerFt), minorI=tickI/5;
  const cols=[];
  for(const w of wells){
    const off=offsetOf(w); const dep=depthOf(w); const noDatum=Number.isNaN(off); const o=noDatum?0:off;
    const col=document.createElement('div'); col.className='column'; col.dataset.well=w.id;
    const head=document.createElement('div'); head.className='colhead';
    head.innerHTML=`<span>${w.name}${w.synthetic?' <small>synthetic</small>':''}</span><small>${w.api||''}${noDatum?' · no '+S.datum+' top, shown in MD':''}</small>`;
    col.appendChild(head);
    const tr=document.createElement('div'); tr.className='tracks';
    // depth track
    tr.appendChild(depthTrack(w,y,H,tickI,minorI,o));
    for(const t of visibleTracks(w)) tr.appendChild(logTrack(w,t,y,H,tickI,minorI,o,dep));
    col.appendChild(tr); panel.insertBefore(col,ov); cols.push({w,el:col,o});
  }
  const heads=[...panel.querySelectorAll('.thead')]; heads.forEach(h=>h.style.height=''); const mh=Math.max(0,...heads.map(h=>h.offsetHeight)); heads.forEach(h=>h.style.height=mh+'px');
  if(S.mode==='corr') drawCorrelations(cols,y);
  renderSidebar();
  autosave();
}
function depthTrack(w,y,H,tickI,minorI,o){
  const div=document.createElement('div'); div.className='track'; div.style.width='64px';
  const lbl=S.mode==='single'||S.datum==='MD'?'MD ft':S.datum==='TVDSS'?'TVDSS ft':'ft rel. '+S.datum;
  div.innerHTML=`<div class="thead"><div class="tn">Depth</div><div class="scale" style="color:var(--muted)"><span></span><span class="c">${lbl}</span><span></span></div></div>`;
  const svg=d3.create('svg').attr('width',64).attr('height',H);
  const [t,b]=S.view.top!==undefined?[S.view.top,S.view.bottom]:[0,0];
  const start=Math.ceil(t/minorI)*minorI;
  for(let v=start;v<=b;v+=minorI){ const major=Math.abs(v/tickI-Math.round(v/tickI))<1e-6; svg.append('line').attr('x1',major?40:52).attr('x2',64).attr('y1',y(v)).attr('y2',y(v)).attr('class','grid'+(major?' s':''));
    if(major) svg.append('text').attr('x',38).attr('y',y(v)+3.5).attr('text-anchor','end').attr('class','depth').text(fmtDepth(v)); }
  for(const tp of w.tops){ const yy=y(tp.md-o); if(yy<0||yy>H) continue; svg.append('line').attr('x1',0).attr('x2',64).attr('y1',yy).attr('y2',yy).attr('class','top'); }
  div.appendChild(svg.node()); return div;
}
function scaleFor(c,width){ return c.log?d3.scaleLog([c.min,c.max],[0,width]).clamp(true):d3.scaleLinear([c.min,c.max],[0,width]).clamp(true); }
function logTrack(w,t,y,H,tickI,minorI,o,dep){
  const width=t.width||190; const div=document.createElement('div'); div.className='track'; div.style.width=width+'px';
  const head=document.createElement('div'); head.className='thead';
  head.innerHTML=`<div class="tn"><span>${t.name}</span><button title="Edit track" data-edit="${t.id}">⚙</button></div>`;
  const resolved=t.curves.map(c=>({cfg:c,curve:resolveCurve(w,c)}));
  if(t.type==='lithpct'){ const have=resolved.filter(r=>r.curve&&!r.curve.sparse); head.innerHTML+=`<div class="scale" style="color:var(--muted)"><span>0</span><span class="c">${have.length?have.length+' components':'no cuttings curves'}</span><span class="r">100%</span></div><div class="legend">${have.map(r=>`<i style="background:${r.cfg.color}" title="${r.cfg.label} (${r.curve.mnemonic})"></i>`).join('')}</div>`; }
  else if(t.type!=='lith') for(const {cfg,curve} of resolved){ const s=document.createElement('div'); s.className='scale'; s.style.color=cfg.color; s.style.opacity=curve?1:.35;
    s.innerHTML=`<span>${cfg.min}</span><span class="c">${curve?curve.mnemonic:cfg.label+' (none)'}${cfg.unit?' '+cfg.unit:''}</span><span class="r">${cfg.max}</span><span class="bar${curve?.sparse?' pts':cfg.dash?' dash':''}"></span>`; head.appendChild(s); }
  else head.innerHTML+=`<div class="scale" style="color:var(--muted)"><span>sand</span><span class="c">Vsh</span><span class="r">shale</span></div>`;
  div.appendChild(head);
  const svg=d3.create('svg').attr('width',width).attr('height',H).classed('pick',S.picking);
  const [top,bot]=[S.view.top,S.view.bottom];
  // horizontal grid
  for(let v=Math.ceil(top/minorI)*minorI;v<=bot;v+=minorI){ const major=Math.abs(v/tickI-Math.round(v/tickI))<1e-6; svg.append('line').attr('x1',0).attr('x2',width).attr('y1',y(v)).attr('y2',y(v)).attr('class','grid'+(major?' s':'')); }
  // vertical grid
  const first=t.curves[0];
  if(t.type==='lithpct'){ for(let i=1;i<10;i++){ const x=width*i/10; svg.append('line').attr('x1',x).attr('x2',x).attr('y1',0).attr('y2',H).attr('class','grid'+(i%5===0?' s':'')); } }
  else if(t.type!=='lith'){ if(first.log){ const dec=Math.round(Math.log10(first.max/first.min)); const sx=scaleFor(first,width);
      for(let d=0;d<=dec;d++){ const base=first.min*10**d; for(let m=1;m<10;m++){ const v=base*m; if(v>first.max*1.0001) break; svg.append('line').attr('x1',sx(v)).attr('x2',sx(v)).attr('y1',0).attr('y2',H).attr('class','grid'+(m===1?' s':'')); } } }
    else for(let i=0;i<=10;i++){ const x=width*i/10; svg.append('line').attr('x1',x).attr('x2',x).attr('y1',0).attr('y2',H).attr('class','grid'+(i%5===0?' s':'')); } }
  // sample stride: ~2 samples per px
  const step=dep.length>1?Math.abs(dep[1]-dep[0]):1; const stride=Math.max(1,Math.floor(1/(S.view.pxPerFt*step)/2));
  const i0=Math.max(0,d3.bisectLeft(dep,top+o)-1), i1=Math.min(dep.length-1,d3.bisectRight(dep,bot+o)+1);
  const idx=d3.range(i0,i1+1,stride);
  if(t.type==='lithpct'){ const have=resolved.filter(r=>r.curve&&!r.curve.sparse); if(have.length){ const g=svg.append('g'); const sx=width/100;
      for(let k=0;k<idx.length;k++){ const i=idx[k], j=idx[k+1]??Math.min(i1,i+stride); const y0=y(dep[i]-o), h=Math.max(.5,y(dep[j]-o)-y0); let x=0;
        for(const r of have){ const v=r.curve.data[i]; if(!Number.isFinite(v)||v<=0) continue; g.append('rect').attr('x',x).attr('y',y0).attr('width',v*sx).attr('height',h).attr('fill',r.cfg.color); x+=v*sx; } } } }
  else if(t.type==='lith'){ const c=resolved[0].curve; if(c&&!c.sparse){ const s=first; const g=svg.append('g'); let run=null;
      const flush=(kind,a,b)=>g.append('rect').attr('x',0).attr('width',width).attr('y',y(dep[a]-o)).attr('height',Math.max(.5,y(dep[b]-o)-y(dep[a]-o))).attr('fill',kind==='sand'?'var(--sand)':kind==='shale'?'var(--shale)':'var(--paper)');
      for(const i of idx){ const v=c.data[i]; const vsh=Number.isFinite(v)?Math.min(1,Math.max(0,(v-s.min)/(s.max-s.min))):NaN; const kind=Number.isNaN(vsh)?'gap':vsh<0.4?'sand':vsh>0.6?'shale':'silt';
        if(!run||run.kind!==kind){ if(run) flush(run.kind,run.a,i); run={kind,a:i}; } }
      if(run) flush(run.kind,run.a,i1); } }
  else {
    // crossover shading (gas)
    if(t.crossover){ const ra=resolved.find(r=>r.cfg.label===t.crossover[0]), rb=resolved.find(r=>r.cfg.label===t.crossover[1]);
      if(ra?.curve&&rb?.curve&&!ra.curve.sparse&&!rb.curve.sparse){ const sa=scaleFor(ra.cfg,width), sb=scaleFor(rb.cfg,width);
        const area=d3.area().defined(i=>Number.isFinite(ra.curve.data[i])&&Number.isFinite(rb.curve.data[i])&&sa(ra.curve.data[i])<sb(rb.curve.data[i]))
          .x0(i=>sa(ra.curve.data[i])).x1(i=>sb(rb.curve.data[i])).y(i=>y(dep[i]-o));
        svg.append('path').attr('d',area(idx)).attr('fill','var(--gas)').attr('opacity',.45); } }
    for(const {cfg,curve} of resolved){ if(!curve) continue; const sx=scaleFor(cfg,width); if(curve.sparse){ drawPoints(svg,cfg,curve,sx,y,o,top,bot); continue; } const ok=i=>Number.isFinite(curve.data[i])&&!(cfg.log&&curve.data[i]<=0);
      if(cfg.fill&&cfg.fill!=='none'){ let fillRef=cfg.fillColor||cfg.color;
        if(cfg.fillStyle==='gradient'){ const gid='g'+t.id+'_'+cfg.label.replace(/\W/g,'')+'_'+w.id; const gr=svg.append('defs').append('linearGradient').attr('id',gid).attr('gradientUnits','userSpaceOnUse').attr('x1',0).attr('x2',width).attr('y1',0).attr('y2',0);
          gr.append('stop').attr('offset','0%').attr('stop-color',cfg.fillColor||cfg.color); gr.append('stop').attr('offset','100%').attr('stop-color',cfg.fillColor2||cfg.color); fillRef=`url(#${gid})`; }
        const area=d3.area().defined(ok).x0(cfg.fill==='left'?0:width).x1(i=>sx(curve.data[i])).y(i=>y(dep[i]-o)); svg.append('path').attr('d',area(idx)).attr('fill',fillRef).attr('opacity',cfg.fillOpacity??.35); }
      const line=d3.line().defined(ok).x(i=>sx(curve.data[i])).y(i=>y(dep[i]-o));
      svg.append('path').attr('d',line(idx)).attr('fill','none').attr('stroke',cfg.color).attr('stroke-width',1.2).attr('stroke-dasharray',cfg.dash||null); }
  }
  // tops
  for(const tp of w.tops){ const yy=y(tp.md-o); if(yy<0||yy>H) continue; svg.append('line').attr('x1',0).attr('x2',width).attr('y1',yy).attr('y2',yy).attr('class','top');
    if(t===visibleTracks(w)[0]) svg.append('text').attr('x',3).attr('y',yy-3).attr('class','toplbl').text(tp.name); }
  const node=svg.node();
  node.addEventListener('mousemove',e=>{ const r=node.getBoundingClientRect(); const d=y.invert(e.clientY-r.top)+o; showCursor(e.clientY-$('logPanel').getBoundingClientRect().top,d,w,resolved,dep); });
  node.addEventListener('mouseleave',()=>{ $('cursor').style.display='none'; });
  node.addEventListener('click',e=>{ if(!S.picking) return; const r=node.getBoundingClientRect(); const md=Math.round((y.invert(e.clientY-r.top)+o)*2)/2; placeTop(w,md); });
  div.appendChild(node); return div;
}
function showCursor(yPx,md,w,resolved,dep){ const c=$('cursor'); c.style.display='block'; c.style.top=(yPx)+'px';
  const i=Math.min(dep.length-1,Math.max(0,d3.bisectCenter(dep,md)));
  $('stCursor').innerHTML=`<b>${w.name}</b> MD ${md.toFixed(1)} ft`;
  $('stVals').innerHTML=resolved.filter(r=>r.curve).map(r=>{ const c=r.curve; if(c.sparse){ const k=nearestPoint(c,md); return k<0?'':`${c.mnemonic} <b>${fmtVal(c.data[k],r.cfg)}</b> @${c.md[k]}`; } return `${c.mnemonic} <b>${fmtVal(c.data[i],r.cfg)}</b>`; }).filter(Boolean).join(' · '); }
function drawCorrelations(cols,y){
  const ov=d3.select('#overlay'); const panelR=$('logPanel').getBoundingClientRect();
  const fmColor={Pico:'var(--pico)',Repetto:'var(--repetto)',Puente:'var(--puente)'};
  const names=[...new Set(cols.flatMap(c=>c.w.tops.map(t=>t.name)))];
  const geo=cols.map(c=>{ const r=c.el.getBoundingClientRect(); const trk=c.el.querySelector('.tracks').getBoundingClientRect(); return {l:r.left-panelR.left,r:r.right-panelR.left,y0:trk.top-panelR.top,c}; });
  ov.attr('width',panelR.width).attr('height',panelR.height);
  for(let i=0;i<geo.length-1;i++){ const a=geo[i],b=geo[i+1];
    const ya=n=>{const t=a.c.w.tops.find(t=>t.name===n); return t?a.y0+y(t.md-a.c.o):null;}, yb=n=>{const t=b.c.w.tops.find(t=>t.name===n); return t?b.y0+y(t.md-b.c.o):null;};
    const shared=names.filter(n=>ya(n)!==null&&yb(n)!==null).sort((p,q)=>ya(p)-ya(q));
    shared.forEach((n,k)=>{ const nx=shared[k+1]; const bottomA=nx?ya(nx):a.y0+y(S.view.bottom), bottomB=nx?yb(nx):b.y0+y(S.view.bottom);
      ov.append('polygon').attr('class','fm').attr('fill',fmColor[n]||'var(--grid)').attr('points',`${a.r},${ya(n)} ${b.l},${yb(n)} ${b.l},${bottomB} ${a.r},${bottomA}`);
      ov.append('line').attr('class','corr').attr('x1',a.r).attr('y1',ya(n)).attr('x2',b.l).attr('y2',yb(n));
      ov.append('text').attr('x',(a.r+b.l)/2).attr('y',(ya(n)+yb(n))/2-4).attr('text-anchor','middle').text(n); });
  }
}
function placeTop(w,md){ const name=$('topName').value.trim(); if(!name) return; const ex=w.tops.find(t=>t.name===name); if(ex) ex.md=md; else w.tops.push({name,md,source:'user'}); S.picking=false; $('btnPick').classList.remove('primary'); $('stNote').textContent=`${name} set at ${md} ft in ${w.name}`; render(); }

/* ---------- Sidebar: map, wells, tracks, tops ---------- */
function clickWell(id){ if(S.mode==='corr'){ const i=S.panel.indexOf(id); if(i>=0) S.panel.splice(i,1); else S.panel.push(id); } else S.selected=id; render(); }
function renderSidebar(){
  renderMap();
  $('wellCount').textContent=S.wells.length;
  const ul=$('wellList'); ul.innerHTML='';
  for(const w of S.wells){ const li=document.createElement('li'); li.className=w.id===S.selected?'sel':''; const [a,b]=wellRange(w);
    li.innerHTML=`<span class="dot${S.mode==='corr'&&S.panel.includes(w.id)?' in':''}"></span><span>${w.name}</span><span class="meta">${w.curves.filter(c=>!c.sparse).length-1} crv${w.curves.some(c=>c.sparse)?' · pts':''} · ${fmtDepth(b)} ${w.depthUnit}</span><button class="small" data-wellset="${w.id}" title="Well settings">⚙</button>`;
    li.onclick=e=>{ if(!e.target.closest('button')) clickWell(w.id); }; ul.appendChild(li); }
  const tl=$('trackList'); tl.innerHTML='';
  S.tracks.forEach((t,i)=>{ const d=document.createElement('div'); d.className='trackrow'; d.innerHTML=`<span class="sw">${t.curves.slice(0,4).map(c=>`<i style="background:${c.color||'var(--muted)'}"></i>`).join('')}</span><span class="nm">${t.name}</span><label title="Show in correlation panel" style="display:${S.mode==='corr'?'inline':'none'};font-size:11px;color:var(--muted)"><input type="checkbox" data-panel="${i}"${t.panel?' checked':''}> panel</label><button class="small" data-up="${i}" title="Move left">◂</button><button class="small" data-dn="${i}" title="Move right">▸</button><button class="small" data-edit="${t.id}">⚙</button>`; tl.appendChild(d); });
  renderPointList();
  const w=S.mode==='corr'?wellById(S.panel[S.panel.length-1]||S.selected):wellById(S.selected);
  $('topsWell').textContent=w?w.name:''; const tt=$('topsTable'); tt.innerHTML='';
  if(w){ for(const t of [...w.tops].sort((a,b)=>a.md-b.md)){ const tr=document.createElement('tr'); tr.innerHTML=`<td>${t.name}</td><td style="text-align:right">${t.md.toFixed(1)}</td><td><button class="small" data-deltop="${t.name}">×</button></td>`; tt.appendChild(tr); } }
  const names=[...new Set([...S.wells.flatMap(w=>w.tops.map(t=>t.name)),'Pico','Repetto','Puente'])];
  $('topNames').innerHTML=names.map(n=>`<option value="${n}">`).join('');
  const dsel=$('datum'); const cur=S.datum; dsel.innerHTML=`<option value="MD">Measured depth</option><option value="TVDSS">Sea level (TVDSS)</option>`+names.map(n=>`<option value="${n}">Flatten on ${n}</option>`).join(''); dsel.value=names.includes(cur)||cur==='MD'||cur==='TVDSS'?cur:'MD';
  $('winTop').value=S.view.top; $('winBot').value=S.view.bottom; $('showEmpty').checked=S.showEmpty;
  const sw=wellById(S.selected); if(sw) $('stFile').innerHTML=`<b>${sw.fileName||sw.name+'.las (synthetic)'}</b> · ${sw.rows||depthOf(sw).length} rows · KB ${sw.elevation.kb??'?'} ft · null ${sw.nullv??-999.25}${sw.wrap?' · wrapped':''}`;
}

/* ---------- Track editor ---------- */
let editing=null;
function openTrackDlg(id){ const t=S.tracks.find(t=>t.id===id); if(!t) return; editing=JSON.parse(JSON.stringify(t)); $('tdName').value=editing.name; $('tdWidth').value=editing.width||190; drawTdCurves(); $('trackDlg').hidden=false; }
function drawTdCurves(){ const w=wellById(S.selected)||S.wells[0]; const tb=$('tdCurves'); tb.innerHTML='';
  const toHex=c=>c.startsWith('var(')?cssVarHex(c.slice(4,-1)):c;
  editing.curves.forEach((c,i)=>{ const tr=document.createElement('tr'); const cur=resolveCurve(w,c);
    tr.innerHTML=`<td><select data-i="${i}" class="tdm">${w.curves.slice(1).map(x=>`<option value="${x.mnemonic}"${cur&&cur.mnemonic===x.mnemonic?' selected':''}>${x.mnemonic} (${x.unit||'-'})${x.sparse?' · points':''}</option>`).join('')}${cur?'':`<option selected value="">${c.label} (not in well)</option>`}</select><div class="hint" style="font-size:10px">${c.label}</div></td>
      <td><input type="number" class="tdmin" data-i="${i}" value="${c.min}" step="any"></td><td><input type="number" class="tdmax" data-i="${i}" value="${c.max}" step="any"><button class="small tdauto" data-i="${i}" title="Set scale from this well's data (p2 to p98)">auto</button></td>
      <td><input type="checkbox" class="tdlog" data-i="${i}"${c.log?' checked':''}></td><td><input type="color" class="tdcol" data-i="${i}" value="${toHex(c.color||'#333333')}"></td>
      <td><input type="checkbox" class="tddash" data-i="${i}"${c.dash?' checked':''}></td>
      <td><select class="tdfill" data-i="${i}"><option value="none"${!c.fill||c.fill==='none'?' selected':''}>None</option><option value="left"${c.fill==='left'?' selected':''}>Left of curve</option><option value="right"${c.fill==='right'?' selected':''}>Right of curve</option></select>
          <select class="tdfs" data-i="${i}"><option value="solid"${c.fillStyle!=='gradient'?' selected':''}>Solid</option><option value="gradient"${c.fillStyle==='gradient'?' selected':''}>Gradient by value</option></select></td>
      <td><input type="color" class="tdfc" data-i="${i}" value="${toHex(c.fillColor||c.color||'#cccccc')}" title="Fill color (gradient: at left scale value)"><input type="color" class="tdfc2" data-i="${i}" value="${toHex(c.fillColor2||c.fillColor||c.color||'#cccccc')}" title="Gradient color at right scale value"></td>
      <td><input type="number" class="tdfo" data-i="${i}" value="${c.fillOpacity??.35}" min="0" max="1" step="0.05" style="width:4em"></td>
      <td><button class="small tdrm" data-i="${i}">×</button></td>`; tb.appendChild(tr); }); }
function autoScale(curve,log){ const v=Array.from(curve.data).filter(x=>Number.isFinite(x)&&(!log||x>0)).sort((a,b)=>a-b); if(v.length<10) return null;
  const lo=v[Math.floor(v.length*.02)], hi=v[Math.floor(v.length*.98)]; if(log){ return [10**Math.floor(Math.log10(lo)),10**Math.ceil(Math.log10(hi))]; }
  const [a,b]=d3.scaleLinear().domain([lo,hi]).nice(5).domain(); return [a,b]; }
function cssVarHex(name){ const v=cssVar(name); if(/^#/.test(v)) return v; const m=v.match(/\d+/g); return m?'#'+m.slice(0,3).map(n=>(+n).toString(16).padStart(2,'0')).join(''):'#333333'; }
function readTd(){ editing.name=$('tdName').value; editing.width=+$('tdWidth').value||190;
  document.querySelectorAll('#tdCurves tr').forEach((tr,i)=>{ const c=editing.curves[i]; const m=tr.querySelector('.tdm').value; if(m){ const mu=m.toUpperCase(); if(!c.aliases.some(a=>a.toUpperCase()===mu)) c.label=m; c.aliases=[m,...c.aliases.filter(a=>a.toUpperCase()!==mu)]; }
    c.min=+tr.querySelector('.tdmin').value; c.max=+tr.querySelector('.tdmax').value; c.log=tr.querySelector('.tdlog').checked; c.color=tr.querySelector('.tdcol').value; c.dash=tr.querySelector('.tddash').checked?'4 3':undefined;
    c.fill=tr.querySelector('.tdfill').value; c.fillStyle=tr.querySelector('.tdfs').value; c.fillColor=tr.querySelector('.tdfc').value; c.fillColor2=tr.querySelector('.tdfc2').value; c.fillOpacity=+tr.querySelector('.tdfo').value; }); }
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
$('tdSaveDefaults').onclick=()=>{ readTd(); const i=S.tracks.findIndex(t=>t.id===editing.id); const set=S.tracks.map(t=>t.id===editing.id?editing:t); if(i<0) set.push(editing); try{ localStorage.setItem('weller.trackDefaults',JSON.stringify(set)); $('stNote').textContent='Track defaults saved for new projects'; }catch(e){ $('stNote').textContent='Could not save defaults (storage blocked)'; } };
$('tdResetDefaults').onclick=()=>{ try{ localStorage.removeItem('weller.trackDefaults'); }catch(e){} S.tracks=defaultTracks(); $('trackDlg').hidden=true; render(); };
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
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
function setMode(m){ const was=S.mode; S.mode=m; document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-selected',b.dataset.mode===m)); if(m==='corr'&&S.panel.length===0) S.panel=[S.selected]; if(m!=='stats'&&was==='stats'){ render(); fitView(); } else render(); }
$('datum').onchange=e=>{ S.datum=e.target.value; fitView(); };
$('winTop').onchange=e=>{ S.view.top=+e.target.value; render(); }; $('winBot').onchange=e=>{ S.view.bottom=+e.target.value; render(); };
$('btnFit').onclick=fitView;
$('showEmpty').onchange=e=>{ S.showEmpty=e.target.checked; render(); };
function fitView(){ if(S.mode==='stats') return render(); const wells=S.mode==='single'?[wellById(S.selected)]:S.panel.map(wellById); let lo=Infinity,hi=-Infinity;
  for(const w of wells.filter(Boolean)){ const o=offsetOf(w); const oo=Number.isNaN(o)?0:o; const [a,b]=wellRange(w); lo=Math.min(lo,a-oo); hi=Math.max(hi,b-oo); }
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
  for(const f of files){ try{ const p=parseLAS(f.text); if(!p.curves.length||!p.rows) throw new Error('no curve data found'); const w=normalizeWell(p,f.name); S.wells.push(w); first=first||w.id; lasCache.put(f.name,f.text);
      if(!Number.isFinite(w.location.lat)) notes.push(`${w.name}: no location in header, not on map`); if(w.elevation.kb===undefined) notes.push(`${w.name}: no KB elevation, TVDSS unavailable`); const conv=w.curves.filter(c=>c.note).map(c=>c.mnemonic+' '+c.note); if(conv.length) notes.push(`${w.name}: ${conv.join(', ')}`); if(w.notes?.length) notes.push(`${w.name}: ${w.notes.join(', ')}`);
    }catch(err){ notes.push(`${f.name}: could not read (${err.message})`); } }
  if(first){ S.selected=first; if(S.mode==='corr') S.panel.push(first); if(S.mode!=='stats') fitView(); } return notes; }
let dragDepth=0;
addEventListener('dragenter',e=>{ if(e.dataTransfer?.types?.includes('Files')){ dragDepth++; document.body.classList.add('dropping'); } });
addEventListener('dragleave',()=>{ if(--dragDepth<=0){ dragDepth=0; document.body.classList.remove('dropping'); } });
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',async e=>{ e.preventDefault(); dragDepth=0; document.body.classList.remove('dropping'); const files=[]; for(const f of e.dataTransfer.files) files.push({name:f.name,text:await f.text()}); if(files.length) openFiles(files); });

/* ---------- Project save / load / autosave ---------- */
function projectJSON(){ return { version:2, app:'weller-logs', savedAt:new Date().toISOString(), mode:S.mode, selected:S.selected, panel:S.panel, datum:S.datum, view:S.view, tracks:S.tracks, hiddenPoints:S.hiddenPoints, stats:S.stats, basemap:S.basemap,
  wells:S.wells.map(w=>({id:w.id,name:w.name,api:w.api,field:w.field,preset:w.preset,fileName:w.fileName,location:w.location,elevation:w.elevation,depthUnit:w.depthUnit,tops:w.tops,points:pointsJSON(w),curveList:w.curves.filter(c=>!c.sparse).map(c=>c.mnemonic)})) }; }
async function loadProject(p){ if(!p||p.app!=='weller-logs') throw new Error('not a Weller Logs project'); const missing=[];
  const fromCache={}; for(const r of p.wells){ if(r.preset||S.wells.some(w=>w.fileName===r.fileName)) continue; const text=await lasCache.get(r.fileName); if(text){ try{ fromCache[r.fileName]=normalizeWell(parseLAS(text),r.fileName); }catch(e){} } }
  S.wells=p.wells.map(ref=>{ if(ref.preset){ const cfg=WellerSynth.PRESET_WELLS.find(c=>c.id===ref.preset); const w=presetWell(cfg); w.tops=ref.tops; w.elevation=ref.elevation; restorePoints(w,ref.points); return w; }
    const live=S.wells.find(w=>w.fileName===ref.fileName)||fromCache[ref.fileName]; if(live){ Object.assign(live,{tops:ref.tops,elevation:ref.elevation,location:ref.location,name:ref.name,api:ref.api,field:ref.field,id:ref.id}); restorePoints(live,ref.points); return live; } missing.push(ref.fileName||ref.name); return null; }).filter(Boolean);
  S.tracks=p.tracks; S.view=p.view; S.datum=p.datum||'MD'; S.hiddenPoints=p.hiddenPoints||[]; S.stats={...statsDefaults(),...(p.stats||{})}; setBasemap(p.basemap||'map'); if((p.version||1)<2) pointSeriesNames().forEach(placePointSeries); S.panel=(p.panel||[]).filter(id=>wellById(id)); S.selected=wellById(p.selected)?p.selected:(S.wells[0]?.id||null);
  setMode(p.mode||'single'); $('stNote').textContent=missing.length?`Re-open these LAS files to restore them: ${missing.join(', ')}`:'Project loaded'; }
function autosave(){ try{ localStorage.setItem('weller.session',JSON.stringify(projectJSON())); }catch(e){} }
const projName=()=>(wellById(S.selected)?.name||'project').replace(/\s+/g,'-')+'.lasproj';
async function saveProject(as){ const text=JSON.stringify(projectJSON(),null,1);
  if(window.showSaveFilePicker){ try{ if(as||!S.fileHandle) S.fileHandle=await showSaveFilePicker({suggestedName:projName(),types:[{description:'Weller Logs project',accept:{'application/json':['.lasproj']}}]});
      const w=await S.fileHandle.createWritable(); await w.write(text); await w.close(); $('stNote').textContent='Saved '+S.fileHandle.name; }catch(e){ if(e.name!=='AbortError') $('stNote').textContent='Save failed: '+e.message; } return; }
  downloadBlob(projName(),new Blob([text],{type:'application/json'})); }
$('btnSave').onclick=()=>saveProject(false);
document.addEventListener('keydown',e=>{ if(!(e.metaKey||e.ctrlKey)) return; const k=e.key.toLowerCase(); if(k==='o'){ e.preventDefault(); $('btnOpen').click(); } else if(k==='s'){ e.preventDefault(); saveProject(e.shiftKey); } else if(k==='e'){ e.preventDefault(); $('btnPng').click(); } });

/* ---------- Boot: resume-last-session prompt ---------- */
S.stats=statsDefaults();
loadPresets();
let saved=null; try{ saved=JSON.parse(localStorage.getItem('weller.session')||'null'); }catch(e){}
if(saved&&saved.savedAt){ $('resumeWhen').textContent=new Date(saved.savedAt).toLocaleString(); $('resume').hidden=false; }
$('btnResume').onclick=async()=>{ $('resume').hidden=true; try{ await loadProject(saved); }catch(e){ $('stNote').textContent='Saved session could not be restored: '+e.message; } };
$('btnFresh').onclick=()=>{ $('resume').hidden=true; };
if('serviceWorker' in navigator&&/^https?:/.test(location.protocol)&&!/claude\.ai|claudeusercontent/.test(location.host)) navigator.serviceWorker.register('sw.js').catch(()=>{});
fitView();
