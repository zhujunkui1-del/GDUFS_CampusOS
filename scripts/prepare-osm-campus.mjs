// Research input is an ODbL snapshot from the official OSM API, never AMap tiles/POI.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const source = JSON.parse(
  await readFile("docs/research/s1/osm-reference.json", "utf8"),
);
const nodes = new Map(source.nodes.map((n) => [n.id, [n.lon, n.lat]]));
const ways = new Map(source.ways.map((w) => [w.id, w]));
const campus = source.relations.find((r) => r.id === "13900183");
if (!campus || campus.tags.amenity !== "university")
  throw new Error("Campus relation missing");
const parts = campus.members
  .filter((m) => m.role === "outer")
  .map((m) => [...ways.get(m.ref).nodes]);
const rings = [];
while (parts.length) {
  const ring = parts.shift();
  while (ring.at(-1) !== ring[0]) {
    const i = parts.findIndex(
      (p) => p[0] === ring.at(-1) || p.at(-1) === ring.at(-1),
    );
    if (i < 0) throw new Error("Campus boundary is incomplete");
    const part = parts.splice(i, 1)[0];
    if (part[0] !== ring.at(-1)) part.reverse();
    ring.push(...part.slice(1));
  }
  rings.push(
    ring.map((id) => {
      if (!nodes.has(id)) throw new Error("Missing boundary node");
      return nodes.get(id);
    }),
  );
}
function contains(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
function anchor(way) {
  const points = way.nodes.map((id) => nodes.get(id)).filter(Boolean);
  return [
    (Math.min(...points.map((p) => p[0])) +
      Math.max(...points.map((p) => p[0]))) /
      2,
    (Math.min(...points.map((p) => p[1])) +
      Math.max(...points.map((p) => p[1]))) /
      2,
  ];
}
const library = anchor(ways.get("307250998"));
const zones = rings.map((polygon) => ({
  id: contains(library, polygon) ? "teaching" : "living",
  polygon,
}));
if (zones.length !== 2 || new Set(zones.map((z) => z.id)).size !== 2)
  throw new Error("Both campus zones required");
function category(tags, zone) {
  if (tags.entrance && tags.name) return "entrance";
  if (tags.leisure === "swimming_pool") return "swimming";
  if (tags.leisure === "sports_hall") return "sports_hall";
  if (
    tags.sport ||
    ["pitch", "track", "stadium", "sports_centre"].includes(tags.leisure)
  ) {
    const sports = (tags.sport || "").split(";");
    if (tags.leisure === "track") return "track";
    for (const sport of [
      "basketball",
      "volleyball",
      "tennis",
      "soccer",
      "swimming",
    ])
      if (sports.includes(sport))
        return sport === "soccer" ? "football" : sport;
    return "sports";
  }
  if (tags.amenity === "library") return "library";
  if (["clinic", "post_office", "cafe"].includes(tags.amenity) || tags.shop)
    return "service";
  if (
    zone === "living" &&
    /^(北苑|南苑|(?:[7-9]|1[0-3])栋)/.test(tags.name || "")
  )
    return "dormitory";
  if (tags.amenity === "restaurant" || tags.amenity === "canteen")
    return "canteen";
  if (/教学楼/.test(tags.name || "")) return "teaching";
  if (tags.name && tags.building) return "building";
  return null;
}
const categoryNames = {
  swimming: "游泳场地",
  sports_hall: "体育馆",
  track: "田径场",
  football: "足球场",
  basketball: "篮球场",
  volleyball: "排球场",
  tennis: "网球场",
  sports: "运动场地（类型待核验）",
};
const places = [];
for (const way of source.ways) {
  if (!way.nodes.every((id) => nodes.has(id))) continue;
  const coordinate = anchor(way);
  const zone = zones.find((z) => contains(coordinate, z.polygon));
  if (!zone) continue;
  const kind = category(way.tags, zone.id);
  if (!kind) continue;
  const name = way.tags.name || categoryNames[kind];
  if (!name) continue;
  places.push({
    id: `osm-way-${way.id}`,
    name,
    category: kind,
    zone: zone.id,
    coordinate,
    crs: "WGS84",
    sourceUrl: `https://www.openstreetmap.org/way/${way.id}`,
    sourceName: "OpenStreetMap",
    fetchedAt: source.fetched_at,
    verification: "source_mapped",
    navigationVerified: false,
    minZoom: ["library", "sports_hall"].includes(kind)
      ? 15
      : kind === "dormitory"
        ? 17
        : 16,
    geometry:
      way.nodes[0] === way.nodes.at(-1)
        ? way.nodes.map((id) => nodes.get(id))
        : undefined,
  });
}
for (const node of source.nodes) {
  if (!node.tags?.name) continue;
  const coordinate = [node.lon, node.lat];
  const zone = zones.find((z) => contains(coordinate, z.polygon));
  if (!zone) continue;
  const kind = category(node.tags, zone.id);
  if (
    !kind ||
    places.some(
      (p) =>
        p.name === node.tags.name &&
        Math.hypot(p.coordinate[0] - node.lon, p.coordinate[1] - node.lat) <
          0.0001,
    )
  )
    continue;
  places.push({
    id: `osm-node-${node.id}`,
    name: node.tags.name,
    category: kind,
    zone: zone.id,
    coordinate,
    crs: "WGS84",
    sourceUrl: `https://www.openstreetmap.org/node/${node.id}`,
    sourceName: "OpenStreetMap",
    fetchedAt: source.fetched_at,
    verification: "source_mapped",
    navigationVerified: false,
    minZoom: 17,
  });
}
const paths = source.ways.filter(
  (w) =>
    ["footway", "pedestrian", "steps", "path", "service"].includes(
      w.tags.highway,
    ) &&
    w.tags.access !== "private" &&
    w.tags.foot !== "no" &&
    w.nodes.every((id) => nodes.has(id)) &&
    w.nodes.every((id) =>
      zones.some((z) => contains(nodes.get(id), z.polygon)),
    ),
);
const graphNodeIds = new Set(paths.flatMap((p) => p.nodes));
const graph = {
  version: `osm-13900183-${source.fetched_at.slice(0, 10)}`,
  verification: "pending_walkability_review",
  nodes: [...graphNodeIds].map((id) => ({
    id: `osm-node-${id}`,
    coordinate: nodes.get(id),
  })),
  ways: paths.map((w) => ({
    id: `osm-way-${w.id}`,
    nodeIds: w.nodes.map((id) => `osm-node-${id}`),
    highway: w.tags.highway,
    level: w.tags.tunnel ? "underground" : "ground",
    verified: false,
    sourceUrl: `https://www.openstreetmap.org/way/${w.id}`,
  })),
};
const output = {
  campusId: "gdufs_university_town",
  crs: "WGS84",
  sourceUrl: "https://www.openstreetmap.org/relation/13900183",
  license: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors",
  fetchedAt: source.fetched_at,
  zones,
  places,
};
await mkdir("src/features/campus-map/data", { recursive: true });
await writeFile(
  "src/features/campus-map/data/campus.json",
  JSON.stringify(output, null, 2) + "\n",
);
await writeFile(
  "docs/research/s1/pending-path-network.json",
  JSON.stringify(graph, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    zones: zones.map((z) => z.id),
    places: places.length,
    categories: Object.fromEntries(
      [...new Set(places.map((p) => p.category))].map((c) => [
        c,
        places.filter((p) => p.category === c).length,
      ]),
    ),
    pendingWays: graph.ways.length,
    pendingNodes: graph.nodes.length,
  }),
);
