import {
  planCandidateRoute,
  type WalkingGraph,
  type GraphEdge,
} from "@/domain/maps/route-graph";
import raw from "./walking-network.json";
import {
  campusData,
  CoordinateSchema,
  type Coordinate,
  type CampusPlace,
} from "./campus";
import { z } from "zod";
import { distanceMeters, pointInPolygon } from "./geometry";
import { projectOnPath } from "./route-progress";
import {
  closestToBoundary,
  segmentAvoids,
  segmentInside,
} from "./navigation-geometry";
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
const obstacles = [
    ...raw.obstacles.water,
    ...raw.obstacles.buildings,
  ] as Coordinate[][][],
  water = raw.obstacles.water as Coordinate[][][];
const candidates = tunnelNetwork.edges.filter((e) => e.level !== "underground"),
  areaPlaces = campusData.places.filter((p) =>
    raw.walkablePlaceIds.includes(p.id),
  );
const clear = (a: Coordinate, b: Coordinate) => segmentAvoids(a, b, obstacles);
type EndpointOption = {
  edge: GraphEdge;
  road: Coordinate;
  boundary: Coordinate;
  distance: number;
};
const endpointCache = new Map<string, EndpointOption[]>();
function targetRing(place: CampusPlace) {
  const parent =
    place.parentId && campusData.places.find((p) => p.id === place.parentId);
  return place.geometry?.length && place.geometry.length > 3
    ? place.geometry
    : parent
      ? parent.geometry
      : undefined;
}
function belongsToPart(place: CampusPlace, p: Coordinate) {
  if (!place.parentId || place.geometry) return true;
  return campusData.places
    .filter((v) => v.parentId === place.parentId && !v.geometry)
    .every(
      (v) =>
        v.id === place.id ||
        distanceMeters(p, place.coordinate) <=
          distanceMeters(p, v.coordinate) + 0.5,
    );
}
export function planLocalRoute(
  start: RoutePoint,
  end: RoutePoint,
): CampusRoute | null {
  if (!raw.walkingPolicy.campusRoadsApproved) return null;
  if (raw.mapVersion !== campusData.mapVersion)
    throw new Error("路线数据版本与底图不一致，请由维护者手动更新路网。");
  const graph: WalkingGraph = {
    version: raw.version,
    nodes: [...tunnelNetwork.nodes],
    edges: [...tunnelNetwork.edges],
  };
  const addNode = (p: Coordinate) => {
    const id = "selection:" + graph.nodes.length;
    graph.nodes.push({ id, coordinate: p });
    return id;
  };
  const splits = new Map<
    string,
    { edge: GraphEdge; points: { fraction: number; id: string }[] }
  >();
  const addEdge = (a: string, b: string, source: string, name: string) => {
    const x = graph.nodes.find((n) => n.id === a)!.coordinate,
      y = graph.nodes.find((n) => n.id === b)!.coordinate;
    if (distanceMeters(x, y) > 0.03)
      graph.edges.push({
        id: "selection-edge:" + graph.edges.length,
        from: a,
        to: b,
        geometry: [x, y],
        verified: true,
        level: "ground",
        sourceUrl: source,
        bidirectional: true,
        name,
        kind: "approach",
      });
  };
  const attach = (point: RoutePoint) => {
    const coordinate = toWgs84(point.coordinateGcj02),
      place = point.placeId
        ? campusData.places.find((p) => p.id === point.placeId)
        : undefined,
      ring = place ? targetRing(place) : undefined;
    const cacheKey = point.placeId || coordinate.join(",");
    let options = endpointCache.get(cacheKey);
    if (!options) {
      options = [];
      for (const edge of candidates) {
        const a = edge.geometry[0],
          b = edge.geometry.at(-1)!;
        const option = ring
          ? closestToBoundary(a, b, ring)
          : (() => {
              const p = projectOnPath(coordinate, edge.geometry);
              return {
                road: p.coordinate,
                boundary: coordinate,
                distance: p.distance,
              };
            })();
        if (
          option.distance > (place ? 80 : 30) ||
          (place && !belongsToPart(place, option.boundary)) ||
          (!(edge.kind === "bridge" && option.distance < 0.3) &&
            !clear(option.road, option.boundary))
        )
          continue;
        options.push({ edge, ...option });
      }
      options.sort((a, b) => a.distance - b.distance);
      endpointCache.set(cacheKey, options);
      if (endpointCache.size > 200)
        endpointCache.delete(endpointCache.keys().next().value!);
    }
    const chosen: typeof options = [];
    for (const p of options) {
      if (!chosen.some((c) => distanceMeters(c.boundary, p.boundary) < 8))
        chosen.push(p);
      if (chosen.length === 16) break;
    }
    const ids: string[] = [];
    for (const p of chosen) {
      const roadId =
          distanceMeters(p.road, p.edge.geometry[0]) < 0.15
            ? p.edge.from
            : distanceMeters(p.road, p.edge.geometry.at(-1)!) < 0.15
              ? p.edge.to
              : addNode(p.road),
        boundaryId =
          distanceMeters(p.road, p.boundary) < 0.1
            ? roadId
            : addNode(p.boundary);
      const split = splits.get(p.edge.id) || {
        edge: p.edge,
        points: [
          { fraction: 0, id: p.edge.from },
          { fraction: 1, id: p.edge.to },
        ],
      };
      split.points.push({
        fraction: projectOnPath(p.road, p.edge.geometry).fraction,
        id: roadId,
      });
      splits.set(p.edge.id, split);
      if (boundaryId !== roadId)
        addEdge(
          roadId,
          boundaryId,
          "owner-review:arrival-policy",
          "走到建筑周边",
        );
      ids.push(boundaryId);
    }
    if (!place)
      for (const area of areaPlaces)
        if (area.geometry && pointInPolygon(coordinate, area.geometry)) {
          const id = addNode(coordinate);
          ids.push(id);
          for (const n of tunnelNetwork.nodes)
            if (
              segmentInside(coordinate, n.coordinate, area.geometry) &&
              segmentAvoids(coordinate, n.coordinate, water)
            )
              addEdge(
                id,
                n.id,
                "owner-review:" + area.id,
                "穿过教学实验楼可通行区域",
              );
          break;
        }
    return ids;
  };
  const starts = attach(start),
    ends = attach(end);
  for (const { edge, points } of splits.values()) {
    points.sort((a, b) => a.fraction - b.fraction);
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1].id,
        to = points[i].id;
      if (from === to) continue;
      const a = graph.nodes.find((n) => n.id === from)!.coordinate,
        b = graph.nodes.find((n) => n.id === to)!.coordinate;
      if (distanceMeters(a, b) > 0.03)
        graph.edges.push({
          ...edge,
          id: "split:" + graph.edges.length,
          from,
          to,
          geometry: [a, b],
        });
    }
  }
  if (!starts.length || !ends.length) return null;
  const cross =
    start.zone !== end.zone &&
    start.zone !== "connection" &&
    end.zone !== "connection";
  const planned = planCandidateRoute(
    graph,
    starts,
    ends,
    cross ? raw.mandatoryTunnelSource : undefined,
  );
  if (!planned || planned.distanceMeters < 3) return null;
  const used = planned.edgeIds.map((id) =>
      graph.edges.find((e) => e.id === id)!,
    ),
    steps: CampusRoute["steps"] = [];
  for (const [i, e] of used.entries()) {
    const length = e.geometry
      .slice(1)
      .reduce((sum, p, j) => sum + distanceMeters(e.geometry[j], p), 0);
    if (length < 0.2) continue;
    const instruction =
      e.level === "underground"
        ? "进入并穿过下沉隧道"
        : used[i - 1]?.level === "underground"
          ? "离开隧道，沿台阶步行"
          : e.kind === "building_passage"
            ? "穿过教学实验楼可通行区域"
            : e.kind === "bridge"
              ? "经过" + e.name
              : e.stairs
                ? "沿台阶步行，请留意脚下"
                : e.name?.startsWith("语心")
                  ? "沿语心湖岸边步道步行"
                  : "沿校内步道步行";
    const prev = steps.at(-1);
    if (prev?.instruction === instruction) prev.distance += length;
    else steps.push({ instruction, distance: length });
  }
  steps.forEach((s) => (s.distance = Math.max(1, Math.round(s.distance))));
  return {
    id: crypto.randomUUID(),
    start,
    end,
    pathGcj02: planned.coordinates.map(toGcj02),
    distanceMeters: planned.distanceMeters,
    seconds: planned.distanceMeters / 1.25,
    steps,
    source: "CampusOS.OSM",
    verification: "reviewed_source_network",
    networkVersion: raw.version,
    snapDistances: {
      start: distanceMeters(
        toWgs84(start.coordinateGcj02),
        planned.coordinates[0],
      ),
      end: distanceMeters(
        toWgs84(end.coordinateGcj02),
        planned.coordinates.at(-1)!,
      ),
    },
    undergroundPathGcj02: used
      .filter((e) => e.level === "underground")
      .map((e) => e.geometry.map(toGcj02)),
  };
}
export function nearestTunnelDistance(p: Coordinate) {
  return Math.min(
    ...tunnelNetwork.edges
      .filter((e) => e.kind === "tunnel" || e.stairs)
      .map((e) => projectOnPath(p, e.geometry).distance),
  );
}
