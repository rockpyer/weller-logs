# Build truth raster (USGS WY_geol_poly), map-area mask, and the two line masks.
import numpy as np, cv2
from common import *
img=load_map()
np.save('truth.npy',truth_raster(img.shape[:2]))
hsv=cv2.cvtColor(img,cv2.COLOR_RGB2HSV)
col=((hsv[...,1]>22)|(hsv[...,2]<150)).astype(np.uint8)
col=cv2.morphologyEx(col,cv2.MORPH_OPEN,np.ones((9,9),np.uint8))
col=cv2.morphologyEx(col,cv2.MORPH_CLOSE,np.ones((31,31),np.uint8))
n,lab,st,_=cv2.connectedComponentsWithStats(col); m=(lab==1+np.argmax(st[1:,4])).astype(np.uint8)
cnt,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
out=np.zeros_like(m); cv2.drawContours(out,cnt,-1,1,-1); np.save('mask.npy',out.astype(bool))
# light line mask (black text/contacts, gray roads) -> used for color sampling; keeps hachure patterns
ink1=(hsv[...,2]<100)|((hsv[...,1]<20)&(hsv[...,2]<190))
np.save('ink1.npy',cv2.dilate(ink1.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool))
# aggressive shade-invariant line mask (hue deviation from local median) -> used for line-snapping
f=img.astype(np.float32)+1; med=cv2.medianBlur(img,9).astype(np.float32)+1
ang=np.degrees(np.arccos(np.clip((f*med).sum(2)/np.linalg.norm(f,axis=2)/np.linalg.norm(med,axis=2),-1,1)))
S=hsv[...,1].astype(np.float32); Sm=cv2.medianBlur(hsv[...,1],9).astype(np.float32)
ink=(ang>4)|(hsv[...,2]<80)|(img.max(2)<0.55*med.max(2))|((Sm>35)&(S<0.6*Sm))
ink=cv2.morphologyEx(ink.astype(np.uint8),cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
np.save('ink.npy',cv2.dilate(ink,np.ones((3,3),np.uint8)).astype(bool))
