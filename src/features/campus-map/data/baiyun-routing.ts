import graph from "./baiyun-walking.json";
export type BaiyunCoordinate = [number, number];
export type BaiyunEndpoint = { id: string; name: string; coordinate: number[] };
export type BaiyunRoute = {
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
function nearest(p: number[]) {
  return Object.entries(nodes)
    .map(([id, coordinate]) => ({ id, meters: distance(p, coordinate) }))
    .filter((p) => p.meters <= 100)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 4);
}
export function planBaiyunRoute(
  start: BaiyunEndpoint,
  end: BaiyunEndpoint,
): BaiyunRoute {
  if (start.id === end.id) throw Error("请选择不同的起点和终点。");
  const sources = nearest(start.coordinate),
    targets = nearest(end.coordinate);
  if (!sources.length || !targets.length)
    throw Error("地点附近缺少可连接的步道，请选择附近地点。");
  const costs = new Map<string, number>(sources.map((p) => [p.id, p.meters]));
  const previous = new Map<string, (typeof edges)[number]>(),
    open = new Set(sources.map((p) => p.id));
  while (open.size) {
    const id = [...open].reduce((best, id) =>
      (costs.get(id) ?? Infinity) < (costs.get(best) ?? Infinity) ? id : best,
    );
    open.delete(id);
    for (const edge of adjacent.get(id) || []) {
      const cost = costs.get(id)! + edge.meters;
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost);
        previous.set(edge.to, edge);
        open.add(edge.to);
      }
    }
  }
  const target = targets
    .filter((p) => costs.has(p.id))
    .sort(
      (a, b) => costs.get(a.id)! + a.meters - costs.get(b.id)! - b.meters,
    )[0];
  if (!target) throw Error("当前步道数据无法连通这两个地点，请更换起终点。");
  const routeEdges: Array<(typeof edges)[number]> = [];
  let id = target.id;
  while (previous.has(id)) {
    const edge = previous.get(id)!;
    routeEdges.unshift(edge);
    id = edge.from;
  }
  if (!routeEdges.length)
    throw Error("两处地点靠近同一步道节点，请选择更远的起终点。");
  const path = [nodes[id], ...routeEdges.map((e) => nodes[e.to])];
  const meters = routeEdges.reduce((n, e) => n + e.meters, 0);
  const steps: Array<{ instruction: string; distance: number }> = [];
  for (const edge of routeEdges) {
    const instruction = `沿${edge.name}步行`;
    const last = steps.at(-1);
    if (last?.instruction === instruction) last.distance += edge.meters;
    else steps.push({ instruction, distance: edge.meters });
  }
  return {
    path,
    distanceMeters: meters,
    seconds: meters / 1.2,
    sourceWayIds: [...new Set(routeEdges.map((e) => e.way))],
    steps: steps.map((s) => ({ ...s, distance: Math.round(s.distance) })),
  };
}
