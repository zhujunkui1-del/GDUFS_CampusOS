"""Manual, offline-only OSM snapshot preparation. Never called by app/build startup.

Input XML is supplied/downloaded by the maintainer, not a tile cache. Preserve
owner labels separately. Strip contributor identities. Coordinates remain WGS84.
"""
import argparse
import hashlib
import json
import pathlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--context", default="CampusOS_Codex_完整设计文档_v2/map (1).osm")
parser.add_argument("--buffer", help="Optional, manually prepared wider viewport context XML")
parser.add_argument("--version", required=True)
parser.add_argument("--source-url", action="append", default=[])
args = parser.parse_args()
base = pathlib.Path("src/features/campus-map/data")
campus = json.loads((base / "campus.json").read_text(encoding="utf-8"))
labels = json.loads((base / "owner-labels.json").read_text(encoding="utf-8"))
context = ET.parse(args.context).getroot()
buffer = ET.parse(args.buffer).getroot() if args.buffer else None
supplied_path = pathlib.Path("CampusOS_Codex_完整设计文档_v2/map.osm")
supplied = ET.parse(supplied_path).getroot()
# Owner's exact snapshot wins for existing campus geometry.
nodes, ways, relations = {}, {}, {}
for root in ((buffer, context, supplied) if buffer is not None else (context, supplied)):
    nodes.update({n.get("id"): [float(n.get("lon")), float(n.get("lat"))] for n in root.findall("node")})
    ways.update({w.get("id"): w for w in root.findall("way")})
    relations.update({r.get("id"): r for r in root.findall("relation")})
tags = lambda e: {t.get("k"): t.get("v") for t in e.findall("tag")}
b = (buffer if buffer is not None else context).find("bounds").attrib
bounds = [float(b[k]) for k in ("minlon", "minlat", "maxlon", "maxlat")]
features = []
def feature(identifier, geometry, t):
    # No synthetic buildings, entrances, heights or routable edges.
    kind = ("building" if t.get("building") not in (None, "no") else
            "water" if t.get("natural") == "water" or t.get("waterway") else
            "sports" if t.get("leisure") in ("pitch", "track", "stadium", "swimming_pool") else
            "green" if t.get("landuse") in ("grass", "forest", "meadow", "recreation_ground") or t.get("natural") in ("wood", "grassland", "scrub") or t.get("leisure") in ("park", "garden") else
            "road" if t.get("highway") else "land")
    if kind == "land" and not (t.get("landuse") or t.get("amenity") == "university"):
        return
    features.append({"type": "Feature", "id": identifier,
        "properties": {"kind": kind, "name": t.get("name", ""), "highway": t.get("highway", ""),
                       "sport": t.get("sport", ""), "tunnel": t.get("tunnel", "no"), "sourceId": identifier},
        "geometry": geometry})
for identifier, w in ways.items():
    refs = [n.get("ref") for n in w.findall("nd")]
    if len(refs) < 2 or any(n not in nodes for n in refs):
        continue
    points = [nodes[n] for n in refs]
    if max(p[0] for p in points) < bounds[0] or min(p[0] for p in points) > bounds[2] or max(p[1] for p in points) < bounds[1] or min(p[1] for p in points) > bounds[3]:
        continue
    t = tags(w)
    polygon = refs[0] == refs[-1] and len(refs) >= 4 and t.get("area") != "no" and (not t.get("highway") or t.get("area") == "yes")
    feature("osm-way-" + identifier, {"type": "Polygon" if polygon else "LineString", "coordinates": [points] if polygon else points}, t)
# Named multipolygons (e.g. lake) can span several ordered OSM ways.
for identifier, relation in relations.items():
    t = tags(relation)
    if t.get("type") != "multipolygon" or t.get("amenity") == "university":
        continue
    rings = {"outer": [], "inner": []}
    valid = True
    for role in rings:
        parts = []
        for m in relation.findall("member"):
            if m.get("type") == "way" and (m.get("role") or "outer") == role:
                w = ways.get(m.get("ref"))
                if w is None:
                    valid = False
                    break
                parts.append([n.get("ref") for n in w.findall("nd")])
        while parts:
            ring = parts.pop(0)
            while ring[0] != ring[-1]:
                match = next((i for i,p in enumerate(parts) if p[0] == ring[-1] or p[-1] == ring[-1]), None)
                if match is None:
                    valid = False
                    break
                p = parts.pop(match)
                if p[0] != ring[-1]: p.reverse()
                ring.extend(p[1:])
            if not valid or any(n not in nodes for n in ring):
                valid = False
                break
            rings[role].append([nodes[n] for n in ring])
    if valid and len(rings["outer"]) == 1:
        feature("osm-relation-" + identifier, {"type": "Polygon", "coordinates": rings["outer"] + rings["inner"]}, t)
