import {
  planVerifiedRoute,
  type WalkingGraph,
} from "@/domain/maps/route-graph";
import raw from "./walking-network.json";
import review from "./walkway-review.json";
import { projectOnPath } from "./route-progress";
import { campusData, CoordinateSchema, type Coordinate } from "./campus";
import { z } from "zod";
import { distanceMeters } from "./geometry";
import { toGcj02, toWgs84 } from "../adapters/online-services";
import type { CampusRoute, RoutePoint } from "../adapters/amap-adapter";

export const tunnelNetwork: WalkingGraph = {
  version: raw.version,
  nodes: raw.nodes.map((n) => ({
    ...n,
    coordinate: CoordinateSchema.parse(n.coordinate),
  })),
  edges: raw.edges.map((e) => ({
    ...e,
    geometry: e.geometry.map((p) => CoordinateSchema.parse(p)),
    level: z.enum(["ground", "underground", "elevated"]).parse(e.level),
  })),
};
export function planLocalRoute(
  start: RoutePoint,
  end: RoutePoint,
): CampusRoute | null {
  if (!review.approved) return null;
  if (raw.mapVersion !== campusData.mapVersion)
    throw new Error("路线数据版本与底图不一致，请由维护者手动更新路网。");
  const graph: WalkingGraph = {
    version: raw.version,
    nodes: [...tunnelNetwork.nodes],
    edges: [...tunnelNetwork.edges],
  };
  const attach = (point: RoutePoint, id: string) => {
    const coordinate = toWgs84(point.coordinateGcj02);
    const nearest = graph.edges
      .filter((e) => e.verified)
      .map((edge) => ({ edge, snap: projectOnPath(coordinate, edge.geometry) }))
      .sort((a, b) => a.snap.distance - b.snap.distance)[0];
    if (!nearest || nearest.snap.distance > 25) return null;
    const { edge, snap } = nearest;
    if (snap.fraction < 0.00001)
      return { id: edge.from, distance: snap.distance };
    if (snap.fraction > 0.99999)
      return { id: edge.to, distance: snap.distance };
    graph.nodes.push({ id, coordinate: snap.coordinate });
    // Splitting a source segment preserves its topology, including both selections on the same segment.
    graph.edges = graph.edges.filter((e) => e.id !== edge.id);
    graph.edges.push(
      {
        ...edge,
        id: edge.id + ":a",
        to: id,
        geometry: [edge.geometry[0], snap.coordinate],
      },
      {
        ...edge,
        id: edge.id + ":b",
        from: id,
        geometry: [snap.coordinate, edge.geometry.at(-1)!],
      },
    );
    return { id, distance: snap.distance };
  };
  const a = attach(start, "selection:start"),
    b = attach(end, "selection:end");
  if (a === null || b === null) return null;
  const route = planVerifiedRoute(graph, a.id, b.id);
  if (!route || route.distanceMeters < 5) return null;
  const used = route.edgeIds.map((id) => graph.edges.find((e) => e.id === id)!);
  const steps = used.map((edge) => {
    const distance = Math.round(
      edge.geometry
        .slice(1)
        .reduce((sum, p, n) => sum + distanceMeters(edge.geometry[n], p), 0),
    );
    const underground = edge.level === "underground";
    const instruction = underground
      ? "穿过下沉隧道"
      : edge.stairs
        ? "沿台阶步行，请留意脚下"
        : "沿连接步道步行";
    return { instruction, distance };
  });
  return {
    id: crypto.randomUUID(),
    start,
    end,
    pathGcj02: route.coordinates.map(toGcj02),
    distanceMeters: route.distanceMeters,
    seconds: route.distanceMeters / 1.25,
    steps,
    source: "CampusOS.OSM",
    verification: "reviewed_source_network",
    networkVersion: raw.version,
    snapDistances: { start: a.distance, end: b.distance },
    undergroundPathGcj02: used
      .filter((e) => e.level === "underground")
      .map((e) => e.geometry.map(toGcj02)),
  };
}
export function nearestTunnelDistance(point: Coordinate) {
  return Math.min(
    ...raw.edges.map(
      (e) => projectOnPath(point, e.geometry as Coordinate[]).distance,
    ),
  );
}
