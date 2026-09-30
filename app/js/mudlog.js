/* Weller Logs: Mudlogs tab (beta). PDF and TIFF mudlogs as image strips hung in measured depth, with depth
   calibration, formation picks shared with LAS wells, and an optional LAS curve drawn over the strip.
   Images are cut into bands at import and kept in IndexedDB; the view draws only the bands on screen, from a
   quarter-resolution copy when zoomed out, so a long log costs about as much as a short one.
   Depends on core.js globals: S, $, esc, render, wellById, zoneColorMap, depthOf, wgs84Of, downloadBlob. */
(function(){
'use strict';
const CAL=WellerMudCal;
const WARN_MB=35, MAX_PANEL=8, BAND=2048, LO_F=4, MAX_W=2000, PDF_DPI=160;
const HEAD=50, RULER=40, GAP=34, PADL=12;
const FT_PER_M=1/0.3048;
const PAL=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#4a3aa7','#8c6d31','#17becf'];

const DEFAULT_RATIO=2400;
const M={ logs:[], panel:[], sel:null, hang:'MD', pxPerFt:1152/DEFAULT_RATIO, goto:null, z0:null, tool:'view', trackW:280, topName:'', cal:{scale:null}, cursor:null, warn:'' };
const byId=id=>M.logs.find(m=>m.id===id);
const panelLogs=()=>M.panel.map(byId).filter(Boolean);
const selLog=()=>byId(M.sel);

/* ---------- Storage: IndexedDB 'weller-mud'. bands: "id/level/page/idx" -> Blob; logs: id -> {complete, file} ---------- */
const db={ p:null,
  open(){ return this.p||(this.p=new Promise((res,rej)=>{ const r=indexedDB.open('weller-mud',1); r.onupgradeneeded=()=>{ r.result.createObjectStore('bands'); r.result.createObjectStore('logs'); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); },
  async run(store,mode,fn){ const d=await this.open(); return new Promise((res,rej)=>{ const t=d.transaction(store,mode), q=fn(t.objectStore(store)); t.oncomplete=()=>res(q&&'result' in q?q.result:undefined); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }); },
  put(store,k,v){ return this.run(store,'readwrite',s=>s.put(v,k)); },
  get(store,k){ return this.run(store,'readonly',s=>s.get(k)); },
  drop(id){ return Promise.all([this.run('bands','readwrite',s=>s.delete(IDBKeyRange.bound(id+'/',id+'/￿'))),this.run('logs','readwrite',s=>s.delete(id))]); } };
const bandKey=(m,level,page,idx)=>`${m.id}/${level}/${page}/${idx}`;

/* Decoded bands, least recently used first, capped at ~90 megapixels (~360 MB). Bands drawn in this frame or the
   last are never evicted: evicting a band the screen still needs makes it reload every frame, which flashes. */
const cache=new Map(); let cachePx=0, frameNo=0; const CACHE_PX=90e6;
function bitmap(key){ const e=cache.get(key); if(e){ e.f=frameNo; cache.delete(key); cache.set(key,e); return e.bmp; }
  const n={bmp:null,f:frameNo}; cache.set(key,n);
  db.get('bands',key).then(b=>b?createImageBitmap(b):null).then(bmp=>{ if(!bmp){ n.missing=true; return; } if(cache.get(key)!==n){ bmp.close(); return; } n.bmp=bmp; cachePx+=bmp.width*bmp.height; trim(); schedule(); }).catch(()=>{ n.missing=true; });
  return null; }
function peek(key){ const e=cache.get(key); if(e) e.f=frameNo; return e&&e.bmp; }
function trim(){ for(const [k,e] of cache){ if(cachePx<=CACHE_PX) break; if(e.f>=frameNo-1) continue; if(e.bmp){ cachePx-=e.bmp.width*e.bmp.height; e.bmp.close(); } cache.delete(k); } }
function evict(id){ for(const [k,e] of cache) if(k.startsWith(id+'/')){ if(e.bmp){ cachePx-=e.bmp.width*e.bmp.height; e.bmp.close(); } cache.delete(k); } }

/* ---------- Import ---------- */
let queue=Promise.resolve();
// "040373058000 WEZU 24F Mud Log.pdf": a leading 10, 12 or 14 digit API.
function apiFromName(f){ const m=f.match(/^(\d{2})(\d{3})(\d{5})(\d{2})?(\d{2})?(?=\D|$)/); return m?m.slice(1).filter(Boolean).join('-'):undefined; }
const niceName=f=>f.replace(/\.(pdf|tiff?)$/i,'').replace(/^[0-9a-f]{8}-/i,'').replace(/[_]+/g,' ').replace(/\s{2,}/g,' ').trim();
function openFiles(files,force){
  files=[...files].filter(f=>/\.(pdf|tiff?)$/i.test(f.name)); if(!files.length) return;
  const big=force?[]:files.filter(f=>f.size>WARN_MB*1048576), ok=files.filter(f=>!big.includes(f));
  M.warn=big.length?{files:big,text:`${big.map(f=>`${f.name} (${Math.round(f.size/1048576)} MB)`).join(', ')} ${big.length>1?'are':'is'} over ${WARN_MB} MB. Large scans take longer to cut into strips and use more memory while they do; the view stays fast once they are stored.`}:'';
  for(const f of ok) addFile(f);
  if(S.mode!=='mud') setModeMud(); else render();
}
function setModeMud(){ document.querySelector('[data-mode="mud"]')?.click(); }
function addFile(f){
  let m=M.logs.find(x=>x.file&&x.file.name===f.name&&x.file.size===f.size);
  if(m&&m.status==='ready'){ M.sel=m.id; return; }
  if(!m){ const api=apiFromName(f.name); m={id:'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:niceName(f.name).replace(/^\d{10,14}[\s_-]*/,'')||niceName(f.name),api,kind:/\.pdf$/i.test(f.name)?'pdf':'tiff',file:{name:f.name,size:f.size},pages:[],picks:[],crop:[0,1],unit:'ft',useText:true};
    M.logs.push(m); if(M.panel.length<MAX_PANEL) M.panel.push(m.id); }
  M.sel=m.id; m.status='queued'; m.progress='Waiting';
  queue=queue.then(()=>processFile(m,f)).catch(()=>{});
}
async function processFile(m,f){
  const t0=performance.now(); m.status='processing'; m.progress='Reading'; sideSoon();
  try{ try{ navigator.storage?.persist?.(); }catch(e){}
    await db.drop(m.id); evict(m.id);
    const keepTies=m.pages.map(p=>({ties:p.ties||[],skip:p.skip}));
    if(m.kind==='pdf') await processPdf(m,f); else await processTiff(m,f);
    if(!M.logs.includes(m)){ await db.drop(m.id); evict(m.id); return; }   // removed while it was being read
    // Re-opening a file keeps the depth ties and skips made before.
    m.pages.forEach((p,i)=>{ if(keepTies[i]){ p.ties=keepTies[i].ties; if(keepTies[i].skip!==undefined) p.skip=keepTies[i].skip; } });
    await db.put('logs',m.id,{complete:true,file:m.file,at:Date.now()});
    m.status='ready'; m.progress=''; m.ms=Math.round(performance.now()-t0); m._sol=null;
    if(!calState(m).ok&&M.sel===m.id&&S.mode==='mud'&&M.tool!=='calib'){ const sc=$('mudScroll'); M.viewZ=M.z0!=null?zOfY(HEAD+(sc.clientHeight-HEAD)/2):null; M.tool='calib'; M.cal.scale=null; sc.scrollTop=0; }
    autoLink(m); if(M.panel.length===1&&M.panel[0]===m.id) M.goto='top';
  }catch(err){ m.status='failed'; m.progress=err.message||String(err); console.error(err); }
  render();
}
function script(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>rej(new Error('Could not load '+src)); document.head.appendChild(s); }); }
async function pdfLib(){ if(!window.pdfjsLib){ await script('vendor/pdf.min.js'); pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js'; } return window.pdfjsLib; }
async function encode(cv){ const b=await new Promise(r=>cv.toBlob(r,'image/webp',0.82)); return b&&b.type==='image/webp'?b:await new Promise(r=>cv.toBlob(r,'image/jpeg',0.85)); }
const canvas=(w,h)=>{ const c=document.createElement('canvas'); c.width=Math.max(1,w); c.height=Math.max(1,h); return c; };

// Quarter-resolution overview: every LO_F full bands make one overview band.
function overview(m,p,w){ const lo=canvas(Math.max(1,Math.round(w/LO_F)),BAND), lc=lo.getContext('2d'); lc.imageSmoothingQuality='high'; let idx=0, filled=0;
  const clear=()=>{ lc.fillStyle='#fff'; lc.fillRect(0,0,lo.width,BAND); }; clear();
  return { async add(cv,rows,last){ lc.drawImage(cv,0,0,cv.width,rows,0,Math.round(filled),lo.width,rows/LO_F); filled+=rows/LO_F;
      if(filled>=BAND-0.5||last){ const r=Math.ceil(filled); const out=r<BAND?crop(lo,r):lo; await db.put('bands',bandKey(m,1,p,idx++),await encode(out)); clear(); filled=0; } } }; }
function crop(cv,rows){ const c=canvas(cv.width,rows); c.getContext('2d').drawImage(cv,0,0); return c; }

async function processPdf(m,f){
  const lib=await pdfLib(); const doc=await lib.getDocument({data:new Uint8Array(await f.arrayBuffer()),isEvalSupported:false}).promise;
  m.pages=[]; m.header=null;
  for(let i=1;i<=doc.numPages;i++){ m.progress=`Page ${i} of ${doc.numPages}`; sideSoon();
    const page=await doc.getPage(i), v1=page.getViewport({scale:1}), dpi=Math.min(PDF_DPI,MAX_W/(v1.width/72)), sc=dpi/72, vp=page.getViewport({scale:sc});
    const W=Math.round(vp.width), H=Math.round(vp.height);
    const tc=await page.getTextContent();
    // Text boxes on the rendered page (after any /Rotate). Depth labels may be printed sideways, so every
    // orientation counts for the depth fit; the header reader takes upright text only.
    const items=[]; for(const t of tc.items){ if(!t.str||!t.str.trim()) continue; const q=lib.Util.transform(vp.transform,t.transform);
      const fh=Math.hypot(q[2],q[3]), len=t.width*sc, u=[q[0]/Math.hypot(q[0],q[1]),q[1]/Math.hypot(q[0],q[1])], v=[q[2]/fh,q[3]/fh], h=fh*0.75;
      const cx=q[4]+u[0]*len/2+v[0]*h/2, cy=q[5]+u[1]*len/2+v[1]*h/2, ex=Math.abs(u[0])*len+Math.abs(v[0])*h, ey=Math.abs(u[1])*len+Math.abs(v[1])*h;
      if(!Number.isFinite(cx+cy)) continue; items.push({s:t.str,x:cx-ex/2,y:cy-ey/2,w:ex,h:ey,up:u[0]>0.95}); }
    if(i<=2&&!m.header){ const top=items.filter(t=>t.up&&t.y<Math.min(H,W*1.4)); const h=CAL.parseHeader(top,{width:W}); if(Object.keys(h).length) m.header=h; }
    const fit=CAL.fitDepthLabels(items,{pxPerIn:dpi,width:W});
    const pg={w:W,h:H,dpi,ties:[],fit:fit?{a:fit.a,b:fit.b,n:fit.n,step:fit.step,yMin:fit.yMin,yMax:fit.yMax,x:fit.x,resid:+fit.resid.toFixed(2)}:null,text:items.length>0};
    m.pages.push(pg);
    const ov=overview(m,i-1,W), nb=Math.ceil(H/BAND);
    for(let b=0;b<nb;b++){ const r0=b*BAND, rows=Math.min(BAND,H-r0); const cv=canvas(W,rows), ctx=cv.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,rows);
      await page.render({canvasContext:ctx,viewport:page.getViewport({scale:sc,offsetY:-r0}),background:'#fff'}).promise;
      await db.put('bands',bandKey(m,0,i-1,b),await encode(cv)); await ov.add(cv,rows,b===nb-1);
      if(nb>1){ m.progress=`Page ${i} of ${doc.numPages} · strip ${b+1}/${nb}`; sideSoon(); } }
    page.cleanup(); }
  await doc.destroy();
  // Fits whose scale disagrees with the rest are header tables, not depth columns.
  const good=CAL.consistentFits(m.pages.map(p=>p.fit)); m.pages.forEach((p,i)=>{ if(!good[i]) p.fit=null; });
  const fitted=m.pages.filter(p=>p.fit).length;
  // With text calibration on most pages, pages without it are headers and legends: hide them.
  if(fitted>=Math.max(1,m.pages.length/2)) m.pages.forEach(p=>{ if(!p.fit) p.skip=true; });
  applyHeader(m);
}
function processTiff(m,f){ return new Promise(async(res,rej)=>{
  const wk=new Worker('js/mudworker.js'); const pending=[];
  wk.onerror=e=>{ wk.terminate(); rej(new Error(e.message||'TIFF worker failed')); };
  wk.onmessage=async e=>{ const d=e.data;
    if(d.type==='meta'){ m.pages=d.pages.map(p=>({w:p.w,h:p.h,dpi:d.dpi?d.dpi/p.f:null,src:[p.W,p.H],ties:[],fit:null})); m.header=null; }
    else if(d.type==='band') pending.push(db.put('bands',bandKey(m,d.level,d.page,d.idx),d.blob));
    else if(d.type==='progress'){ m.progress=d.stage==='decode'?`Decoding page ${d.page+1} of ${m.pages.length}`:`Page ${d.page+1} of ${m.pages.length} · strip ${d.done}/${d.of}`; sideSoon(); }
    else if(d.type==='done'){ wk.terminate(); await Promise.all(pending); res(); }
    else if(d.type==='error'){ wk.terminate(); rej(new Error(d.message)); } };
  wk.postMessage({buf:await f.arrayBuffer(),maxW:MAX_W,band:BAND,loF:LO_F}); }); }

function applyHeader(m){ const h=m.header||{};
  for(const k of ['company','field','county','state']) if(h[k]&&!m[k]) m[k]=h[k];
  if(h.name&&!h.nameHidden) m.name=h.name;
  if(h.api&&!m.api) m.api=h.api; if(Number.isFinite(h.kb)&&m.kb==null) m.kb=h.kb; if(Number.isFinite(h.gl)&&m.gl==null) m.gl=h.gl;
  if(h.location&&!m.location) m.location=h.location; if(h.unit) m.unit=h.unit; }
function autoLink(m){ if(m.wellId&&wellById(m.wellId)) return; const key=WellerLAS.apiKey(m.api), nm=normName(m.name);
  const w=S.wells.find(w=>key&&WellerLAS.apiKey(w.api)===key)||S.wells.find(w=>nm&&nm.length>3&&normName(w.name)===nm); if(w) link(m,w.id); }
// Linking moves the mudlog's own picks into the well's tops (a top the well already has wins); unlinking keeps
// the tops that were picked on the mudlog.
function link(m,id){ const prev=linked(m), w=id?wellById(id):null; if(prev===w) return;
  if(prev&&!w) m.picks=prev.tops.filter(t=>t.source==='mudlog').map(t=>({name:t.name,md:t.md/wK(prev)}));
  if(w){ for(const t of m.picks||[]) if(!w.tops.some(x=>x.name===t.name)) w.tops.push({name:t.name,md:t.md*wK(w),source:'mudlog'}); w.tops.sort((a,b)=>a.md-b.md); m.picks=[]; }
  m.wellId=w?w.id:null; }
const normName=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');

/* ---------- Depth: calibration, hang and picks ---------- */
const unitK=m=>m.unit==='m'?FT_PER_M:1;
function sol(m){ const key=JSON.stringify([m.unit,m.useText,m.pages.map(p=>[p.ties,p.skip,!!p.fit])]); if(m._sol&&m._solKey===key) return m._sol;
  const k=unitK(m), pages=m.pages.map(p=>({h:p.h,skip:!!p.skip,ties:p.ties||[],fit:m.useText!==false&&p.fit?{a:p.fit.a*k,b:p.fit.b*k}:null}));
  m._sol=CAL.solvePages(pages); m._solKey=key; return m._sol; }
// The part of each page to draw: text-calibrated pages lose their header and footer beyond one label step.
function pageSpans(m){ const s=sol(m), out=[];
  m.pages.forEach((p,i)=>{ const q=s[i]; if(!q||!q.segs) return; let y0=0, y1=p.h;
    if(p.fit&&m.useText!==false&&!(p.ties||[]).length){ const stepPx=(p.fit.step||0)/p.fit.b; y0=Math.max(0,p.fit.yMin-stepPx); const next=s[i+1]; if(next&&next.segs) y1=Math.min(p.h,p.fit.yMax+stepPx); }
    let md0=CAL.mdAt(q,y0), md1=CAL.mdAt(q,y1);
    if(m.show){ if(Number.isFinite(m.show[0])&&md0<m.show[0]){ y0=CAL.yAt(q,m.show[0]); md0=m.show[0]; } if(Number.isFinite(m.show[1])&&md1>m.show[1]){ y1=CAL.yAt(q,m.show[1]); md1=m.show[1]; } }
    if(y1>y0) out.push({i,q,y0,y1,md0,md1}); });
  return out; }
function mdRange(m){ const sp=pageSpans(m); if(!sp.length) return null; return [Math.min(...sp.map(s=>s.md0)),Math.max(...sp.map(s=>s.md1))]; }
function calState(m){ const s=sol(m); const n=s.filter(q=>q&&q.segs).length, bad=s.find(q=>q&&q.bad);
  return bad?{ok:false,text:bad.bad}:n?{ok:true,text:''}:{ok:false,text:'Needs depth: open Calibrate and click two depth lines'}; }
const linked=m=>m.wellId?wellById(m.wellId):null;
const wK=w=>w&&w.depthUnit==='m'?0.3048:1;   // well depth units per ft
function picksOf(m){ const w=linked(m); return w?w.tops.map(t=>({name:t.name,md:t.md/wK(w)})):(m.picks||[]); }
function setPick(m,name,md){ md=Math.round(md*10)/10; const w=linked(m);
  if(w){ const t=w.tops.find(t=>t.name===name); if(t) t.md=md*wK(w); else w.tops.push({name,md:md*wK(w),source:'mudlog'}); w.tops.sort((a,b)=>a.md-b.md); }
  else { m.picks=m.picks||[]; const t=m.picks.find(t=>t.name===name); if(t) t.md=md; else m.picks.push({name,md}); m.picks.sort((a,b)=>a.md-b.md); } }
function delPick(m,name){ const w=linked(m); if(w) w.tops=w.tops.filter(t=>t.name!==name); else m.picks=(m.picks||[]).filter(t=>t.name!==name); }
const pickMd=(m,name)=>picksOf(m).find(t=>t.name===name)?.md;
function elevOf(m){ const e=m.elevRef==='gl'?m.gl:(m.kb??m.gl); return Number.isFinite(e)?e:NaN; }
function zOf(m,md){ if(M.hang==='MD') return md; if(M.hang==='SS'){ const e=elevOf(m); return Number.isFinite(e)?md-e:NaN; } const p=pickMd(m,M.hang); return Number.isFinite(p)?md-p:NaN; }
function mdOfZ(m,z){ if(M.hang==='MD') return z; if(M.hang==='SS') return z+elevOf(m); return z+pickMd(m,M.hang); }
function hangNote(m){ if(M.hang==='SS'&&!Number.isFinite(elevOf(m))) return 'no KB or GL'; if(M.hang!=='MD'&&M.hang!=='SS'&&!Number.isFinite(pickMd(m,M.hang))) return 'no '+M.hang; return ''; }
function topColor(name){ const c=S.topColors?.[name]||(S._zc||zoneColorMap()).get?.(name); if(c) return c; let h=0; for(const ch of name) h=(h*31+ch.charCodeAt(0))>>>0; return PAL[h%PAL.length]; }
function allTopNames(){ const s=new Set(); for(const w of S.wells) for(const t of w.tops) s.add(t.name); for(const m of M.logs) for(const t of picksOf(m)) s.add(t.name); return [...s]; }

/* ---------- Layout ---------- */
const trackX=k=>PADL+k*(RULER+M.trackW+GAP)+RULER;
function frame(){ let lo=Infinity, hi=-Infinity; for(const m of panelLogs()){ const r=mdRange(m); if(!r) continue; const a=zOf(m,r[0]), b=zOf(m,r[1]); if(Number.isFinite(a)){ lo=Math.min(lo,a); hi=Math.max(hi,b); } }
  if(!Number.isFinite(lo)) return [0,1000]; const pad=Math.max(20,(hi-lo)*0.01); return [Math.floor((lo-pad)/50)*50,Math.ceil((hi+pad)/50)*50]; }
function fit(){ const sc=$('mudScroll'); const [lo,hi]=frame(); M.pxPerFt=Math.max(0.005,Math.min(40,(sc.clientHeight-HEAD-16)/Math.max(1,hi-lo))); layout(); sc.scrollTop=0; }
// Put depth z at a fraction of the view height.
function scrollToZ(z,frac){ const sc=$('mudScroll'); sc.scrollTop=Math.max(0,(z-M.z0)*M.pxPerFt+HEAD-(sc.clientHeight-HEAD)*frac); }
function layout(){ const sc=$('mudScroll'), sp=$('mudSpacer');
  if(M.tool==='calib'){ const m=selLog(); const s=calScale(m); const H=m?m.pages.reduce((a,p)=>a+p.h*s+CAL_GAP,0):0; sp.style.height=(H+HEAD+40)+'px'; sp.style.width=(m?(m.pages[0]?.w||0)*s+RULER+PADL*2+60:0)+'px'; return; }
  const [lo,hi]=frame(); M.z0=lo; M.z1=hi; sp.style.height=(HEAD+(hi-lo)*(M.pxPerFt||1)+24)+'px'; sp.style.width=(trackX(panelLogs().length)-RULER+PADL)+'px'; }
const yOfZ=z=>HEAD+(z-M.z0)*M.pxPerFt-$('mudScroll').scrollTop;
const zOfY=y=>M.z0+(y-HEAD+$('mudScroll').scrollTop)/M.pxPerFt;

/* ---------- Drawing ---------- */
let raf=0; function schedule(){ if(!raf) raf=requestAnimationFrame(()=>{ raf=0; draw(); }); }
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function sizeCanvas(){ const cv=$('mudCanvas'), st=$('mudStage'), dpr=devicePixelRatio||1, w=st.clientWidth, h=st.clientHeight;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); cv.style.width=w+'px'; cv.style.height=h+'px'; }
  const ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); return {ctx,w,h,dpr}; }
function draw(){ if(S.mode!=='mud'||$('mudView').hidden) return; frameNo++; const {ctx,w,h,dpr}=sizeCanvas();
  ctx.fillStyle=css('--paper')||'#fff'; ctx.fillRect(0,0,w,h);
  if(M.tool==='calib') return drawCalib(ctx,w,h,dpr);
  const logs=panelLogs(); if(!logs.length){ ctx.fillStyle=css('--muted'); ctx.font='14px "IBM Plex Sans",sans-serif'; ctx.fillText('Open a PDF or TIFF mudlog to start. Up to 8 logs sit side by side.',24,HEAD+30); return; }
  const sx=$('mudScroll').scrollLeft, ink=css('--ink'), muted=css('--muted'), line=css('--line');
  const pos=[];
  logs.forEach((m,k)=>{ const x=trackX(k)-sx; pos.push(x); if(x>w||x+M.trackW<-RULER) return; drawTrack(ctx,m,x,h,dpr,{ink,muted,line}); });
  // Correlation lines between neighbouring logs.
  ctx.save(); ctx.setLineDash([5,4]); ctx.lineWidth=1.3;
  for(let k=0;k+1<logs.length;k++){ const a=logs[k], b=logs[k+1]; for(const t of picksOf(a)){ const mb=pickMd(b,t.name); if(!Number.isFinite(mb)) continue; const ya=yOfZ(zOf(a,t.md)), yb=yOfZ(zOf(b,mb)); if(!Number.isFinite(ya+yb)) continue;
      ctx.strokeStyle=topColor(t.name); ctx.beginPath(); ctx.moveTo(pos[k]+M.trackW,ya); ctx.lineTo(pos[k+1]-RULER,yb); ctx.stroke(); } }
  ctx.restore();
  // Cursor.
  if(M.cursor&&M.cursor.y>HEAD){ const z=zOfY(M.cursor.y); ctx.save(); ctx.strokeStyle=css('--focus')||'#36c'; ctx.globalAlpha=.7; ctx.beginPath(); ctx.moveTo(0,M.cursor.y); ctx.lineTo(w,M.cursor.y); ctx.stroke(); ctx.globalAlpha=1;
    ctx.font='11px "IBM Plex Mono",monospace'; logs.forEach((m,k)=>{ const md=mdOfZ(m,z); if(!Number.isFinite(md)) return; const t=`MD ${Math.round(md).toLocaleString()}`+(Number.isFinite(elevOf(m))?` · SS ${Math.round(elevOf(m)-md).toLocaleString()}`:''); const tw=ctx.measureText(t).width+8, x=pos[k]+4;
      ctx.fillStyle=css('--panel'); ctx.fillRect(x,M.cursor.y-17,tw,15); ctx.fillStyle=ink; ctx.fillText(t,x+4,M.cursor.y-6); }); ctx.restore(); }
  // Header band.
  ctx.fillStyle=css('--panel'); ctx.fillRect(0,0,w,HEAD); ctx.strokeStyle=line; ctx.beginPath(); ctx.moveTo(0,HEAD+.5); ctx.lineTo(w,HEAD+.5); ctx.stroke();
  logs.forEach((m,k)=>{ const x=pos[k]-RULER+2, tw=M.trackW+RULER-4; ctx.save(); ctx.beginPath(); ctx.rect(x,0,tw,HEAD); ctx.clip();
    ctx.fillStyle=m.id===M.sel?css('--accent'):ink; ctx.font='600 13px "IBM Plex Sans",sans-serif'; ctx.fillText(m.name||m.file?.name||'Mudlog',x+2,17);
    ctx.fillStyle=muted; ctx.font='11px "IBM Plex Sans",sans-serif'; const e=elevOf(m); const bits=[m.api,Number.isFinite(e)?`${m.elevRef==='gl'||m.kb==null?'GL':'KB'} ${e.toLocaleString()} ft`:'',linked(m)?'↔ '+linked(m).name:''].filter(Boolean);
    ctx.fillText(bits.join(' · '),x+2,32); const note=m.status!=='ready'?(m.status==='missing'?'Re-open file to show':m.progress||m.status):calState(m).ok?hangNote(m):calState(m).text;
    if(note){ ctx.fillStyle=css('--accent'); ctx.fillText(note,x+2,45); } ctx.restore(); });
}
function drawTrack(ctx,m,x,h,dpr,c){
  const W=M.trackW, z0=zOfY(HEAD), z1=zOfY(h);
  ctx.save(); ctx.beginPath(); ctx.rect(x-RULER,HEAD,W+RULER,h-HEAD); ctx.clip();
  ctx.fillStyle=css('--ground'); ctx.fillRect(x,HEAD,W,h-HEAD);
  const ready=m.status==='ready'&&!hangNote(m)&&calState(m).ok;
  if(!ready){ ctx.fillStyle=css('--muted'); ctx.font='12px "IBM Plex Sans",sans-serif'; const t=m.status!=='ready'?(m.status==='missing'?'Re-open the file to show this log':m.progress||m.status):!calState(m).ok?'Needs depth: select it and press Calibrate':`Not shown: ${hangNote(m)}`; ctx.fillText(t,x+8,HEAD+22); }
  if(ready){ for(const sp of pageSpans(m)) drawSpan(ctx,m,sp,x,W,z0,z1,dpr); drawOverlay(ctx,m,x,W,z0,z1); }
  ctx.strokeStyle=c.line; ctx.strokeRect(x+.5,HEAD+.5,W-1,h-HEAD);
  // Ruler: MD, or subsea when hung on sea level.
  if(ready){ const step=[1,2,5,10,20,25,50,100,200,250,500,1000,2000,5000].find(s=>s*M.pxPerFt>=36)||10000; ctx.fillStyle=c.muted; ctx.strokeStyle=c.muted; ctx.font='10px "IBM Plex Mono",monospace'; ctx.textAlign='right';
    const md0=mdOfZ(m,z0), md1=mdOfZ(m,z1), ss=M.hang==='SS', e=elevOf(m);
    const v0=ss?e-md1:md0, v1=ss?e-md0:md1;
    const rg=mdRange(m)||[-Infinity,Infinity]; for(let v=Math.ceil(v0/step)*step;v<=v1;v+=step){ const md=ss?e-v:v; if(md<rg[0]-step/2||md>rg[1]+step/2) continue; const y=yOfZ(zOf(m,md)); ctx.beginPath(); ctx.moveTo(x-5,y+.5); ctx.lineTo(x,y+.5); ctx.stroke(); ctx.fillText((Math.round(v)||0).toLocaleString().replace(/^-/,'−'),x-7,y+3); }
    ctx.textAlign='left'; }
  // Picks.
  if(ready) for(const t of picksOf(m)){ const y=yOfZ(zOf(m,t.md)); if(y<HEAD-2||y>h+2) continue; const col=topColor(t.name); ctx.strokeStyle=col; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+W,y); ctx.stroke(); ctx.lineWidth=1;
    ctx.font='600 11px "IBM Plex Sans",sans-serif'; const tw=ctx.measureText(t.name).width; ctx.fillStyle=css('--paper'); ctx.globalAlpha=.85; ctx.fillRect(x+W-tw-8,y-14,tw+6,13); ctx.globalAlpha=1; ctx.fillStyle=col; ctx.fillText(t.name,x+W-tw-5,y-4); }
  ctx.restore();
}
function drawSpan(ctx,m,sp,x,W,z0,z1,dpr){ const p=m.pages[sp.i], q=sp.q;
  const segs=q.segs.map((g,k)=>({g,a:Math.max(sp.y0,Number.isFinite(g.y0)?g.y0:-Infinity),b:Math.min(sp.y1,k+1<q.segs.length?q.segs[k+1].y0:Infinity)})).filter(s=>s.b>s.a);
  const c0=m.crop?.[0]||0, c1=m.crop?.[1]??1, cw=(c1-c0)*p.w;
  for(const s of segs){ const scY=M.pxPerFt*s.g.b, scX=W/cw, level=Math.max(scX,scY)*dpr<0.4?1:0;
    const zA=zOf(m,s.g.a+s.g.b*s.a), zB=zOf(m,s.g.a+s.g.b*s.b); if(zB<z0||zA>z1) continue;
    // Only the rows on screen.
    const ya=Math.max(s.a,(mdOfZ(m,z0)-s.g.a)/s.g.b-2), yb=Math.min(s.b,(mdOfZ(m,z1)-s.g.a)/s.g.b+2); if(yb<=ya) continue;
    const Bh=BAND*(level?LO_F:1);
    for(let idx=Math.floor(ya/Bh);idx*Bh<yb;idx++){ const ys=Math.max(ya,idx*Bh), ye=Math.min(yb,(idx+1)*Bh);
      let bmp=bitmap(bandKey(m,level,sp.i,idx)), lv=level, bi=idx;
      if(!bmp&&level===0){ bi=Math.floor(idx/LO_F); bmp=peek(bandKey(m,1,sp.i,bi)); lv=1; if(!bmp) bitmap(bandKey(m,1,sp.i,bi)); }
      const dy0=yOfZ(zOf(m,s.g.a+s.g.b*ys)), dy1=yOfZ(zOf(m,s.g.a+s.g.b*ye));
      if(!bmp){ ctx.fillStyle=css('--grid'); ctx.fillRect(x,dy0,W,dy1-dy0); continue; }
      const fy=lv?LO_F:1, fx=bmp.width/p.w, by0=bi*BAND*fy;
      ctx.drawImage(bmp,c0*p.w*fx,(ys-by0)/fy,cw*fx,(ye-ys)/fy,x,dy0,W,dy1-dy0); } } }
function drawOverlay(ctx,m,x,W,z0,z1){ const w=linked(m); if(!w||!m.overlay) return; const c=w.curves.find(c=>c.mnemonic===m.overlay); if(!c) return;
  const d=depthOf(w), k=wK(w), lo=m.ovMin??0, hi=m.ovMax??150; if(!(hi>lo)) return;
  ctx.save(); ctx.beginPath(); let on=false; const md0=mdOfZ(m,z0)*k, md1=mdOfZ(m,z1)*k;
  for(let i=0;i<d.length;i++){ if(d[i]<md0-5||d[i]>md1+5){ on=false; continue; } const v=c.data[i]; if(!Number.isFinite(v)){ on=false; continue; }
    const px=x+Math.max(0,Math.min(1,(v-lo)/(hi-lo)))*W, py=yOfZ(zOf(m,d[i]/k)); if(on) ctx.lineTo(px,py); else { ctx.moveTo(px,py); on=true; } }
  ctx.lineJoin='round'; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.lineWidth=3.5; ctx.stroke(); ctx.strokeStyle=m.ovColor||'#1a9e3f'; ctx.lineWidth=1.6; ctx.stroke(); ctx.restore(); }

/* ---------- Calibrate: one log, raw pages stacked at true aspect ---------- */
const CAL_GAP=14;
function calScale(m){ if(!m||!m.pages.length) return 1; const st=$('mudStage'); const fitW=(st.clientWidth-RULER-PADL*2-40)/Math.max(...m.pages.map(p=>p.w)); return M.cal.scale??Math.min(1,Math.max(0.1,fitW)); }
function calPages(m){ const s=calScale(m); let y=HEAD+10; return m.pages.map((p,i)=>{ const r={i,p,top:y,s}; y+=p.h*s+CAL_GAP; return r; }); }
function calHit(m,cy){ const sc=$('mudScroll'), Y=cy+sc.scrollTop; for(const r of calPages(m)) if(Y>=r.top&&Y<=r.top+r.p.h*r.s) return {...r,y:(Y-r.top)/r.s}; return null; }
function drawCalib(ctx,w,h,dpr){ const m=selLog(); if(!m) return; const sc=$('mudScroll'), sy=sc.scrollTop, sx=sc.scrollLeft, x0=PADL+RULER-sx; const s=sol(m), k=unitK(m);
  ctx.font='11px "IBM Plex Mono",monospace';
  for(const r of calPages(m)){ const top=r.top-sy, H=r.p.h*r.s, Wd=r.p.w*r.s; if(top>h||top+H<0) continue;
    const level=r.s*dpr<0.4?1:0, Bh=BAND*(level?LO_F:1);
    for(let idx=Math.max(0,Math.floor((-top)/r.s/Bh));idx*Bh<r.p.h&&top+idx*Bh*r.s<h;idx++){ const bmp=bitmap(bandKey(m,level,r.i,idx))||(level===0?peek(bandKey(m,1,r.i,Math.floor(idx/LO_F))):null);
      const ys=idx*Bh, ye=Math.min(r.p.h,(idx+1)*Bh);
      if(!bmp){ ctx.fillStyle=css('--grid'); ctx.fillRect(x0,top+ys*r.s,Wd,(ye-ys)*r.s); continue; }
      const fromLo=level===0&&bmp.width<r.p.w*0.9, fy=fromLo||level?LO_F:1, by0=fromLo?Math.floor(idx/LO_F)*BAND*LO_F:idx*Bh, fx=bmp.width/r.p.w;
      ctx.drawImage(bmp,0,(ys-by0)/fy,r.p.w*fx,(ye-ys)/fy,x0,top+ys*r.s,Wd,(ye-ys)*r.s); }
    const q=s[r.i];
    if(r.p.skip||!q||!q.segs){ ctx.fillStyle='rgba(120,120,120,.28)'; ctx.fillRect(x0,top,Wd,H); }
    ctx.fillStyle=css('--muted'); ctx.fillText(`p${r.i+1}${r.p.skip?' · skipped':q&&q.cont?' · continues':''}`,x0-RULER+2,top+12);
    // Text fit: a tick at every label depth, so a wrong fit shows at a glance.
    if(r.p.fit&&m.useText!==false&&!r.p.skip){ const f=r.p.fit; ctx.strokeStyle='#2a78d6'; ctx.fillStyle='#2a78d6'; for(let v=Math.ceil((f.a+f.b*0)/f.step)*f.step;v<=f.a+f.b*r.p.h;v+=f.step||1e9){ const y=top+((v-f.a)/f.b)*r.s; ctx.beginPath(); ctx.moveTo(x0-8,y); ctx.lineTo(x0+14,y); ctx.stroke(); ctx.fillText(Math.round(v*k).toLocaleString(),x0-RULER+2,y+4); } }
    for(const t of r.p.ties||[]){ const y=top+t.y*r.s; ctx.strokeStyle=css('--accent'); ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(x0-8,y); ctx.lineTo(x0+Wd,y); ctx.stroke(); ctx.lineWidth=1; const lbl=`${t.md.toLocaleString()} ft`; ctx.fillStyle=css('--panel'); ctx.fillRect(x0+4,y-15,ctx.measureText(lbl).width+8,14); ctx.fillStyle=css('--accent'); ctx.fillText(lbl,x0+8,y-4); } }
  if(M.cursor){ const hit=calHit(m,M.cursor.y); ctx.strokeStyle=css('--focus'); ctx.beginPath(); ctx.moveTo(0,M.cursor.y); ctx.lineTo(w,M.cursor.y); ctx.stroke();
    if(hit){ const q=s[hit.i]; const t=q&&q.segs?`MD ${Math.round(CAL.mdAt(q,hit.y)).toLocaleString()} ft`:'not calibrated'; ctx.fillStyle=css('--panel'); ctx.fillRect(M.cursor.x+12,M.cursor.y-18,ctx.measureText(t).width+8,15); ctx.fillStyle=css('--ink'); ctx.fillText(t,M.cursor.x+16,M.cursor.y-7); } }
  ctx.fillStyle=css('--panel'); ctx.fillRect(0,0,w,HEAD); ctx.fillStyle=css('--ink'); ctx.font='600 13px "IBM Plex Sans",sans-serif'; ctx.fillText(`Calibrating ${m.name}`,PADL,20);
  ctx.font='12px "IBM Plex Sans",sans-serif'; ctx.fillStyle=css('--muted'); ctx.fillText('Click a ruled depth line and type its MD. Two lines on one page set the scale; one line on a later page fixes its offset. Blue ticks: depths read from the PDF text.',PADL,38); }

// Snap a click to the darkest ruled line within ±8 px, read from the full-resolution band.
async function snapY(m,page,y){ const p=m.pages[page], idx=Math.floor(y/BAND), key=bandKey(m,0,page,idx);
  let bmp=peek(key); if(!bmp){ const b=await db.get('bands',key); if(!b) return y; bmp=await createImageBitmap(b); }
  const r=8, y0=Math.max(0,Math.round(y-idx*BAND)-r), n=Math.min(bmp.height-y0,2*r+1); if(n<3) return y;
  const c0=m.crop?.[0]||0, c1=m.crop?.[1]??1, W=Math.min(400,Math.round((c1-c0)*p.w)); const cv=canvas(W,n), ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bmp,c0*bmp.width,y0,(c1-c0)*bmp.width,n,0,0,W,n); const d=ctx.getImageData(0,0,W,n).data, rows=new Float32Array(n);
  for(let j=0;j<n;j++){ let s=0; for(let i=0;i<W;i++){ const o=(j*W+i)*4; s+=255-(d[o]+d[o+1]+d[o+2])/3; } rows[j]=s/W/255; }
  return idx*BAND+y0+CAL.snapRow(rows,Math.round(y-idx*BAND)-y0,r); }

