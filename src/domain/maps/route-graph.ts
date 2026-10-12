import { distanceMeters } from "@/features/campus-map/data/geometry";
import type { Coordinate } from "@/features/campus-map/data/campus";

export type GraphNode = { id: string; coordinate: Coordinate };
export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  geometry: Coordinate[];
  verified: boolean;
  level: "ground" | "underground" | "elevated";
  sourceUrl: string;
  bidirectional: boolean;
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

// Only reviewed edges participate. A research OSM graph is never implicitly approved.
export function planVerifiedRoute(
  graph: WalkingGraph,
  startId: string,
  endId: string,
): GraphRoute | null {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodes.has(startId) || !nodes.has(endId) || startId === endId)
    return null;
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
      .reduce(
        (sum, point, index) =>
          sum + distanceMeters(edge.geometry[index], point),
        0,
      );
    if (!Number.isFinite(length) || length <= 0) continue;
    const forward = adjacency.get(edge.from) || [];
    forward.push({ edge, next: edge.to, reversed: false, length });
    adjacency.set(edge.from, forward);
    if (edge.bidirectional) {
      const reverse = adjacency.get(edge.to) || [];
      reverse.push({ edge, next: edge.from, reversed: true, length });
      adjacency.set(edge.to, reverse);
    }
  }
  const distances = new Map<string, number>([[startId, 0]]),
    visited = new Set<string>();
  const previous = new Map<
    string,
    { node: string; edge: GraphEdge; reversed: boolean }
  >();
  for (;;) {
    let current: string | undefined,
      best = Infinity;
    for (const [id, cost] of distances)
      if (!visited.has(id) && cost < best) {
        current = id;
        best = cost;
      }
    if (!current) return null;
    if (current === endId) break;
    visited.add(current);
    for (const connection of adjacency.get(current) || []) {
      const cost = best + connection.length;
      if (cost < (distances.get(connection.next) ?? Infinity)) {
        distances.set(connection.next, cost);
        previous.set(connection.next, {
          node: current,
          edge: connection.edge,
          reversed: connection.reversed,
        });
      }
    }
  }
  const chain: { node: string; edge: GraphEdge; reversed: boolean }[] = [];
  let node = endId;
  while (node !== startId) {
    const step = previous.get(node);
    if (!step) return null;
    chain.unshift(step);
    node = step.node;
  }
  const coordinates = chain.flatMap((step, i) => {
    const path = step.reversed
      ? [...step.edge.geometry].reverse()
      : step.edge.geometry;
    return i ? path.slice(1) : path;
  });
  const distance = distances.get(endId)!;
  return {
    networkVersion: graph.version,
    nodeIds: [...chain.map((s) => s.node), endId],
    edgeIds: chain.map((s) => s.edge.id),
    coordinates,
    distanceMeters: distance,
    estimatedMinutes: distance / 75,
    undergroundEdgeIds: chain
      .filter((s) => s.edge.level === "underground")
      .map((s) => s.edge.id),
  };
}
