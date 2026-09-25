import sys, time, json, numpy as np, cv2
from scipy import ndimage as ndi
from skimage.measure import label as cclabel
from common import *
from seg_utils import *
img=load_map(); M=np.load('mask.npy'); T=np.load('truth.npy')
ink=np.load('ink1.npy'); ink2=np.load('ink.npy')
FILL=RGB.astype(np.float32); SIGM=np.array(json.load(open('sig.json')),np.float32)
B=nblur(img,ink,9)
res={}; out={}
def run(name,lab):
    e=evaluate(lab,T,M); e['polys']=int(cclabel(lab+1,background=0,connectivity=1).max()); res[name]=e; out[name]=lab; print(name,e,flush=True)
for signame,S in (('swatch',SIGM),):
    p=lut_classify(B,S); p=fill_nearest(p,ink|~M)
    run(f'A_{signame}',finish(mode_filter(p,11),M))
# self-training on best signature -> Gaussian per class in Lab
S=SIGM
p=fill_nearest(lut_classify(B,S),ink|~M); pm=mode_filter(p,15)
conf=(p==pm)&~cv2.dilate(ink.astype(np.uint8),np.ones((7,7),np.uint8)).astype(bool)&M
labB=cv2.cvtColor(B,cv2.COLOR_RGB2LAB).astype(np.float32)
for it in range(2):
    mus=[];covs=[];pri=[]
    pooled=np.cov(labB[conf].reshape(-1,3)[::50].T)*0.3
    for k in range(len(CODES)):
        sel=conf&(pm==k); n=sel.sum()
        ref=lab_of((S[k]*0.87)[None])[0]
        if n>800:
            x=labB[sel][::max(1,n//20000)]; mu=0.5*x.mean(0)+0.5*ref; cv=np.cov(x.T)+np.eye(3)*4
        else: mu=ref; cv=pooled+np.eye(3)*4
        mus.append(mu); covs.append(cv); pri.append(np.log(max(n,200)))
    ll=gauss_lut(mus,covs,np.array(pri)*0.5)
    p=ll[B[...,0]>>2,B[...,1]>>2,B[...,2]>>2]; p=fill_nearest(p,ink|~M); pm=mode_filter(p,15)
    conf=(p==pm)&conf
    run(f'B_selftrain{it}',finish(pm,M))
# line-snap regions
m=out[max(res,key=lambda k:res[k]['pixel_acc'])]
run('C_linesnap',finish(linesnap(m,ink2,M),M))
run('C_linesnap_A',finish(linesnap(out['A_swatch'],ink2,M),M))
json.dump(res,open('scores2.json','w'),indent=1)
for k,v in out.items(): np.save(k+'.npy',v)
