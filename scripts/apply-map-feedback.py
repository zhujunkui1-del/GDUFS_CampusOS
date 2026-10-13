"""One-time owner corrections of 2026-10-13. All anchors are existing OSM nodes."""
import json
from pathlib import Path
p=Path('src/features/campus-map/data/owner-labels.json')
d=json.loads(p.read_text(encoding='utf-8')); labels=d['labels']
source='负责人2026-10-13浏览器批注与指定校区图'
labels['osm-way-313039031'].update(category='dormitory',nameSource=source)
for identifier in ('1389859440','1389859441'):
    labels['osm-way-'+identifier]={'name':'羽毛球场','category':'badminton','zone':'teaching','nameSource':source}
for identifier in ('1389859416','1389859418','1389859420','1389859423'):
    labels['osm-way-'+identifier]={'name':'排球场','category':'volleyball','zone':'teaching','nameSource':source}
for parent,names,anchors in (
    ('4105730',('E','F','G'),('3125704419','3125704391','3125704356')),
    ('4105911',('A','B','C','D','E'),('3125808975','3125808984','3125808994','3125809005','3125809014')),
):
    kind='教学楼' if parent=='4105730' else '实验楼'
    labels['osm-relation-'+parent].update(name=kind+'（'+ '/'.join(names)+'栋）',maxZoom=15.8,
        nameSource=source+'；保留整体轮廓，分栋标签按负责人朝北顺序绑定原始外环节点')
    for name,node in zip(names,anchors):
        labels['osm-node-'+node]={'name':kind+name+'栋','category':'teaching' if kind=='教学楼' else 'building',
            'zone':'teaching','minZoom':17,'parentId':'osm-relation-'+parent,
            'aliases':[kind+name,name+'栋'], 'nameSource':source+'；源轮廓标签锚点，非已核验建筑入口'}
labels['osm-way-1410275259']={'name':'下沉广场','category':'plaza','zone':'living','minZoom':15,'nameSource':'OpenStreetMap命名广场与负责人指定校区图'}
labels['osm-way-864205124']={'name':'下沉隧道','aliases':['南校隧道','南校地下隧道'],'category':'transport','zone':'connection','minZoom':15,'nameSource':source+'；OSM地下步行段，通行待确认'}
for node,name,zone in (('6110327053','下沉隧道生活区入口','living'),('6110327054','下沉隧道教学区入口','teaching')):
    labels['osm-node-'+node]={'name':name,'category':'entrance','zone':zone,'minZoom':17,'nameSource':'OSM两端台阶地面节点；负责人指定下沉隧道'}
d['confirmations']+='；本轮友苑、球场及分栋顺序依据负责人逐项批注'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