# Apply only reviewed names to source geometry; unknown mappings stay unresolved.
places = {p["id"]: p for p in campus["places"]}
feature_index = {f["id"]: f for f in features}
for p in places.values():
    kind, identifier = p["id"].split("-")[1:]
    if kind == "way":
        w = ways.get(identifier)
        if w is None: raise ValueError("Existing place missing; review removal explicitly: " + p["id"])
        refs = [n.get("ref") for n in w.findall("nd")]
        pts = [nodes[n] for n in refs]
        p["coordinate"] = [(min(x[i] for x in pts)+max(x[i] for x in pts))/2 for i in range(2)]
        if refs[0] == refs[-1]: p["geometry"] = pts
    elif kind == "relation":
        f = feature_index.get(p["id"])
        if f is None or f["geometry"]["type"] != "Polygon": raise ValueError("Incomplete complex footprint: " + p["id"])
        rings = f["geometry"]["coordinates"]
        p["geometry"], p["geometryRings"] = rings[0], rings
        p["coordinate"] = [(min(x[i] for x in rings[0])+max(x[i] for x in rings[0]))/2 for i in range(2)]
    else:
        if identifier not in nodes: raise ValueError("Existing node missing: " + p["id"])
        p["coordinate"] = nodes[identifier]
for identifier, label in labels["labels"].items():
    if identifier not in places:
        f = feature_index.get(identifier)
        if f is None or f["geometry"]["type"] != "Polygon": raise ValueError("Reviewed geometry missing: " + identifier)
        points = f["geometry"]["coordinates"][0]
        if points[0] != points[-1]: raise ValueError("Building ring is open")
        source_kind, source_id = identifier.split("-")[1:]
        places[identifier] = {"id": identifier, "category": label["category"], "zone": label["zone"],
            "coordinate": [(min(p[0] for p in points)+max(p[0] for p in points))/2, (min(p[1] for p in points)+max(p[1] for p in points))/2],
            "geometry": points, "crs": "WGS84", "sourceUrl": "https://www.openstreetmap.org/" + source_kind + "/" + source_id,
            "sourceName": "OpenStreetMap", "fetchedAt": "2026-10-12", "verification": "source_mapped", "navigationVerified": False,
            "minZoom": 15 if label["category"] == "canteen" else 17}
        if source_kind == "relation": places[identifier]["geometryRings"] = f["geometry"]["coordinates"]
    p = places[identifier]
    old = p.get("name")
    p.update(label)
    p["aliases"] = sorted(set(p.get("aliases", []) + ([old] if old and old != label["name"] else [])))
    p["nameSource"] = label.get("nameSource", labels["source"])
    p["nameReviewedAt"] = labels["reviewedAt"]
campus["places"] = list(places.values())
campus["mapVersion"] = args.version
(base / "campus.json").write_text(json.dumps(campus, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
geo = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")).encode()
digest = hashlib.sha256(geo).hexdigest()
filename = "campus-" + digest[:12] + ".geojson"
output = pathlib.Path("public/maps")
output.mkdir(parents=True, exist_ok=True)
(output / filename).write_bytes(geo)
manifest = {"version": args.version, "crs": "WGS84", "bounds": bounds, "url": "/maps/" + filename,
    "sha256": digest, "bytes": len(geo), "features": len(features), "license": "ODbL-1.0",
    "contextSources": args.source_url or ["maintainer-supplied XML: " + args.context],
    "contextSha256": hashlib.sha256(pathlib.Path(args.context).read_bytes()).hexdigest(),
    "contextFile": pathlib.Path(args.context).name,
    "contextBounds": context.find("bounds").attrib,
    "bufferSha256": hashlib.sha256(pathlib.Path(args.buffer).read_bytes()).hexdigest() if args.buffer else None,
    "campusSourceSha256": hashlib.sha256(supplied_path.read_bytes()).hexdigest(),
    "preparedAt": datetime.now(timezone.utc).isoformat(), "updates": "manual only"}
(base / "local-map-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"places": len(places), "features": len(features), "bytes": len(geo), "version": args.version}))
