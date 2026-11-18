"""Build a fixed, source-node-connected pedestrian graph; no synthetic links."""
import xml.etree.ElementTree as ET
import pathlib,json,math,hashlib
base=pathlib.Path('CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外白云山校区地图')
elements={}
for name in ['白云山校区_周边补充.osm','白云山校区.osm']:
    for e in ET.parse(base/name).getroot():
        if e.tag in ('node','way'): elements[(e.tag,e.get('id'))]=e
tags=lambda e:{t.get('k'):t.get('v') for t in e.findall('tag')}
nodes={id:e for (kind,id),e in elements.items() if kind=='node'}
coords={id:[float(e.get('lon')),float(e.get('lat'))] for id,e in nodes.items()}
boundary=json.loads(pathlib.Path('src/features/campus-map/data/baiyun-map.json').read_text(encoding='utf-8'))['boundary']
def inside(p):
    x,y=p;c=False
    for a,b in zip(boundary,boundary[1:]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]: c=not c
    return c
def allowed(t):
    return t.get('foot') not in ('no','private','use_sidepath') and (t.get('access') not in ('no','private') or t.get('foot') in ('yes','designated','permissive')) and t.get('locked')!='yes' and t.get('barrier') not in ('wall','fence')
edges=[]; used=set()
for (kind,id),e in elements.items():
    if kind!='way':continue
    t=tags(e)
    if t.get('highway') not in ('service','residential','unclassified','living_street','tertiary','footway','path','pedestrian','steps','track') or not allowed(t):continue
    refs=[n.get('ref') for n in e.findall('nd')]
    for a,b in zip(refs,refs[1:]):
        if a not in coords or b not in coords or not allowed(tags(nodes[a])) or not allowed(tags(nodes[b])):continue
        p,q=coords[a],coords[b]
        if not all(inside(v) for v in (p,q,[(p[0]+q[0])/2,(p[1]+q[1])/2])):continue
        distance=math.hypot((p[0]-q[0])*math.cos(math.radians((p[1]+q[1])/2))*111195,(p[1]-q[1])*111195)
        if distance<=0:continue
        used.update((a,b));edges.append([a,b,round(distance,3),id,t.get('name') or ('台阶' if t['highway']=='steps' else '校内步道'),t['highway']])
data={'version':'baiyun-walking-2026-11-18.1','crs':'WGS84','verification':'source_mapped','nodes':{id:coords[id] for id in sorted(used)},'edges':edges}
pathlib.Path('src/features/campus-map/data/baiyun-walking.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'nodes':len(used),'edges':len(edges),'ways':len(set(e[3] for e in edges))}))
