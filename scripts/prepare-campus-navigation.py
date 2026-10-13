"""Manual offline GIS preparation: source roads + owner-approved walkable areas.

Install scripts/requirements-map-tools.txt into .map-tools. No map downloads.
All coordinates are WGS84; metric operations use a local planar projection.
"""
import sys, pathlib, json, math, hashlib, argparse, xml.etree.ElementTree as ET
parser=argparse.ArgumentParser()
parser.add_argument('--map-version',required=True)
parser.add_argument('--network-version',required=True)
args=parser.parse_args()
sys.path.insert(0,str(pathlib.Path('.map-tools').resolve()))
from shapely.geometry import Point, LineString, Polygon, shape
from shapely.ops import unary_union, nearest_points, transform
from shapely import make_valid

base=pathlib.Path('src/features/campus-map/data')
campus=json.loads((base/'campus.json').read_text(encoding='utf-8'))
review=json.loads((base/'owner-map-review.json').read_text(encoding='utf-8'))
manifest=json.loads((base/'local-map-manifest.json').read_text(encoding='utf-8'))
root=ET.parse('CampusOS_Codex_完整设计文档_v2/map.osm').getroot()
source_nodes={n.get('id'):[float(n.get('lon')),float(n.get('lat'))] for n in root.findall('node')}
origin=(113.392,23.066);sx=111320*math.cos(math.radians(origin[1]));sy=111320
def xy(p):return ((p[0]-origin[0])*sx,(p[1]-origin[1])*sy)
def wgs(p):return [round(origin[0]+p[0]/sx,8),round(origin[1]+p[1]/sy,8)]
def metric(g):return transform(lambda x,y,z=None:((x-origin[0])*sx,(y-origin[1])*sy),g)
zones={z['id']:Polygon([xy(p) for p in z['polygon']]).buffer(.2) for z in campus['zones']}
scope=unary_union(list(zones.values()))
def zone_of(p):return next((id for id,g in zones.items() if g.covers(Point(p))),'connection')
features=json.loads(pathlib.Path('public'+manifest['url']).read_text(encoding='utf-8'))['features']
water=unary_union([metric(shape(f['geometry'])) for f in features if f['properties']['kind']=='water' and f['geometry']['type']=='Polygon' and metric(shape(f['geometry'])).intersects(scope)])
walk_places=[p for p in campus['places'] if p.get('geometry') and (p['category']=='teaching' or p['id']=='osm-relation-4105911')]
walk_polys={p['id']:make_valid(Polygon([xy(v) for v in p['geometry']])) for p in walk_places}
walk_union=unary_union(list(walk_polys.values()))
all_buildings=unary_union([metric(shape(f['geometry'])) for f in features if f['properties']['kind']=='building' and f['geometry']['type']=='Polygon' and metric(shape(f['geometry'])).intersects(scope)])
blocked_buildings=all_buildings.difference(walk_union.buffer(.1))
def clear_connection(a,b):
    line=LineString([a,b]); return not line.intersects(water.buffer(-.15)) and not line.intersects(blocked_buildings.buffer(-.15))

nodes={};edges=[];positions={}
def node(p,id=None):
    key=tuple(wgs(p))
    if id is None and key in positions:return positions[key]
    id=id or 'gis-node-'+str(len(nodes))
    nodes[id]={'id':id,'coordinate':wgs(p),'zone':zone_of(p)};positions.setdefault(key,id)
    return id
def edge(a,b,source,kind='road',level='ground',name='校内步道',stairs=False):
    if a==b:return
    pa=xy(nodes[a]['coordinate']);pb=xy(nodes[b]['coordinate'])
    if math.dist(pa,pb)<.1:return
    edges.append({'id':f'{source}:{len(edges)}','from':a,'to':b,'geometry':[nodes[a]['coordinate'],nodes[b]['coordinate']],
       'verified':True,'level':level,'sourceUrl':source,'bidirectional':True,'name':name,'kind':kind,'stairs':stairs})
