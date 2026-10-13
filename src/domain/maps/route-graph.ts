import { distanceMeters } from "@/features/campus-map/data/geometry";
import type { Coordinate } from "@/features/campus-map/data/campus";
export type GraphNode = { id: string; coordinate: Coordinate; zone?: string };
export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  geometry: Coordinate[];
  verified: boolean;
  level: "ground" | "underground" | "elevated";
  sourceUrl: string;
  bidirectional: boolean;
  name?: string;
  stairs?: boolean;
  kind?: string;
};
export type WalkingGraph = {
  version: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};
export type GraphRoute = {
  networkVersion: string;
  nodeIds: string[];
  edgeIds: string[];
  coordinates: Coordinate[];
  distanceMeters: number;
  estimatedMinutes: number;
  undergroundEdgeIds: string[];
};
// Heap queue and a tunnel-visited state compute the constrained shortest route.
class Queue {
  items: { key: string; cost: number }[] = [];
  push(item: { key: string; cost: number }) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= item.cost) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items,
      head = a[0],
      tail = a.pop();
    if (!a.length) return head;
    let i = 0;
    while (i * 2 + 1 < a.length) {
      let c = i * 2 + 1;
      if (c + 1 < a.length && a[c + 1].cost < a[c].cost) c++;
      if (a[c].cost >= tail!.cost) break;
      a[i] = a[c];
      i = c;
    }
    a[i] = tail!;
    return head;
  }
}
export function planCandidateRoute(
  graph: WalkingGraph,
  startIds: string[],
  endIds: string[],
  tunnelSource?: string,
): GraphRoute | null {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n])),
    ends = new Set(endIds.filter((id) => nodes.has(id)));
  const adjacency = new Map<
    string,
    { edge: GraphEdge; next: string; reversed: boolean; length: number }[]
  >();
  for (const edge of graph.edges) {
    if (
      !edge.verified ||
      !edge.sourceUrl ||
      edge.geometry.length < 2 ||
      !nodes.has(edge.from) ||
      !nodes.has(edge.to)
    )
      continue;
    if (
      distanceMeters(edge.geometry[0], nodes.get(edge.from)!.coordinate) > 2 ||
      distanceMeters(edge.geometry.at(-1)!, nodes.get(edge.to)!.coordinate) > 2
    )
      continue;
    const length = edge.geometry
      .slice(1)
      .reduce((sum, p, i) => sum + distanceMeters(edge.geometry[i], p), 0);
    if (!Number.isFinite(length) || length <= 0) continue;
    const add = (from: string, next: string, reversed: boolean) => {
      const list = adjacency.get(from) || [];
      list.push({ edge, next, reversed, length });
      adjacency.set(from, list);
    };
    add(edge.from, edge.to, false);
    if (edge.bidirectional) add(edge.to, edge.from, true);
  }
  const queue = new Queue(),
    distances = new Map<string, number>(),
    previous = new Map<
      string,
      { prior: string; edge: GraphEdge; reversed: boolean }
    >();
  for (const id of startIds)
    if (nodes.has(id)) {
      const key = id + "|0";
      distances.set(key, 0);
      queue.push({ key, cost: 0 });
    }
  let final: string | undefined;
  while (queue.items.length) {
    const current = queue.pop();
    if (current.cost !== distances.get(current.key)) continue;
    const split = current.key.lastIndexOf("|"),
      id = current.key.slice(0, split),
      passed = current.key.slice(split + 1) === "1";
    if (ends.has(id) && (!tunnelSource || passed)) {
      final = current.key;
      break;
    }
    for (const item of adjacency.get(id) || []) {
      const used = passed || item.edge.sourceUrl === tunnelSource,
        key = item.next + "|" + (used ? "1" : "0"),
        cost = current.cost + item.length;
      if (cost < (distances.get(key) ?? Infinity)) {
        distances.set(key, cost);
        previous.set(key, {
          prior: current.key,
          edge: item.edge,
          reversed: item.reversed,
        });
        queue.push({ key, cost });
      }
    }
  }
  if (!final) return null;
  const chain: { edge: GraphEdge; reversed: boolean }[] = [];
  let key = final;
  while (previous.has(key)) {
    const p = previous.get(key)!;
    chain.unshift(p);
    key = p.prior;
  }
  if (!chain.length) return null;
  const coordinates = chain.flatMap((s, i) => {
      const p = s.reversed ? [...s.edge.geometry].reverse() : s.edge.geometry;
      return i ? p.slice(1) : p;
    }),
    distance = distances.get(final)!;
  return {
    networkVersion: graph.version,
    nodeIds: [
      key.slice(0, key.lastIndexOf("|")),
      ...chain.map((s) => (s.reversed ? s.edge.from : s.edge.to)),
    ],
    edgeIds: chain.map((s) => s.edge.id),
    coordinates,
    distanceMeters: distance,
    estimatedMinutes: distance / 75,
    undergroundEdgeIds: chain
      .filter((s) => s.edge.level === "underground")
      .map((s) => s.edge.id),
  };
}
export function planVerifiedRoute(
  graph: WalkingGraph,
  startId: string,
  endId: string,
) {
  if (startId === endId) return null;
  return planCandidateRoute(graph, [startId], [endId]);
}
