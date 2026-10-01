import numpy as np, cv2
from scipy import ndimage as ndi
from skimage.measure import label as cclabel
from common import *
q=np.arange(0,256,4)+2; CUBE=np.stack(np.meshgrid(q,q,q,indexing='ij'),-1).reshape(-1,3).astype(np.float32)
def classify(P,S,S0=0.87,w=0.6):
    n2=(S**2).sum(1); s=np.clip(P@S.T/n2,0.55,1.08)
    d=((P[:,None,:]-s[...,None]*S[None])**2).sum(2)/n2 + w*(s-S0)**2
    return d.argmin(1).astype(np.int16)
def lut_classify(img,S):
    L=np.concatenate([classify(c,S) for c in np.array_split(CUBE,32)]).reshape(64,64,64)
    return L[img[...,0]>>2,img[...,1]>>2,img[...,2]>>2]
def gauss_lut(mus,covs,logpri):
    lab=cv2.cvtColor(np.uint8(CUBE)[None],cv2.COLOR_RGB2LAB)[0].astype(np.float32)
    sc=np.stack([-0.5*np.einsum('ni,ij,nj->n',lab-m,np.linalg.inv(c),lab-m)-0.5*np.log(np.linalg.det(c))+lp for m,c,lp in zip(mus,covs,logpri)],1)
    return sc.argmax(1).astype(np.int16).reshape(64,64,64)
def nblur(a,ink,k):
    w=(~ink).astype(np.float32); num=cv2.blur(a.astype(np.float32)*w[...,None],(k,k)); den=cv2.blur(w,(k,k))[...,None]
    o=num/np.maximum(den,1e-3); o[den[...,0]<1e-3]=a[den[...,0]<1e-3]
    return np.clip(o,0,255).astype(np.uint8)
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
    return fill_nearest(lab,sz[cc]<minpx)
def finish(lab,M,minpx=150):
    lab=fill_nearest(lab,~M); lab=remove_small(lab,minpx); lab=lab.copy(); lab[~M]=-1; return lab
def linesnap(m1,ink,M,thr=0.6):
    K=int(m1.max())+1
    reg=cclabel(~ink&M,connectivity=1); p3=m1.copy()
    r=reg.ravel(); v=(r>0)&(m1.ravel()>=0)
    cnts=np.bincount(r[v].astype(np.int64)*K+m1.ravel()[v],minlength=(reg.max()+1)*K).reshape(-1,K)
    tot=cnts.sum(1); dom=cnts.argmax(1); frac=cnts.max(1)/np.maximum(tot,1)
    ok=(frac>=thr)&(tot>=30); snap=ok[reg]&(reg>0); p3[snap]=dom[reg][snap]
    return fill_nearest(p3,ink)
