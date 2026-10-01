# Final regularization (majority 21 px, min 400 px) on the self-trained result, then polygonize -> GeoJSON + SHP (EPSG:4326).
import os, zipfile, numpy as np, geopandas as gpd
from rasterio.features import shapes
from shapely.geometry import shape
from common import *; from seg_utils import *
M=np.load('mask.npy'); T=np.load('truth.npy'); b=np.load('B_selftrain1.npy')
lab=finish(mode_filter(fill_nearest(b,b<0),21),M,400).astype(np.int32); np.save('final.npy',lab)
print('final',evaluate(lab,T,M))
def pretty(c): return c.replace('^','Tr').replace('*','IP').replace('=u','pCu').replace('_','Cm')
FIXW={'U pper':'Upper','Low er':'Lower','rock s':'rocks','W agon':'Wagon','W hite':'White','R iver':'River','U nion':'Union','P hosphoria':'Phosphoria',
      'P ierre':'Pierre','P ahasapa':'Pahasapa','P recambrian':'Precambrian','P aleozoic':'Paleozoic','Sk ull':'Skull','Minnek ahta':'Minnekahta',
      'Chugw ater':'Chugwater','Dinw oody':'Dinwoody','Lew is':'Lewis','V entre':'Ventre','low ermost':'lowermost','w edge':'wedge','W asatch':'Wasatch','U plift':'Uplift'}
def name(s):
    for a,b_ in FIXW.items(): s=s.replace(a,b_)
    return s
geoms=[];rows=[]
for g,v in shapes(lab,mask=lab>=0,transform=TR,connectivity=4):
    k=int(v); o=L[k]; grp=[pretty(CODES[j]) for j in range(len(CODES)) if GROUP[j]==GROUP[k]]
    geoms.append(shape(g)); rows.append(dict(unit=pretty(o['code']),unit_name=name(o['desc']),alt_units='/'.join(grp) if len(grp)>1 else '',color='#%02x%02x%02x'%tuple(o['fill'])))
d=gpd.GeoDataFrame(rows,geometry=geoms,crs=LCC)
d['geometry']=d.geometry.simplify(30).make_valid()
d=d.explode(index_parts=False); d=d[d.geom_type=='Polygon']
d['area_km2']=(d.geometry.area/1e6).round(3); d=d.to_crs('EPSG:4326')
os.makedirs('out/shp',exist_ok=True)
d.to_file('out/powder_river_basin_geology.geojson',driver='GeoJSON',COORDINATE_PRECISION=6)
d.to_file('out/shp/prb_geology.shp',encoding='utf-8')
with zipfile.ZipFile('out/powder_river_basin_geology_shp.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in os.listdir('out/shp'): z.write('out/shp/'+f,f)
print(len(d),'polygons')
