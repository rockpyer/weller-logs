/* Weller Logs: state, LAS parsing, log rendering, files, project. */
const {parseLAS,normalizeWell}=WellerLAS;   // app/js/las.js

/* ---------- Curve aliases and default track presets ---------- */
// Mnemonic families. Merged with petroplots' alias table so templates resolve the same curves in both tools.
const A={
  // Total gamma ray; CGR (uranium-free) last, since it reads lower than total GR in organic shale.
  GR:['GR','GRD','SGR','GRC','GAMMA','GRGC','GR_EDTC','ECGR','HSGR','GRS','GRR','HGR','GRAX','GR_MWD','GRMWD','MWD_GR','GRAM','GRA','GR_RT','GRAPI','GAM','GGRM','GRCO','CGR'], SP:['SP','SPC','SSP','SPR'],
  CAL:['CALI','CAL','CALS','HCAL','CALX','DCAL','CLDC','C1CAL','CALD','LCAL','ACAL','DCALI'], BS:['BS','BIT','BITSIZE','BIT_SIZE'],
  RD:['RDEEP','RT','RD','ILD','LLD','AT90','AHT90','AF90','RES_DEEP','M2R9','RLA5','RESD','RILD','RT90','R85S','R85T','R85F','R85O','R85','RTAS','RTAT','RTAF','RTAO','RPD','RACELM','P34H','A34H','RPCEHM','RACEHM'],
  RM:['RMED','RM','ILM','LLM','AT30','AT60','AHT60','AF60','RES_MED','RLA3','RILM','M2R6','RT60','RT30','R40S','R40T','R40F','R40O','R60S','R60T','R60F','R60O','R30S','R30T','R30F','R30O','RPM','P22H','A22H','RPCSHM'],
  RS:['RSHAL','RS','LLS','SFL','SFLU','MSFL','AT10','AHT10','AF10','RES_SHAL','RXO','RXOZ','RLA1','SN','M2R1','RT20','RT10','R20S','R20T','R20F','R20O','R20','RPS','P16H','A16H'],
  RHOB:['RHOB','DEN','RHOZ','DENS','ZDEN','RHO'], NPHI:['NPHI','TNPH','NEU','PHIN','CNC','NPOR','HNPO','NPHI_LS','NPRL','NPRS','NPRD','CNCF','NPLS','NPSS'],
  DPHI:['DPHI','DPOR','DPRL','DPHZ','DPHI_LS','DPLS','DPRS','DPSS','DPRD'], DRHO:['DRHO','HDRA','ZCOR','DCOR','CORR','DRH'],
  K:['POTA','GMPO','HFK','KPOT','GRK','SGRK'], TH:['THOR','GMTH','HTHO','GRTH','SGRT'], U:['URAN','GMUR','HURA','GRU','SGRU'], CGR:['CGR','GMGC','HCGR','GRCG','CGR_'], DT:['DT','DTC','AC','SONIC','DT24','DTCO','DT4P'], PE:['PEF','PE','PEFZ','PDPE'],
  ROP:['ROP','ROPA','ROP_AVG','ROP5','ROPS'],
  AMP:['AMP3FT','AM3F','CBL','AMPAVG','AMP','CBLF','AMP3','CBLA','E1'], TT:['TT3FT','TM3','TT','TT3','TT3F'], BOND:['BONDIX','BI','BOND'], CCL:['CCL','CCLU','CCLC'],
  // Ultrasonic cement and casing (pulse-echo tools): acoustic impedance of what is behind pipe, and casing geometry.
  IMP:['IMAV','ZAVG','IMPAVG','AIAV'], IMPMIN:['IMMN','ZMIN','IMPMIN'], IMPMAX:['IMMX','ZMAX','IMPMAX'],
  THK:['THAV','THKAVG','THAVG','CTAV'], THKMIN:['THMN','THKMIN'], THKMAX:['THMX','THKMAX'],
  ID:['DIAV','IDAV','IDAVG','CIDA'], IDMIN:['DIMN','IDMN','IDMIN'], IDMAX:['DIMX','IDMX','IDMAX'], OVAL:['OVLI','OVAL','OVALITY'], ECC:['ECCE','ECCN','ECC'],
  TEMP:['TEMP','TEMPERATURE','MTEM','TMP','WTEP','DTEMP','FTEMP'], TENS:['LTEN','TENS','TEN','CHT','SURFTENS'], LSPD:['LSPD','SPEED','CS','LSPEED'],
  SHKL:['SHK_LAT_MAX','SHKLAT','LAT_SHK','SHK_LAT'], SHKA:['SHK_AXL_MAX','SHKAXL','AXL_SHK','SHK_AXL'], SS:['STKSLP','STICKSLIP','SS_IDX','STKSLIP'], SHKR:['SHKRSK','SHOCK_RISK'],
  SHOW:['OILSHOW','OIL_SHOW','SHOW','FLUOR','FLUO'], WOB:['WOB','WOBA'], RPM:['RPM'], TG:['TG','TGU','TGAS','GAS','TOTGAS','GASU','TOTAL GAS','TOTALGAS','TOTAL_GAS'], C1:['C1','CH4','METH','METHANE'], C2:['C2','C2H6','ETH'], C3:['C3','C3H8','PROP'],
  C4:['C4','NC4','IC4','C4N','C4I'], C5:['C5','NC5','IC5','C5N','C5I'], H2S:['H2S'], CO2:['CO2'],
};
// Cuttings percentages as logged on mud logs (Petrolog and similar). Order = stacking order, left to right.
const LITH=[
  {label:'Clay',aliases:['CLY','CLAY'],color:'#8C7B62'},{label:'Claystone',aliases:['CST','CLST'],color:'#A89A84'},{label:'Kaolinite',aliases:['KAO'],color:'#D9CFC0'},
  {label:'Siltstone',aliases:['SLT','SLTST','SILT'],color:'#B9B39A'},{label:'Fine sand',aliases:['FSD','FSND'],color:'#F2E3A8'},{label:'Med sand',aliases:['MSD','MSND'],color:'#E8D27E'},
  {label:'Coarse sand',aliases:['CSD','CSND'],color:'#D9BD5A'},{label:'Sandstone',aliases:['SSD','SST','SS'],color:'#E4C96A'},{label:'Limestone',aliases:['LS','LIME','LST'],color:'#9DBBD6'},
  {label:'Anhydrite',aliases:['ANHYDRITE','ANHY','ANH'],color:'#C9A7D6'},{label:'Cement',aliases:['CMT'],color:'#9A9A9A'},
  {label:'Shale',aliases:['SH','SHALE','SHL'],color:'#5E6B5A'},{label:'Silty shale',aliases:['SILTYSHALE','SLTYSH','SLTSH'],color:'#7D8A74'},{label:'Shaly sandstone',aliases:['SHALYSANDSTONE','SHYSS','SHSS'],color:'#CDB86A'},
  {label:'Marlstone',aliases:['MARLSTONE','MARL','MRL'],color:'#A2DBDB'},{label:'Chalk',aliases:['CHALK','CHK'],color:'#9FC3E0'},{label:'Dolomite',aliases:['DOLOMITE','DOL','DOLO'],color:'#C38FB4'},
  {label:'Bentonite',aliases:['BENTONITE','BENT','BENTON'],color:'#B7A1C9'},{label:'Coal',aliases:['COAL'],color:'#2B2B2B'},{label:'Salt',aliases:['SALT','HALITE'],color:'#D9A5A5'}];
const cssVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function defaultTracks(){ return [
  {id:'t1',name:'GR / SP / Cal',width:190,panel:true,curves:[
    {label:'GR',aliases:A.GR,min:0,max:200,unit:'API',color:'var(--gr)',fill:'left',fillStyle:'gradient',fillColor:'#EDC84A',fillColor2:'#465445',fillOpacity:.6},
    {label:'SP',aliases:A.SP,min:-100,max:100,unit:'mV',color:'var(--sp)'},
    {label:'CAL',aliases:A.CAL,min:6,max:16,unit:'in',color:'var(--cal)',dash:'3 3'},
    {label:'BS',aliases:A.BS,min:6,max:16,unit:'in',color:'var(--muted)',dash:'1 3'}]},
  {id:'t14',name:'Spectral GR',width:150,curves:[
    {label:'K',aliases:A.K,min:0,max:5,unit:'%',color:'#2A9D8F'},
    {label:'TH',aliases:A.TH,min:0,max:20,unit:'ppm',color:'#E07A1F',dash:'4 2'},
    {label:'U',aliases:A.U,min:0,max:10,unit:'ppm',color:'#9B59B6'},
    {label:'CGR',aliases:A.CGR,min:0,max:200,unit:'API',color:'var(--gr)',dash:'1 2'}]},
  {id:'t2',name:'Resistivity',width:190,panel:true,curves:[
    {label:'Deep',aliases:A.RD,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rdeep)'},
    {label:'Med',aliases:A.RM,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rmed)',dash:'5 3'},
    {label:'Shal',aliases:A.RS,min:0.2,max:2000,log:true,unit:'Ω·m',color:'var(--rshal)',dash:'2 2'}]},
  {id:'t3',name:'Density · Neutron',width:190,panel:true,crossover:['RHOB','NPHI'],curves:[
    {label:'RHOB',aliases:A.RHOB,min:1.95,max:2.95,unit:'g/cc',color:'var(--rhob)',matchNeutron:true},
    {label:'NPHI',aliases:A.NPHI,min:0.45,max:-0.15,unit:'v/v',color:'var(--nphi)',dash:'5 3'},
    {label:'PEF',aliases:A.PE,min:0,max:10,unit:'b/e',color:'var(--pef)',dash:'1 2'},
    {label:'DT',aliases:A.DT,min:140,max:40,unit:'µs/ft',color:'var(--dt)'},
    {label:'DRHO',aliases:A.DRHO,min:-0.75,max:0.25,unit:'g/cc',color:'var(--muted)',dash:'1 3'}]},
  // Porosity as the vendor delivered it (neutron and density porosity on one matrix): the classic NPHI-DPHI overlay.
  {id:'t17',name:'Logged porosity',width:150,crossover:['DPHI','NPHI'],curves:[
    {label:'NPHI',aliases:A.NPHI,min:0.45,max:-0.15,unit:'v/v',color:'var(--nphi)',dash:'5 3'},
    {label:'DPHI',aliases:A.DPHI,min:0.45,max:-0.15,unit:'v/v',color:'var(--rhob)'}]},
  {id:'t6',name:'Lith',width:56,type:'lith',panel:true,curves:[{label:'GR',aliases:[...A.GR,'VSH_SP'],min:0,max:200}]},
  {id:'t8',name:'Vsh',width:84,curves:[{label:'VSH',aliases:['VSH_GR','VSH_SP','VSH','VCL','VSHALE','VCLAY'],min:0,max:1,unit:'v/v',color:'var(--vsh)',fill:'left',fillColor:'#465445',fillOpacity:.45}]},
  {id:'t9',name:'Porosity · BVW',width:120,curves:[
    {label:'PHI',aliases:['PHI_SW','PHIE','PORE','PHIEF'],min:0.5,max:0,unit:'v/v',color:'var(--phie)',fill:'right',fillColor:'#2A9D8F',fillOpacity:.5},
    {label:'BVW',aliases:['BVW'],min:0.5,max:0,unit:'v/v',color:'var(--sw)',fill:'right',fillColor:'#0353A4',fillOpacity:.55},
    {label:'PHIE',aliases:['PHIE','PORE','PHIEF'],min:0.5,max:0,unit:'v/v',color:'var(--muted)',dash:'2 2'}]},
  {id:'t10',name:'Sw',width:84,curves:[{label:'SW',aliases:['SW','SWT','SWE','SUWI'],min:1,max:0,unit:'v/v',color:'var(--sw)'}]},
  {id:'t11',name:'TOC',width:84,curves:[{label:'TOC',aliases:['TOC_DLR','TOC'],min:0,max:10,unit:'wt%',color:'var(--toc)',fill:'left',fillColor:'#7A5C3E',fillOpacity:.45}]},
  {id:'t12',name:'Flags',width:40,type:'flags',curves:[
    {label:'Net reservoir',aliases:['NET_RES'],color:'#EDC84A'},{label:'Net pay',aliases:['NET_PAY'],color:'#2E7D32'},{label:'Washout',aliases:['FLAG_WO'],color:'#8C7B62'},{label:'Bad hole',aliases:['FLAG_BH'],color:'#9AA5AB'},{label:'Oil show',aliases:A.SHOW,color:'#E07A1F'}]},
  {id:'t4',name:'Drilling',width:130,curves:[
    {label:'ROP',aliases:A.ROP,min:0,max:300,unit:'ft/hr',color:'var(--rop)'},
    {label:'WOB',aliases:A.WOB,min:0,max:50,unit:'klb',color:'var(--wob)',dash:'3 3'}]},
  {id:'t5',name:'Gas',width:150,curves:[
    {label:'TG',aliases:A.TG,min:1,max:10000,log:true,unit:'units',color:'var(--tg)'},
    {label:'C1',aliases:A.C1,min:1,max:100000,log:true,unit:'ppm',color:'var(--c1)',fill:'left',fillStyle:'gradient',fillColor:'#FCE8D5',fillColor2:'#E4572E',fillOpacity:.75},
    {label:'C2',aliases:A.C2,min:1,max:100000,log:true,unit:'ppm',color:'var(--c2)',dash:'4 2'},
    {label:'C3',aliases:A.C3,min:1,max:100000,log:true,unit:'ppm',color:'#9B59B6',dash:'2 2'},
    {label:'C4',aliases:A.C4,min:1,max:100000,log:true,unit:'ppm',color:'#3A86FF',dash:'6 2'},
    {label:'C5',aliases:A.C5,min:1,max:100000,log:true,unit:'ppm',color:'#6A8D2F',dash:'1 2'}]},
  {id:'t18',name:'Vibration',width:120,curves:[
    {label:'Lateral shock',aliases:A.SHKL,auto:true,min:0,max:50,unit:'g',color:'#E4572E'},
    {label:'Axial shock',aliases:A.SHKA,auto:true,min:0,max:50,unit:'g',color:'#3A86FF',dash:'4 2'},
    {label:'Stick-slip',aliases:A.SS,auto:true,min:0,max:100,unit:'',color:'#2A9D8F',dash:'1 2'},
    {label:'Shock risk',aliases:A.SHKR,auto:true,min:0,max:5,unit:'',color:'#9B59B6'}]},
  ...CASED_TRACKS(),
  {id:'t7',name:'Cuttings %',width:110,type:'lithpct',curves:LITH.map(l=>({...l,min:0,max:100,unit:'%'}))},
];}
// Cement bond: amplitude (low = bonded), transit time, bond index, collars.
// Cased-hole tracks, shown only in wells that have these curves. Scales marked auto come from each well's data.
function CASED_TRACKS(){ return [CBL_TRACK(),
  {id:'t15',name:'Ultrasonic cement',width:140,curves:[
    {label:'Z avg',aliases:A.IMP,min:0,max:8,unit:'MRayl',color:'#E07A1F',fill:'left',fillColor:'#9AA5AB',fillOpacity:.35},
    {label:'Z min',aliases:A.IMPMIN,min:0,max:8,unit:'MRayl',color:'#3A86FF',dash:'1 2'},
    {label:'Z max',aliases:A.IMPMAX,min:0,max:8,unit:'MRayl',color:'#D63384',dash:'4 2'}]},
  {id:'t16',name:'Casing',width:150,curves:[
    {label:'Thick avg',aliases:A.THK,auto:true,min:0.2,max:0.6,unit:'in',color:'#2A9D8F'},
    {label:'Thick min',aliases:A.THKMIN,auto:true,min:0.2,max:0.6,unit:'in',color:'#2A9D8F',dash:'1 2'},
    {label:'ID avg',aliases:A.ID,auto:true,min:4,max:7,unit:'in',color:'#E4572E'},
    {label:'ID max',aliases:A.IDMAX,auto:true,min:4,max:7,unit:'in',color:'#E4572E',dash:'1 2'},
    {label:'Ovality',aliases:A.OVAL,auto:true,min:0,max:5,unit:'%',color:'#9B59B6',dash:'4 2'}]},
  {id:'t19',name:'Temp · tension',width:130,curves:[
    {label:'TEMP',aliases:A.TEMP,auto:true,min:50,max:300,unit:'°F',color:'#E4572E'},
    {label:'TENS',aliases:A.TENS,auto:true,min:0,max:5000,unit:'lb',color:'#3A86FF',dash:'4 2'},
    {label:'LSPD',aliases:A.LSPD,auto:true,min:0,max:60,unit:'ft/min',color:'var(--muted)',dash:'1 3'}]}]; }