tunnel_review=json.loads((base/'walkway-review.json').read_text(encoding='utf-8'))
approved_tunnel=set(tunnel_review['wayIds'])
road_ways=[];skipped=[]
for w in root.findall('way'):
    t={t.get('k'):t.get('v') for t in w.findall('tag')};wid=w.get('id')
    if t.get('highway') not in ('service','footway','path','pedestrian','steps'):continue
    if t.get('foot') in ('no','private') or (t.get('access')=='no' and t.get('foot') not in ('yes','designated')):continue
    if t.get('service')=='parking_aisle':continue
    refs=[n.get('ref') for n in w.findall('nd')];added=False
    for a,b in zip(refs,refs[1:]):
        pa,pb=xy(source_nodes[a]),xy(source_nodes[b]);line=LineString([pa,pb])
        if wid not in approved_tunnel:
            if not scope.covers(line) or zone_of(pa)!=zone_of(pb):continue
            # Source roads are trusted geometry, but no surface connection across water.
            if line.intersects(water.buffer(-.5)) and t.get('bridge')!='yes':continue
            if line.intersects(blocked_buildings.buffer(-.5)):continue
        na=node(pa,'osm-node-'+a);nb=node(pb,'osm-node-'+b)
        edge(na,nb,'https://www.openstreetmap.org/way/'+wid,'tunnel' if t.get('tunnel')=='yes' else 'road',
             'underground' if t.get('tunnel')=='yes' else 'elevated' if t.get('bridge')=='yes' else 'ground',t.get('name') or ('下沉隧道' if t.get('tunnel')=='yes' else '校内步道'),t.get('highway')=='steps')
        added=True
    if added:road_ways.append(wid)

owner_features=[];owner_places=[]
def place(id,name,category,coordinate,geometry=None,parent=None):
    p={'id':id,'name':name,'category':category,'zone':'teaching','coordinate':coordinate,'crs':'WGS84',
       'sourceUrl':'https://www.openstreetmap.org/#map=19/'+str(coordinate[1])+'/'+str(coordinate[0]),
       'sourceName':'负责人提供的OSM坐标/原始轮廓核对','fetchedAt':review['reviewedAt'],'verification':'owner_confirmed',
       'nameSource':'负责人坐标与地图批注确认','nameReviewedAt':review['reviewedAt'],'navigationVerified':True,
       'navigationSource':'负责人确认通行/就近到达策略','navigationReviewedAt':review['reviewedAt'],'minZoom':16}
    if geometry:p['geometry']=geometry
    if parent:p['parentId']=parent
    owner_places.append(p)

# Three owner-supplied centers sit inside the actual OSM lake. Bridge axis is the
# normal of that lake's NW-SE axis, matching E/F/G-facing spans in the annotation.
lake=next(metric(shape(f['geometry'])) for f in features if f['id']=='osm-relation-19177031')
centers=[xy(b['coordinate']) for b in review['bridges']]
ax=centers[-1][0]-centers[0][0];ay=centers[-1][1]-centers[0][1];length=math.hypot(ax,ay)
normal=(-ay/length,ax/length)
bridge_bank=[];east_bank=[]
for br,c in zip(review['bridges'],centers):
    if not lake.contains(Point(c)):raise ValueError('Bridge anchor must lie in source lake')
    axis=LineString([(c[0]-normal[0]*200,c[1]-normal[1]*200),(c[0]+normal[0]*200,c[1]+normal[1]*200)])
    span=axis.intersection(lake)
    if span.geom_type!='LineString':raise ValueError('Ambiguous bridge span')
    ends=[list(span.coords)[0],list(span.coords)[-1]];ends.sort(key=lambda p:p[0])
    west,east=ends; bridge_bank.append(west);east_bank.append(east)
    nw,ne=node(west),node(east)
    edge(nw,ne,'owner-review:'+br['id'],'bridge','elevated',br['name'])
    coords=[wgs(west),wgs(c),wgs(east)]
    owner_features.append({'type':'Feature','id':br['id'],'properties':{'kind':'road','sourceId':br['id'],'name':br['name'],'bridge':'yes','highway':'footway','tunnel':'no','ownerReviewed':True},'geometry':{'type':'LineString','coordinates':coords}})
    place(br['id'],'语心桥' if br['id']=='owner-bridge-f' else br['name'],'transport',br['coordinate'],coords)
    owner_places[-1]['labelPlaceId']='owner-bridge-f'
    west_landing=nearest_points(walk_polys['osm-relation-4105730'],Point(west))[0]
    if not clear_connection(west,west_landing.coords[0]):raise ValueError('Blocked western bridge approach')
    edge(nw,node(west_landing.coords[0]),'owner-review:'+br['id'],'bridge-approach',name='语心桥')
    # Attach eastern landing to the existing eastern shore road, outside the water.
    candidates=[]
    for e in edges:
        if e['kind']!='road' or e['level']=='underground':continue
        a,b=xy(nodes[e['from']]['coordinate']),xy(nodes[e['to']]['coordinate']);line=LineString([a,b]);q=line.interpolate(line.project(Point(east)))
        if q.x>west[0] and q.distance(Point(east))<20 and clear_connection(east,(q.x,q.y)):candidates.append((q.distance(Point(east)),e,q))
    if candidates:
        _,e,q=min(candidates,key=lambda v:v[0]);nq=node((q.x,q.y));edge(e['from'],nq,e['sourceUrl']);edge(nq,e['to'],e['sourceUrl']);edge(ne,nq,'owner-review:'+br['id'],'bridge-approach',name='语心湖岸边步道')