/* ---------- Pointer and wheel ---------- */
let drag=null;
function hitTrack(px){ const sx=$('mudScroll').scrollLeft; const logs=panelLogs(); for(let k=0;k<logs.length;k++){ const x=trackX(k)-sx; if(px>=x-RULER&&px<=x+M.trackW) return {m:logs[k],k,x}; } return null; }
function pickNear(m,y){ let best=null; for(const t of picksOf(m)){ const d=Math.abs(yOfZ(zOf(m,t.md))-y); if(d<6&&(!best||d<best.d)) best={t,d}; } return best&&best.t; }
function bindPointer(){ const sc=$('mudScroll');
  const pt=e=>{ const r=sc.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; };
  sc.addEventListener('scroll',()=>{ hidePop(); schedule(); });
  sc.addEventListener('pointerleave',()=>{ M.cursor=null; schedule(); });
  sc.addEventListener('pointermove',e=>{ const p=pt(e); M.cursor=p;
    if(drag){ const md=mdOfZ(drag.m,zOfY(p.y)); if(Number.isFinite(md)){ setPick(drag.m,drag.name,md); drag.moved=true; } schedule(); return; }
    let cur=M.tool==='pick'?'crosshair':M.tool==='calib'?'crosshair':'default'; if(M.tool!=='calib'){ const h=hitTrack(p.x); if(h&&pickNear(h.m,p.y)) cur='ns-resize'; } sc.style.cursor=cur; schedule(); });
  sc.addEventListener('pointerdown',e=>{ if(e.button!==0) return; const p=pt(e); if(p.y<HEAD&&M.tool!=='calib'){ const h=hitTrack(p.x); if(h){ M.sel=h.m.id; renderSide(); schedule(); } return; }
    if(M.tool==='calib') return calClick(p);
    const h=hitTrack(p.x); if(!h||h.m.status!=='ready') return; M.sel=h.m.id;
    const near=pickNear(h.m,p.y);
    if(near&&e.altKey){ delPick(h.m,near.name); render(); return; }
    if(near){ drag={m:h.m,name:near.name}; sc.setPointerCapture(e.pointerId); return; }
    if(M.tool==='pick'){ const name=($('mudTop').value||'').trim(); if(!name){ $('mudTop').focus(); flash('Type a top name first'); return; } const md=mdOfZ(h.m,zOfY(p.y)); if(Number.isFinite(md)){ setPick(h.m,name,md); render(); } return; }
    renderSide(); schedule(); });
  sc.addEventListener('pointerup',()=>{ if(drag){ const d=drag; drag=null; if(d.moved) render(); } });
  sc.addEventListener('wheel',e=>{ if(!(e.ctrlKey||e.metaKey)) return; e.preventDefault(); const p=pt(e), f=Math.exp(-e.deltaY*0.0015);
    if(M.tool==='calib'){ const m=selLog(); const s0=calScale(m), s1=Math.max(0.05,Math.min(4,s0*f)); const Y=(p.y+sc.scrollTop-HEAD)/s0; M.cal.scale=s1; layout(); sc.scrollTop=Y*s1+HEAD-p.y; schedule(); return; }
    const z=zOfY(p.y); M.pxPerFt=Math.max(0.005,Math.min(40,M.pxPerFt*f)); layout(); sc.scrollTop=Math.max(0,(z-M.z0)*M.pxPerFt+HEAD-p.y); syncScale(); schedule(); },{passive:false});
  new ResizeObserver(()=>{ if(S.mode==='mud'){ layout(); schedule(); } }).observe($('mudStage'));
}
async function calClick(p){ const m=selLog(); if(!m||m.status!=='ready') return; const hit=calHit(m,p.y); if(!hit) return;
  const near=(m.pages[hit.i].ties||[]).findIndex(t=>Math.abs(t.y-hit.y)*hit.s<6);
  const y=near>=0?m.pages[hit.i].ties[near].y:await snapY(m,hit.i,hit.y); const q=sol(m)[hit.i];
  const guess=near>=0?m.pages[hit.i].ties[near].md:q&&q.segs?Math.round(CAL.mdAt(q,y)/10)*10:'';
  showPop(p.x,p.y,`<label>MD at this line <input type="number" id="mudTieMd" step="any" value="${guess}"> ft</label><button class="small primary" id="mudTieOk">${near>=0?'Update':'Add'}</button>${near>=0?'<button class="small" id="mudTieDel">Delete</button>':''}<button class="small" id="mudTieNo">Cancel</button>`);
  const inp=$('mudTieMd'); inp.focus(); inp.select();
  const ok=()=>{ const v=parseFloat(inp.value); if(!Number.isFinite(v)) return; const pg=m.pages[hit.i]; pg.ties=pg.ties||[]; if(near>=0) pg.ties[near]={y,md:v}; else pg.ties.push({y,md:v}); pg.skip=false; hidePop(); render(); };
  $('mudTieOk').onclick=ok; inp.onkeydown=e=>{ if(e.key==='Enter') ok(); if(e.key==='Escape') hidePop(); };
  $('mudTieNo').onclick=hidePop; if(near>=0) $('mudTieDel').onclick=()=>{ m.pages[hit.i].ties.splice(near,1); hidePop(); render(); }; }