function CBL_TRACK(){ return {id:'t13',name:'Cement bond',width:150,curves:[
    {label:'AMP',aliases:A.AMP,min:0,max:100,unit:'mV',color:'var(--rdeep)',fill:'left',fillColor:'#9AA5AB',fillOpacity:.35},
    {label:'TT',aliases:A.TT,min:400,max:200,unit:'µs',color:'var(--rmed)',dash:'4 2'},
    {label:'BI',aliases:A.BOND,min:0,max:1,unit:'',color:'var(--phie)'},
    {label:'CCL',aliases:A.CCL,min:-10,max:10,unit:'',color:'var(--muted)',dash:'1 2'}]}; }
function loadTrackDefaults(){ try{ const d=JSON.parse(localStorage.getItem('weller.trackDefaults2')||'null'); if(Array.isArray(d)&&d.length) return migrateTracks(d); }catch(e){} return defaultTracks(); }
// Older track sets: net pay was red (reads as gas), there was no washout flag, and Vsh had no SP source.
// Saved track sets and projects keep their styling but pick up new built-in tracks, curves and vendor aliases.
const ADDED_TRACKS=['t13','t14','t15','t16','t17','t18','t19'], ADDED_CURVES=['t1','t3','t5','t7','t12'];
function migrateTracks(tr){ const D=defaultTracks();
  for(const d of D){ const t=tr.find(x=>x.id===d.id);
    if(!t){ if(ADDED_TRACKS.includes(d.id)){ const at=D.indexOf(d), next=D.slice(at+1).map(x=>tr.findIndex(y=>y.id===x.id)).find(i=>i>=0); tr.splice(next??tr.length,0,d); } continue; }
    for(const dc of d.curves||[]){ const c=(t.curves||[]).find(x=>x.label===dc.label);
      if(c){ if(Array.isArray(c.aliases)&&Array.isArray(dc.aliases)){ const have=new Set(c.aliases.map(a=>a.toUpperCase())); for(const a of dc.aliases) if(!have.has(a.toUpperCase())) c.aliases.push(a); } if(dc.auto&&c.auto===undefined) c.auto=true; }
      else if(ADDED_CURVES.includes(d.id)&&t.curves) t.curves.push(structuredClone(dc)); } }
  for(const t of tr){ for(const c of t.curves||[]){ if(c.aliases?.[0]==='NET_PAY'&&/^#c1121f$/i.test(c.color)) c.color='#2E7D32'; if(c.aliases?.[0]==='VSH_GR'&&!c.aliases.includes('VSH_SP')) c.aliases.splice(1,0,'VSH_SP'); }
    if(t.type==='lith') for(const c of t.curves) if(!c.aliases.includes('VSH_SP')) c.aliases.push('VSH_SP');
    if(t.type==='flags'&&!t.curves.some(c=>c.aliases?.includes('FLAG_WO'))){ const i=t.curves.findIndex(c=>c.aliases?.[0]==='FLAG_BH'); t.curves.splice(i<0?t.curves.length:i,0,{label:'Washout',aliases:['FLAG_WO'],color:'#8C7B62'}); } } return tr; }
const norm=s=>s.toUpperCase().replace(/[:_-]\d+$/,'');
// Every curve in the well that a track curve's aliases match, best first: open hole before cased hole, then alias order.
const famKey=cfg=>String(cfg.aliases?.[0]||cfg.label||'').toUpperCase();
// Among open-hole curves, one covering half again as much depth wins over the alias order (MWD GR to TD vs a short GR).
function curveCandidates(well,cfg){ const out=[]; cfg.aliases.forEach((a,k)=>{ const au=a.toUpperCase(); for(const c of well.curves) if(norm(c.mnemonic)===au&&!out.some(o=>o.c===c)) out.push({c,k,n:c.sparse?0:c.data.length-(c.nulls||0)}); });
  // A curve chosen by name in the track editor (exact) keeps its place ahead of better-covered alternatives.
  return out.sort((x,y)=>cfg.exact?(x.k-y.k):(!!x.c.cased-!!y.c.cased)||(x.n>1.5*y.n?-1:y.n>1.5*x.n?1:x.k-y.k)).map(o=>o.c); }
// A well can pin which curve a family uses (well settings), or show all of them ('*').
function resolveCurve(well,cfg){ const pick=well.pick?.[famKey(cfg)]; if(pick&&pick!=='*'){ const c=well.curves.find(c=>c.mnemonic===pick); if(c) return c; } return curveCandidates(well,cfg)[0]||null; }

/* ---------- State ---------- */
const newViews=()=>({single:{pxPerFt:0.35,top:0,bottom:1000},corr:{pxPerFt:0.35,top:0,bottom:1000}});
const lsGet=(k,d)=>{ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } };
const lsSet=(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } };
const S={ mode:'single', wells:[], selected:null, panel:[], showEmpty:false, tracks:loadTrackDefaults(), views:newViews(), datum:'MD', picking:false, hiddenPoints:[], stats:null, basemap:'map', interp:interpDefaults(), corr:{gap:64,spacing:'equal',scale:0.75},
  units:lsGet('weller.units','imperial'), depthLabels:lsGet('weller.depthLabels',{md:true,ss:true}), topColors:lsGet('weller.topColors',{}) };