# Owner traced the west-shore path connecting the three bridge heads. Keep it
# on the lake boundary, not a chord through water.
boundary=LineString(list(lake.exterior.coords))
def boundary_path(a,b):
    da,db=boundary.project(Point(a)),boundary.project(Point(b));lo,hi=sorted([da,db]);coords=list(boundary.coords)
    positions=[];acc=0
    for i,p in enumerate(coords):
        if i:acc+=math.dist(coords[i-1],p)
        if lo<acc<hi:positions.append(p)
    direct=[list(boundary.interpolate(lo).coords)[0]]+positions+[list(boundary.interpolate(hi).coords)[0]]
    if LineString(direct).length > boundary.length/2:raise ValueError('Review long shore connection')
    return direct if da<db else list(reversed(direct))
for side,bank in [('west',bridge_bank),('east',east_bank)]:
    for i in range(2):
        path=boundary_path(bank[i],bank[i+1]);ids=[node(v) for v in path]
        for a,b in zip(ids,ids[1:]):edge(a,b,'owner-review:'+side+'-shore','shore',name='语心湖岸边步道')
        owner_features.append({'type':'Feature','id':'owner-'+side+'-shore-'+str(i),'properties':{'kind':'road','sourceId':'owner-'+side+'-shore-'+str(i),'name':'语心湖岸边步道','bridge':'no','highway':'footway','tunnel':'no','ownerReviewed':True},'geometry':{'type':'LineString','coordinates':[wgs(p) for p in path]}})

# Build visibility graphs within the owner-approved teaching/laboratory surface.
# Room interiors/stairs/floors are not claimed; this is a ground passage policy.
if review['walkingPolicy'].get('teachingAToGContinuous'):
    # Owner confirms the open space between A-G is traversable. Derive its extent
    # from the existing footprints; preserve obstacles and all original geometry.
    teaching=unary_union([poly for pid,poly in walk_polys.items() if pid!='osm-relation-4105911'])
    surface=teaching.convex_hull.intersection(zones['teaching']).difference(water).difference(blocked_buildings)
    continuous_anchors=set()
    teaching_parts=[poly for pid,poly in walk_polys.items() if pid!='osm-relation-4105911']
    for i,part in enumerate(teaching_parts):
        for other in teaching_parts[i+1:]:
            a,b=nearest_points(part,other)
            if clear_connection(a.coords[0],b.coords[0]):
                continuous_anchors.update([node(a.coords[0]),node(b.coords[0])])
        for head in bridge_bank:
            q=nearest_points(part,Point(head))[0]
            if clear_connection(head,q.coords[0]):
                continuous_anchors.update([node(head),node(q.coords[0])])
    for i,poly in enumerate([surface] if surface.geom_type=='Polygon' else surface.geoms):
        if poly.geom_type=='Polygon':walk_polys['owner-teaching-a-g-'+str(i)]=poly
