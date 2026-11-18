"""Manual offline preparation of the owner-supplied Baiyun OSM snapshot."""
import hashlib
import json
import pathlib
import xml.etree.ElementTree as ET

source = pathlib.Path('CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外白云山校区地图/白云山校区.osm')
original = ET.parse(source).getroot()
context_source = source.with_name('白云山校区_周边补充.osm')
context = ET.parse(context_source).getroot()
# The supplied campus snapshot wins for every existing source identity.
merged = {}
for document in (context, original):
    for element in document:
        if element.tag in ('node','way','relation'):
            merged[(element.tag,element.get('id'))] = element
root = ET.Element('osm')
root.append(context.find('bounds'))
root.extend(merged.values())
nodes = {e.get('id'): [float(e.get('lon')), float(e.get('lat'))] for e in root.findall('node')}
ways = {e.get('id'): e for e in root.findall('way')}
tags = lambda e: {t.get('k'): t.get('v') for t in e.findall('tag')}
refs = lambda e: [n.get('ref') for n in e.findall('nd')]
campus = [nodes[n] for n in refs(ways['338027672'])]
bounds = [float(root.find('bounds').get(k)) for k in ('minlon', 'minlat', 'maxlon', 'maxlat')]

def inside(p):
    x, y = p
    result = False
    for a, b in zip(campus, campus[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result

def kind(t):
    if t.get('building') not in (None, 'no'): return 'building'
    if t.get('natural') == 'water' or t.get('waterway'): return 'water'
    if t.get('leisure') in ('pitch', 'track', 'stadium', 'swimming_pool'): return 'sports'
    if t.get('amenity') == 'parking': return 'parking'
    if t.get('natural') in ('wood','scrub','grassland') or t.get('landuse') in ('grass','forest','meadow','village_green') or t.get('leisure') in ('park','garden'): return 'green'
    if t.get('highway') and t.get('area') != 'yes': return 'road'
    if t.get('place') == 'square' or t.get('highway') == 'pedestrian': return 'plaza'
    if t.get('landuse') or t.get('amenity') in ('university','school','college') or t.get('leisure') == 'sports_centre': return 'land'

features, places, skipped, excluded, members = [], [], [], [], set()
def emit(identifier, geometry, t):
    if '已爆破拆除' in t.get('name','') or t.get('demolished:building') or t.get('building') == 'demolished':
        excluded.append(identifier)
        return
    k = kind(t)
    if not k: return
    features.append({'type':'Feature','id':identifier,'properties':{'sourceId':identifier,'kind':k,'name':t.get('name',''),'sport':'swimming' if t.get('leisure') == 'swimming_pool' else t.get('sport',''),'highway':t.get('highway',''),'tunnel':t.get('tunnel','no')},'geometry':geometry})
    if geometry['type'] == 'LineString' or identifier == 'osm-way-338027672' or not t.get('name'): return
    points = geometry['coordinates'][0] if geometry['type'] == 'Polygon' else geometry['coordinates']
    coordinate = [(min(p[0] for p in points)+max(p[0] for p in points))/2,(min(p[1] for p in points)+max(p[1] for p in points))/2] if geometry['type'] == 'Polygon' else points
    if not inside(coordinate): return
    category = 'dormitories' if t.get('building') == 'dormitory' else 'sports' if k == 'sports' or t.get('leisure') == 'sports_centre' else 'buildings'
    if t.get('amenity') in ('restaurant','cafe','fast_food','doctors') or t.get('shop') or geometry['type'] == 'Point': category = 'services'
    places.append({'id':identifier,'name':t['name'],'coordinate':coordinate,'category':category,'minZoom':14 if t.get('amenity') == 'library' or '教学楼' in t['name'] or '食堂' in t['name'] or t.get('leisure') == 'sports_centre' or t['name'] == '行政办公楼' else 16.7,'sourceUrl':'https://www.openstreetmap.org/'+identifier.replace('osm-','').replace('-','/',1)})

def rings(parts):
    result = []
    while parts:
        chain = parts.pop(0)
        while chain[0] != chain[-1]:
            match = next((i for i,p in enumerate(parts) if chain[-1] in (p[0],p[-1])),None)
            if match is None: raise ValueError('open ring')
            part = parts.pop(match)
            chain += (part if part[0] == chain[-1] else part[::-1])[1:]
        result.append([nodes[n] for n in chain])
    return result

for relation in root.findall('relation'):
    t = tags(relation)
    if t.get('type') != 'multipolygon' or not kind(t): continue
    ms = relation.findall('member')
    try:
        if any(m.get('type') != 'way' or m.get('ref') not in ways for m in ms): raise ValueError('missing member')
        outer = rings([refs(ways[m.get('ref')]) for m in ms if m.get('role') in ('outer','')])
        inner = rings([refs(ways[m.get('ref')]) for m in ms if m.get('role') == 'inner'])
        if len(outer) != 1 and inner: raise ValueError('ambiguous inner assignment')
        if len(outer) == 1:
            parent_way = next((ways[m.get('ref')] for m in ms if m.get('role') in ('outer','')),None)
            if parent_way is not None:
                t = {**tags(parent_way), **t}
            emit('osm-relation-'+relation.get('id'),{'type':'Polygon','coordinates':outer+inner},t)
        else:
            # Complete disjoint outer rings remain one geographic source feature.
            features.append({'type':'Feature','id':'osm-relation-'+relation.get('id'),'properties':{'sourceId':'osm-relation-'+relation.get('id'),'kind':kind(t),'name':t.get('name','')},'geometry':{'type':'MultiPolygon','coordinates':[[p] for p in outer]}})
        members.update(m.get('ref') for m in ms)
    except (ValueError,KeyError) as e:
        skipped.append({'id':relation.get('id'),'reason':str(e)})

for identifier, way in ways.items():
    if identifier in members: continue
    rr = refs(way)
    if len(rr) < 2 or any(n not in nodes for n in rr): raise ValueError('Missing way geometry: '+identifier)
    points = [nodes[n] for n in rr]
    polygon = rr[0] == rr[-1] and tags(way).get('area') != 'no' and not (tags(way).get('highway') and tags(way).get('area') != 'yes')
    emit('osm-way-'+identifier,{'type':'Polygon' if polygon else 'LineString','coordinates':[points] if polygon else points},tags(way))
for e in root.findall('node'):
    t = tags(e)
    if t.get('name') and inside(nodes[e.get('id')]) and (t.get('entrance') or t.get('barrier') or t.get('amenity') or t.get('shop')):
        emit('osm-node-'+e.get('id'),{'type':'Point','coordinates':nodes[e.get('id')]},{**t,'amenity':t.get('amenity','university')})

geo = json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':')).encode()
sha = hashlib.sha256(geo).hexdigest()
url = '/maps/baiyun-'+sha[:12]+'.geojson'
pathlib.Path('public'+url).write_bytes(geo)
data = {'version':'baiyun-2026-11-18.2','crs':'WGS84','url':url,'sha256':sha,'bytes':len(geo),'bounds':bounds,'campusBounds':[min(p[0] for p in campus),min(p[1] for p in campus),max(p[0] for p in campus),max(p[1] for p in campus)],'boundary':campus,'places':places,'features':len(features),'sourceUrl':'https://www.openstreetmap.org/way/338027672','license':'ODbL-1.0','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'contextSourceUrl':'https://api.openstreetmap.org/api/0.6/map?bbox=113.272,23.185,113.303,23.224','contextSha256':hashlib.sha256(context_source.read_bytes()).hexdigest(),'excluded':excluded,'skippedRelations':skipped,'updates':'manual only'}
pathlib.Path('src/features/campus-map/data/baiyun-map.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'features':len(features),'places':len(places),'bytes':len(geo),'excluded':excluded,'skippedRelations':skipped}))
