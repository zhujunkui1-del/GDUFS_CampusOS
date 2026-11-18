import {
  planLocalRoute,
  tunnelNetwork,
  nearestTunnelDistance,
} from "./local-routing";
import { campusData, type Coordinate } from "./campus";
import { exteriorGuide } from "./exterior-guide";
import exteriorNetwork from "./university-exterior.json";
import { endpointAttachment } from "./route-connectors";
import { distanceMeters, pointInPolygon } from "./geometry";
import { toGcj02, toWgs84 } from "../adapters/online-services";
import type { RoutePoint, CampusRoute } from "../adapters/amap-adapter";
export async function planCampusRoute(
  start: RoutePoint,
  end: RoutePoint,
): Promise<CampusRoute> {
  const polygons = campusData.zones.map((z) => z.polygon),
    gates = campusData.places
      .filter((p) => p.category === "entrance")
      .map((p) => p.coordinate),
    nodes = tunnelNetwork.nodes.map((n) => n.coordinate);
  const segments = tunnelNetwork.edges
    .filter((e) => e.level !== "underground")
    .flatMap((e) =>
      e.geometry
        .slice(1)
        .map((p, i) => [e.geometry[i], p] as [Coordinate, Coordinate]),
    );
  const attachment = (p: Coordinate) =>
    endpointAttachment(p, polygons, gates, nodes, {
      segments,
      inside:
        polygons.some((polygon) => pointInPolygon(p, polygon)) ||
        nearestTunnelDistance(p) <= 25,
    });
  const s = toWgs84(start.coordinateGcj02),
    e = toWgs84(end.coordinateGcj02),
    a = attachment(s),
    b = attachment(e);
  if (!a.inside && !b.inside) {
    const meters = distanceMeters(s, e);
    return {
      id: crypto.randomUUID(),
      start,
      end,
      pathGcj02: [start.coordinateGcj02, end.coordinateGcj02],
      solidPathGcj02: [],
      guidancePathsGcj02: [[start.coordinateGcj02, end.coordinateGcj02]],
      distanceMeters: meters,
      seconds: meters / 1.25,
      steps: [
        { instruction: "沿虚线引导前往终点", distance: Math.round(meters) },
      ],
      source: "CampusOS.OSM",
      verification: "reviewed_source_network",
      networkVersion: tunnelNetwork.version,
    };
  }
  if (!a.inside)
    a.path = [...exteriorGuide(s, a.gate, polygons, exteriorNetwork), a.road];
  if (!b.inside)
    b.path = [...exteriorGuide(e, b.gate, polygons, exteriorNetwork), b.road];
  const point = (original: RoutePoint, road: Coordinate): RoutePoint => ({
    ...original,
    source: "user_map_selection",
    placeId: undefined,
    coordinateGcj02: toGcj02(road),
    zone:
      campusData.zones.find((z) => pointInPolygon(road, z.polygon))?.id ||
      original.zone,
  });
  let core = a.inside && b.inside ? planLocalRoute(start, end) : null;
  if (!core) core = planLocalRoute(point(start, a.road), point(end, b.road));
  if (!core && distanceMeters(a.road, b.road) < 3)
    core = {
      id: crypto.randomUUID(),
      start,
      end,
      pathGcj02: [toGcj02(a.road), toGcj02(b.road)],
      distanceMeters: distanceMeters(a.road, b.road),
      seconds: 0,
      steps: [],
      source: "CampusOS.OSM",
      verification: "reviewed_source_network",
      networkVersion: tunnelNetwork.version,
    };
  if (!core) throw Error("当前步道路网未连通，请调整校内接入点。");
  const solid = core.pathGcj02.slice(core.approachPathGcj02 ? 1 : 0),
    lead = a.inside ? [start.coordinateGcj02] : a.path.map(toGcj02),
    tail = b.inside ? [end.coordinateGcj02] : b.path.map(toGcj02);
  if (distanceMeters(toWgs84(lead.at(-1)!), toWgs84(solid[0])) > 0.2)
    lead.push(solid[0]);
  if (distanceMeters(toWgs84(tail.at(-1)!), toWgs84(solid.at(-1)!)) > 0.2)
    tail.push(solid.at(-1)!);
  lead[0] = start.coordinateGcj02;
  tail[0] = end.coordinateGcj02;
  tail.reverse();
  const guidance = [lead, tail].filter((p) => p.length > 1),
    extra = guidance.reduce(
      (n, p) =>
        n +
        p
          .slice(1)
          .reduce(
            (sum, q, i) => sum + distanceMeters(toWgs84(p[i]), toWgs84(q)),
            0,
          ),
      0,
    );
  const length = (path: Coordinate[]) =>
    path
      .slice(1)
      .reduce(
        (sum, p, i) => sum + distanceMeters(toWgs84(path[i]), toWgs84(p)),
        0,
      );
  const solidDistance =
    core.distanceMeters -
    (core.approachPathGcj02 ? length(core.approachPathGcj02) : 0);
  return {
    ...core,
    start,
    end,
    approachPathGcj02: undefined,
    solidPathGcj02: solid,
    guidancePathsGcj02: guidance,
    pathGcj02: [...lead, ...solid.slice(1), ...tail.slice(1)],
    distanceMeters: solidDistance + extra,
    seconds: (solidDistance + extra) / 1.25,
    steps: [
      ...(lead.length > 1
        ? [
            {
              instruction: a.inside
                ? "沿虚线引导前往步道"
                : "沿虚线引导前往最近校门及步道",
              distance: Math.round(length(lead)),
            },
          ]
        : []),
      ...core.steps.slice(core.approachPathGcj02 ? 1 : 0),
      ...(tail.length > 1
        ? [
            {
              instruction: "沿虚线引导前往终点",
              distance: Math.round(length(tail)),
            },
          ]
        : []),
    ],
  };
}
