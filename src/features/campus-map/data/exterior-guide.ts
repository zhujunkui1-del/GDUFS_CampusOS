import type { Coordinate } from "./campus";
import { distanceMeters, pointInPolygon } from "./geometry";
import { segmentAvoids } from "./navigation-geometry";
import { projectOnPath } from "./route-progress";
export type ExteriorNetwork = {
  nodes: Record<string, number[]>;
  edges: string[][];
  buildings: number[][][];
};
// Guide to the chosen gate along existing exterior source segments. Prefer the perimeter and exclude building intersections.
export function exteriorGuide(
  point: Coordinate,
  gate: Coordinate,
  polygons: Coordinate[][],
  network: ExteriorNetwork,
): Coordinate[] {
  const nodes = network.nodes as Record<string, Coordinate>;
  const buildings = network.buildings
    .filter(
      (r) =>
        !pointInPolygon(point, r as Coordinate[]) &&
        !pointInPolygon(gate, r as Coordinate[]),
    )
    .map((r) => [r as Coordinate[]]);
  const campusObstacles = polygons.map((r) => [r]);
  const weight = (a: Coordinate, b: Coordinate) =>
    [0.2, 0.4, 0.6, 0.8].some((t) => {
      const p: Coordinate = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      return (
        polygons.some(
          (r) => pointInPolygon(p, r) && projectOnPath(p, r).distance > 60,
        ) && distanceMeters(p, gate) > 80
      );
    })
      ? 30
      : 1;
  const edges = network.edges
    .filter(([a, b]) => segmentAvoids(nodes[a], nodes[b], buildings))
    .map(([from, to]) => ({
      from,
      to,
      path: [nodes[from], nodes[to]],
      length: distanceMeters(nodes[from], nodes[to]),
      weight: weight(nodes[from], nodes[to]),
    }));
  const candidates = (
    p: Coordinate,
    target = false,
    connected?: Set<string>,
  ) => {
    const sorted = edges
      .filter((e) => !connected || connected.has(e.from))
      .map((edge) => ({ edge, projection: projectOnPath(p, edge.path) }))
      .sort((a, b) => a.projection.distance - b.projection.distance);
    const selected: typeof sorted = [];
    for (const item of sorted) {
      if (
        !target &&
        selected.length &&
        item.projection.distance > selected[0].projection.distance + 15
      )
        break;
      if (target && item.projection.distance > 80) break;
      const q = item.projection.coordinate;
      if (!segmentAvoids(p, q, buildings)) continue;
      if (
        !target &&
        Array.from(
          { length: 10 },
          (_, i) =>
            [
              p[0] + ((q[0] - p[0]) * i) / 10,
              p[1] + ((q[1] - p[1]) * i) / 10,
            ] as Coordinate,
        ).some((v) =>
          polygons.some(
            (r) => pointInPolygon(v, r) && projectOnPath(v, r).distance > 60,
          ),
        )
      )
        continue;
      if (
        target &&
        Array.from(
          { length: 10 },
          (_, i) =>
            [
              q[0] + ((p[0] - q[0]) * i) / 10,
              q[1] + ((p[1] - q[1]) * i) / 10,
            ] as Coordinate,
        ).some(
          (v) =>
            polygons.some((r) => pointInPolygon(v, r)) &&
            distanceMeters(v, gate) > 80,
        )
      )
        continue;
      selected.push(item);
      if (selected.length === 16) break;
    }
    return selected;
  };
  const ends = candidates(gate, true);
  const adjacent = new Map<string, Array<{ id: string; length: number }>>();
  for (const edge of edges)
    for (const [a, b] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      const bucket = adjacent.get(a) || [];
      bucket.push({ id: b, length: edge.length * edge.weight });
      adjacent.set(a, bucket);
    }
  const connected = new Set<string>(),
    queue = ends.flatMap((e) => [e.edge.from, e.edge.to]);
  while (queue.length) {
    const id = queue.pop()!;
    if (connected.has(id)) continue;
    connected.add(id);
    for (const next of adjacent.get(id) || []) queue.push(next.id);
  }
  const starts = candidates(point, false, connected);
  const costs = new Map<string, number>(),
    open = new Set<string>(),
    previous = new Map<string, string>(),
    roots = new Map<string, Coordinate>();
  for (const item of starts)
    for (const id of [item.edge.from, item.edge.to]) {
      const cost =
        item.projection.distance +
        distanceMeters(item.projection.coordinate, nodes[id]) *
          item.edge.weight;
      if (cost < (costs.get(id) ?? Infinity)) {
        costs.set(id, cost);
        open.add(id);
        roots.set(id, item.projection.coordinate);
      }
    }
  while (open.size) {
    const id = [...open].reduce((a, b) =>
      costs.get(a)! < costs.get(b)! ? a : b,
    );
    open.delete(id);
    for (const next of adjacent.get(id) || []) {
      const cost = costs.get(id)! + next.length;
      if (cost < (costs.get(next.id) ?? Infinity)) {
        costs.set(next.id, cost);
        previous.set(next.id, id);
        open.add(next.id);
      }
    }
  }
  const targets = ends
    .flatMap((item) =>
      [item.edge.from, item.edge.to]
        .filter((id) => costs.has(id))
        .map((id) => ({
          id,
          projection: item.projection.coordinate,
          cost:
            costs.get(id)! +
            distanceMeters(nodes[id], item.projection.coordinate) *
              item.edge.weight +
            item.projection.distance,
        })),
    )
    .sort((a, b) => a.cost - b.cost);
  if (targets.length) {
    const best = targets[0],
      chain = [best.id];
    while (previous.has(chain[0])) chain.unshift(previous.get(chain[0])!);
    return [
      point,
      roots.get(chain[0])!,
      ...chain.map((id) => nodes[id]),
      best.projection,
      gate,
    ].filter((p, i, all) => !i || distanceMeters(p, all[i - 1]) > 0.05);
  }
  if (
    segmentAvoids(point, gate, buildings) &&
    segmentAvoids(point, gate, campusObstacles)
  )
    return [point, gate];
  throw Error("校外步道未连通，请在附近道路选点。");
}
