"""One-time calibration of the owner's annotated CampusOS/OSM screenshot.

Does not edit/publish the raster. The existing gym's exact OSM footprint is the
control object. Reject mismatched/perspective images; never guess world coords.
"""
import json,math,hashlib
from pathlib import Path
from PIL import Image
image_path=Path('C:/Users/zhuju/Downloads/停车场_.png')
im=Image.open(image_path).convert('RGB');pixels=im.load()
base=Path('src/features/campus-map/data')
catalogue=json.loads((base/'campus.json').read_text(encoding='utf-8'))
ring=next(p for p in catalogue['places'] if p['id']=='osm-way-1389756844')['geometry']
box=[85,481,394,754] # Observed connected gym fill bounds in this exact image.
merc=lambda lat:math.log(math.tan(math.pi/4+math.radians(lat)/2))
inv=lambda y:math.degrees(2*math.atan(math.exp(y))-math.pi/2)
lon0,lon1=min(p[0] for p in ring),max(p[0] for p in ring)
y0,y1=min(merc(p[1]) for p in ring),max(merc(p[1]) for p in ring)
def geo(x,y):return [round(lon0+(x-box[0])*(lon1-lon0)/(box[2]-box[0]),8),round(inv(y1-(y-box[1])*(y1-y0)/(box[3]-box[1])),8)]
residual=[]
for p in ring:
 x=(p[0]-lon0)/(lon1-lon0)*(box[2]-box[0])+box[0];y=(y1-merc(p[1]))/(y1-y0)*(box[3]-box[1])+box[1]
 matches=[]
 for yy in range(round(y)-4,round(y)+5):
  for xx in range(round(x)-4,round(x)+5):
   r,g,b=pixels[xx,yy]
   if abs(r-224)<4 and abs(g-216)<4 and abs(b-206)<4:matches.append(math.hypot(xx-x,yy-y))
 residual.append(min(matches) if matches else 99)
if max(residual)>1.5:raise ValueError('Image no longer matches north-up flat OSM control footprint')
outline=[(236,207),(599,207),(599,307),(703,307),(703,423),(399,423),(399,307),(236,307),(236,207)]
review=json.loads((base/'owner-map-review.json').read_text(encoding='utf-8'))
review['parking']['geometry']=[geo(x,y) for x,y in outline]
review['parking']['geometrySource']='负责人在CampusOS真实OSM底图上红框描绘；用原始体育馆轮廓校准，不是根据无参照图片猜坐标'
review['parking']['calibration']={'sourceSha256':hashlib.sha256(image_path.read_bytes()).hexdigest(),'control':'osm-way-1389756844','controlPixelBounds':box,'maximumControlResidualPixels':max(residual),'note':'影像重合残差，不等于现场测绘精度；用户给定停车场WGS84点位于标注南边界'}
(base/'owner-map-review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'controlResidualPixels':max(residual),'outlineVertices':len(outline)}))
