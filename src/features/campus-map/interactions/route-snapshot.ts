import { RouteOutputSchema } from "@/domain/maps/skill-contracts";
import { campusData } from "../data/campus";
import { tunnelNetwork } from "../data/local-routing";
import { boundsOf, distanceMeters, pointInPolygon } from "../data/geometry";
import { toGcj02 } from "../adapters/online-services";
import type { CampusRoute, RoutePoint } from "../adapters/amap-adapter";

export function campusRouteFromSnapshot(
  input: unknown,
  now = Date.now(),
): CampusRoute {
  const route = RouteOutputSchema.parse(input);
  if (
    route.mapVersion !== campusData.mapVersion ||
    route.networkVersion !== tunnelNetwork.version ||
    Date.parse(route.expiresAt) <= now
  )
    throw new Error("路线已失效，请重新规划。");
  const [sw, ne] = boundsOf(campusData.zones.flatMap((zone) => zone.polygon));
  if (
    route.path.coordinates.some(
      (p) =>
        p[0] < sw[0] - 0.003 ||
        p[0] > ne[0] + 0.003 ||
        p[1] < sw[1] - 0.003 ||
        p[1] > ne[1] + 0.003,
    )
  )
    throw new Error("路线不在校园范围内。");
  const length = route.path.coordinates
    .slice(1)
    .reduce(
      (sum, p, i) => sum + distanceMeters(route.path.coordinates[i], p),
      0,
    );
  if (Math.abs(length - route.distanceMeters) > Math.max(2, length * 0.01))
    throw new Error("路线未通过距离校验，请重新规划。");
  const point = (origin: typeof route.start): RoutePoint => {
    const place = origin.placeId
      ? campusData.places.find((place) => place.id === origin.placeId)
      : undefined;
    if (origin.placeId && !place) throw new Error("路线地点不存在。");
    return {
      name: origin.name,
      placeId: origin.placeId || undefined,
      coordinateGcj02: toGcj02(origin.coordinate),
      zone:
        place?.zone ||
        campusData.zones.find((zone) =>
          pointInPolygon(origin.coordinate, zone.polygon),
        )?.id ||
        "connection",
      source:
        origin.source === "authorized_device_location"
          ? "device_location"
          : "campus_place",
    };
  };
  return {
    id: route.routeId,
    start: point(route.start),
    end: point(route.end),
    pathGcj02: route.path.coordinates.map(toGcj02),
    approachPathGcj02: route.approachPath?.coordinates.map(toGcj02),
    undergroundPathGcj02: route.undergroundPaths.map((path) =>
      path.coordinates.map(toGcj02),
    ),
    distanceMeters: route.distanceMeters,
    seconds: route.estimatedSeconds,
    steps: route.steps.map((step) => ({
      instruction: step.instruction,
      distance: step.distanceMeters,
    })),
    source: "CampusOS.OSM",
    verification: "reviewed_source_network",
    networkVersion: route.networkVersion,
  };
}
