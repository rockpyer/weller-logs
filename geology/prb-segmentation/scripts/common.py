import json, numpy as np, cv2
from rasterio.features import rasterize, shapes
from affine import Affine
L=json.load(open('legend.json'))
FIX={'KclKcl':'Kcl','KgbKgb':'Kgb'}
for o in L: o['code']=FIX.get(o['code'],o['code'])
CODES=[o['code'] for o in L]
RGB=np.array([o['fill'] for o in L],float)
g=json.load(open('georef.json')); X0,Y0,s,rot=g['params']; LCC=g['lcc']
TR=Affine(s*np.cos(rot), s*np.sin(rot), X0, s*np.sin(rot), -s*np.cos(rot), Y0)  # px,py -> X,Y
def truth_code(lbl):
    t=lbl.replace('@','^').replace('&','*')
    if t=='_r': return '_u'
    if t[:1] in 'WXVU' or t[:2] in ('Wg',): return '=u'
    return t
def load_map():
    return cv2.cvtColor(cv2.imread('map.png'),cv2.COLOR_BGR2RGB)
def truth_raster(shape):
    import geopandas as gpd
    d=gpd.read_file('wy/WY_geol_poly.shp').to_crs(LCC)
    d['c']=d.ORIG_LABEL.map(truth_code)
    idx={c:i for i,c in enumerate(CODES)}
    d['i']=d.c.map(lambda c: idx.get(c,-2))
    return rasterize(((geom,int(i)) for geom,i in zip(d.geometry,d.i)),out_shape=shape,transform=TR,fill=-1,dtype='int16')
def map_mask(img):
    hsv=cv2.cvtColor(img,cv2.COLOR_RGB2HSV)
    col=(hsv[...,1]>18)|(hsv[...,2]<200)
    m=cv2.morphologyEx(col.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((41,41),np.uint8))
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    big=1+np.argmax(st[1:,4]); m=(lab==big).astype(np.uint8)
    cnt,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    out=np.zeros_like(m); cv2.drawContours(out,cnt,-1,1,-1)
    return cv2.erode(out,np.ones((15,15),np.uint8)).astype(bool)
# color groups: units with near-identical fill
def lab_of(rgb):
    return cv2.cvtColor(np.uint8(np.clip(rgb,0,255))[None],cv2.COLOR_RGB2LAB)[0].astype(float)
LEGLAB=lab_of(RGB)
GROUP=np.arange(len(CODES))
for i in range(len(CODES)):
    for j in range(i):
        if np.linalg.norm(LEGLAB[i]-LEGLAB[j])<4: GROUP[i]=GROUP[j]; break
def evaluate(pred,truth,mask):
    v=mask&(truth>=0)&(pred>=0)
    t,p=truth[v],pred[v]
    acc=(t==p).mean(); gacc=(GROUP[t]==GROUP[p]).mean()
    ious=[]; 
    for c in np.unique(t):
        a=(t==c).sum(); 
        if a<2000: continue
        inter=((t==c)&(p==c)).sum(); uni=a+(p==c).sum()-inter; ious.append(inter/uni)
    return dict(pixel_acc=round(acc,3),group_acc=round(gacc,3),mIoU=round(float(np.mean(ious)),3),coverage=round(v.sum()/(mask&(truth>=0)).sum(),3))
