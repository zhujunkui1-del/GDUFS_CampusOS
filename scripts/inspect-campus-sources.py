"""Read supplied OSM/GeoPackage without importing contributor identities into the app."""
import collections
import hashlib
import json
import pathlib
import sqlite3
import xml.etree.ElementTree as ET

base = pathlib.Path("CampusOS_Codex_完整设计文档_v2")
xml_path = base / "map.osm"
gpkg_path = next(base.glob("planet*/**/*.gpkg"))
root = ET.parse(xml_path).getroot()
current = json.loads(pathlib.Path("src/features/campus-map/data/campus.json").read_text(encoding="utf-8"))
nodes = {n.get("id"): [float(n.get("lon")), float(n.get("lat"))] for n in root.findall("node")}
ways = {w.get("id"): w for w in root.findall("way")}
tags = lambda element: {t.get("k"): t.get("v") for t in element.findall("tag")}

def contains(point, polygon):
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > point[1]) != (yj > point[1]) and point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def in_campus(point):
    return any(contains(point, z["polygon"]) for z in current["zones"])

matched, missing, changed = [], [], []
for place in current["places"]:
    _, kind, identifier = place["id"].split("-")
    element = ways.get(identifier) if kind == "way" else root.find(f"node[@id='{identifier}']")
    if element is None:
        missing.append(place["id"])
        continue
    if kind == "way":
        points = [nodes[n.get("ref")] for n in element.findall("nd")]
        anchor = [(min(p[0] for p in points) + max(p[0] for p in points)) / 2,
                  (min(p[1] for p in points) + max(p[1] for p in points)) / 2]
    else:
        anchor = nodes[identifier]
    matched.append(place["id"])
    if max(abs(a-b) for a,b in zip(anchor, place["coordinate"])) > 1e-8:
        changed.append(place["id"])

highways = []
tunnels = []
for identifier, way in ways.items():
    t = tags(way)
    points = [nodes[n.get("ref")] for n in way.findall("nd")]
    if t.get("highway") and any(in_campus(p) for p in points):
        highways.append({"id": identifier, "name": t.get("name"), "highway": t["highway"],
                         "tunnel": t.get("tunnel"), "level": t.get("level"), "layer": t.get("layer"),
                         "foot": t.get("foot"), "access": t.get("access"),
                         "all_nodes_inside": all(in_campus(p) for p in points)})
    if t.get("tunnel") and t.get("tunnel") != "no":
        tunnels.append({"id": identifier, "name": t.get("name"), "highway": t.get("highway"),
                        "tunnel": t.get("tunnel"), "touches_campus": any(in_campus(p) for p in points)})

relation = root.find("relation[@id='13900183']")
con = sqlite3.connect(f"file:{gpkg_path.as_posix()}?mode=ro", uri=True)
layers = []
for table, data_type, min_x, min_y, max_x, max_y, srs_id in con.execute(
        "select table_name,data_type,min_x,min_y,max_x,max_y,srs_id from gpkg_contents"):
    # Table names originate in the local container's catalog, not an external request.
    table = table.replace('"', '""')
    rows = con.execute(f'select count(*) from "{table}"').fetchone()[0]
    layers.append({"name": table, "features": rows, "data_type": data_type,
                   "bounds": [min_x, min_y, max_x, max_y], "srs_id": srs_id})
expected_md5 = (gpkg_path.parent / "CHECKSUM.txt").read_text(encoding="utf-8").split()[0]
actual_md5 = hashlib.md5(gpkg_path.read_bytes()).hexdigest()
report = {
    "license": "ODbL-1.0; © OpenStreetMap contributors",
    "sources": [{"path": str(p), "bytes": p.stat().st_size,
                 "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in [xml_path, gpkg_path]],
    "osm": {"bounds": root.find("bounds").attrib,
            "counts": {kind: len(root.findall(kind)) for kind in ["node", "way", "relation"]},
            "campus_relation": {"id": "13900183", "tags": tags(relation),
                                "outer_way_ids": [m.get("ref") for m in relation.findall("member") if m.get("role") == "outer"]},
            "existing_places_matched": len(matched), "missing_place_ids": missing,
            "changed_anchor_ids": changed,
            "highways_touching_campus": highways, "tunnels_in_extract": tunnels},
    "geopackage": {"checksum_matches": actual_md5 == expected_md5, "layers": layers},
    "limitations": ["Exports retain whole crossing geometries outside the selected extent.",
                    "Two extracts share the OSM source and are not independent geography verification.",
                    "Building height, current access, entrances and underground walkability still require review.",
                    "No contributor user/uid fields are copied into this report or production data."]
}
output = pathlib.Path("docs/research/s1/supplied-data-audit.json")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"osm_counts": report["osm"]["counts"], "matched_places": len(matched),
                  "changed_anchors": changed, "missing_places": missing,
                  "highway_count": len(highways), "tunnels": tunnels,
                  "gpkg_layers": {l["name"]: l["features"] for l in layers},
                  "gpkg_checksum_matches": actual_md5 == expected_md5}, ensure_ascii=False))
