/* Weller Logs: mudlog image calibration and header reading. Pure functions, no DOM, so node tests can run them.
   Page coordinates are image pixels with y down. Text items are {s, x, y, w, h}, with x,y the top-left corner. */
(function(root){
'use strict';

/* ---------- Text: words to lines to phrases ---------- */
// Group items into lines (similar vertical centre), then join words closer than ~1.2 text heights into phrases.
function phrases(items){
  const its=items.filter(i=>i&&String(i.s).trim()&&i.h>0).map(i=>({...i,s:String(i.s).trim(),cy:i.y+i.h/2})).sort((a,b)=>a.cy-b.cy||a.x-b.x);
  const lines=[];
  for(const it of its){ const L=lines[lines.length-1]; if(L&&Math.abs(it.cy-L.cy)<Math.max(2,0.5*Math.min(it.h,L.h))) { L.items.push(it); L.cy=(L.cy*(L.items.length-1)+it.cy)/L.items.length; L.h=Math.max(L.h,it.h); } else lines.push({cy:it.cy,h:it.h,items:[it]}); }
  const out=[];
  for(const L of lines){ L.items.sort((a,b)=>a.x-b.x); let cur=null;
    for(const it of L.items){ if(cur&&it.x-(cur.x+cur.w)<1.2*Math.max(it.h,cur.h)&&it.x>=cur.x){ cur.s+=' '+it.s; cur.w=Math.max(cur.w,it.x+it.w-cur.x); cur.h=Math.max(cur.h,it.h); }
      else { cur={s:it.s,x:it.x,y:L.cy-it.h/2,w:it.w,h:it.h,cy:L.cy}; out.push(cur); } } }
  return out;
}

/* ---------- Depth labels ---------- */
const NUM_RE=/^(\d{1,3}(?:,\d{3})+|\d{1,5})(?:\.0+)?\s*(?:'|’|ft|m)?$/i;
function numberOf(s){ const m=String(s).trim().match(NUM_RE); return m?+m[1].replace(/,/g,''):NaN; }

/* Find the column of depth labels on one page and fit depth = a + b·y by consensus: pairs of numbers in one column
   propose a line, the line that most other numbers agree with wins, then least squares on those numbers.
   Stray numbers (gas units, ROP scales, OCR noise) are outvoted. pxPerIn bounds the scale to 1–2000 ft per inch. */
function fitDepthLabels(items,opt={}){
  const pxPerIn=opt.pxPerIn||150, W=opt.width||1000, maxDepth=opt.maxDepth||40000;
  const nums=[]; for(const it of items){ const v=numberOf(it.s); if(Number.isFinite(v)&&v<=maxDepth) nums.push({v,x:it.x+it.w/2,y:it.y+it.h/2,h:it.h}); }
  if(nums.length<3) return null;
  const tolX=Math.max(6,0.02*W); nums.sort((a,b)=>a.y-b.y);
  let best=null;
  const minB=0.2/pxPerIn, maxB=2000/pxPerIn;   // ft per px
  for(let i=0;i<nums.length;i++){ let seen=0;
    for(let j=i+1;j<nums.length&&seen<4;j++){ const p=nums[i], q=nums[j]; if(Math.abs(p.x-q.x)>tolX||q.y-p.y<2) continue; seen++;
      const b=(q.v-p.v)/(q.y-p.y); if(!(b>=minB&&b<=maxB)) continue; const a=p.v-b*p.y;
      const tolY=Math.max(2,0.6*Math.max(p.h,q.h));
      const inl=nums.filter(n=>Math.abs(n.x-p.x)<=tolX*1.5&&Math.abs(n.y-(n.v-a)/b)<=tolY);
      const vals=new Set(inl.map(n=>n.v)); if(vals.size<3) continue;
      const round=inl.filter(n=>n.v%10===0).length/inl.length;
      const score=vals.size+0.5*round;
      if(!best||score>best.score) best={score,inl}; } }
  if(!best) return null;
  // Least squares on the consensus set, then drop any point more than 2 px off and refit once.
  let pts=dedupe(best.inl), f=lsq(pts);
  pts=pts.filter(n=>Math.abs(n.y-(n.v-f.a)/f.b)<=Math.max(2,0.5*n.h)); if(pts.length>=3) f=lsq(pts);
  if(!(f.b>0)) return null;
  const vs=pts.map(n=>n.v).sort((a,b)=>a-b), steps=[]; for(let k=1;k<vs.length;k++) steps.push(vs[k]-vs[k-1]);
  const step=median(steps)||0, resid=Math.max(...pts.map(n=>Math.abs(n.v-(f.a+f.b*n.y))));
  return {a:f.a,b:f.b,n:pts.length,step,resid,x:median(pts.map(n=>n.x)),yMin:Math.min(...pts.map(n=>n.y)),yMax:Math.max(...pts.map(n=>n.y)),vMin:vs[0],vMax:vs[vs.length-1]};
}
function dedupe(pts){ const seen=new Map(); for(const p of pts){ const k=p.v+'|'+Math.round(p.y); if(!seen.has(k)) seen.set(k,p); } return [...seen.values()]; }
function lsq(pts){ const n=pts.length, my=pts.reduce((s,p)=>s+p.y,0)/n, mv=pts.reduce((s,p)=>s+p.v,0)/n; let sxy=0,sxx=0; for(const p of pts){ sxy+=(p.y-my)*(p.v-mv); sxx+=(p.y-my)**2; } const b=sxx?sxy/sxx:0; return {a:mv-b*my,b}; }
function median(a){ if(!a.length) return NaN; const s=[...a].sort((x,y)=>x-y), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }

/* Page fits from several pages: fits whose scale is off the median by more than 3% are dropped (a table of numbers
   on a header page can look like a depth column). */
function consistentFits(fits){
  const bs=fits.filter(Boolean).map(f=>f.b); if(bs.length<3) return fits;
  const mb=median(bs); return fits.map(f=>f&&Math.abs(f.b/mb-1)<=0.03?f:null);
}

/* ---------- Calibration: image y (per page) to MD ----------
   page.ties: [{y, md}] clicked or typed. page.fit: {a,b} from text. Precedence: 2+ ties give a piecewise line through
   them; a text fit is used next, shifted to honour a single tie; 1 tie alone takes the scale of the page above
   (else the nearest calibrated page); a page with nothing continues the page above at the same scale. Pages before the first
   calibrated page, or marked skip, are not drawn. Returns per page {a,b,segs,top,bot} or null. */
function solvePages(pages){
  const out=pages.map(()=>null);
  const own=p=>{ const t=(p.ties||[]).filter(t=>Number.isFinite(t.y)&&Number.isFinite(t.md)).sort((a,b)=>a.y-b.y);
    if(t.length>=2){ const segs=[]; for(let k=1;k<t.length;k++){ const b=(t[k].md-t[k-1].md)/(t[k].y-t[k-1].y); segs.push({y0:t[k-1].y,a:t[k-1].md-b*t[k-1].y,b}); }
      if(segs.some(s=>!(s.b>0))) return {bad:'Depths must increase down the page'}; return {segs}; }
    if(p.fit&&p.fit.b>0){ const a=t.length===1?t[0].md-p.fit.b*t[0].y:p.fit.a; return {segs:[{y0:-Infinity,a,b:p.fit.b}]}; }
    if(t.length===1) return {one:t[0]};
    return null; };
  const sol=pages.map(p=>p.skip?null:own(p));
  const scaleNear=i=>{ for(let d=1;d<pages.length;d++) for(const k of [i-d,i+d]){ const s=sol[k]; if(s&&s.segs) return s.segs[s.segs.length-1].b; } return null; };
  let prev=null;
  for(let i=0;i<pages.length;i++){ const p=pages[i]; if(p.skip){ continue; } let s=sol[i];
    if(s&&s.one){ const b=prev?prev.segs[prev.segs.length-1].b:scaleNear(i); s=b?{segs:[{y0:-Infinity,a:s.one.md-b*s.one.y,b}]}:null; }
    if(!s&&prev){ const b=prev.segs[prev.segs.length-1].b; s={segs:[{y0:-Infinity,a:mdAt(prev,prev.h),b}]}; s.cont=true; }
    if(s&&s.segs){ s.segs[0].y0=-Infinity; s.h=p.h; s.clip=p.clip||null; out[i]=s; prev=s; } else if(s&&s.bad) out[i]={bad:s.bad}; }
  return out;
}
function mdAt(s,y){ let g=s.segs[0]; for(const q of s.segs) if(y>=q.y0) g=q; return g.a+g.b*y; }
function yAt(s,md){ let g=s.segs[0]; for(const q of s.segs) if(Number.isFinite(q.y0)&&md>=q.a+q.b*q.y0) g=q; return (md-g.a)/g.b; }

/* ---------- Header ---------- */
const LABELS={
  name:/^(lease\s*(?:&|and)\s*well(?:\s*no\.?)?|well\s*name|well|lease)\s*[:#]?$/i,
  api:/^(api|api\s*(?:no\.?|number|#)|uwi)\s*[:#]?$/i,
  company:/^(operator|company|operator\s*name)\s*:?$/i,
  field:/^(field|prospect\/field|field\s*name|pool)\s*:?$/i,
  county:/^(county|parish)\s*:?$/i,
  state:/^(state|province)\s*:?$/i,
  kb:/^(kb\s*elev(?:ation)?|elev(?:ation)?\s*kb|kelly\s*bushing(?:\s*elev(?:ation)?)?|k\.?b\.?|rkb|d\.?f\.?)\s*:?$/i,
  gl:/^(ground\s*(?:level\s*)?elev(?:ation)?|gl\s*elev(?:ation)?|elev(?:ation)?\s*gl|ground(?:\s*level)?|g\.?l\.?)\s*:?$/i,
};
const PREFIX=Object.entries(LABELS).map(([k,re])=>[k,new RegExp(re.source.replace(/\$$/,'')+'\\s+(\\S.*)$','i')]);
const isLabel=s=>Object.values(LABELS).some(re=>re.test(s.trim()))||/^[A-Z][A-Za-z .()\/&#-]{1,30}:$/.test(s.trim());
const API_RE=/\b(\d{2})[- ]?(\d{3})[- ]?(\d{5})(?:[- ]?(\d{2}))?(?:[- ]?(\d{2}))?\b/;
const num=s=>{ const m=String(s).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/); return m?+m[0]:NaN; };

/* Read well name, API, operator, field, location and elevations from the header text. Handles "LABEL: value" on one
   line, a value to the right of its label, and the vendor layout that prints the value above a small caption. */
function parseHeader(items,opt={}){
  const ph=phrases(items), H={}, W=opt.width||1000;
  const inline=[[/\bWELL(?:\s*NAME)?\s*[:#]\s*(.+)$/i,'name'],[/\bAPI\s*(?:NO\.?|NUMBER|#)?\s*[:#]?\s*(\d{2}[- ]?\d{3}[- ]?\d{5}(?:[- ]?\d{2}){0,2})/i,'api'],[/\b(?:OPERATOR|COMPANY)\s*:\s*(.+)$/i,'company'],[/\bFIELD\s*:\s*(.+)$/i,'field'],[/\bCOUNTY\s*:\s*(.+)$/i,'county']];
  for(const p of ph) for(const [re,k] of inline){ const m=p.s.match(re); if(m&&!H[k]&&m[1].trim()) H[k]=m[1].trim(); }
  // "Label value" run together on one line, as MPlot and similar headers read.
  for(const p of ph) for(const [k,re] of PREFIX){ if(H[k]!==undefined) continue; const m=p.s.trim().match(re); if(!m) continue; const val=m[m.length-1].trim();
    if(k==='kb'||k==='gl'){ const x=num(val); if(Number.isFinite(x)&&/^-?[\d,.]+\s*(?:'|’|ft|feet)?\s*(?:\(?\w{2,3}\)?)?$/i.test(val)) H[k]=x; }
    else if(k==='api'){ const a=val.match(API_RE); if(a) H.api=a.slice(1).filter(Boolean).join('-'); }
    else if(k!=='name'||/name|:/i.test(m[0].slice(0,m[0].length-val.length))) H[k]=val; }
  // Label phrases with the value beside, above or below.
  for(const p of ph){ const s=p.s.trim(); for(const [k,re] of Object.entries(LABELS)){ if(H[k]!==undefined||!re.test(s)) continue;
      const right=ph.filter(q=>q!==p&&Math.abs(q.cy-p.cy)<0.6*Math.max(p.h,q.h)&&q.x>p.x+p.w-2&&q.x-(p.x+p.w)<0.4*W&&!isLabel(q.s)).sort((a,b)=>a.x-b.x)[0];
      const near=(dir)=>ph.filter(q=>q!==p&&!isLabel(q.s)&&(dir<0?p.cy-q.cy:q.cy-p.cy)>0.3*p.h&&Math.abs(q.cy-p.cy)<2.2*Math.max(p.h,q.h)&&q.x<p.x+p.w&&q.x+q.w>p.x-0.02*W).sort((a,b)=>Math.abs(a.cy-p.cy)-Math.abs(b.cy-p.cy))[0];
      const v=right||near(-1)||near(1); if(!v) continue;
      const val=v.s.trim(); if(k==='kb'||k==='gl'){ const x=num(val); if(Number.isFinite(x)) H[k]=x; } else if(k==='api'){ const m=val.match(API_RE); if(m) H.api=m.slice(1).filter(Boolean).join('-'); } else H[k]=val; } }
  const all=ph.map(p=>p.s).join('\n');
  // Elevations written inline: "ELEVATION: 1998.78'GL, 2021.28'KB" or "KB 2021.3".
  for(const [k,tags] of [['kb','K\\.?B\\.?|RKB|D\\.?F\\.?'],['gl','G\\.?L\\.?']]){ if(H[k]!==undefined) continue;
    let m=all.match(new RegExp(`(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:'|’|ft|feet)?\\s*(?:${tags})\\b`,'i')); if(!m) m=all.match(new RegExp(`\\b(?:${tags})\\s*(?:elev(?:ation)?)?\\s*[:=]?\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`,'i'));
    if(m){ const x=num(m[1]); if(Number.isFinite(x)&&Math.abs(x)<20000) H[k]=x; } }
  if(!H.api){ const m=all.match(/\bAPI[^\n\d]{0,12}(\d{2}[- ]?\d{3}[- ]?\d{5}(?:[- ]?\d{2}){0,2})/i)||all.match(/\b(\d{2}-\d{3}-\d{5}(?:-\d{2}){0,2})\b/); if(m) H.api=m[1].replace(/\s/g,'-'); }
  const ll=latLon(all); if(ll) H.location=ll;
  for(const k of ['name','company','field','county','state']) if(H[k]) H[k]=H[k].replace(/\s{2,}/g,' ').slice(0,80);
  if(H.name&&/^(confidential|n\/?a|none)$/i.test(H.name)) H.nameHidden=true;
  if(/\bto\s*\(m\)|\bdepth\s*\(m\)|\bmetres\b|\bmeters\b|\(m\)/i.test(all)) H.unit='m';
  return H;
}
// Decimal degrees with hemisphere letters or labels; the western and southern hemispheres are negative.
function latLon(t){
  const re=/(-?\d{1,3}\.\d{3,})\s*[°º’'"]?\s*([NSEW])?\b/gi; const hits=[]; let m;
  while((m=re.exec(t))){ hits.push({v:+m[1],h:(m[2]||'').toUpperCase(),i:m.index}); }
  for(let k=0;k+1<hits.length;k++){ const a=hits[k], b=hits[k+1]; if(b.i-a.i>60) continue;
    const pre=t.slice(Math.max(0,a.i-40),a.i).toLowerCase();
    if(!(a.h||b.h||/lat|location|coord/.test(pre))) continue;
    let lat=a.v, lon=b.v; if(a.h==='E'||a.h==='W'){ [lat,lon]=[b.v,a.v]; }
    if((a.h==='S'||b.h==='S')&&lat>0) lat=-lat; if((a.h==='W'||b.h==='W')&&lon>0) lon=-lon;
    if(Math.abs(lat)<=90&&Math.abs(lon)<=180&&Math.abs(lat)>0.01) return {lat,lon}; }
  return null;
}

/* ---------- Line snapping ----------
   rows: darkness per image row (0 = white, 1 = black) over the log width. Returns the index of the darkest row within
   ±r of i if it stands out from the local median (a ruled depth line), else i unchanged. */
function snapRow(rows,i,r=10){
  const lo=Math.max(0,i-r), hi=Math.min(rows.length-1,i+r); let best=i, bv=-1;
  for(let k=lo;k<=hi;k++) if(rows[k]>bv){ bv=rows[k]; best=k; }
  const med=median(Array.from(rows.slice(lo,hi+1))); return bv>Math.max(0.25,med*2.5)?best:i;
}

const api={phrases,numberOf,fitDepthLabels,consistentFits,solvePages,mdAt,yAt,parseHeader,latLon,snapRow,median};
if(typeof module==='object'&&module.exports) module.exports=api; else root.WellerMudCal=api;
})(typeof self!=='undefined'?self:this);
