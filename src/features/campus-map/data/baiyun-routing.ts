import { projectOnPath } from "./route-progress";
import { exteriorGuide } from "./exterior-guide";
import exteriorNetwork from "./baiyun-exterior.json";
import graph from "./baiyun-walking.json";
import campus from "./baiyun-map.json";
import { endpointAttachment } from "./route-connectors";
export type BaiyunCoordinate = [number, number];
export type BaiyunEndpoint = { id: string; name: string; coordinate: number[] };
export type BaiyunRoute = {
  guidance?: BaiyunCoordinate[][];
  solidPath?: BaiyunCoordinate[];
  path: BaiyunCoordinate[];
  distanceMeters: number;
  seconds: number;
  sourceWayIds: string[];
  steps: Array<{ instruction: string; distance: number }>;
};
const nodes: Record<string, BaiyunCoordinate> = Object.fromEntries(
  Object.entries(graph.nodes).map(([id, p]) => [
    id,
    [p[0], p[1]] as BaiyunCoordinate,
  ]),
);
const edges = graph.edges.map((e) => ({
  from: String(e[0]),
  to: String(e[1]),
  meters: Number(e[2]),
  way: String(e[3]),
  name: String(e[4]),
}));
const adjacent = new Map<string, Array<(typeof edges)[number]>>();
for (const edge of edges) {
  for (const directed of [edge, { ...edge, from: edge.to, to: edge.from }]) {
    const bucket = adjacent.get(directed.from) || [];
    bucket.push(directed);
    adjacent.set(directed.from, bucket);
  }
}
const distance = (a: number[], b: number[]) =>
  Math.hypot(
    (a[0] - b[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360) * 111195,
    (a[1] - b[1]) * 111195,
  );
const unseen = new Set(Object.keys(nodes));
let main = new Set<string>();
while (unseen.size) {
  const component = new Set<string>(),
    queue = [[...unseen][0]];
  while (queue.length) {
    const id = queue.pop()!;
    if (!unseen.delete(id)) continue;
    component.add(id);
    for (const edge of adjacent.get(id) || []) queue.push(edge.to);
  }
  if (component.size > main.size) main = component;
}
const eligible = edges.filter((e) => main.has(e.from) && main.has(e.to));
function snap(point: number[]) {
  let edge = eligible[0],
    projection = projectOnPath(
      [point[0], point[1]],
      [nodes[edge.from], nodes[edge.to]],
    );
  for (const candidate of eligible) {
    const next = projectOnPath(
      [point[0], point[1]],
      [nodes[candidate.from], nodes[candidate.to]],
    );
    if (next.distance < projection.distance) {
      edge = candidate;
      projection = next;
    }
  }
  return { edge, projection };
}
function planBaiyunCore(
  start: BaiyunEndpoint,
  end: BaiyunEndpoint,
): BaiyunRoute {
  const a = snap(start.coordinate),
    b = snap(end.coordinate);
  const records: Array<{
    from: BaiyunCoordinate;
    to: BaiyunCoordinate;
    way: string;
    name: string;
    meters: number;
  }> = [];
  if (a.edge === b.edge)
    records.push({
      from: a.projection.coordinate,
      to: b.projection.coordinate,
      way: a.edge.way,
      name: a.edge.name,
      meters: distance(a.projection.coordinate, b.projection.coordinate),
    });
  else {
    const costs = new Map([
        [a.edge.from, a.edge.meters * a.projection.fraction],
        [a.edge.to, a.edge.meters * (1 - a.projection.fraction)],
      ]),
      open = new Set(costs.keys()),
      previous = new Map<string, (typeof edges)[number]>();
    while (open.size) {
      const id = [...open].reduce((best, id) =>
        costs.get(id)! < costs.get(best)! ? id : best,
      );
      open.delete(id);
      for (const edge of adjacent.get(id) || []) {
        const next = costs.get(id)! + edge.meters;
        if (next < (costs.get(edge.to) ?? Infinity)) {
          costs.set(edge.to, next);
          previous.set(edge.to, edge);
          open.add(edge.to);
        }
      }
    }
    const targets = [
      { id: b.edge.from, meters: b.edge.meters * b.projection.fraction },
      { id: b.edge.to, meters: b.edge.meters * (1 - b.projection.fraction) },
    ];
    const target = targets
      .filter((t) => costs.has(t.id))
      .sort(
        (a, b) => costs.get(a.id)! + a.meters - costs.get(b.id)! - b.meters,
      )[0];
    if (!target) throw Error("当前步道路网未连通。");
    let id = target.id;
    const used: Array<(typeof edges)[number]> = [];
    while (previous.has(id)) {
      const edge = previous.get(id)!;
      used.unshift(edge);
      id = edge.from;
    }
    records.push({
      from: a.projection.coordinate,
      to: nodes[id],
      way: a.edge.way,
      name: a.edge.name,
      meters: distance(a.projection.coordinate, nodes[id]),
    });
    for (const e of used)
      records.push({ ...e, from: nodes[e.from], to: nodes[e.to] });
    records.push({
      from: nodes[target.id],
      to: b.projection.coordinate,
      way: b.edge.way,
      name: b.edge.name,
      meters: distance(nodes[target.id], b.projection.coordinate),
    });
  }
  const path = [records[0].from, ...records.map((e) => e.to)].filter(
    (p, i, all) => !i || distance(p, all[i - 1]) > 0.001,
  );
  if (path.length === 1) path.push(path[0]);
  const steps: BaiyunRoute["steps"] = [];
  for (const e of records) {
    if (e.meters < 0.01) continue;
    const instruction = `沿${e.name}步行`,
      last = steps.at(-1);
    if (last?.instruction === instruction) last.distance += e.meters;
    else steps.push({ instruction, distance: e.meters });
  }
  const meters = records.reduce((n, e) => n + e.meters, 0);
  return {
    path,
    distanceMeters: meters,
    seconds: meters / 1.2,
    sourceWayIds: [
      ...new Set(records.filter((e) => e.meters > 0.01).map((e) => e.way)),
    ],
    steps: steps.map((s) => ({ ...s, distance: Math.round(s.distance) })),
  };
}
export function planBaiyunRoute(
  start: BaiyunEndpoint,
  end: BaiyunEndpoint,
): BaiyunRoute {
  if (start.id === end.id) throw Error("请选择不同的起点和终点。");
  const polygons = [campus.boundary as BaiyunCoordinate[]],
    gates = campus.places
      .filter((p) => /门$/.test(p.name))
      .map((p) => p.coordinate as BaiyunCoordinate),
    points = [...main].map((id) => nodes[id]);
  const a = endpointAttachment(
      start.coordinate as BaiyunCoordinate,
      polygons,
      gates,
      points,
      {
        segments: eligible.map(
          (e) =>
            [nodes[e.from], nodes[e.to]] as [
              BaiyunCoordinate,
              BaiyunCoordinate,
            ],
        ),
      },
    ),
    b = endpointAttachment(
      end.coordinate as BaiyunCoordinate,
      polygons,
      gates,
      points,
      {
        segments: eligible.map(
          (e) =>
            [nodes[e.from], nodes[e.to]] as [
              BaiyunCoordinate,
              BaiyunCoordinate,
            ],
        ),
      },
    );
  if (!a.inside && !b.inside) {
    const path = [start.coordinate, end.coordinate] as BaiyunCoordinate[];
    const meters = distance(path[0], path[1]);
    return {
      path,
      solidPath: [],
      guidance: [path],
      distanceMeters: meters,
      seconds: meters / 1.2,
      sourceWayIds: [],
      steps: [
        { instruction: "沿虚线引导前往终点", distance: Math.round(meters) },
      ],
    };
  }
  if (!a.inside)
    a.path = [
      ...exteriorGuide(
        start.coordinate as BaiyunCoordinate,
        a.gate,
        polygons,
        exteriorNetwork,
      ),
      a.road,
    ];
  if (!b.inside)
    b.path = [
      ...exteriorGuide(
        end.coordinate as BaiyunCoordinate,
        b.gate,
        polygons,
        exteriorNetwork,
      ),
      b.road,
    ];
  let core: BaiyunRoute;
  if (distance(a.road, b.road) < 0.1)
    core = {
      path: [a.road, b.road],
      distanceMeters: 0,
      seconds: 0,
      sourceWayIds: [],
      steps: [],
    };
  else
    core = planBaiyunCore(
      { ...start, coordinate: a.road },
      { ...end, coordinate: b.road },
    );
  const lead = [...a.path];
  if (distance(lead.at(-1)!, core.path[0]) > 0.1) lead.push(core.path[0]);
  const tail = [...b.path].reverse();
  if (distance(core.path.at(-1)!, tail[0]) > 0.1)
    tail.unshift(core.path.at(-1)!);
  const guidance = [lead, tail].filter((p) => p.length > 1),
    extra = guidance.reduce(
      (n, p) =>
        n + p.slice(1).reduce((sum, q, i) => sum + distance(p[i], q), 0),
      0,
    );
  return {
    ...core,
    solidPath: core.path,
    guidance,
    path: [...lead, ...core.path.slice(1), ...tail.slice(1)],
    distanceMeters: core.distanceMeters + extra,
    seconds: (core.distanceMeters + extra) / 1.2,
    steps: [
      ...(lead.length > 1
        ? [
            {
              instruction: a.inside
                ? "沿虚线引导前往步道"
                : "沿虚线引导前往最近校门及步道",
              distance: Math.round(
                lead.slice(1).reduce((n, p, i) => n + distance(lead[i], p), 0),
              ),
            },
          ]
        : []),
      ...core.steps,
      ...(tail.length > 1
        ? [
            {
              instruction: "沿虚线引导前往终点",
              distance: Math.round(
                tail.slice(1).reduce((n, p, i) => n + distance(tail[i], p), 0),
              ),
            },
          ]
        : []),
    ],
  };
}
