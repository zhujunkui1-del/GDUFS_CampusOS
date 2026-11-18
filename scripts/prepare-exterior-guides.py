"""Extract walking approaches and building obstacles from the existing fixed OSM files."""
import json,math,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
base=Path('CampusOS_Codex_完整设计文档_v2/assets/source_maps');out=Path('src/features/campus-map/data')
def dist(a,b):return math.hypot((a[0]-b[0])*111195*math.cos(math.radians(a[1])),(a[1]-b[1])*111195)
for campus,folder,files in [('baiyun','广外白云山校区地图',['白云山校区_周边补充.osm','白云山校区.osm']),('university','广外大学城校区地图',['大学城校区 (1).osm','大学城校区.osm'])]:
 data=json.loads((out/('baiyun-map.json' if campus=='baiyun' else 'campus.json')).read_text(encoding='utf8'))
 manifest=data if campus=='baiyun' else json.loads((out/'local-map-manifest.json').read_text(encoding='utf8'))
 bounds=manifest['bounds'];els={}
 for f in files:
  for e in ET.parse(base/folder/f).getroot():
   if e.tag in ('node','way'):els[(e.tag,e.get('id'))]=e
 tags=lambda e:{t.get('k'):t.get('v') for t in e.findall('tag')}
 ns={i:[float(e.get('lon')),float(e.get('lat'))] for (k,i),e in els.items() if k=='node'}
 def inbounds(p):return bounds[0]<=p[0]<=bounds[2] and bounds[1]<=p[1]<=bounds[3]
 def allowed(t):return t.get('foot') not in ('no','private','use_sidepath') and (t.get('access') not in ('no','private') or t.get('foot') in ('yes','designated','permissive')) and t.get('locked')!='yes' and t.get('barrier') not in ('wall','fence')
 edges=[];used=set();obstacles=[]
 for (kind,i),e in els.items():
  if kind!='way':continue
  t=tags(e);refs=[n.get('ref') for n in e.findall('nd')]
  if t.get('building') and all(r in ns for r in refs) and len(refs)>3 and refs[0]==refs[-1] and any(inbounds(ns[r]) for r in refs):obstacles.append([ns[r] for r in refs])
  if t.get('highway') not in ('service','residential','unclassified','living_street','tertiary','secondary','secondary_link','footway','path','pedestrian','steps','track') or not allowed(t):continue
  for a,b in zip(refs,refs[1:]):
   if a not in ns or b not in ns or not inbounds(ns[a]) or not inbounds(ns[b]) or not allowed(tags(els[('node',a)])) or not allowed(tags(els[('node',b)])):continue
   p,q=ns[a],ns[b]
   if dist(p,q)<.01:continue
   used.update((a,b));edges.append([a,b,i])
 result={'license':'ODbL-1.0','verification':'source_mapped','sources':[{'file':str(base/folder/f),'sha256':hashlib.sha256((base/folder/f).read_bytes()).hexdigest()} for f in files],'version':campus+'-exterior-2026-11-18.1','nodes':{i:ns[i] for i in sorted(used)},'edges':edges,'buildings':obstacles}
 path=out/(campus+'-exterior.json');path.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8');print(campus,len(used),len(edges),path.stat().st_size)