S.view=S.views.single;   // the active tab's zoom and scroll; Logs and Correlation each keep their own
const $=id=>document.getElementById(id);
/* ---------- Display units. Data stay in each well's own unit; only labels and inputs convert. ---------- */
const dispU=()=>S.units==='metric'?'m':'ft';
const unitK=w=>{ const u=w?.depthUnit||'ft'; return u===dispU()?1:u==='ft'?0.3048:1/0.3048; };
const toDisp=(v,w)=>v*unitK(w), fromDisp=(v,w)=>v/unitK(w);
function fmtD(v,w,dec=0){ return Number.isFinite(v)?toDisp(v,w).toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec}).replace(/^-/,'−'):'—'; }
function fmtDist(km){ return S.units==='metric'?`${Math.round(km*100)*10} m`:`${(Math.round(km*328.084)*10).toLocaleString()} ft`; }
// Subsea TVD as an elevation: KB (or GL) minus TVD, negative below sea level, the way US well files and Petra show it.
function ssArr(w){ const e=WellerLAS.datumElevation(w); if(!Number.isFinite(e)) return null; if(!w._ss||w._ssE!==e||w._ss.length!==depthOf(w).length){ w._ss=(tvdOf(w)||depthOf(w)).map(v=>e-v); w._ssE=e; } return w._ss; }
function ssAt(w,md){ const e=WellerLAS.datumElevation(w); return Number.isFinite(e)?e-mdToTvd(w,md):NaN; }
function depthText(w,md){ const ss=ssAt(w,md), u=dispU(); return `MD ${fmtD(md,w)} ${u}`+(Number.isFinite(ss)?` · ssTVD ${fmtD(ss,w)} ${u}`:''); }
function presetWell(cfg){ const w={...WellerSynth.makeWell(cfg),preset:cfg.id}; for(const p of w.points) w.curves.push(makePointCurve(p.mnemonic,p.unit,p.description,p.md,p.data)); delete w.points; return w; }
function loadPresets(){ S.wells=WellerSynth.PRESET_WELLS.map(presetWell); S.selected=S.wells[0].id; S.panel=['w1','w2','w4']; S.datum='MD'; pointSeriesNames().forEach(placePointSeries); computeAllInterp(); }
const wellById=id=>S.wells.find(w=>w.id===id);
const depthOf=w=>w.curves[0].data;
function wellRange(w){ const d=depthOf(w); return [d[0],d[d.length-1]]; }
/* ---------- Depth frames: MD, TVDSS, or flattened on a top. Deviated wells use TVD from their survey. ---------- */
function tvdOf(w){ if(!w.survey) return null; const d=depthOf(w); if(!w._tvd||w._tvd.length!==d.length) w._tvd=WellerLAS.tvdAt(w.survey,d); return w._tvd; }
function mdToTvd(w,md){ return w.survey?WellerLAS.tvdAt(w.survey,Float64Array.of(md))[0]:md; }
function syncDatum(){ if(!['MD','TVDSS'].includes(S.datum)&&!S.wells.some(w=>w.tops.some(t=>t.name===S.datum))) S.datum='MD'; }
function frameOf(w){
  const dep=depthOf(w), mode=S.mode==='single'?'MD':S.datum, md={kind:'MD',z:m=>m,arr:dep,mono:true,note:''};
  if(mode==='MD') return md;
  const tvd=tvdOf(w), base=tvd?(m=>mdToTvd(w,m)):(m=>m), src=tvd||dep;
  const mono=!tvd||src.every((v,i)=>i===0||v>=src[i-1]-1e-9);
  if(mode==='TVDSS'){ const e=WellerLAS.datumElevation(w); if(!Number.isFinite(e)) return {...md,note:'no elevation, shown in MD'};
    const hungGL=!Number.isFinite(w.elevation?.kb); return {kind:'TVDSS',z:m=>base(m)-e,arr:src.map(v=>v-e),mono,note:(hungGL?'hung on GL':'')+(tvd?(hungGL?', ':'')+'TVD from survey':'')}; }
  const t=w.tops.find(t=>t.name===mode); if(!t) return {...md,note:`no ${mode} pick, not flattened`};
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
// Scale from this well's data (p2-p98) for curves whose range differs by tool and job (casing size, tension, shock).
function autoCfg(cfg,curve){ if(!cfg.auto||!curve||curve.sparse) return cfg; if(!curve._as) curve._as=autoScale(curve,cfg.log)||[cfg.min,cfg.max];
  const [a,b]=curve._as; return cfg.min>cfg.max?{...cfg,min:b,max:a}:{...cfg,min:a,max:b}; }
function effCfg(w,cfg){
  if(cfg.matchNeutron&&A.RHOB.includes((cfg.aliases||[])[0])){ const m=w.neutronMatrix||'limestone'; const [a,b]=ND_RHOB[m]; return {...cfg,min:a,max:b,tag:MATRIX_TAG[m]+' scale'}; }
  if(A.NPHI.includes((cfg.aliases||[])[0])&&w.neutronMatrix) return {...cfg,tag:MATRIX_TAG[w.neutronMatrix]};
  return cfg; }

/* ---------- Rendering ---------- */
function visibleTracks(w){ return S.tracks.filter(t=>(S.mode==='single'||t.panel)&&(S.showEmpty||t.curves.some(c=>resolveCurve(w,c)))); }
function fmtDepth(v){ return Math.round(v).toLocaleString(); }
function tickStep(pxPerUnit){ for(const i of [1,2,5,10,20,25,50,100,200,250,500,1000,2000]) if(i*pxPerUnit>=44) return i; return 5000; }
const trackW=t=>Math.round((t.width||190)*(S.mode==='corr'?(S.corr?.scale??0.75):1));
const sectionWells=()=>S.wells.filter(w=>S.panel.includes(w.id));
const viewWells=()=>S.mode==='single'?[wellById(S.selected)].filter(Boolean):sectionWells();
// Section order is the well-list order, so dragging a well in the list moves it in the section.
function syncPanel(){ S.panel=S.wells.filter(w=>S.panel.includes(w.id)).map(w=>w.id); }
function frameExtent(wells){ let lo=Infinity,hi=-Infinity;
  for(const w of wells){ const a=frameOf(w).arr; for(let i=0;i<a.length;i+=8){ if(a[i]<lo) lo=a[i]; if(a[i]>hi) hi=a[i]; } lo=Math.min(lo,a[0],a[a.length-1]); hi=Math.max(hi,a[0],a[a.length-1]); }
  return Number.isFinite(lo)?[lo,hi]:[0,1000]; }
/* Depth ticks in display units, found where each well's MD or ssTVD crosses a round number. They are placed through the
   frame, so they read true in any hang (MD, sea level, flattened) and in deviated wells. */
function depthTicks(w,F,y,H){
  const d=depthOf(w), k=unitK(w), step=tickStep(S.view.pxPerFt/k), minor=step/5, [i0,i1]=visibleRange(F,S.view.top,S.view.bottom), a=F.arr, ss=ssArr(w);
  const walk=(q,withMinor)=>{ const out=[]; let lastV=NaN;
    for(let i=Math.max(1,i0);i<=i1;i++){ const qa=q(i-1)*k, qb=q(i)*k; if(!Number.isFinite(qa)||!Number.isFinite(qb)||qa===qb) continue; const lo=Math.min(qa,qb), hi=Math.max(qa,qb);
      for(let v=Math.ceil(lo/minor)*minor;v<=hi;v+=minor){ const major=Math.abs(v/step-Math.round(v/step))<1e-6; if(!major&&!withMinor) continue; if(v===lastV) continue; lastV=v;
        const t=(v-qa)/(qb-qa), yy=y(a[i-1]+t*(a[i]-a[i-1])); if(yy>=0&&yy<=H) out.push({y:yy,v,major}); } }
    return out; };
  const thin=(list,gap)=>{ const out=[]; for(const t of list){ if(out.length&&Math.abs(out[out.length-1].y-t.y)<gap) continue; out.push(t); } return out; };
  const hasSS=!!ss&&S.depthLabels.ss, showMD=S.depthLabels.md||!hasSS;
  const primary=(hasSS&&(!showMD||(S.mode==='corr'&&S.datum==='TVDSS')))?(i=>ss[i]):(i=>d[i]);
  return { grid:thin(walk(primary,true),3), md:showMD?thin(walk(i=>d[i],false),14):[], ss:hasSS?thin(walk(i=>ss[i],false),14):[], showMD, showSS:hasSS, hasSS:!!ss };
}
function render(){ syncDatum();
  const statsMode=S.mode==='stats'; $('statsView').hidden=!statsMode; $('logView').hidden=statsMode;
  syncPanel();
  if(statsMode){ renderSidebar(); renderStats(); autosave(); return; }
  const panel=$('logPanel'); panel.querySelectorAll('.column,.gaplbl').forEach(c=>c.remove()); const ov=$('overlay'); ov.innerHTML=''; ov.setAttribute('width',0); ov.setAttribute('height',0);
  const wells=viewWells();
  $('datumWrap').hidden=S.mode!=='corr'; $('spacingWrap').hidden=S.mode!=='corr';
  $('vbWell').textContent=S.mode==='single'?(wells[0]?.name||'No well'):`Section A–A′ · ${wells.length} wells`;
  // The window always spans every log shown; zoom and scroll move within it, so nothing is ever cut off.
  const [lo,hi]=frameExtent(wells), pad=Math.max(20,(hi-lo)*0.01); S.view.top=Math.floor((lo-pad)/50)*50; S.view.bottom=Math.ceil((hi+pad)/50)*50;
  renderScale(wells[0]);
  const {top,bottom,pxPerFt}=S.view; const H=Math.max(10,(bottom-top)*pxPerFt); const y=d3.scaleLinear([top,bottom],[0,H]);
  const zc=zoneColorMap(); S._zc=zc;
  const gaps=S.mode==='corr'?wellGaps(wells):[];
  const cols=[];
  wells.forEach((w,k)=>{
    const F=frameOf(w), ticks=depthTicks(w,F,y,H);
    const col=document.createElement('div'); col.className='column'+(S.mode==='corr'&&w.id===S.selected?' sel':''); col.dataset.well=w.id; if(k>0&&S.mode==='corr') col.style.marginLeft=gaps[k-1].px+'px';
    const head=document.createElement('div'); head.className='colhead';
    const warn=(w.notes||[]).some(n=>/ignored|corrected/.test(n));
    head.innerHTML=`<span class="wname" data-wellmeta="${w.id}"${S.mode==='corr'?` data-selwell="${w.id}"`:''}>${esc(w.name)}${w.synthetic?' <small>synthetic</small>':''}${warn?' <small class="warn" title="'+esc(w.notes.join('; '))+'">⚠ header</small>':''}</span><small>${esc(w.api||'')}${F.note?' · '+F.note:''}</small>`;
    col.appendChild(head);
    const tr=document.createElement('div'); tr.className='tracks';
    tr.appendChild(depthTrack(w,F,y,H,ticks,zc));
    for(const t of visibleTracks(w)) tr.appendChild(logTrack(w,t,F,y,H,ticks));
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
/* Depth track: MD and subsea TVD side by side, each switchable from the chips in its header. */
function depthTrack(w,F,y,H,ticks,zc){
  const cols=[ticks.showMD&&'md',ticks.showSS&&'ss'].filter(Boolean);
  const W=12+44*cols.length, u=dispU();
  const div=document.createElement('div'); div.className='track dtrack'; div.style.width=W+'px';
  const chip=(k,lbl,dis)=>`<button type="button" data-dl="${k}" aria-pressed="${!!S.depthLabels[k]&&!dis}"${dis?` disabled title="No KB or GL elevation in this well"`:` title="Show ${k==='md'?'measured depth':'subsea TVD (KB minus TVD, negative below sea level)'}"`}>${lbl}</button>`;
  div.innerHTML=`<div class="thead"><div class="tn">Depth</div><div class="dchips">${chip('md','MD',false)}${chip('ss','ssTVD',!ticks.hasSS)}</div><div class="scale" style="color:var(--muted)"><span></span><span class="c">${u}</span><span></span></div></div>`;
  const svg=d3.create('svg').attr('width',W).attr('height',H).attr('class','depthsvg');
  // Zone strip: the same zone colors as the stats tab and the correlation fills.
  for(const z of zonesOf(w)){ if(z.name==='Whole well') continue; const y0=y(F.z(z.top)), y1=y(F.z(z.base)); if(y1<0||y0>H) continue;
    svg.append('rect').attr('x',0).attr('width',7).attr('y',Math.max(0,y0)).attr('height',Math.max(0,Math.min(H,y1)-Math.max(0,y0))).attr('fill',zc.get(z.name)||'transparent').append('title').text(z.name); }
  for(const t of ticks.grid) svg.append('line').attr('x1',t.major?W-6:W-3).attr('x2',W).attr('y1',t.y).attr('y2',t.y).attr('class','grid s');
  cols.forEach((c,j)=>{ const x=12+44*j+40; for(const t of ticks[c]) svg.append('text').attr('x',x).attr('y',t.y+3.5).attr('text-anchor','end').attr('class','depth'+(c==='ss'?' ss':'')).text((Math.round(t.v)||0).toLocaleString().replace(/^-/,'−')); });
  for(const tp of w.tops){ const yy=y(F.z(tp.md)); if(yy<0||yy>H) continue; svg.append('line').attr('x1',8).attr('x2',W).attr('y1',yy).attr('y2',yy).attr('class','top').attr('data-top',tp.name).style('stroke',zc.get(tp.name)||null); }
  const node=svg.node();
  node.addEventListener('mousemove',e=>{ if(S.drag) return; const r=node.getBoundingClientRect(); const z=y.invert(e.clientY-r.top); showCursor(e.clientY-$('logPanel').getBoundingClientRect().top,mdAtZ(w,F,z),w,[]); });
  node.addEventListener('mouseleave',()=>{ $('cursor').style.display='none'; });
  attachTopDrag(node,w,F,y); div.appendChild(node); return div;
}
// Curve colors with at least 3:1 contrast on both the light (#FFFFFF) and dark (#1F262E) track background.
const CURVE_COLORS=['#E4572E','#3A86FF','#2A9D8F','#9B59B6','#D63384','#6A8D2F','#E07A1F','#1F77B4'];
function nextColor(used){ const u=new Set(used.map(c=>String(c||'').toUpperCase())); return CURVE_COLORS.find(c=>!u.has(c))||CURVE_COLORS[used.length%CURVE_COLORS.length]; }
// Whatever a track asks for, the line drawn stays visible on the current background: too-light or too-dark colors are
// pushed away from the background until they reach 3:1.
const _vis=new Map();
function visibleColor(c){ const bg=cssVar('--paper')||'#FFFFFF', key=c+'|'+bg; if(_vis.has(key)) return _vis.get(key);
  const src=d3.color(c&&c.startsWith('var(')?cssVar(c.slice(4,-1)):c), B=d3.color(bg); if(!src||!B){ _vis.set(key,c); return c; }
  const lum=x=>{ const f=v=>{ v/=255; return v<=.03928?v/12.92:((v+.055)/1.055)**2.4; }; const r=d3.rgb(x); return .2126*f(r.r)+.7152*f(r.g)+.0722*f(r.b); };
  const cr=(a,b)=>{ const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  let h=d3.hsl(src); const dark=lum(B)<.2; for(let i=0;i<12&&cr(h,B)<3;i++) h.l=Math.max(0,Math.min(1,h.l+(dark?.07:-.07)));
  const out=cr(h,B)>=3?h.formatHex():c; _vis.set(key,out); return out; }
const fillHex=c=>c&&c.startsWith('var(')?cssVarHex(c.slice(4,-1)):c;
function scaleFor(c,width){ return c.log?d3.scaleLog([c.min,c.max],[0,width]).clamp(true):d3.scaleLinear([c.min,c.max],[0,width]).clamp(true); }
const LITHO={Sandstone:'#EDC84A',Siltstone:'#C0CCC6',Shale:'#465445',Marl:'#A2DBDB','Limestone / chalk':'#4E86C4'};   // petroplots LITHOLOGY colors
// Quick-look cutoffs, editable per lithology track (gear on the track).
const LITH_DEF={sandVsh:0.4,shaleVsh:0.65,limePE:4,marlPE:3.5,marlVsh:0.75,sandPE:2.6};
function lithParams(t){ return {...LITH_DEF,...(t?.lith||{}),colors:{...LITHO,...(t?.lith?.colors||{})}}; }
function lithRules(P,hasPE){ return hasPE?{'Limestone / chalk':`PE ≥ ${P.limePE}, Vsh < ${P.sandVsh}`,Marl:`PE ≥ ${P.marlPE}, Vsh < ${P.marlVsh}`,Sandstone:`PE < ${P.sandPE}, Vsh < ${P.sandVsh}`,Siltstone:`Vsh < ${P.sandVsh} otherwise, or ${P.sandVsh}–${P.shaleVsh}`,Shale:`Vsh ≥ ${P.shaleVsh}`}
  :{Sandstone:`Vsh < ${P.sandVsh}`,Siltstone:`Vsh ${P.sandVsh}–${P.shaleVsh}`,Shale:`Vsh ≥ ${P.shaleVsh}`}; }
function quickLith(vsh,pe,P=LITH_DEF){ if(!Number.isFinite(vsh)) return null;
  if(Number.isFinite(pe)){ if(pe>=P.limePE&&vsh<P.sandVsh) return 'Limestone / chalk'; if(pe>=P.marlPE&&vsh<P.marlVsh) return 'Marl'; if(pe<P.sandPE&&vsh<P.sandVsh) return 'Sandstone'; if(vsh<P.sandVsh) return 'Siltstone'; }
  return vsh<P.sandVsh?'Sandstone':vsh<P.shaleVsh?'Siltstone':'Shale'; }
function showTip(e,html){ const tip=$('tip'); tip.innerHTML=html; tip.hidden=false;
  const x=e.clientX+14, y=e.clientY+14; tip.style.left=Math.max(8,Math.min(x,innerWidth-tip.offsetWidth-8))+'px'; tip.style.top=Math.max(8,Math.min(y,innerHeight-tip.offsetHeight-8))+'px'; }
function hideTip(){ $('tip').hidden=true; }
const legendTip=(title,rows)=>`<div class="tiph">${esc(title)}</div>`+rows.map(([n,c,r])=>`<div class="lr"><i style="background:${c}"></i>${esc(n)} <small>${esc(r||'')}</small></div>`).join('');
function logTrack(w,t,F,y,H,ticks){
  const width=trackW(t), dep=depthOf(w), zA=F.arr; const div=document.createElement('div'); div.className='track'; div.style.width=width+'px';
  const head=document.createElement('div'); head.className='thead';
  head.innerHTML=`<div class="tn"><span>${esc(t.name)}</span><button title="Edit track" data-edit="${t.id}">⚙</button></div>`;
  const MULTI=CURVE_COLORS;
  const resolved=t.curves.flatMap(c=>{ if(!t.type&&w.pick?.[famKey(c)]==='*'){ const all=curveCandidates(w,c); if(all.length>1) return all.map((curve,k)=>({cfg:{...autoCfg(effCfg(w,c),curve),label:curve.mnemonic,color:k?MULTI[(k-1)%MULTI.length]:c.color,dash:c.dash,fill:k?'none':c.fill},curve})); }
    const curve=resolveCurve(w,c); return [{cfg:curve?autoCfg(effCfg(w,c),curve):c,curve}]; });
  // Auto-scaled curves sharing a unit in one track share one scale (min and average thickness must be comparable).
  const grp={}; for(const r of resolved) if(r.cfg.auto&&r.curve){ const k=String(r.cfg.unit||''), [a,b]=r.curve._as||[r.cfg.min,r.cfg.max]; const g=grp[k]||(grp[k]=[Infinity,-Infinity]); g[0]=Math.min(g[0],a,b); g[1]=Math.max(g[1],a,b); }
  for(const r of resolved) if(r.cfg.auto&&r.curve){ const [a,b]=grp[String(r.cfg.unit||'')]; r.cfg={...r.cfg,...(r.cfg.min>r.cfg.max?{min:b,max:a}:{min:a,max:b})}; }
  const gr=resolveCurve(w,{aliases:A.GR}), pe=resolveCurve(w,{aliases:A.PE}); let lithCls=null;
  if(t.type==='lithpct'){ const have=resolved.filter(r=>r.curve&&!r.curve.sparse); head.innerHTML+=`<div class="scale" style="color:var(--muted)"><span>0</span><span class="c">${have.length?have.length+' components':'no cuttings curves'}</span><span class="r">100%</span></div><div class="legend">${have.map(r=>`<i style="background:${r.cfg.color}" title="${r.cfg.label} (${r.curve.mnemonic})"></i>`).join('')}</div>`; }
  const LP=lithParams(t), hasPE=!!(pe&&!pe.sparse);
  const vs=resolveCurve(w,{aliases:['VSH_GR','VSH_SP']}), vSrc=gr&&!gr.sparse?'GR':vs?'SP':null;
  if(t.type==='lith') head.innerHTML+=`<div class="scale" style="color:var(--muted)" title="Computed from ${esc(gr?.mnemonic||vSrc||'GR')} cutoffs, not a mud-log or core description${gr?.cased?'. This gamma ray was logged through casing and reads low; pick an open-hole GR in well settings':''}"><span></span><span class="c">${vSrc?'computed* '+esc(vSrc==='GR'?gr.mnemonic:'SP')+(hasPE?' + PE':''):'needs GR or SP'}${gr?.cased?' · cased':''}</span><span></span></div><div class="legend">${Object.keys(lithRules(LP,hasPE)).map(k=>`<i style="background:${LP.colors[k]}"></i>`).join('')}</div>`;
  else if(t.type==='flags') head.innerHTML+=`<div class="legend">${resolved.filter(r=>r.curve).map(r=>`<i style="background:${r.cfg.color}"></i>`).join('')}</div>`;
  else for(const {cfg,curve} of resolved){ const s=document.createElement('div'); s.className='scale'; s.style.color=cfg.color; s.style.opacity=curve?1:.35; s.title=curve?.description||'';
    s.innerHTML=`<span>${cfg.min}</span><span class="c">${curve?curve.mnemonic:cfg.label+' (none)'}${cfg.unit?' '+cfg.unit:''}${cfg.tag?' · '+cfg.tag:''}</span><span class="r">${cfg.max}</span><span class="bar${curve?.sparse?' pts':cfg.dash?' dash':''}"></span>`; head.appendChild(s); }
  div.appendChild(head);
  const svg=d3.create('svg').attr('width',width).attr('height',H).classed('pick',S.picking);
  const [top,bot]=[S.view.top,S.view.bottom];
  for(const tk of ticks.grid) svg.append('line').attr('x1',0).attr('x2',width).attr('y1',tk.y).attr('y2',tk.y).attr('class','grid'+(tk.major?' s':''));
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
  else if(t.type==='lith'){ if(vSrc){ const g=svg.append('g').attr('opacity',gr?.cased&&vSrc==='GR'?.5:1); const bl=grBaselines(w); let run=null;
      const vshAt=i=>vs?vs.data[i]:WellerPetro.igr(gr.data[i],bl.clean??20,bl.shale??130), peAt=i=>hasPE?pe.data[i]:NaN;
      const cls=i=>quickLith(vshAt(i),peAt(i),LP); lithCls=i=>({k:cls(i),vsh:vshAt(i),pe:peAt(i)});
      const flush=(k,a,b)=>{ if(k) band(g,a,b,0,width,LP.colors[k]); };
      for(const i of idx){ const k=cls(i); if(!run||run.k!==k){ if(run) flush(run.k,run.a,i); run={k,a:i}; } }
      if(run) flush(run.k,run.a,i1); } }
  else if(t.type==='flags'){ const have=resolved.filter(r=>r.curve&&!r.curve.sparse); const wd=width/Math.max(1,have.length);
    have.forEach((r,c)=>{ const g=svg.append('g'); let a=null; for(const i of idx){ const on=r.curve.data[i]>=(r.cfg.flagAt??0.5); if(on&&a===null) a=i; if(!on&&a!==null){ band(g,a,i,c*wd,wd,r.cfg.color); a=null; } } if(a!==null) band(g,a,i1,c*wd,wd,r.cfg.color); }); }
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
      svg.append('path').attr('d',line(idx)).attr('fill','none').attr('stroke',visibleColor(cfg.color)).attr('stroke-width',1.2).attr('stroke-dasharray',cfg.dash||null); }
  }
  const firstVis=visibleTracks(w)[0];
  for(const tp of w.tops){ const yy=y(F.z(tp.md)); if(yy<0||yy>H) continue; svg.append('line').attr('x1',0).attr('x2',width).attr('y1',yy).attr('y2',yy).attr('class','top').attr('data-top',tp.name).style('stroke',S._zc?.get(tp.name)||null);
    if(t===firstVis) svg.append('text').attr('x',3).attr('y',yy-3).attr('class','toplbl').attr('data-top',tp.name).text(tp.name); }
  const node=svg.node();
  const flagsOn=resolved.filter(r=>r.curve&&!r.curve.sparse);
  node.addEventListener('mousemove',e=>{ if(S.drag) return; const r=node.getBoundingClientRect(); const z=y.invert(e.clientY-r.top), md=mdAtZ(w,F,z); showCursor(e.clientY-$('logPanel').getBoundingClientRect().top,md,w,resolved);
    const i=Math.min(dep.length-1,Math.max(0,d3.bisectCenter(dep,md)));
    if(lithCls){ const L=lithCls(i); if(!L.k) return hideTip(); const rule=lithRules(LP,hasPE)[L.k];
      showTip(e,`<div class="lr on"><i style="background:${LP.colors[L.k]}"></i>${esc(L.k)}</div><div class="tipv">Vsh <b>${L.vsh.toFixed(2)}</b>${Number.isFinite(L.pe)?` · PE <b>${L.pe.toFixed(2)}</b> b/e`:''}</div><div class="tipr">Rule: ${esc(rule)}</div><div class="tipd">${depthText(w,md)}</div>`); }
    else if(t.type==='flags'){ const on=flagsOn.filter(f=>f.curve.data[i]>=(f.cfg.flagAt??0.5));
      showTip(e,(on.length?on.map(f=>`<div class="lr on"><i style="background:${f.cfg.color}"></i>${esc(f.cfg.label)}</div>`).join(''):'<div class="tipv">No flag at this depth</div>')+`<div class="tipd">${depthText(w,md)}</div>`); } });
  node.addEventListener('mouseleave',()=>{ $('cursor').style.display='none'; hideTip(); });
  const leg=head.querySelector('.legend');
  if(leg&&t.type==='lith'){ leg.addEventListener('mousemove',e=>showTip(e,legendTip(`Computed lithology from ${vSrc==='GR'?gr.mnemonic:vSrc||'GR'}${hasPE?' and PE':' only'}: a quick look from cutoffs, not described cuttings${gr?.cased?'. Cased-hole GR: unreliable':''}`,Object.entries(lithRules(LP,hasPE)).map(([n,r])=>[n,LP.colors[n],r])))); leg.addEventListener('mouseleave',hideTip); }
  if(leg&&t.type==='flags'){ leg.addEventListener('mousemove',e=>showTip(e,legendTip('Flags',flagsOn.map(f=>[f.cfg.label,f.cfg.color,(f.curve.description||'').replace(/^[^:]*:\s*/,'')])))); leg.addEventListener('mouseleave',hideTip); }
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
    $('stNote').textContent=`${D.tp.name}: ${depthText(w,D.md)} in ${w.name}`; });
  const end=e=>{ const D=S.drag; if(!D||D.w!==w) return; S.drag=null; document.body.classList.remove('dragging');
    if(Math.abs(D.md-D.tp.md)>=0.5){ D.tp.md=D.md; D.tp.source='user'; w._grP=null; if(S.interp?.enabled) computeInterp(w); } render(); };
  node.addEventListener('pointerup',end); node.addEventListener('pointercancel',end);
}
function showCursor(yPx,md,w,resolved){ const dep=depthOf(w); const c=$('cursor'); c.style.display='block'; c.style.top=(yPx)+'px';
  const i=Math.min(dep.length-1,Math.max(0,d3.bisectCenter(dep,md)));
  $('stCursor').innerHTML=`<b>${esc(w.name)}</b> ${depthText(w,md)}`;
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
      lbl.textContent=fmtDist(g.km); lbl.title='Distance between wellheads'; panel.appendChild(lbl); }
  }
  S._corrWarn=warn.join(' · '); if(warn.length) $('stNote').textContent='⚠ '+S._corrWarn;
}
function placeTop(w,md){ const name=$('topName').value.trim(); if(!name) return; const ex=w.tops.find(t=>t.name===name); if(ex) ex.md=md; else w.tops.push({name,md,source:'user'}); S.picking=false; $('btnPick').classList.remove('primary'); $('stNote').textContent=`${name} set at ${depthText(w,md)} in ${w.name}`; if(S.interp?.enabled) computeInterp(w); render(); }

