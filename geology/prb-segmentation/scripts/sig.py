import pymupdf as fitz, numpy as np, json, cv2
from common import L
d=fitz.open('/root/.claude/uploads/14dc42b4-3207-59d6-805b-3d813a8a3e5f/6d8a3647-wsgs-web-prb-geologic-map.pdf');p=d[0]
sig=[];tiles=[]
for o in L:
    x0,y0,x1,y1=o['rect']
    pm=p.get_pixmap(dpi=150,clip=fitz.Rect(x0+1.5,y0+1.5,x1-1.5,y1-1.5))
    a=np.frombuffer(pm.samples,np.uint8).reshape(pm.h,pm.w,pm.n)[...,:3].astype(float)
    dark=a.sum(2)<200  # label text
    dark=cv2.dilate(dark.astype(np.uint8),np.ones((3,3)))>0
    m=a[~dark].mean(0); sig.append([round(v,1) for v in m])
    tiles.append(cv2.resize(np.uint8(a),(60,24)))
json.dump(sig,open('sig.json','w'))
for o,s in zip(L,sig):
    if np.abs(np.array(o['fill'])-s).max()>8: print(o['code'],o['fill'],np.round(s))
