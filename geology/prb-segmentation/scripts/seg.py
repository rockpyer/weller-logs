import sys, time, json, numpy as np, cv2
from scipy import ndimage as ndi
from skimage.measure import label as cclabel
from common import *
SIG=np.array(json.load(open('sig.json')),np.float32)
K=len(SIG)
def classify(P, S0=0.87, w=0.6):
    """P: N x 3 RGB. Shade-invariant: best multiplicative shade s per class, penalize s far from S0."""
    P=P.astype(np.float32); n2=(SIG**2).sum(1)
    s=np.clip(P@SIG.T/n2,0.55,1.08)
    d=((P[:,None,:]-s[...,None]*SIG[None])**2).sum(2)/n2 + w*(s-S0)**2
    return d.argmin(1).astype(np.int16), d.min(1)
# LUT over 6-bit color cube
q=np.arange(0,256,4)+2; cube=np.stack(np.meshgrid(q,q,q,indexing='ij'),-1).reshape(-1,3)
LUT=np.concatenate([classify(c)[0] for c in np.array_split(cube,32)]).reshape(64,64,64)
def lut(img): return LUT[img[...,0]>>2,img[...,1]>>2,img[...,2]>>2]
img=load_map(); M=np.load('mask.npy'); T=np.load('truth.npy')
hsv=cv2.cvtColor(img,cv2.COLOR_RGB2HSV)
ink=(hsv[...,2]<100)|((hsv[...,1]<20)&(hsv[...,2]<190))
ink=cv2.dilate(ink.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool)
def nblur(a,k):  # normalized blur ignoring ink
    w=(~ink).astype(np.float32); num=cv2.blur(a.astype(np.float32)*w[...,None],(k,k)); den=cv2.blur(w,(k,k))[...,None]
    return np.clip(num/np.maximum(den,1e-3),0,255).astype(np.uint8)
def fill_nearest(lab,bad):
    idx=ndi.distance_transform_edt(bad,return_distances=False,return_indices=True)
    return lab[tuple(idx)]
def mode_filter(lab,k):
    best=np.zeros(lab.shape,np.float32); out=lab.copy()
    for c in np.unique(lab):
        if c<0: continue
        f=cv2.blur((lab==c).astype(np.float32),(k,k)); u=f>best; best[u]=f[u]; out[u]=c
    return out
def remove_small(lab,minpx):
    cc=cclabel(lab+1,background=0,connectivity=1); sz=np.bincount(cc.ravel())
    small=sz[cc]<minpx; return fill_nearest(lab,small)
def finish(lab,minpx=150):
    lab=lab.copy(); lab=remove_small(lab,minpx); lab[~M]=-1; return lab
t=time.time(); R={}
# --- M1 pixel
B=nblur(img,9); p1=lut(B); p1=fill_nearest(p1,ink); p1=mode_filter(p1,11); R['m1_pixel']=finish(p1)
print('m1',time.time()-t)
# --- M2 superpixel (half-res SLIC)
from skimage.segmentation import slic
h=cv2.resize(nblur(img,3),None,fx=.5,fy=.5,interpolation=cv2.INTER_AREA)
sp=slic(h,n_segments=40000,compactness=12,start_label=0,convert2lab=True)
sp=cv2.resize(sp.astype(np.int32),(img.shape[1],img.shape[0]),interpolation=cv2.INTER_NEAREST)
w=(~ink).ravel(); n=sp.max()+1
cnt=np.bincount(sp.ravel(),w,n); mean=np.stack([np.bincount(sp.ravel(),img[...,i].ravel()*w,n) for i in range(3)],1)/np.maximum(cnt,1)[:,None]
spl=classify(mean)[0]; p2=spl[sp]; R['m2_superpixel']=finish(p2)
print('m2',time.time()-t)
# --- M3 line-snapped: regions bounded by drawn ink lines, majority of M1
reg=cclabel(~ink,connectivity=1)
p3=R['m1_pixel'].copy(); m1=R['m1_pixel']
r=reg.ravel(); v=(r>0)&(m1.ravel()>=0)
key=r[v].astype(np.int64)*K+m1.ravel()[v]
cnts=np.bincount(key,minlength=(reg.max()+1)*K).reshape(-1,K)
tot=cnts.sum(1); dom=cnts.argmax(1); frac=cnts.max(1)/np.maximum(tot,1)
ok=(frac>=0.6)&(tot>=30)
snap=ok[reg]&(reg>0); p3[snap]=dom[reg][snap]
p3=fill_nearest(p3,ink|(p3<0)); R['m3_linesnap']=finish(p3)
print('m3',time.time()-t)
res={}
for k_,v_ in R.items():
    np.save(k_+'.npy',v_); e=evaluate(v_,T,M); e['polys']=int(cclabel(v_+1,background=0,connectivity=1).max()); res[k_]=e; print(k_,e)
tt=np.where(M,T,-1); print('truth polys in area',cclabel(tt+2,background=0,connectivity=1).max())
json.dump(res,open('scores.json','w'),indent=1)