/* ---------- Sidebar: map, wells, tracks, tops ---------- */
// A click selects a well (the one the Tops panel edits). The dot adds it to or drops it from the section.
function clickWell(id){ S.selected=id; render(); }
function toggleSection(id){ const i=S.panel.indexOf(id); if(i>=0) S.panel.splice(i,1); else S.panel.push(id); S.selected=id; if(S.mode==='corr'&&S.panel.length===1) fitView(); else render(); }
// Rebuild a list only when its markup changed, so a click in progress never loses its target.
function setHTML(el,html){ if(el._html!==html){ el.innerHTML=html; el._html=html; } }
function renderSidebar(){
  renderMap();
  $('wellCount').textContent=S.wells.length;
  setHTML($('wellList'),S.wells.map(w=>{ const inSec=S.panel.includes(w.id); return `<li data-well="${w.id}" data-wellmeta="${w.id}" draggable="true" class="${w.id===S.selected?'sel':''}"><span class="grip" aria-hidden="true">⋮⋮</span><button type="button" class="dot${inSec?' in':''}" data-sect="${w.id}" aria-pressed="${inSec}" title="${inSec?'In the correlation section: click to remove':'Add to the correlation section'}"></button><span class="wn">${esc(w.name)}</span><button class="small" data-wellset="${w.id}" title="Well settings">⚙</button></li>`; }).join(''));
  setHTML($('trackList'),S.tracks.map((t,i)=>`<div class="trackrow"><span class="sw">${t.curves.slice(0,4).map(c=>`<i style="background:${c.color||'var(--muted)'}"></i>`).join('')}</span><span class="nm">${t.name}</span><label title="Show in correlation panel" style="display:${S.mode==='corr'?'inline':'none'};font-size:11px;color:var(--muted)"><input type="checkbox" data-panel="${i}"${t.panel?' checked':''}> panel</label><button class="small" data-up="${i}" title="Move left">◂</button><button class="small" data-dn="${i}" title="Move right">▸</button><button class="small" data-edit="${t.id}">⚙</button></div>`).join(''));
  renderPointList(); renderInterpPanel();
  const w=wellById(S.selected), zc=S._zc||zoneColorMap();
  setHTML($('topsWellSel'),S.wells.map(x=>`<option value="${x.id}"${x.id===S.selected?' selected':''}>${esc(x.name)}</option>`).join('')); $('topsWellSel').value=S.selected||'';
  $('topsUnit').textContent=`MD ${dispU()}`;
  setHTML($('topsTable'),w?[...w.tops].sort((a,b)=>a.md-b.md).map(t=>{ const c=zc.get(t.name)||'#888888';
    return `<tr><td><button type="button" class="swatchbtn tiny" data-topcolor="${esc(t.name)}" data-color="${c}" style="background:${c}" title="Color for ${esc(t.name)} in every well"></button></td><td class="tn">${esc(t.name)}</td><td style="text-align:right"><input type="number" step="0.5" data-topmd="${esc(t.name)}" value="${+toDisp(t.md,w).toFixed(1)}" aria-label="${esc(t.name)} MD"></td><td><button class="small" data-deltop="${esc(t.name)}" title="Delete this pick">×</button></td></tr>`; }).join(''):'');
  const names=[...new Set(S.wells.flatMap(w=>[...w.tops].sort((a,b)=>a.md-b.md).map(t=>t.name)))];
  $('topNames').innerHTML=names.map(n=>`<option value="${esc(n)}">`).join('');
  const dsel=$('datum'); const cur=S.datum; dsel.innerHTML=`<option value="MD">Measured depth</option><option value="TVDSS">Sea level (TVDSS)</option>`+names.map(n=>`<option value="${esc(n)}">Flatten on ${esc(n)}</option>`).join(''); dsel.value=names.includes(cur)||cur==='MD'||cur==='TVDSS'?cur:'MD';
  $('spacing').value=S.corr.spacing; $('showEmpty').checked=S.showEmpty;
  document.querySelectorAll('[data-units]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.units===S.units));
  const sw=wellById(S.selected); $('stFile').innerHTML=sw?`<b title="${esc(sourcesOf(sw).join('\n'))}">${esc(sourcesOf(sw).length>1?sourcesOf(sw).length+' LAS files':sw.fileName||sw.name+'.las (synthetic)')}</b> · ${sw.rows||depthOf(sw).length} rows · KB ${Number.isFinite(sw.elevation.kb)?fmtD(sw.elevation.kb,sw)+' '+dispU():'?'} · null ${sw.nullv??-999.25}${sw.wrap?' · wrapped':''}`:'';
}
/* Well list: drag a row to reorder wells, and with them the section. */
{ const list=$('wellList'); let dragId=null;
  list.addEventListener('dragstart',e=>{ const li=e.target.closest('li[data-well]'); if(!li) return; dragId=li.dataset.well; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/x-weller-well',dragId); li.classList.add('dragsrc'); });
  list.addEventListener('dragover',e=>{ if(!dragId) return; e.preventDefault(); e.stopPropagation(); list.querySelectorAll('.dropb,.dropa').forEach(x=>x.classList.remove('dropb','dropa'));
    const li=e.target.closest('li[data-well]'); if(!li||li.dataset.well===dragId) return; const r=li.getBoundingClientRect(); li.classList.add(e.clientY<r.top+r.height/2?'dropb':'dropa'); });
  list.addEventListener('drop',e=>{ if(!dragId) return; e.preventDefault(); e.stopPropagation(); const li=e.target.closest('li[data-well]');
    if(li&&li.dataset.well!==dragId){ const after=li.classList.contains('dropa'); const w=wellById(dragId); S.wells=S.wells.filter(x=>x!==w); const j=S.wells.findIndex(x=>x.id===li.dataset.well); S.wells.splice(after?j+1:j,0,w); }
    dragId=null; list._html=null; render(); });
  list.addEventListener('dragend',()=>{ dragId=null; list.querySelectorAll('.dragsrc,.dropb,.dropa').forEach(x=>x.classList.remove('dragsrc','dropb','dropa')); }); }
// West to east (left to right, as on the map); wells without a location keep their order at the end.
function sortWestEast(wells){ const lon=w=>wgs84Of(w)?.[1]; return [...wells].sort((a,b)=>{ const x=lon(a), y=lon(b); return Number.isFinite(x)&&Number.isFinite(y)?x-y:Number.isFinite(x)?-1:Number.isFinite(y)?1:0; }); }
$('topsWellSel').onchange=e=>{ S.selected=e.target.value; render(); };
document.addEventListener('change',e=>{ const t=e.target; if(t.dataset.topmd===undefined) return; const w=wellById(S.selected), tp=w?.tops.find(x=>x.name===t.dataset.topmd), v=parseFloat(t.value);
  if(!tp||!Number.isFinite(v)) return; tp.md=fromDisp(v,w); tp.source='user'; w._grP=null; if(S.interp?.enabled) computeInterp(w); render(); });
document.addEventListener('colorpicked',e=>{ const n=e.target.dataset.topcolor; if(n===undefined) return; S.topColors={...S.topColors,[n]:e.detail}; render(); });
$('btnTopColorsSave').onclick=()=>{ const zc=zoneColorMap(), all={}; for(const w of S.wells) for(const t of w.tops) all[t.name]=zc.get(t.name);
  $('stNote').textContent=lsSet('weller.topColors',{...lsGet('weller.topColors',{}),...all})?`Top colors saved as your default (${Object.keys(all).length} tops)`:'Could not save (storage blocked)'; };
$('btnTopColorsReset').onclick=()=>{ try{ localStorage.removeItem('weller.topColors'); }catch(e){} S.topColors={}; render(); $('stNote').textContent='Top colors reset to the built-in palette'; };

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
function pickColor(c){ const t=colorTarget; if(t&&/^#[0-9a-f]{6}$/i.test(c)){ t.dataset.color=c; t.style.background=c; } closeColorPop(); if(t&&/^#[0-9a-f]{6}$/i.test(c)) t.dispatchEvent(new CustomEvent('colorpicked',{bubbles:true,detail:c})); }
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
// Lithology tracks edit their cutoffs and colors instead of a curve list.
function drawTdLith(){ const P=lithParams(editing), n=(k,st)=>`<input type="number" data-lp="${k}" value="${P[k]}" step="${st||0.05}" style="width:4.2em">`, c=k=>`<button type="button" class="swatchbtn" data-lc="${k}" data-color="${P.colors[k]}" style="background:${P.colors[k]}" title="${k} color"></button>`;
  $('tdLithBody').innerHTML=[['Sandstone',`Vsh &lt; ${n('sandVsh')}; where PE exists, also PE &lt; ${n('sandPE',0.1)}`],['Siltstone',`Vsh from the sand cutoff to ${n('shaleVsh')}, or clean rock no PE class fits`],['Shale','Vsh at or above the shale cutoff'],
    ['Limestone / chalk',`PE ≥ ${n('limePE',0.1)} and Vsh below the sand cutoff`],['Marl',`PE ≥ ${n('marlPE',0.1)} and Vsh &lt; ${n('marlVsh')}`]].map(([k,r])=>`<tr><td>${c(k)} ${k}</td><td>${r}</td></tr>`).join(''); }
function readTdLith(){ const P={colors:{}}; document.querySelectorAll('#tdLithBody [data-lp]').forEach(i=>{ const v=parseFloat(i.value); if(Number.isFinite(v)) P[i.dataset.lp]=v; }); document.querySelectorAll('#tdLithBody [data-lc]').forEach(b=>P.colors[b.dataset.lc]=b.dataset.color); editing.lith=P; }
function drawTdCurves(){ const lith=editing.type==='lith'; $('tdLith').hidden=!lith; $('tdCurveWrap').hidden=lith; $('tdAddRow').hidden=lith; if(lith) return drawTdLith();
  const w=wellById(S.selected)||S.wells[0]; const tb=$('tdCurves'); tb.innerHTML=''; if(!w) return;
  const flags=editing.type==='flags'; $('tdHead').innerHTML=flags?'<th>Curve</th><th>Flag where value ≥</th><th>Color</th><th></th>':'<th>Curve</th><th>Left</th><th>Right</th><th>Log</th><th>Line</th><th>Dash</th><th>Fill</th><th>Fill colors</th><th>Opacity</th><th></th>';
  $('tdHint').textContent=flags?'Each curve draws as a bar where its value reaches the threshold: 1 for the computed 0/1 flags, or a level on any log, such as metal loss % or caliper minus bit for corrosion and washout.':'Styles apply to this track in every well. Reversed scales (left > right) are fine: that is how NPHI and DT are read. Color by value shades each depth by its reading, from the first color at the left scale value to the second at the right.';
  if(flags){ editing.curves.forEach((c,i)=>{ const cur=resolveCurve(w,c), tr=document.createElement('tr'); const col=c.color&&c.color.startsWith('var(')?cssVarHex(c.color.slice(4,-1)):(c.color||'#333333');
    tr.innerHTML=`<td><select data-i="${i}" class="tdm">${w.curves.slice(1).map(x=>`<option value="${x.mnemonic}"${cur&&cur.mnemonic===x.mnemonic?' selected':''}>${x.mnemonic} (${x.unit||'-'})</option>`).join('')}${cur?'':`<option selected value="">${esc(c.label)} (not in this well)</option>`}</select> <input type="text" class="tdlbl" data-i="${i}" value="${esc(c.label)}" aria-label="Flag name" style="width:9em"></td>
      <td><input type="number" class="tdfa" data-i="${i}" value="${c.flagAt??0.5}" step="any"></td><td><button type="button" class="swatchbtn tdcol" data-i="${i}" data-color="${col}" style="background:${col}" title="Flag color"></button></td><td><button class="small tdrm" data-i="${i}">×</button></td>`; tb.appendChild(tr); }); return; }
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
function readTd(){ editing.name=$('tdName').value; editing.width=+$('tdWidth').value||190; if(editing.type==='lith') return readTdLith();
  if(editing.type==='flags'){ document.querySelectorAll('#tdCurves tr').forEach((tr,i)=>{ const c=editing.curves[i], m=tr.querySelector('.tdm').value; if(m){ const mu=m.toUpperCase(); c.aliases=[m,...(c.aliases||[]).filter(a=>a.toUpperCase()!==mu)]; }
    c.label=tr.querySelector('.tdlbl').value.trim()||m||c.label; const fa=parseFloat(tr.querySelector('.tdfa').value); c.flagAt=Number.isFinite(fa)?fa:0.5; c.color=tr.querySelector('.tdcol').dataset.color; }); return; }
  document.querySelectorAll('#tdCurves tr').forEach((tr,i)=>{ const c=editing.curves[i]; const m=tr.querySelector('.tdm').value; if(m){ const mu=m.toUpperCase(); if(!c.aliases.some(a=>a.toUpperCase()===mu)){ c.label=m; c.exact=true; } c.aliases=[m,...c.aliases.filter(a=>a.toUpperCase()!==mu)]; }
    const mn=+tr.querySelector('.tdmin').value, mx=+tr.querySelector('.tdmax').value; if(c.matchNeutron&&(mn!==c.min||mx!==c.max)) c.matchNeutron=false; c.min=mn; c.max=mx; c.log=tr.querySelector('.tdlog').checked; c.color=tr.querySelector('.tdcol').dataset.color; c.dash=tr.querySelector('.tddash').checked?'4 3':undefined;
    c.fill=tr.querySelector('.tdfill').value; c.fillStyle=tr.querySelector('.tdfs').value; c.fillColor=tr.querySelector('.tdfc').dataset.color; c.fillColor2=tr.querySelector('.tdfc2').dataset.color; c.fillOpacity=+tr.querySelector('.tdfo').value; }); }
document.addEventListener('change',e=>{ if(e.target.dataset.panel!==undefined){ S.tracks[+e.target.dataset.panel].panel=e.target.checked; render(); } });
document.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(b.dataset.edit) openTrackDlg(b.dataset.edit);
  if(b.dataset.up!==undefined){ const i=+b.dataset.up; if(i>0){ [S.tracks[i-1],S.tracks[i]]=[S.tracks[i],S.tracks[i-1]]; render(); } }
  if(b.dataset.dn!==undefined){ const i=+b.dataset.dn; if(i<S.tracks.length-1){ [S.tracks[i+1],S.tracks[i]]=[S.tracks[i],S.tracks[i+1]]; render(); } }
  if(b.dataset.deltop){ const w=wellById(S.selected); if(w){ w.tops=w.tops.filter(t=>t.name!==b.dataset.deltop); if(S.interp?.enabled) computeInterp(w); render(); } }
  if(b.dataset.sect){ toggleSection(b.dataset.sect); return; }
  if(b.dataset.dl){ const k=b.dataset.dl, o=k==='md'?'ss':'md'; S.depthLabels={...S.depthLabels,[k]:!S.depthLabels[k]}; if(!S.depthLabels[k]&&!S.depthLabels[o]) S.depthLabels[o]=true; lsSet('weller.depthLabels',S.depthLabels); render(); }
  if(b.dataset.units&&b.dataset.units!==S.units){ S.units=b.dataset.units; lsSet('weller.units',S.units); render(); }
  if(b.classList.contains('tdrm')){ readTd(); editing.curves.splice(+b.dataset.i,1); drawTdCurves(); }
  if(b.classList.contains('tdauto')){ readTd(); const c=editing.curves[+b.dataset.i]; const w=wellById(S.selected)||S.wells[0]; const cur=resolveCurve(w,c); const r=cur&&autoScale(cur,c.log); if(r){ [c.min,c.max]=(c.min>c.max)?[r[1],r[0]]:r; drawTdCurves(); } }
  if(b.dataset.wellset) openWellDlg(b.dataset.wellset);
});
$('tdSaveDefaults').onclick=()=>{ readTd(); const i=S.tracks.findIndex(t=>t.id===editing.id); const set=S.tracks.map(t=>t.id===editing.id?editing:t); if(i<0) set.push(editing); try{ localStorage.setItem('weller.trackDefaults2',JSON.stringify(set)); $('stNote').textContent='Track defaults saved for new projects'; }catch(e){ $('stNote').textContent='Could not save defaults (storage blocked)'; } };
$('tdLithReset').onclick=()=>{ delete editing.lith; drawTdLith(); };
$('tdResetDefaults').onclick=()=>{ try{ localStorage.removeItem('weller.trackDefaults2'); }catch(e){} S.tracks=defaultTracks(); $('trackDlg').hidden=true; render(); };
$('tdAddCurve').onclick=()=>{ readTd(); const w=wellById(S.selected)||S.wells[0]; const c=w.curves[1]; editing.curves.push(editing.type==='flags'?{label:c.mnemonic,aliases:[c.mnemonic],flagAt:0.5,color:'#C62828'}:{label:c.mnemonic,aliases:[c.mnemonic],exact:true,...tdRange(c),color:nextColor(editing.curves.map(x=>x.color))}); drawTdCurves(); };
function tdRange(c){ const r=c&&autoScale(c,false); return r?{min:r[0],max:r[1]}:{min:0,max:100}; }
$('tdCurves').addEventListener('change',e=>{ if(!e.target.classList.contains('tdm')||editing.type==='flags') return; readTd(); const c=editing.curves[+e.target.dataset.i]; const w=wellById(S.selected)||S.wells[0]; const cur=w?.curves.find(x=>x.mnemonic===e.target.value);
  if(cur){ const r=autoScale(cur,c.log); if(r) [c.min,c.max]=c.min>c.max?[r[1],r[0]]:r; c.unit=cur.unit||''; } drawTdCurves(); });
$('tdSave').onclick=()=>{ readTd(); const i=S.tracks.findIndex(t=>t.id===editing.id); if(i>=0) S.tracks[i]=editing; else S.tracks.push(editing); $('trackDlg').hidden=true; render(); };
$('tdCancel').onclick=()=>{ $('trackDlg').hidden=true; };
$('tdDelete').onclick=()=>{ S.tracks=S.tracks.filter(t=>t.id!==editing.id); $('trackDlg').hidden=true; render(); };
$('btnAddTrack').onclick=()=>{ editing={id:'t'+Date.now().toString(36),name:'New track',width:160,curves:[]}; $('tdName').value=editing.name; $('tdWidth').value=160; drawTdCurves(); $('trackDlg').hidden=false; };

let wellEditing=null;
function openWellDlg(id){ const w=wellById(id); if(!w) return; wellEditing=w; $('wdName').value=w.name; $('wdApi').value=w.api||''; $('wdField').value=w.field||''; $('wdKb').value=w.elevation.kb??''; $('wdGl').value=w.elevation.gl??''; $('wdUnit').value=w.depthUnit;
  $('wdLat').value=w.location.lat??''; $('wdLon').value=w.location.lon??''; $('wdCrs').value=w.location.crs||''; $('wdNotes').textContent=(w.notes||[]).join(' · ');
  $('wdOp').value=w.company||''; $('wdCounty').value=w.county||''; $('wdState').value=w.state||'';
  const logs=w.curves.slice(1).filter(c=>!c.sparse&&!c.computed), comp=w.curves.filter(c=>c.computed), pts=w.curves.filter(c=>c.sparse);
  $('wdCurves').innerHTML=`<b>${logs.length} logged curves</b>: ${logs.map(c=>`<span title="${esc(c.description||'')}">${esc(c.mnemonic)}${c.unit?` <small>${esc(c.unit)}</small>`:''}</span>`).join(', ')}`+(comp.length?`<br><b>${comp.length} computed</b>: ${comp.map(c=>esc(c.mnemonic)).join(', ')}`:'')+(pts.length?`<br><b>${pts.length} point series</b>: ${pts.map(c=>esc(c.mnemonic)).join(', ')}`:'');
  drawCurveChoices(w);
  const src=sourcesOf(w); $('wdSources').innerHTML=src.length>1?`<b>${src.length} source files</b>, merged on one depth grid: ${src.map(esc).join(', ')}`:''; $('wdSplit').hidden=src.length<2;
  $('wellDlg').hidden=false; }
$('wdSave').onclick=()=>{ const w=wellEditing; const n=v=>v===''?undefined:+v; w.name=$('wdName').value; w.api=$('wdApi').value; w.field=$('wdField').value; w.elevation.kb=n($('wdKb').value); w.elevation.gl=n($('wdGl').value); w.depthUnit=$('wdUnit').value;
  w.location.lat=n($('wdLat').value); w.location.lon=n($('wdLon').value); w.location.crs=$('wdCrs').value; w.company=$('wdOp').value; w.county=$('wdCounty').value; w.state=$('wdState').value; w._ss=null; $('wellDlg').hidden=true; render(); };
$('wdCancel').onclick=()=>{ $('wellDlg').hidden=true; };
// Curve pickers for one well. The same controls sit in the load summary and in well settings.
function choicesHTML(w){ return curveChoices(w).map(m=>{ const p=w.pick?.[m.key]||'', auto=curveCandidates(w,m.cfg)[0];
  return `<div class="pickrow"><span class="pk">${esc(m.label)}</span><select data-pick="${esc(m.key)}" data-wid="${w.id}" aria-label="${esc(m.label)} curve for ${esc(w.name)}"><option value=""${p?'':' selected'}>Auto: ${esc(auto?curveWhere(w,auto):'')}</option>${m.list.map(c=>`<option value="${esc(c.mnemonic)}"${p===c.mnemonic?' selected':''}>${esc(curveWhere(w,c))}</option>`).join('')}<option value="*"${p==='*'?' selected':''}>Show all ${m.list.length}, overlaid</option></select></div>`; }).join(''); }
function hiddenCurves(w){ const shown=new Set(); for(const t of S.tracks) for(const c of t.curves||[]){ if(!c.aliases) continue; for(const x of curveCandidates(w,c)) shown.add(x); }
  return w.curves.slice(1).filter(c=>!c.computed&&!c.sparse&&!shown.has(c)&&c.nulls<depthOf(w).length&&!/^(TVD|TVDSS|MD|DEPT|DEPTH)$/i.test(norm(c.mnemonic))); }
const hiddenHTML=w=>hiddenCurves(w).map(c=>`<button class="small" data-addtrack="${esc(c.mnemonic)}" data-wid="${w.id}" title="Add a track for ${esc(c.description||c.mnemonic)}">+ ${esc(c.mnemonic)}</button>`).join(' ');
function drawCurveChoices(w){ const ch=choicesHTML(w), hid=hiddenHTML(w);
  $('wdChoices').innerHTML=ch?`<b>Several curves of one kind</b> <span class="hint">Auto uses an open-hole curve, the one covering the most depth. Applies to tracks, lithology and interpretation.</span>${ch}`:'';
  $('wdHidden').innerHTML=hid?`<b>Not in any track</b> <span class="hint">click to add a track</span><div class="chips">${hid}</div>`:''; }
function refreshPickers(){ if(!$('wellDlg').hidden&&wellEditing) drawCurveChoices(wellEditing); if(!$('impDlg').hidden) openImportReport(); }
document.addEventListener('change',e=>{ const k=e.target.dataset?.pick, w=wellById(e.target.dataset?.wid); if(k===undefined||!w) return; w.pick={...(w.pick||{})}; if(e.target.value) w.pick[k]=e.target.value; else delete w.pick[k];
  w._grP=null; computeInterp(w); render(); refreshPickers(); $('stNote').textContent=`${w.name}: ${k} ${e.target.value==='*'?'shows all curves':e.target.value?'uses '+e.target.value:'back to auto'}`; });
// A new track for one curve: auto range, a color that reads on both themes.
function addCurveTrack(w,m){ const c=w.curves.find(x=>x.mnemonic===m); if(!c) return; const r=autoScale(c,false)||[0,100];
  S.tracks.push({id:'t'+Date.now().toString(36),name:m,width:120,curves:[{label:m,aliases:[norm(m)],min:r[0],max:r[1],unit:c.unit||'',color:nextColor([])}]}); render(); refreshPickers(); $('stNote').textContent=`Track added for ${m}. Its ⚙ adds more curves or changes the scale.`; }
document.addEventListener('click',e=>{ const b=e.target.closest('[data-addtrack]'); if(!b) return; const w=wellById(b.dataset.wid); if(w) addCurveTrack(w,b.dataset.addtrack); });
$('wdSplit').onclick=()=>{ const out=splitWell(wellEditing); $('wellDlg').hidden=true; render(); $('stNote').textContent=`Split into ${out.length} wells: ${out.map(w=>w.name).join(', ')}`; };
$('wdRemove').onclick=()=>{ removeWells([wellEditing]); $('wellDlg').hidden=true; };
function removeWells(list){ S.wells=S.wells.filter(w=>!list.includes(w)); S.panel=S.panel.filter(id=>wellById(id)); if(!wellById(S.selected)) S.selected=S.wells[0]?.id||null; render(); }

/* ---------- Manage wells: rename and fill header fields in bulk, remove or clear wells ---------- */
const MW_FIELDS=[['name','Name','text'],['api','API','text'],['company','Operator','text'],['field','Field','text'],['county','County','text'],['state','State','text'],['kb','KB','number'],['gl','GL','number']];
let mwRows=null;
function mwGet(w,k){ return k==='kb'||k==='gl'?w.elevation[k]:w[k]; }
function openManageWells(){ $('mwAuto').checked=lsGet('weller.autoMerge',true); mwRows=S.wells.map(w=>({w,sel:false,gone:false,into:null,split:false,v:Object.fromEntries(MW_FIELDS.map(([k])=>[k,mwGet(w,k)??'']))})); drawMW(); $('mwDlg').hidden=false; }
function drawMW(){ $('mwBody').innerHTML=mwRows.map((r,i)=>r.gone?'':`<tr><td><input type="checkbox" data-mwsel="${i}"${r.sel?' checked':''} aria-label="Select ${esc(r.w.name)}"></td>${MW_FIELDS.map(([k,,t])=>`<td><input type="${t}" data-mw="${i}" data-k="${k}" value="${esc(r.v[k])}"${t==='number'?' step="0.1"':''} class="mw-${k}"></td>`).join('')}<td class="num">${r.w.curves.filter(c=>!c.sparse&&!c.computed).length-1}</td><td class="num">${mwFiles(r,i)}</td></tr>`).join('')
    ||'<tr><td colspan="11" class="hint">No wells. Apply to clear the project.</td></tr>';
  const n=mwRows.filter(r=>r.sel&&!r.gone).length; $('mwCount').textContent=n?`${n} selected`:'Select rows to edit or remove several at once'; $('mwSet').disabled=$('mwRemove').disabled=!n; $('mwMerge').disabled=n<2; }
function mwFiles(r,i){ const merged=mwRows.filter(x=>x.into===r), k=sourcesOf(r.w).length+merged.reduce((a,x)=>a+sourcesOf(x.w).length,0);
  const tip=[...sourcesOf(r.w),...merged.flatMap(x=>sourcesOf(x.w))].join('\n');
  return `<span title="${esc(tip)}">${k||'—'}</span>`+(merged.length?` <button class="small" data-mwunmerge="${i}" title="Undo this merge">unmerge</button>`:sourcesOf(r.w).length>1?` <button class="small" data-mwsplit="${i}" title="One well per file">${r.split?'will split':'split'}</button>`:''); }
$('mwDlg').addEventListener('input',e=>{ const t=e.target; if(t.dataset.mw!==undefined) mwRows[+t.dataset.mw].v[t.dataset.k]=t.value; });
$('mwDlg').addEventListener('change',e=>{ const t=e.target; if(t.dataset.mwsel!==undefined){ mwRows[+t.dataset.mwsel].sel=t.checked; drawMW(); } });
$('mwBody').addEventListener('click',e=>{ const t=e.target;
  if(t.dataset.mwsplit!==undefined){ const r=mwRows[+t.dataset.mwsplit]; r.split=!r.split; drawMW(); }
  if(t.dataset.mwunmerge!==undefined){ const r=mwRows[+t.dataset.mwunmerge]; mwRows.forEach(x=>{ if(x.into===r){ x.into=null; x.gone=false; } }); drawMW(); } });
// Merge: the first selected row keeps its name and header; the others' curves are spliced in on Apply.
$('mwMerge').onclick=()=>{ const sel=mwRows.filter(r=>r.sel&&!r.gone); if(sel.length<2) return; const [t,...rest]=sel;
  const keys=[...new Set(sel.map(r=>apiOf({api:r.v.api})?.key).filter(Boolean))];
  rest.forEach(r=>{ r.gone=true; r.into=t; r.sel=false; }); t.sel=false; drawMW();
  $('mwCount').textContent=`${rest.length+1} wells will merge into ${t.v.name}`+(keys.length>1?`. Their APIs differ (${keys.join(', ')}): check they are the same borehole.`:''); };
$('mwAuto').onchange=e=>lsSet('weller.autoMerge',e.target.checked);
$('mwAll').onclick=()=>{ const on=mwRows.some(r=>!r.sel&&!r.gone); mwRows.forEach(r=>r.sel=on); drawMW(); };
$('mwSort').onclick=()=>{ const order=sortWestEast(mwRows.map(r=>r.w)); mwRows.sort((a,b)=>order.indexOf(a.w)-order.indexOf(b.w)); drawMW(); };
$('mwSet').onclick=()=>{ const k=$('mwField').value, v=$('mwVal').value; mwRows.forEach(r=>{ if(r.sel&&!r.gone) r.v[k]=v; }); drawMW(); };
$('mwRemove').onclick=()=>{ mwRows.forEach(r=>{ if(r.sel){ r.gone=true; r.into=null; } }); drawMW(); };
$('mwClear').onclick=()=>{ mwRows.forEach(r=>{ r.gone=true; r.into=null; }); drawMW(); };
$('mwCancel').onclick=()=>{ $('mwDlg').hidden=true; };
$('mwSave').onclick=()=>{ const keep=mwRows.filter(r=>!r.gone), n=v=>v===''||v==null?undefined:+v;
  for(const {w,v} of keep){ for(const [k] of MW_FIELDS){ if(k==='kb'||k==='gl') w.elevation[k]=n(v[k]); else w[k]=String(v[k]).trim()||(k==='name'?w.name:''); } w._ss=null; }
  S.wells=[...keep.map(r=>r.w),...mwRows.filter(r=>r.into).map(r=>r.w)]; const msg=[];
  for(const r of keep){ const others=mwRows.filter(x=>x.into===r).map(x=>x.w); if(others.length){ const nw=mergeInto(r.w,others); msg.push(`merged ${others.length+1} into ${nw.name}`); } }
  for(const r of keep) if(r.split){ const w=wellById(r.w.id); if(w) msg.push(`split ${w.name} into ${splitWell(w).length}`); }
  $('mwDlg').hidden=true; removeWells([]); $('stNote').textContent=`${S.wells.length} well${S.wells.length===1?'':'s'}`+(msg.length?' · '+msg.join(' · '):''); };
$('btnManageWells').onclick=e=>{ e.preventDefault(); e.stopPropagation(); openManageWells(); };

/* ---------- Well header on hover: the key facts from the LAS header ---------- */
function wellMetaHTML(w){ const m=w.meta||{}, e=w.elevation||{}, u=dispU(), d=depthOf(w), td=w.params?.td;
  const loc=[m.location,[w.county&&w.county+' Co.',w.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const rows=[['Operator',w.company],['Field',w.field],['Location',loc],['API',w.api],['Spud',m.spud],['Logged',[m.logDate,m.service].filter(Boolean).join(', ')],
    ['Elevation',[Number.isFinite(e.kb)?`KB ${fmtD(e.kb,w)}`:'',Number.isFinite(e.gl)?`GL ${fmtD(e.gl,w)}`:''].filter(Boolean).join(' · ')+(Number.isFinite(e.kb)||Number.isFinite(e.gl)?' '+u:'')],
    ['TD',Number.isFinite(td)?`${fmtD(td,w)} ${u} MD`:''],['Logged interval',`${fmtD(d[0],w)}–${fmtD(d[d.length-1],w)} ${u} MD`],['Deviated',w.survey?'yes, TVD from the survey in the file':'']].filter(r=>r[1]);
  return `<div class="tiph">${esc(w.name)}</div><table class="tipt">${rows.map(([k,v])=>`<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>`; }
document.addEventListener('mouseover',e=>{ const el=e.target.closest('[data-wellmeta]'); if(!el||e.target.closest('button')) return; const w=wellById(el.dataset.wellmeta); if(w) showTip(e,wellMetaHTML(w)); });
document.addEventListener('mouseout',e=>{ const el=e.target.closest('[data-wellmeta]'); if(el&&!el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('dragstart',hideTip);

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
$('logPanel').addEventListener('click',e=>{ const h=e.target.closest('[data-selwell]'); if(h&&h.dataset.selwell!==S.selected){ S.selected=h.dataset.selwell; render(); } });
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
const viewKey=m=>m==='corr'?'corr':'single';
// Logs and Correlation keep their own zoom and scroll: leaving a flattened section never strands the Logs tab.
function setMode(m){ const was=S.mode; if(was!=='stats') S.view.scroll=$('logScroll').scrollTop;
  S.mode=m; document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-selected',b.dataset.mode===m));
  if(m==='corr'&&S.panel.length===0&&S.selected) S.panel=[S.selected];
  if(m==='stats'){ render(); return; }
  S.view=S.views[viewKey(m)]||(S.views[viewKey(m)]={pxPerFt:0.35});
  if(!S.view.fitted) return fitView();
  render(); $('logScroll').scrollTop=S.view.scroll||0; }
$('datum').onchange=e=>{ S.datum=e.target.value; fitView(); };
$('spacing').onchange=e=>{ S.corr.spacing=e.target.value; render(); };
$('btnFit').onclick=fitView;
$('showEmpty').onchange=e=>{ S.showEmpty=e.target.checked; render(); };
/* Fit: the whole log fits the screen height. A section flattened on a top fits the interval around that top and
   scrolls there; the rest of the logs stay a scroll away. */
function fitView(){ if(S.mode==='stats') return render(); const wells=viewWells();
  render(); let [lo,hi]=frameExtent(wells);
  if(S.mode==='corr'&&!['MD','TVDSS'].includes(S.datum)&&wells.length){ const k=wells[0].depthUnit==='m'?0.3048:1; lo=Math.max(lo,-400*k); hi=Math.min(hi,1200*k); }
  const sc=$('logScroll'), svg=$('logPanel').querySelector('.tracks svg'), hdr=svg?svg.getBoundingClientRect().top-$('logPanel').getBoundingClientRect().top:120;
  const vh=Math.max(120,sc.clientHeight-hdr-24); S.view.pxPerFt=Math.min(20,Math.max(0.01,vh/Math.max(1,hi-lo))); S.view.fitted=true;
  render(); sc.scrollTop=Math.max(0,(lo-S.view.top)*S.view.pxPerFt); S.view.scroll=sc.scrollTop; }
/* Vertical scale as a ratio, the way log prints are specified: 1:240 is 5 in per 100 ft, 1:200 is 5 mm per m.
   Screen size assumes the CSS standard of 96 px per inch, so it is nominal on screen and exact in a 96 dpi PNG. */
const SCALES={imperial:[48,120,240,600,1200,2400,4800,9600,20000],metric:[40,100,200,500,1000,2000,5000,10000,20000]};
const ratioK=w=>(w?.depthUnit==='m'?96/0.0254:96*12);   // ratio × px per depth unit
const ratioOf=w=>ratioK(w)/S.view.pxPerFt;
function scaleHint(r){ return S.units==='metric'?`${+(1000/r).toFixed(2)} cm per 10 m`:`${+(1200/r).toFixed(2)} in per 100 ft`; }
function renderScale(w){ const sel=$('scaleSel'), r=ratioOf(w), std=SCALES[S.units]; const hit=std.find(x=>Math.abs(x/r-1)<0.03);
  const opts=std.map(x=>`<option value="${x}">1:${x.toLocaleString()} · ${scaleHint(x)}</option>`); if(!hit) opts.unshift(`<option value="${r}">1:${Math.round(r).toLocaleString()}</option>`);
  setHTML(sel,opts.join('')); sel.value=String(hit||r); }
function setRatio(r,anchorPx){ const w=viewWells()[0]; zoomTo(ratioK(w)/r,anchorPx); }
function zoomTo(px,anchorPx){ const sc=$('logScroll'); const a=anchorPx??sc.clientHeight/2; const depthAt=S.view.top+(sc.scrollTop+a)/S.view.pxPerFt;
  S.view.pxPerFt=Math.min(20,Math.max(0.01,px)); render(); sc.scrollTop=(depthAt-S.view.top)*S.view.pxPerFt-a; S.view.scroll=sc.scrollTop; }
function stepScale(dir){ const r=ratioOf(viewWells()[0]), std=SCALES[S.units]; const next=dir>0?[...std].reverse().find(x=>x<r*0.97):std.find(x=>x>r*1.03); if(next) setRatio(next); }
$('scaleSel').onchange=e=>setRatio(+e.target.value);
$('zoomIn').onclick=()=>stepScale(1); $('zoomOut').onclick=()=>stepScale(-1);
$('logScroll').addEventListener('wheel',e=>{ if(!(e.ctrlKey||e.metaKey)) return; e.preventDefault(); const yIn=e.clientY-$('logScroll').getBoundingClientRect().top; zoomTo(S.view.pxPerFt*(e.deltaY<0?1.2:1/1.2),yIn); },{passive:false});
$('logScroll').addEventListener('scroll',()=>{ if(S.mode!=='stats') S.view.scroll=$('logScroll').scrollTop; },{passive:true});
$('btnPick').onclick=()=>{ if(!$('topName').value.trim()){ $('topName').focus(); return; } S.picking=!S.picking; $('btnPick').classList.toggle('primary',S.picking); render(); };

/* ---------- Browser cache of opened LAS text (IndexedDB), so a session resumes without re-picking files ---------- */
const lasCache={ db:null,
  open(){ return this.db||(this.db=new Promise((res,rej)=>{ try{ const r=indexedDB.open('weller',1); r.onupgradeneeded=()=>r.result.createObjectStore('las'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } })); },
  async put(name,text){ try{ const db=await this.open(); db.transaction('las','readwrite').objectStore('las').put({text,at:Date.now()},name); }catch(e){} },
  async get(name){ try{ const db=await this.open(); return await new Promise((res,rej)=>{ const r=db.transaction('las').objectStore('las').get(name); r.onsuccess=()=>res(r.result?.text||null); r.onerror=()=>rej(r.error); }); }catch(e){ return null; } } };

/* ---------- Files: one Open for LAS, projects, tops CSV and point-data CSV; drag and drop anywhere ---------- */
const OPEN_TYPES=[{description:'Well data',accept:{'text/plain':['.las','.LAS','.txt','.csv'],'application/json':['.lasproj','.json']}}];
$('btnOpen').onclick=async()=>{ if(window.showOpenFilePicker){ try{ const hs=await showOpenFilePicker({multiple:true,types:OPEN_TYPES}); const files=[]; for(const h of hs) files.push({...await readPicked(await h.getFile()),handle:h}); openFiles(files); }catch(e){} } else $('fileIn').click(); };
$('fileIn').onchange=async e=>{ const files=[]; for(const f of e.target.files) files.push(await readPicked(f)); openFiles(files); e.target.value=''; };
async function readPicked(f){ return {name:f.name,text:await f.text(),bytes:new Uint8Array(await f.slice(0,16).arrayBuffer())}; }
// Binary files and log formats (DLIS, PDF, TIFF…) go to the LAS reader, which says what they are instead of failing as CSV.
function kindOf(f){ const t=f.text.trimStart(); if(/\.(lasproj|json)$/i.test(f.name)||t[0]==='{') return 'project';
  if(t[0]==='~'||/\.(las|dlis|lis|tif|tiff|pdf|xlsx?|zip)$/i.test(f.name)||/^#[^\n]*\n\s*~/.test(t)||WellerLAS.sniffBinary(f.text,f.name,f.bytes)) return 'las'; return isTopsCSV(f.text)?'tops':'points'; }
async function openFiles(files){ const by={project:[],las:[],tops:[],points:[]}; for(const f of files) by[kindOf(f)].push(f); const report=[];
  const other=(f,fn)=>{ try{ report.push({file:f.name,status:'loaded',note:fn(),problems:[]}); }catch(err){ report.push({file:f.name,status:'failed',problems:[{level:'error',cat:'Parsing',title:err.message}]}); } };
  for(const f of by.project){ try{ await loadProject(JSON.parse(f.text)); if(f.handle) S.fileHandle=f.handle; report.push({file:f.name,status:'loaded',note:'Project loaded',problems:[]}); }
    catch(err){ report.push({file:f.name,status:'failed',problems:[{level:'error',cat:err instanceof SyntaxError?'Parsing':'File type',title:err instanceof SyntaxError?'Not valid JSON: '+err.message:err.message,fix:'Open a .lasproj saved by Weller Logs.'}]}); } }
  if(by.las.length) report.push(...addLASFiles(by.las));
  for(const f of by.tops) other(f,()=>importTopsCSV(f.text));
  for(const f of by.points) other(f,()=>'Points: '+importPointsCSV(f.text,f.name));
  render(); showImportSummary(report); }

/* ---------- Wells built from several LAS files. w.parts holds the normalized files; a one-file well is its own part. ---------- */
const partsOf=w=>w.parts||[w];
const sourcesOf=w=>partsOf(w).map(p=>p.fileName).filter(Boolean);
const apiOf=w=>WellerLAS.apiKey(w?.api);
const HEAD_KEYS=['name','api','field','company','county','state'];
// prefer 'prev': header values edited in the app win (merging). 'parts': the files win (re-opening a corrected file).
function rebuildWell(prev,parts,prefer='prev'){ const m=WellerLAS.mergeWells(parts); for(const k of Object.keys(m)) if(k[0]==='_') delete m[k];
  delete m.parts; delete m.demo; m.interpNotes=[]; m.fileName=parts[0].fileName; if(parts.length===1&&parts[0].demo) m.demo=parts[0].demo;
  if(prev){ m.id=prev.id; const ok=v=>v!==undefined&&v!==null&&v!==''&&!(typeof v==='number'&&!Number.isFinite(v));
    for(const k of HEAD_KEYS) if(ok(prev[k])&&(prefer==='prev'||!ok(m[k]))) m[k]=prev[k];
    for(const g of ['location','elevation']) for(const [k,v] of Object.entries(prev[g]||{})) if(ok(v)&&(prefer==='prev'||!ok(m[g][k]))) m[g][k]=v;
    const tops=[...(prev.tops||[])]; for(const t of m.tops) if(!tops.some(x=>x.name===t.name)) tops.push(t); m.tops=tops;
    m.curves.push(...prev.curves.filter(c=>c.sparse&&!m.curves.some(x=>x.mnemonic===c.mnemonic))); if(prev.pick) m.pick={...prev.pick}; }
  if(parts.length>1) m.parts=parts; return m; }
function replaceWell(old,nw){ const i=S.wells.indexOf(old); if(i>=0) S.wells[i]=nw; else S.wells.push(nw); }
function mergeInto(target,others){ const nw=rebuildWell(target,[...partsOf(target),...others.flatMap(partsOf)],'prev');
  S.wells=S.wells.filter(w=>!others.includes(w)); replaceWell(target,nw); S.panel=S.panel.filter(id=>wellById(id)); if(!wellById(S.selected)) S.selected=nw.id; computeInterp(nw); return nw; }
// Split a merged well back into one well per file (e.g. a sidetrack filed under the original hole's API).
function splitWell(w){ const parts=partsOf(w); if(parts.length<2) return [w]; const ids=new Set(S.wells.map(x=>x.id));
  const out=parts.map((p,i)=>{ const nw=rebuildWell(null,[p]); nw.id=i===0?w.id:(!ids.has(p.id)&&p.id!==w.id?p.id:'u'+Math.random().toString(36).slice(2,8)); ids.add(nw.id); computeInterp(nw); return nw; });
  const i=S.wells.indexOf(w); S.wells.splice(i,1,...out); return out; }

// Curve families (GR, ROP, …) with more than one matching curve in a well: the user picks, or shows all.
function curveChoices(w){ const seen=new Set(), out=[];
  for(const t of S.tracks) for(const c of t.curves||[]){ if(t.type==='lithpct'||t.type==='flags'||!c.aliases) continue; const k=famKey(c); if(seen.has(k)) continue; seen.add(k);
    const list=curveCandidates(w,c).filter(x=>!x.computed&&!x.sparse); if(list.length>1) out.push({key:k,cfg:c,label:c.label||k,list,current:resolveCurve(w,c)}); }
  return out; }
function curveWhere(w,c){ const d=depthOf(w); let a=-1,b=-1; for(let i=0;i<d.length;i++) if(Number.isFinite(c.data[i])){ if(a<0) a=i; b=i; }
  const src=(c.sources||[w.fileName]).filter(Boolean).join(' + ');
  return `${c.mnemonic}${c.unit?' ('+c.unit+')':''} ${a<0?'no data':fmtD(d[a],w)+'–'+fmtD(d[b],w)+' '+dispU()}${c.cased?', cased hole':''}${src?', '+src:''}`; }
function addLASFiles(files){ const report=[], touched=[], fresh=new Set(), auto=lsGet('weller.autoMerge',true);
  for(const f of files){ const r={file:f.name,problems:[]}; report.push(r);
    try{ const dx=WellerLAS.diagnoseLAS(f.text,f.name,f.bytes); r.problems=dx.problems; if(dx.problems.some(p=>p.level==='error')){ r.status='failed'; continue; }
      const part=normalizeWell(dx.parsed,f.name); if(f.demo) part.demo=f.demo; if(!f.demo) lasCache.put(f.name,f.text);
      const key=WellerLAS.apiKey(part.api), same=S.wells.find(w=>sourcesOf(w).includes(f.name)); let w;
      if(same){ w=rebuildWell(same,partsOf(same).map(p=>p.fileName===f.name?part:p),'parts'); replaceWell(same,w); r.status='reloaded';
        r.problems.push({level:'info',cat:'Merge',title:`Replaced the earlier copy of ${f.name} in ${w.name}`}); }
      else{ let target=auto&&key&&S.wells.find(w=>apiOf(w)?.key===key.key), how=target&&`same borehole, API ${WellerLAS.fmtApi(key)}`;
        // No API on one side: the same well name is enough, unless the other file's API says a different borehole.
        if(auto&&!target){ const nk=WellerLAS.nameKey(part.name); target=nk&&S.wells.find(w=>WellerLAS.nameKey(w.name)===nk&&!(key&&apiOf(w)&&apiOf(w).key!==key.key));
          if(target) how=`same well name${key?'':' (this file has no API)'}${apiOf(target)?'':' (the open well has no API)'}`; }
        if(target){ w=rebuildWell(target,[...partsOf(target),part],'prev'); replaceWell(target,w); r.status='merged';
          const mine=(w.notes||[]).filter(n=>n.includes(f.name));
          r.problems.push({level:'info',cat:'Merge',title:`Merged into ${w.name} (${sourcesOf(w).length} files): ${how}`,detail:mine.join(' · ')||'',fix:'Wrong hole? Split it in Manage wells.'}); }
        else{ w=part; w.sources=[f.name]; S.wells.push(w); fresh.add(w.id); r.status='loaded';
          const sib=key?.us&&S.wells.find(o=>o!==w&&apiOf(o)?.well===key.well);
          if(sib){ const kb=apiOf(sib).bore; if(sib.name===w.name&&key.bore!=='00'&&!/\bST\s*\d|SIDETRACK/i.test(w.name)) w.name+=' ST'+key.bore;
            r.problems.push({level:'info',cat:'Merge',title:`Kept apart from ${sib.name}: wellbore ${key.bore} vs ${kb}`,detail:`Same well (API ${key.well}), different borehole code, so a sidetrack or re-drill${key.explicitBore?'':'; a 10-digit API counts as the original hole (00)'}.`,fix:'Same hole after all? Select both in Manage wells and Merge.'}); }
          else if(!key) r.problems.push({level:'info',cat:'Header',title:'No API or UWI in ~Well: files of this well are matched by name only',fix:'Set the API in well settings, or merge by hand in Manage wells.'}); } }
      touched.push(w.id); r.well=w.name; r.wid=w.id; computeInterp(w);
      if(!Number.isFinite(w.location.lat)) r.problems.push({level:'info',cat:'Header',title:'No location in header, not on map'});
      if(w.elevation.kb===undefined) r.problems.push({level:'info',cat:'Header',title:'No KB elevation, TVDSS unavailable'});
      const conv=part.curves.filter(c=>c.note).map(c=>c.mnemonic+' '+c.note); if(conv.length) r.problems.push({level:'info',cat:'Parsing',title:conv.join(', ')});
      const corr=(part.notes||[]).filter(n=>/ignored|corrected/.test(n)), info=(part.notes||[]).filter(n=>!corr.includes(n));
      if(corr.length) r.problems.push({level:'warn',cat:'Header',title:corr.join(', ')}); if(info.length) r.problems.push({level:'info',cat:'Header',title:info.join(', ')});
    }catch(err){ r.status='failed'; r.problems.push({level:'error',cat:'Parsing',title:'Unexpected error while reading: '+err.message,fix:'Please report this file; it passed the checks but the reader failed.'}); } }
  // New wells join the list west to east, after the wells already open.
  const added=S.wells.filter(w=>fresh.has(w.id));
  if(added.length){ const sorted=sortWestEast(added); S.wells=[...S.wells.filter(w=>!fresh.has(w.id)),...sorted]; }
  const first=touched.map(wellById).find(Boolean);
  if(first){ S.selected=first.id; if(S.mode==='corr'&&!S.panel.includes(first.id)) S.panel.push(first.id); if(S.mode!=='stats') fitView(); }
  return report; }

/* ---------- Import report: per file, what loaded, what merged, and why anything failed ---------- */
let lastReport=[];
const STATUS={loaded:'Loaded',merged:'Merged',reloaded:'Reloaded',failed:'Not loaded'};
function showImportSummary(report,auto=true){ lastReport=report; if(!report.length) return;
  const fail=report.filter(r=>r.status==='failed').length, wells=new Set(report.map(r=>r.wid).filter(Boolean)).size;
  $('stNote').innerHTML=esc(`${report.length} file${report.length>1?'s':''}`+(wells?` → ${wells} well${wells>1?'s':''}`:'')+(fail?`, ${fail} not loaded`:''))+' <button class="small" id="btnImpDetails">Summary</button>';
  if(auto) openImportReport(); }
function snipHTML(sn){ return `<pre class="snip">${sn.map(x=>{ const t=esc(String(x.text??'').replace(/\t/g,' ').slice(0,160)); const body=x.mark?t.replace(esc(x.mark),`<mark>${esc(x.mark)}</mark>`):t; return `<span class="ln">${x.line??''}</span>${body}`; }).join('\n')}</pre>`; }
const LV={error:'Error',warn:'Warning',info:'Note'};
const probHTML=p=>`<div class="prob ${p.level}"><div><span class="lv">${LV[p.level]}</span> <b>${esc(p.title)}</b>${p.line?` <span class="hint">line ${p.line}</span>`:''}</div>${p.detail?`<div class="hint">${esc(p.detail)}</div>`:''}${p.snippet?.length?snipHTML(p.snippet):''}${p.fix?`<div class="fix"><b>Fix:</b> ${esc(p.fix)}${p.template?' See the minimal LAS below.':''}</div>`:''}</div>`;
function openImportReport(){ const R=lastReport, failed=R.filter(r=>r.status==='failed'), other=R.filter(r=>!r.wid&&r.status!=='failed');
  const wells=[...new Set(R.map(r=>r.wid).filter(Boolean))].map(wellById).filter(Boolean);
  const nW=wells.length; $('impTitle').textContent=`Loaded ${R.length-failed.length} of ${R.length} file${R.length>1?'s':''}`+(nW?` into ${nW} well${nW>1?'s':''}`:'');
  const failHTML=failed.map(r=>{ const e=r.problems.find(p=>p.level==='error')||r.problems[0]; return `<section class="imp failed"><div class="imph"><span class="chip failed">Not loaded</span><b>${esc(r.file)}</b></div>${e?probHTML(e):''}</section>`; }).join('');
  const wellHTML=wells.map(w=>{ const mine=R.filter(r=>r.wid===w.id), files=mine.map(r=>r.file);
    const how=mine.map(r=>r.problems.find(p=>p.cat==='Merge'&&p.level==='info')).filter(Boolean).map(p=>p.title.replace(/^Merged into [^:]*: /,'')), merged=mine.some(r=>r.status==='merged');
    const missing=[!Number.isFinite(w.location.lat)&&'location (for the map)',!Number.isFinite(WellerLAS.datumElevation(w))&&'KB or GL elevation (for ssTVD)'].filter(Boolean);
    const warns=mine.flatMap(r=>r.problems.filter(p=>p.level==='warn').map(p=>({...p,file:r.file})));
    const notes=mine.flatMap(r=>r.problems.filter(p=>p.level!=='error').map(p=>({...p,file:r.file})));
    const ch=choicesHTML(w), hid=hiddenHTML(w), nLogs=w.curves.filter(c=>!c.computed&&!c.sparse).length-1;
    const todo=[ch&&`<div class="step"><b>Pick which curve to show</b> <span class="hint">this well has more than one of these; Auto is already applied</span>${ch}</div>`,
      hid&&`<div class="step"><b>Add to a track</b> <span class="hint">loaded but not shown anywhere yet</span><div class="chips">${hid}</div></div>`,
      missing.length&&`<div class="step"><b>Missing:</b> ${missing.join(', ')} <button class="small" data-wellset="${w.id}">Well settings</button></div>`,
      warns.length&&`<div class="step">${warns.map(p=>`<div class="prob warn"><span class="lv">Check</span> ${esc(p.title)} <span class="hint">${esc(p.file)}</span></div>`).join('')}</div>`].filter(Boolean).join('');
    return `<section class="imp"><div class="imph"><span class="chip ${merged?'merged':'loaded'}">${merged?'Merged':'Loaded'}</span><b>${esc(w.name)}</b><span class="hint">${nLogs} curves from ${files.length} file${files.length>1?'s':''}${how.length?' · '+esc([...new Set(how)].join('; ')):''}</span></div>
      ${todo||'<div class="hint">Nothing to do: every curve is in a track.</div>'}
      ${notes.length?`<details><summary>Details: files and ${notes.length} note${notes.length>1?'s':''}</summary><div class="hint">${files.map(esc).join(', ')}</div>${notes.map(p=>probHTML({...p,title:p.title+' ('+p.file+')'})).join('')}</details>`:''}</section>`; }).join('');
  const otherHTML=other.map(r=>`<section class="imp"><div class="imph"><span class="chip loaded">Loaded</span><b>${esc(r.file)}</b><span class="hint">${esc(r.note||'')}</span></div></section>`).join('');
  const failDetails=failed.some(r=>r.problems.length>1)?`<details><summary>Everything the reader found in the files that did not load</summary>${failed.map(r=>r.problems.map(p=>probHTML({...p,title:p.title+' ('+r.file+')'})).join('')).join('')}</details>`:'';
  $('impBody').innerHTML=failHTML+failDetails+wellHTML+otherHTML;
  const tpl=failed.length>0; $('impTpl').hidden=!tpl; if(tpl) $('impTpl').open=failed.some(r=>r.problems.some(p=>p.template));
  $('impDlg').hidden=false; }
$('impTplText').textContent=WellerLAS.LAS_TEMPLATE;
$('impClose').onclick=()=>{ $('impDlg').hidden=true; };
document.addEventListener('click',e=>{ if(e.target.id==='btnImpDetails') openImportReport(); if(e.target.closest('#impDlg [data-wellset]')) $('impDlg').hidden=true; });
let dragDepth=0;
addEventListener('dragenter',e=>{ if(e.dataTransfer?.types?.includes('Files')){ dragDepth++; document.body.classList.add('dropping'); } });
addEventListener('dragleave',()=>{ if(--dragDepth<=0){ dragDepth=0; document.body.classList.remove('dropping'); } });
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',async e=>{ e.preventDefault(); dragDepth=0; document.body.classList.remove('dropping'); const files=[]; for(const f of e.dataTransfer.files) files.push(await readPicked(f)); if(files.length) openFiles(files); });

/* ---------- Project save / load / autosave ---------- */
function projectJSON(){ return { version:3, app:'weller-logs', savedAt:new Date().toISOString(), mode:S.mode, selected:S.selected, panel:S.panel, datum:S.datum, views:S.views, tracks:S.tracks, hiddenPoints:S.hiddenPoints, stats:S.stats, basemap:S.basemap, interp:S.interp, corr:S.corr, topColors:S.topColors,
  wells:S.wells.map(w=>({id:w.id,name:w.name,api:w.api,field:w.field,company:w.company,county:w.county,state:w.state,preset:w.preset,demo:w.demo,fileName:w.fileName,pick:w.pick,files:partsOf(w).length>1?partsOf(w).map(p=>({fileName:p.fileName,demo:p.demo})):undefined,location:w.location,elevation:w.elevation,depthUnit:w.depthUnit,tops:w.tops,points:pointsJSON(w),curveList:w.curves.filter(c=>!c.sparse).map(c=>c.mnemonic)})) }; }
async function loadProject(p){ if(!p||p.app!=='weller-logs') throw new Error('not a Weller Logs project'); const missing=[];
  // A file may be a well on its own or one part of a merged well; find it wherever it is now.
  const findPart=fn=>{ for(const w of S.wells){ const ps=partsOf(w); if(ps.length===1&&w.fileName===fn) return w; const q=ps.find(q=>q.fileName===fn); if(q) return q; } return null; };
  const fromCache={}; for(const r of p.wells){ if(r.preset) continue; for(const f of r.files||[{fileName:r.fileName,demo:r.demo}]){ if(!f.fileName||findPart(f.fileName)||fromCache[f.fileName]) continue;
    const text=f.demo?await fetchText('data/'+f.demo):await lasCache.get(f.fileName); if(text){ try{ const w=normalizeWell(parseLAS(text),f.fileName); if(f.demo) w.demo=f.demo; fromCache[f.fileName]=w; }catch(e){} } } }
  const getPart=fn=>findPart(fn)||fromCache[fn];
  const byFiles=fs=>S.wells.find(w=>sourcesOf(w).join('\n')===fs.join('\n'));
  S.wells=p.wells.map(ref=>{ if(ref.preset){ const cfg=WellerSynth.PRESET_WELLS.find(c=>c.id===ref.preset); const w=presetWell(cfg); w.tops=ref.tops; w.elevation=ref.elevation; restorePoints(w,ref.points); return w; }
    let live;
    if(ref.files){ const fs=ref.files.map(f=>f.fileName); live=byFiles(fs); if(!live){ const parts=fs.map(getPart); if(parts.some(x=>!x)){ missing.push(...fs.filter((f,i)=>!parts[i])); return null; } live=rebuildWell(null,parts); } }
    else live=byFiles([ref.fileName])||getPart(ref.fileName);
    if(live){ if(ref.demo) live.demo=ref.demo; Object.assign(live,{tops:ref.tops,elevation:ref.elevation,location:ref.location,name:ref.name,api:ref.api,field:ref.field,id:ref.id,pick:ref.pick,_grP:null}); for(const k of ['company','county','state']) if(ref[k]!==undefined) live[k]=ref[k]; restorePoints(live,ref.points); return live; } missing.push(ref.fileName||ref.name); return null; }).filter(Boolean);
  S.tracks=migrateTracks(p.tracks); S.views=p.views||newViews(); S.view=S.views[viewKey(S.mode)]||S.views.single; S.datum=p.datum||'MD'; S.topColors=p.topColors||S.topColors; S.hiddenPoints=p.hiddenPoints||[]; S.stats={...statsDefaults(),...(p.stats||{})}; S.interp={...interpDefaults(),...(p.interp||{})}; S.corr={...S.corr,...(p.corr||{})}; if(!p.tracks.some(t=>t.id==='t8')) S.tracks=[...p.tracks,...defaultTracks().filter(t=>['t8','t9','t10','t11','t12'].includes(t.id))]; setBasemap(p.basemap||'map'); if((p.version||1)<2) pointSeriesNames().forEach(placePointSeries); S.panel=(p.panel||[]).filter(id=>wellById(id));
  // Older projects kept section order separately: move those wells into that order within the list.
  if((p.version||1)<3){ const pos=S.wells.map((w,i)=>S.panel.includes(w.id)?i:-1).filter(i=>i>=0); S.panel.forEach((id,k)=>{ S.wells[pos[k]]=wellById(id); }); } S.selected=wellById(p.selected)?p.selected:(S.wells[0]?.id||null);
  computeAllInterp(); setMode(p.mode||'single'); $('stNote').textContent=missing.length?`Re-open these LAS files to restore them: ${missing.join(', ')}`:'Project loaded'; }
function autosave(){ try{ localStorage.setItem('weller.session',JSON.stringify(projectJSON())); }catch(e){} recordHistory(); }
/* Undo and redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z or Ctrl+Y). Each render compares an edit snapshot with the last one.
   View, mode and selection are left out, so zooming or switching tabs is not an undo step. */
const HIST={undo:[],redo:[],last:null,busy:false};
function editSnapshot(){ const p=projectJSON(); delete p.savedAt; delete p.views; delete p.mode; delete p.selected; return JSON.stringify(p); }
function recordHistory(){ if(HIST.busy||S.drag) return; const snap=editSnapshot(); if(snap===HIST.last) return;
  if(HIST.last!==null){ HIST.undo.push(HIST.last); if(HIST.undo.length>60) HIST.undo.shift(); HIST.redo=[]; } HIST.last=snap; }
async function stepHistory(back){ const from=back?HIST.undo:HIST.redo, to=back?HIST.redo:HIST.undo; if(!from.length||HIST.busy){ $('stNote').textContent=back?'Nothing to undo':'Nothing to redo'; return; }
  const snap=from.pop(); to.push(HIST.last); HIST.busy=true;
  try{ const p={...JSON.parse(snap),views:S.views,mode:S.mode,selected:S.selected}; S.wells.forEach(w=>w._grP=null); await loadProject(p); HIST.last=snap; $('stNote').textContent=(back?'Undone':'Redone')+` · ${HIST.undo.length} more to undo`; }
  finally{ HIST.busy=false; } }
document.addEventListener('keydown',e=>{ if(!(e.metaKey||e.ctrlKey)) return; const k=e.key.toLowerCase(); if(k!=='z'&&k!=='y') return;
  const el=e.target; if(el.matches?.('textarea,input[type=text],input:not([type])')) return;   // native text undo
  e.preventDefault(); if(el.blur&&el!==document.body) el.blur(); stepHistory(k==='z'&&!e.shiftKey); });
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
  if(name==='labasin'){ S.tracks=loadTrackDefaults(); S.views=newViews(); loadPresets(); S.wells=sortWestEast(S.wells); S.mode='single'; setMode('single'); exampleNote('Synthetic LA Basin wells loaded'); return true; }
  $('stNote').textContent='Loading Denver Basin Niobrara logs…';
  const texts=await Promise.all(NIOBRARA_FILES.map(f=>fetchText('data/niobrara/'+f)));
  if(texts.some(t=>!t)){ $('stNote').textContent='Could not load the example logs (open the app from a web server, not a file).'; return false; }
  S.wells=[]; S.tracks=loadTrackDefaults(); S.hiddenPoints=[]; S.views=newViews();
  // Example parameters. Rw: max specific conductance 61.3 mS/cm at 25 C in Niobrara produced water, Weld County
  // (USGS data release doi:10.5066/P14CRSQQ); late-time samples approach formation water, giving Rw 0.16 ohm.m at 77 F.
  S.interp={...interpDefaults(),matrix:'auto',swPhi:'total',rw:0.16,rwTemp:77,
    source:'Example Rw 0.16 Ω·m at 77 °F, from Weld County Niobrara produced water (USGS doi:10.5066/P14CRSQQ)', sourceSw:'Sw on total porosity, usual for chalk-marl source rocks'};
  const rep=addLASFiles(NIOBRARA_FILES.map((f,i)=>({name:f,text:texts[i],demo:'niobrara/'+f}))); lastReport=rep;
  const notes=rep.filter(r=>r.status==='failed').map(r=>`${r.file}: ${r.problems[0]?.title}`);
  const tops=await fetchText('data/niobrara/tops.csv'); if(tops) importTopsCSV(tops);
  computeAllInterp();
  // Verticals west to east through the pad, then the Weld County horizontal, which lies ~30 mi south.
  const horiz=S.wells.find(w=>w.survey), vert=sortWestEast(S.wells.filter(w=>w!==horiz));
  S.wells=[...vert,horiz].filter(Boolean);
  S.panel=[vert[0],vert[1],vert[3],vert[5],vert[6],horiz].filter(Boolean).map(w=>w.id); S.selected=(vert[3]||S.wells[0]).id;
  S.datum='Niobrara'; S.stats={...statsDefaults(),curve:'PHI',x:'NPHI',y:'RHOB',type:'nd'}; S.mode='corr'; setMode('corr');
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
(async()=>{ if(!(await loadExample('niobrara'))){ loadPresets(); fitView(); } undoProject=null; HIST.undo=[]; HIST.redo=[]; HIST.last=editSnapshot(); })();

/* ---------- About, popouts and theme ---------- */
function placePop(pop,anchor){ pop.hidden=false; const r=anchor.getBoundingClientRect(); pop.style.top=(r.bottom+8)+'px'; pop.style.left=Math.max(16,Math.min(r.right-pop.offsetWidth,innerWidth-pop.offsetWidth-16))+'px'; }
$('btnAbout').onclick=e=>{ e.stopPropagation(); const p=$('aboutPop'); p.hidden?placePop(p,e.currentTarget):(p.hidden=true); };
document.addEventListener('click',e=>{ if(e.target.closest('[data-close]')){ e.target.closest('.pop').hidden=true; return; }
  if(e.target.closest('#btnNotes,#btnAbout')) return;
  document.querySelectorAll('.pop:not([hidden])').forEach(p=>{ if(!p.contains(e.target)) p.hidden=true; }); });
document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return; document.querySelectorAll('.pop:not([hidden])').forEach(p=>p.hidden=true);
  const open=[...document.querySelectorAll('.modal:not([hidden])')].filter(m=>m.id!=='resume'); const top=open[open.length-1]; if(top){ e.preventDefault(); top.hidden=true; } });
function setTheme(t){ if(t==='dark') document.documentElement.dataset.theme='dark'; else delete document.documentElement.dataset.theme; try{ localStorage.setItem('weller.theme',t); }catch(e){} }
$('btnTheme').onclick=()=>{ setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'); render(); };
/* Sidebar width: drag the gutter, double-click to reset. Long well names get room without a wider default. */
{ const side=document.querySelector('.side'), g=$('sideGutter'); const setW=w=>{ side.style.width=Math.max(240,Math.min(innerWidth*0.6,w))+'px'; };
  const saved=lsGet('weller.sideW',null); if(saved) setW(saved);
  g.addEventListener('pointerdown',e=>{ e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('on'); const x0=e.clientX, w0=side.offsetWidth;
    const move=ev=>setW(w0+ev.clientX-x0), up=()=>{ g.classList.remove('on'); g.removeEventListener('pointermove',move); g.removeEventListener('pointerup',up); lsSet('weller.sideW',side.offsetWidth); };
    g.addEventListener('pointermove',move); g.addEventListener('pointerup',up); });
  g.addEventListener('dblclick',()=>{ side.style.width=''; try{ localStorage.removeItem('weller.sideW'); }catch(e){} }); }