for pid,poly in walk_polys.items():
    pts=list(poly.exterior.coords)[:-1]
    # Include actual nearby road vertices and owner bridge heads on the facade.
    nearby=[(id,xy(n['coordinate'])) for id,n in list(nodes.items()) if poly.distance(Point(xy(n['coordinate'])))<20 and n['zone']=='teaching' and (not pid.startswith('owner-teaching-a-g') or id in continuous_anchors)]
    for id,p in nearby:
        q=nearest_points(poly,Point(p))[0];qq=(q.x,q.y)
        if math.dist(p,qq)>.1 and clear_connection(p,qq):
            nq=node(qq);edge(id,nq,'owner-review:'+pid,'approach',name='教学实验楼周边步道');pts.append(qq)
        elif poly.buffer(.1).covers(Point(p)):pts.append(p)
    # Keep exact source vertices; only reflex vertices are needed to turn around concavities.
    ids=list(dict.fromkeys(node(p) for p in pts))
    for i,a in enumerate(ids):
        for b in ids[i+1:]:
            line=LineString([xy(nodes[a]['coordinate']),xy(nodes[b]['coordinate'])])
            if poly.buffer(.12).covers(line) and clear_connection(*line.coords):
                edge(a,b,'owner-review:'+pid,'building_passage',name='穿过教学实验楼可通行区域')

# Octagonal part of the existing administration footprint: eight original vertices.
octagon_refs=['3125808934','3125808943','3125808950','3125808951','3125808949','3125808938','3125808933','3125808932']
octagon=[source_nodes[n] for n in octagon_refs];octagon.append(octagon[0]);op=Polygon(octagon).centroid
place('owner-bajiaolou','八角楼','building',[op.x,op.y],octagon,'osm-way-307437432')
owner_features.append({'type':'Feature','id':'owner-bajiaolou','properties':{'kind':'building','sourceId':'owner-bajiaolou','name':'八角楼','tunnel':'no','bridge':'no'},'geometry':{'type':'Polygon','coordinates':[octagon]}})
place('owner-parking-north',review['parking']['name'],'parking',review['parking']['coordinate'],review['parking'].get('geometry'))
owner_places[-1]['aliases']=['体育馆北侧停车场']
if review['parking'].get('geometry'):
    owner_features.append({'type':'Feature','id':'owner-parking-north','properties':{'kind':'parking','sourceId':'owner-parking-north','name':review['parking']['name'],'tunnel':'no','bridge':'no'},'geometry':{'type':'Polygon','coordinates':[review['parking']['geometry']]}})

# Store route obstacles for safe endpoint-to-network attachment (no crossing water
# or a dorm/library/office interior). Ground teaching/lab areas are explicitly allowed.
def rings_of(g):
    polys=[g] if g.geom_type=='Polygon' else list(g.geoms)
    return [[list(map(wgs,p.exterior.coords))]+[list(map(wgs,r.coords)) for r in p.interiors] for p in polys if p.geom_type=='Polygon']
output={'version':args.network_version,'mapVersion':args.map_version,'sourceSha256':hashlib.sha256(pathlib.Path('CampusOS_Codex_完整设计文档_v2/map.osm').read_bytes()).hexdigest(),
        'nodes':list(nodes.values()),'edges':edges,'roadWayIds':road_ways,'mandatoryTunnelSource':'https://www.openstreetmap.org/way/864205124',
        'obstacles':{'water':rings_of(water),'buildings':rings_of(blocked_buildings)},'walkablePlaceIds':list(walk_polys),'walkingPolicy':review['walkingPolicy']}
(base/'walking-network.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
(base/'owner-map-additions.json').write_text(json.dumps({'features':owner_features,'places':owner_places,'review':review['reviewedAt'],'method':'负责人WGS84桥位、方向/连通确认与OSM岸线计算；不复制供应商几何；原始楼宇顶点与轮廓保留'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'nodes':len(nodes),'edges':len(edges),'roadWays':len(road_ways),'placesAdded':len(owner_places),'bridges':len(centers)}))
