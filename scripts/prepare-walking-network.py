"""Manual source topology extraction. Never invent links or silently approve roads."""
import json
import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET
p=Path('src/features/campus-map/data')
review=json.loads((p/'walkway-review.json').read_text(encoding='utf-8'))
root=ET.parse(review['sourceFile']).getroot()
nodes={n.get('id'):[float(n.get('lon')),float(n.get('lat'))] for n in root.findall('node')}
ways={w.get('id'):w for w in root.findall('way')}
used=set(); edges=[]
for wid in review['wayIds']:
    w=ways[wid]; t={t.get('k'):t.get('v') for t in w.findall('tag')}
    refs=[n.get('ref') for n in w.findall('nd')]
    if t.get('foot') not in ('yes','designated') or t.get('access') in ('no','private'):
        raise ValueError('Review pedestrian permission explicitly: '+wid)
    used.update(refs)
    for a,b in zip(refs,refs[1:]):
        edges.append({'id':f'osm-way-{wid}:{a}-{b}','from':'osm-node-'+a,'to':'osm-node-'+b,
            'geometry':[nodes[a],nodes[b]],'verified':review['approved'],
            'level':'underground' if t.get('tunnel')=='yes' else 'ground',
            'sourceUrl':'https://www.openstreetmap.org/way/'+wid,'bidirectional':True,
            'name':'下沉隧道' if t.get('tunnel')=='yes' else '隧道连接步道'+('（台阶）' if t.get('highway')=='steps' else ''),
            'stairs':t.get('highway')=='steps'})
campus=json.loads((p/'campus.json').read_text(encoding='utf-8'))
(p/'walking-network.json').write_text(json.dumps({'version':review['version'],'mapVersion':campus['mapVersion'],'sourceSha256':hashlib.sha256(Path(review['sourceFile']).read_bytes()).hexdigest(),'nodes':[{'id':'osm-node-'+n,'coordinate':nodes[n]} for n in sorted(used)],'edges':edges},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'nodes':len(used),'edges':len(edges),'approved':review['approved']}))
