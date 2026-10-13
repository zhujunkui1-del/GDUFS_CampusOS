"""Read owner OSM geometry for the S1 feedback; no network or inferred geometry."""
import json
import pathlib
import xml.etree.ElementTree as ET

base = pathlib.Path('CampusOS_Codex_完整设计文档_v2')
root = ET.parse(base / 'map.osm').getroot()
nodes = {n.get('id'): [float(n.get('lon')), float(n.get('lat'))] for n in root.findall('node')}
ways = {w.get('id'): w for w in root.findall('way')}
tags = lambda e: {t.get('k'): t.get('v') for t in e.findall('tag')}
campus = json.loads(pathlib.Path('src/features/campus-map/data/campus.json').read_text(encoding='utf-8'))
for i in (25,27,29,32,46,47,78,83,84):
    p = campus['places'][i-1]
    print('comment marker', i, p['id'], p['name'], p['coordinate'])
for rid in ('4105730','4105911'):
    r = root.find(f"relation[@id='{rid}']")
    print('relation',rid,tags(r),[(m.attrib) for m in r.findall('member')])
roads=[]
for identifier,w in ways.items():
    t=tags(w)
    pts=[nodes[n.get('ref')] for n in w.findall('nd')]
    if t.get('highway') and any(113.387 < p[0] < 113.399 and 23.060 < p[1] < 23.073 for p in pts):
        roads.append({'id':identifier,'tags':t,'refs':[n.get('ref') for n in w.findall('nd')], 'points':pts})
print('roads',len(roads))
for r in roads:
    if r['tags'].get('bridge') == 'yes' or r['tags'].get('tunnel') == 'yes':
        print('special road',r['id'],r['tags'],len(r['refs']),r['points'][0],r['points'][-1])
out=pathlib.Path('docs/research/s1')
(out/'feedback-source-roads.json').write_text(json.dumps(roads,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
features=json.loads(next(pathlib.Path('public/maps').glob('campus-192268*.geojson')).read_text(encoding='utf-8'))['features']
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2000" viewBox="0 0 1600 2000"><rect width="1600" height="2000" fill="#fff"/>']
def xy(p):return ((p[0]-113.386)*115000, (23.0735-p[1])*110000)
for f in features:
    g=f['geometry'];t=f['properties']
    if g['type']!='Polygon':continue
    if t['kind'] not in ('building','water','sports'):continue
    p=g['coordinates'][0];x,y=xy(p[0])
    if not -200<x<1800 or not -200<y<2200:continue
    d=' '.join(('M' if i==0 else 'L')+f'{xy(v)[0]:.1f},{xy(v)[1]:.1f}' for i,v in enumerate(p))+'Z'
    svg.append(f'<path d="{d}" fill="{dict(building="#ddd5cb",water="#b9dce9",sports="#b4cbae")[t["kind"]]}" stroke="#999" stroke-width="1"/>')
    if t['kind']=='sports':
        c=[sum(v[i] for v in p)/len(p) for i in (0,1)];cx,cy=xy(c)
        svg.append(f'<text x="{cx}" y="{cy}" font-size="9">{f["id"].replace("osm-way-","")}</text>')
for r in roads:
    d=' '.join(('M' if i==0 else 'L')+f'{xy(v)[0]:.1f},{xy(v)[1]:.1f}' for i,v in enumerate(r['points']))
    svg.append(f'<path d="{d}" fill="none" stroke="{"#a000c0" if r["tags"].get("tunnel")=="yes" else "#0068bb"}" stroke-width="3"/>')
    mid=r['points'][len(r['points'])//2];x,y=xy(mid)
    svg.append(f'<text x="{x}" y="{y}" font-size="10" fill="#00356b">{r["id"]}</text>')
svg.append('</svg>')
(out/'feedback-source-network.svg').write_text('\n'.join(svg),encoding='utf-8')
from PIL import Image, ImageDraw
im=Image.new('RGB',(1600,2000),'white'); draw=ImageDraw.Draw(im)
for f in features:
    g=f['geometry']; kind=f['properties']['kind']
    if g['type']!='Polygon' or kind not in ('building','water','sports'): continue
    p=g['coordinates'][0]; x,y=xy(p[0])
    if not -200<x<1800 or not -200<y<2200:continue
    draw.polygon([xy(v) for v in p],fill=dict(building='#ddd5cb',water='#b9dce9',sports='#b4cbae')[kind],outline='#999')
    for inner in g['coordinates'][1:]: draw.polygon([xy(v) for v in inner],fill='white')
    if kind=='sports':
        c=[sum(v[i] for v in p)/len(p) for i in (0,1)]
        draw.text(xy(c),f['id'].replace('osm-way-',''),fill='black')
for r in roads:
    draw.line([xy(v) for v in r['points']],fill='#a000c0' if r['tags'].get('tunnel')=='yes' else '#0068bb',width=3)
    draw.text(xy(r['points'][len(r['points'])//2]),r['id'],fill='#00356b')
for rid in ('4105730','4105911'):
    p=next(p for p in campus['places'] if p['id']=='osm-relation-'+rid)
    draw.text(xy(p['coordinate']),rid,fill='red')
im.save(out/'feedback-source-network.png')
