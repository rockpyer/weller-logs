import pymupdf as fitz, re, json, numpy as np
from pyproj import Transformer
from scipy.optimize import least_squares
d=fitz.open('/root/.claude/uploads/14dc42b4-3207-59d6-805b-3d813a8a3e5f/6d8a3647-wsgs-web-prb-geologic-map.pdf');p=d[0]
X0p,Y0p,X1p,Y1p=85.20024108886719,187.677734375,2714.407470703125,2712.9267578125
DPI=150;k=DPI/72
p.get_pixmap(dpi=DPI,clip=fitz.Rect(X0p,Y0p,X1p,Y1p)).save('map.png')
LCC="+proj=lcc +lat_1=41 +lat_2=45 +lat_0=41 +lon_0=-107.5 +x_0=500000 +y_0=200000 +ellps=GRS80 +units=m +no_defs"
fwd=Transformer.from_crs("EPSG:4269",LCC,always_xy=True)
gcp=[]
for w in p.get_text('words'):
    m=re.match(r"(\d+)°(\d+)'([NW])",w[4])
    if not m: continue
    v=int(m[1])+int(m[2])/60; cx=(w[0]+w[2])/2; cy=(w[1]+w[3])/2
    if m[3]=='W': gcp.append(('lon',-v,(cx-X0p)*k, 0 if cy<1000 else (Y1p-Y0p)*k))
    else: gcp.append(('lat',v,0 if cx<1000 else (X1p-X0p)*k,(cy-Y0p)*k))
inv=Transformer.from_crs(LCC,"EPSG:4269",always_xy=True)
def res(q):
    X0,Y0,s,rot=q; c,sn=np.cos(rot),np.sin(rot); r=[]
    for t,v,px,py in gcp:
        X=X0+s*(c*px+sn*py); Y=Y0-s*(-sn*px+c*py)
        lon,lat=inv.transform(X,Y); r.append(((lon if t=='lon' else lat)-v)*111000*(np.cos(np.radians(44)) if t=='lon' else 1))
    return r
x0,y0=fwd.transform(-107.9,45.1)
sol=least_squares(res,[x0,y0,59.3,0.0],x_scale=[1000,1000,1,0.01])
r=np.array(res(sol.x)); print('params',sol.x,'resid m: rms',np.sqrt((r**2).mean()),'max',abs(r).max())
json.dump(dict(lcc=LCC,params=list(sol.x)),open('georef.json','w'))