function showPop(x,y,html){ const p=$('mudPop'); p.innerHTML=html; p.hidden=false; const st=$('mudStage'); p.style.left=Math.min(x+10,st.clientWidth-p.offsetWidth-8)+'px'; p.style.top=Math.max(4,Math.min(y+10,st.clientHeight-p.offsetHeight-8))+'px'; }
function hidePop(){ const p=$('mudPop'); if(p) p.hidden=true; }
function flash(t){ const n=$('mudMsg'); if(n){ n.textContent=t; clearTimeout(flash.t); flash.t=setTimeout(()=>{ n.textContent=''; },3500); } }

/* ---------- Sidebar and view bar ---------- */
const RATIOS=[240,600,1200,2400,4800,9600];
function syncScale(){ const r=1152/M.pxPerFt, hit=RATIOS.find(x=>Math.abs(x/r-1)<0.03); const sel=$('mudScale'); sel.innerHTML=RATIOS.map(x=>`<option value="${x}"${x===hit?' selected':''}>1:${x}</option>`).join('')+(hit?'':`<option selected value="">1:${Math.round(r)}</option>`); }
let sideT=0; function sideSoon(){ if(!sideT) sideT=setTimeout(()=>{ sideT=0; for(const m of M.logs){ const n=document.querySelector(`[data-mstat="${m.id}"]`); if(n&&m.progress) n.textContent=m.progress; } schedule(); },150); }
function numOrNull(v){ const x=parseFloat(v); return Number.isFinite(x)?x:null; }
function pagesText(m){ const out=[]; let a=null; m.pages.forEach((p,i)=>{ if(p.skip){ if(a===null) a=i+1; } if((!p.skip||i===m.pages.length-1)&&a!==null){ const b=p.skip?i+1:i; out.push(a===b?`${a}`:`${a}-${b}`); a=null; } }); return out.join(', '); }
function parsePages(t,n){ const s=new Set(); for(const part of String(t).split(/[,\s]+/)){ const m=part.match(/^(\d+)(?:-(\d+))?$/); if(!m) continue; for(let i=+m[1];i<=+(m[2]||m[1]);i++) if(i>=1&&i<=n) s.add(i-1); } return s; }
function renderSide(){ const el=$('mudSide'); if(!el) return; const m=selLog();
  const list=M.logs.map((x,i)=>{ const inP=M.panel.includes(x.id), st=x.status==='ready'?(calState(x).ok?'':'needs depth'):x.status==='failed'?'failed':x.status==='missing'?'re-open file':(x.progress||x.status);
    return `<li class="${x.id===M.sel?'sel':''}" data-msel="${x.id}"><input type="checkbox" data-mpanel="${x.id}" ${inP?'checked':''} ${!inP&&M.panel.length>=MAX_PANEL?'disabled title="8 logs at most"':''} aria-label="Show ${esc(x.name)} in the panel"><span title="${esc(x.file?.name||'')}">${esc(x.name)}</span><small data-mstat="${x.id}" class="${x.status==='failed'?'warn':''}">${esc(st)}</small><button class="small link" data-mup="${i}" title="Move left" aria-label="Move up">↑</button><button class="small link" data-mdel="${x.id}" title="Remove" aria-label="Remove">×</button></li>`; }).join('');
  let html=`<div class="row"><button class="primary" id="mudOpen">Open PDF or TIFF…</button><input type="file" id="mudFile" accept=".pdf,.tif,.tiff" multiple hidden></div>
    <p class="hint">Up to ${MAX_PANEL} logs side by side. Files over ${WARN_MB} MB ask first. Images are kept in this browser only. <span id="mudStore"></span></p>
    ${M.warn?`<div class="mwarn">${esc(M.warn.text)} <button class="small" id="mudForce">Open anyway</button> <button class="small link" id="mudWarnX">Skip</button></div>`:''}
    <section><h3>Mudlogs <span class="pill">${M.logs.length}</span> <button class="small" id="mudSortWE" title="Order the panel by longitude from the header">Sort west → east</button></h3><ul class="list">${list||'<li class="hint">None yet</li>'}</ul>${M.logs.length>1?'<button class="small link" id="mudClearAll" title="Remove every mudlog, its picks and ties, and its stored images from this browser">Remove all mudlogs</button>':''}</section>`;
  if(m){ const w=linked(m), curves=w?w.curves.filter(c=>!c.sparse&&c!==w.curves[0]).map(c=>c.mnemonic):[]; const s=sol(m), fitted=m.pages.filter(p=>p.fit).length, cal=calState(m);
    const f=(k,l,t='text',extra='')=>`<label>${l}<input type="${t}" data-mf="${k}" value="${esc(m[k]??'')}" ${extra}></label>`;
    html+=`<section><h3>${esc(m.name)}</h3><div class="mform">
      ${f('name','Name')}${f('api','API')}${f('company','Operator')}${f('field','Field')}
      ${f('kb','KB ft','number','step="any"')}${f('gl','GL ft','number','step="any"')}
      <label>Subsea from<select data-mf="elevRef"><option value="kb"${m.elevRef!=='gl'?' selected':''}>KB (GL if none)</option><option value="gl"${m.elevRef==='gl'?' selected':''}>GL</option></select></label>
      <label>Latitude<input type="number" step="any" data-mloc="lat" value="${m.location?.lat??''}"></label><label>Longitude<input type="number" step="any" data-mloc="lon" value="${m.location?.lon??''}"></label>
      <label>LAS well<select data-mf="wellId"><option value="">None</option>${S.wells.map(x=>`<option value="${x.id}"${x.id===m.wellId?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${w?`<label>Overlay<select data-mf="overlay"><option value="">None</option>${curves.map(c=>`<option${c===m.overlay?' selected':''}>${esc(c)}</option>`).join('')}</select></label><label>Overlay scale<span class="pair"><input type="number" step="any" data-mf="ovMin" value="${m.ovMin??0}" aria-label="Left"><input type="number" step="any" data-mf="ovMax" value="${m.ovMax??150}" aria-label="Right"></span></label>`:''}
      <label>Crop width %<span class="pair"><input type="number" min="0" max="99" data-mcrop="0" value="${Math.round((m.crop?.[0]||0)*100)}" aria-label="Left edge"><input type="number" min="1" max="100" data-mcrop="1" value="${Math.round((m.crop?.[1]??1)*100)}" aria-label="Right edge"></span></label>
      <label>Show MD<span class="pair"><input type="number" step="any" data-mshow="0" value="${m.show?.[0]??''}" placeholder="top" aria-label="Top MD"><input type="number" step="any" data-mshow="1" value="${m.show?.[1]??''}" placeholder="base" aria-label="Base MD"></span></label>
    </div>
    <p class="hint">${w?`Picks on this log are the tops of LAS well ${esc(w.name)}, so they show in Correlation too.`:'Link a LAS well (matched by API or name) to share picks with it and overlay its curves.'}</p></section>
    <section><h3>Depth</h3>
      <p class="hint">${m.status!=='ready'?esc(m.progress||m.status):m.kind==='pdf'&&fitted?`Depth labels read from the PDF text on ${fitted} of ${m.pages.length} page${m.pages.length>1?'s':''} (${fmtScale(m)}).`:m.kind==='pdf'&&m.pages.some(p=>p.text)?'The PDF has text but no depth column was found: calibrate by hand.':'No text layer: calibrate by hand with two depth lines.'} ${cal.ok?'':'<b>'+esc(cal.text)+'</b>'}</p>
      <div class="row"><button class="small${M.tool==='calib'?' on':''}" id="mudCal">${M.tool==='calib'?'Done calibrating':'Calibrate…'}</button>${fitted?`<label class="mini"><input type="checkbox" id="mudUseText" ${m.useText!==false?'checked':''}> use PDF text</label>`:''}
        ${fitted?`<label class="mini" title="Unit of the depth numbers printed on this log. Hand ties are always typed in feet.">Printed depths <select id="mudUnit"><option value="ft"${m.unit!=='m'?' selected':''}>ft</option><option value="m"${m.unit==='m'?' selected':''}>m (shown in ft)</option></select></label>`:''}</div>
      ${m.pages.length>1?`<label class="mini">Skip pages <input type="text" id="mudSkip" value="${pagesText(m)}" placeholder="e.g. 1-2, 31" style="width:9em"></label>`:''}
      ${tiesHTML(m)}</section>
    <section><h3>Picks</h3><table class="tops">${picksOf(m).map(t=>`<tr><td><i class="sw" style="background:${topColor(t.name)}"></i>${esc(t.name)}</td><td><input type="number" step="any" data-mpick="${esc(t.name)}" value="${Math.round(t.md*10)/10}" aria-label="${esc(t.name)} MD"></td><td><button class="small link" data-mpdel="${esc(t.name)}" aria-label="Delete ${esc(t.name)}">×</button></td></tr>`).join('')||'<tr><td class="hint">No picks yet</td></tr>'}</table>
      <p class="hint">Type a name above the panel, press Pick, click a log. Drag a pick line to move it; Alt-click deletes it.</p></section>`; }
  // Re-rendering must not steal focus from the field being edited.
  const a=document.activeElement, keep=a&&el.contains(a)?(a.id?'#'+a.id:[...a.attributes].filter(x=>x.name.startsWith('data-')).map(x=>`[${x.name}="${CSS.escape(x.value)}"]`).join('')):'';
  el.innerHTML=html; if(keep){ const b=el.querySelector(keep); if(b){ b.focus(); } }
  navigator.storage?.estimate?.().then(e=>{ const n=$('mudStore'); if(n&&e.usage!=null) n.textContent=`Browser storage in use: ${Math.round(e.usage/1048576)} MB.`; }).catch(()=>{});
  $('mudTopList').innerHTML=allTopNames().map(n=>`<option value="${esc(n)}">`).join('');
}
function fmtScale(m){ const p=m.pages.find(p=>p.fit); if(!p) return ''; const ftPerIn=p.fit.b*unitK(m)*(p.dpi||150); return `${+(100/ftPerIn).toFixed(2)} in per 100 ft, label every ${Math.round(p.fit.step*unitK(m))} ft`; }
function tiesHTML(m){ const rows=[]; m.pages.forEach((p,i)=>(p.ties||[]).forEach((t,j)=>rows.push(`<tr><td>p${i+1}</td><td>${t.md.toLocaleString()} ft</td><td><button class="small link" data-mtdel="${i}:${j}" aria-label="Delete tie">×</button></td></tr>`)));
  return rows.length?`<table class="tops">${rows.join('')}</table><button class="small link" id="mudTieClear">Clear hand ties</button>`:''; }
function bindSide(){ const el=$('mudSide');
  el.addEventListener('click',async e=>{ const t=e.target;
    if(t.id==='mudOpen') return $('mudFile').click();
    if(t.id==='mudForce'){ const fs=M.warn.files; M.warn=''; openFiles(fs,true); return; }
    if(t.id==='mudWarnX'){ M.warn=''; renderSide(); return; }
    if(t.id==='mudSortWE'){ const lon=m=>m.location?.lon??(linked(m)&&wgs84Of(linked(m))?.[1]); M.logs.sort((a,b)=>{ const x=lon(a), y=lon(b); return Number.isFinite(x)&&Number.isFinite(y)?x-y:Number.isFinite(x)?-1:Number.isFinite(y)?1:0; }); M.panel=M.logs.filter(m=>M.panel.includes(m.id)).map(m=>m.id); const miss=M.logs.filter(m=>!Number.isFinite(lon(m))).length; flash(miss?`${miss} log${miss>1?'s have':' has'} no longitude and stay at the end`:'Sorted west to east'); render(); return; }
    if(t.id==='mudCal'){ setTool(M.tool==='calib'?'view':'calib'); return; }
    if(t.id==='mudTieClear'){ const m=selLog(); m.pages.forEach(p=>p.ties=[]); render(); return; }
    if(t.dataset.mup!==undefined){ const i=+t.dataset.mup; if(i>0){ [M.logs[i-1],M.logs[i]]=[M.logs[i],M.logs[i-1]]; M.panel=M.logs.filter(m=>M.panel.includes(m.id)).map(m=>m.id); render(); } return; }
    if(t.id==='mudClearAll'){ if(!confirm(`Remove all ${M.logs.length} mudlogs, their picks and ties, and their stored images? Tops linked to LAS wells stay.`)) return;
      for(const m of M.logs){ evict(m.id); db.drop(m.id).catch(()=>{}); } M.logs=[]; M.panel=[]; M.sel=null; M.warn=''; if(M.tool==='calib') M.tool='view'; render(); flash('All mudlogs removed'); return; }
    if(t.dataset.mdel){ const m=byId(t.dataset.mdel); if(!confirm(`Remove ${m.name} and its stored images?`)) return; M.logs=M.logs.filter(x=>x!==m); M.panel=M.panel.filter(id=>id!==m.id); if(M.sel===m.id) M.sel=M.logs[0]?.id||null; evict(m.id); db.drop(m.id).catch(()=>{}); if(M.tool==='calib') M.tool='view'; render(); return; }
    if(t.dataset.mtdel){ const [i,j]=t.dataset.mtdel.split(':').map(Number); selLog().pages[i].ties.splice(j,1); render(); return; }
    if(t.dataset.mpdel){ delPick(selLog(),t.dataset.mpdel); render(); return; }
    if(t.dataset.mpanel) return;
    const li=t.closest('[data-msel]'); if(li){ M.sel=li.dataset.msel; if(M.tool==='calib'){ M.cal.scale=null; layout(); } renderSide(); schedule(); } });
  el.addEventListener('change',e=>{ const t=e.target, m=selLog();
    if(t.id==='mudFile'){ openFiles(t.files); t.value=''; return; }
    if(t.dataset.mpanel){ const id=t.dataset.mpanel; if(t.checked){ if(M.panel.length<MAX_PANEL) M.panel=M.logs.filter(x=>M.panel.includes(x.id)||x.id===id).map(x=>x.id); } else M.panel=M.panel.filter(x=>x!==id); render(); return; }
    if(!m) return;
    if(t.dataset.mf==='wellId'){ link(m,t.value||null); render(); return; }
    if(t.dataset.mf){ const k=t.dataset.mf; m[k]=t.type==='number'?numOrNull(t.value):t.value||(k==='elevRef'?'kb':null);
      if(k==='overlay'&&m.overlay){ const c=linked(m)?.curves.find(c=>c.mnemonic===m.overlay); const v=c?Array.from(c.data).filter(Number.isFinite).sort((a,b)=>a-b):[]; if(v.length>10){ m.ovMin=+v[Math.floor(v.length*0.02)].toPrecision(3); m.ovMax=+v[Math.floor(v.length*0.98)].toPrecision(3); } }
      render(); return; }
    if(t.dataset.mloc){ m.location={...(m.location||{}),[t.dataset.mloc]:numOrNull(t.value)}; render(); return; }
    if(t.dataset.mcrop){ const c=[...(m.crop||[0,1])]; c[+t.dataset.mcrop]=Math.max(0,Math.min(1,(numOrNull(t.value)??(+t.dataset.mcrop?100:0))/100)); if(c[1]-c[0]>=0.01) m.crop=c; render(); return; }
    if(t.dataset.mshow){ const s=[...(m.show||[null,null])]; s[+t.dataset.mshow]=numOrNull(t.value); m.show=s.some(v=>v!=null)?s:null; render(); return; }
    if(t.dataset.mpick){ const v=numOrNull(t.value); if(v!=null) setPick(m,t.dataset.mpick,v); render(); return; }
    if(t.id==='mudUseText'){ m.useText=t.checked; render(); return; }
    if(t.id==='mudUnit'){ m.unit=t.value; render(); return; }
    if(t.id==='mudSkip'){ const s=parsePages(t.value,m.pages.length); m.pages.forEach((p,i)=>p.skip=s.has(i)); render(); return; } });
}
function setTool(t){ const was=M.tool, sc=$('mudScroll');
  if(t==='calib'&&was!=='calib'){ M.viewZ=M.z0!=null?zOfY(HEAD+(sc.clientHeight-HEAD)/2):null; }
  M.tool=t; hidePop(); if(t==='calib'){ M.cal.scale=null; sc.scrollTop=0; } else if(was==='calib'&&M.viewZ!=null) M.goto={z:M.viewZ}; render(); }
function renderBar(){ const names=allTopNames(); const hs=$('mudHang'); const cur=M.hang;
  if(!['MD','SS'].includes(cur)&&!names.includes(cur)) M.hang='MD';
  hs.innerHTML=`<option value="MD">MD (0 ft at KB)</option><option value="SS">Subsea (elevation − MD)</option>${names.map(n=>`<option value="${esc(n)}">Flatten on ${esc(n)}</option>`).join('')}`; hs.value=M.hang;
  $('mudPick').setAttribute('aria-pressed',M.tool==='pick'); $('mudTrackW').value=M.trackW; $('mudCalBar').hidden=M.tool!=='calib'; $('mudViewBar').hidden=M.tool==='calib'; }
function bindBar(){
  $('mudHang').onchange=e=>{ M.hang=e.target.value; M.goto=['MD','SS'].includes(M.hang)?'top':'datum'; render(); };
  $('mudFit').onclick=()=>{ fit(); syncScale(); schedule(); };
  $('mudScale').onchange=e=>{ const r=+e.target.value; if(!r) return; const sc=$('mudScroll'), z=zOfY(sc.clientHeight/2); M.pxPerFt=1152/r; layout(); sc.scrollTop=Math.max(0,(z-M.z0)*M.pxPerFt+HEAD-sc.clientHeight/2); schedule(); };
  $('mudPick').onclick=()=>setTool(M.tool==='pick'?'view':'pick');
  $('mudTop').addEventListener('keydown',e=>{ if(e.key==='Enter'){ setTool('pick'); } });
  $('mudTrackW').oninput=e=>{ M.trackW=+e.target.value; layout(); schedule(); };
  $('mudTrackW').onchange=()=>render();
  $('mudCalDone').onclick=()=>setTool('view');
  document.addEventListener('keydown',e=>{ if(S.mode!=='mud'||e.key!=='Escape') return; if(!$('mudPop').hidden) return hidePop(); if(M.tool!=='view') setTool('view'); });
}

// Panel width: drag the gutter, double-click to reset; remembered in this browser.
function bindGutter(){ const side=$('mudSide'), g=$('mudGutter'); if(!g) return; const setW=w=>{ side.style.width=Math.max(220,Math.min(innerWidth*0.6,w))+'px'; };
  const saved=lsGet('weller.mudSideW',null); if(saved) setW(saved);
  g.addEventListener('pointerdown',e=>{ e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('on'); const x0=e.clientX, w0=side.offsetWidth;
    const move=ev=>setW(w0+ev.clientX-x0), up=()=>{ g.classList.remove('on'); g.removeEventListener('pointermove',move); g.removeEventListener('pointerup',up); lsSet('weller.mudSideW',side.offsetWidth); };
    g.addEventListener('pointermove',move); g.addEventListener('pointerup',up); });
  g.addEventListener('dblclick',()=>{ side.style.width=''; try{ localStorage.removeItem('weller.mudSideW'); }catch(e){} }); }

/* ---------- Public ---------- */
let bound=false;
function renderMud(){ if(!bound){ bound=true; bindSide(); bindBar(); bindPointer(); bindGutter(); }
  for(const m of M.logs) if(m.wellId&&!wellById(m.wellId)) m.wellId=null;
  renderBar(); renderSide();
  // The scale stays where the user set it; only the scroll moves. A new hang shows its datum, otherwise the depth at
  // the centre of the view stays put while logs come and go.
  if(M.tool==='calib') layout();
  else { const sc=$('mudScroll'), zc=M.z0!=null?zOfY(HEAD+(sc.clientHeight-HEAD)/2):null; layout();
    if(M.goto==='top'){ sc.scrollTop=0; } else if(M.goto==='datum'){ scrollToZ(0,0.33); } else if(M.goto&&Number.isFinite(M.goto.z)) scrollToZ(M.goto.z,0.5); else if(zc!=null) scrollToZ(zc,0.5); M.goto=null; }
  syncScale(); schedule(); }
function toJSON(){ if(!M.logs.length) return undefined; return { panel:M.panel, sel:M.sel, hang:M.hang, trackW:M.trackW, pxPerFt:M.pxPerFt,
  logs:M.logs.map(m=>({id:m.id,name:m.name,kind:m.kind,file:m.file,api:m.api,company:m.company,field:m.field,county:m.county,state:m.state,kb:m.kb,gl:m.gl,elevRef:m.elevRef,location:m.location,unit:m.unit,useText:m.useText,wellId:m.wellId,crop:m.crop,show:m.show,overlay:m.overlay,ovMin:m.ovMin,ovMax:m.ovMax,picks:m.picks,header:m.header,
    pages:m.pages.map(p=>({w:p.w,h:p.h,dpi:p.dpi,fit:p.fit,ties:p.ties,skip:p.skip||undefined,text:p.text||undefined})),ready:m.status==='ready'||undefined})) }; }
function fromJSON(j){ const old=new Map(M.logs.map(m=>[m.id,m]));
  if(!j||!Array.isArray(j.logs)){ M.logs=M.logs.filter(m=>m.status==='processing'||m.status==='queued'); M.panel=M.panel.filter(id=>byId(id)); return; }
  M.logs=j.logs.map(r=>{ const o=old.get(r.id); const m={...r,picks:r.picks||[],pages:r.pages||[]}; delete m.ready;
    m.status=o?.status==='processing'||o?.status==='queued'?o.status:o?.status==='ready'||r.ready?'checking':'missing'; if(o) m.progress=o.progress;
    if(m.status==='checking') db.get('logs',m.id).then(x=>{ m.status=x&&x.complete?'ready':'missing'; if(S.mode==='mud'){ renderSide(); schedule(); } }).catch(()=>{ m.status='missing'; });
    return m; });
  M.panel=(j.panel||[]).filter(id=>byId(id)).slice(0,MAX_PANEL); M.sel=byId(j.sel)?j.sel:M.logs[0]?.id||null; M.hang=j.hang||'MD'; M.trackW=j.trackW||M.trackW; if(j.pxPerFt) M.pxPerFt=j.pxPerFt; }
function exportPNG(){ $('mudCanvas').toBlob(b=>downloadBlob('mudlogs.png',b),'image/png'); }
window.WellerMud={render:renderMud,openFiles,toJSON,fromJSON,exportPNG,_M:M,
  _calY:(i,y)=>{ const r=calPages(selLog())[i]; return r.top+y*r.s-$('mudScroll').scrollTop; }, _trackX:k=>trackX(k)-$('mudScroll').scrollLeft, _yOfMd:(m,md)=>yOfZ(zOf(m,md))};
})();
