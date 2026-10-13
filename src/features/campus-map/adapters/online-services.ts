import gcoord from "gcoord";
import { loadAMap } from "./load-amap";
import { sdkCoordinate, type SDKPoi, type WalkingResult } from "./amap-types";
import { campusData, type Coordinate } from "../data/campus";
import { boundsOf, distanceMeters, pointInPolygon } from "../data/geometry";
import type { CampusRoute, RoutePoint } from "./amap-adapter";

export function toGcj02(point: Coordinate): Coordinate {
  const p = gcoord.transform([...point], gcoord.WGS84, gcoord.GCJ02);
  return [p[0], p[1]];
}
export function toWgs84(point: Coordinate): Coordinate {
  const p = gcoord.transform([...point], gcoord.GCJ02, gcoord.WGS84);
  return [p[0], p[1]];
}
function bounded<T>(
  operation: (done: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("高德服务请求超时，请稍后重试。")),
      15000,
    );
    operation(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
export async function onlineSearch(keyword: string): Promise<SDKPoi[]> {
  const sdk = await loadAMap();
  await bounded<void>((done) => sdk.plugin(["AMap.PlaceSearch"], () => done()));
  const [sw, ne] = boundsOf(
    campusData.zones.flatMap((z) => z.polygon).map(toGcj02),
  );
  return bounded((done, fail) => {
    new sdk.PlaceSearch({
      city: "广州",
      citylimit: true,
      pageSize: 20,
    }).searchInBounds(keyword, new sdk.Bounds(sw, ne), (status, output) => {
      if (status === "no_data") return done([]);
      if (status !== "complete")
        return fail(new Error("高德地点查询失败，请稍后重试。"));
      done(
        (output.poiList?.pois || []).filter((p) =>
          campusData.zones.some((z) =>
            pointInPolygon(toWgs84(sdkCoordinate(p.location)), z.polygon),
          ),
        ),
      );
    });
  });
}
export async function planOnlineRoute(
  start: RoutePoint,
  end: RoutePoint,
): Promise<CampusRoute> {
  if (start.zone !== end.zone)
    throw new Error("跨区隧道两端入口和通行连接尚未核验，暂不提供跨区导航。");
  if (distanceMeters(start.coordinateGcj02, end.coordinateGcj02) < 5)
    throw new Error("请选取不同的起点与终点。");
  const sdk = await loadAMap();
  await bounded<void>((done) => sdk.plugin(["AMap.Walking"], () => done()));
  const output = await bounded<WalkingResult>((done, fail) =>
    new sdk.Walking({ hideMarkers: true }).search(
      start.coordinateGcj02,
      end.coordinateGcj02,
      (status, result) => {
        if (status === "complete") done(result);
        else fail(new Error("高德未返回可用步行路线，未绘制替代直线。"));
      },
    ),
  );
  const route = output.routes?.[0];
  const path = route?.steps.flatMap((s) => s.path.map(sdkCoordinate)) || [];
  const zone = campusData.zones.find((z) => z.id === start.zone)!;
  if (
    !route ||
    path.length < 2 ||
    !Number.isFinite(route.distance) ||
    route.distance <= 0 ||
    !Number.isFinite(route.time) ||
    route.time <= 0 ||
    distanceMeters(path[0], start.coordinateGcj02) > 80 ||
    distanceMeters(path.at(-1)!, end.coordinateGcj02) > 80 ||
    path.some((p) => !pointInPolygon(toWgs84(p), zone.polygon))
  )
    throw new Error("路线未通过校园范围或端点校验，暂不显示导航结果。");
  return {
    id: crypto.randomUUID(),
    start,
    end,
    pathGcj02: path,
    distanceMeters: route.distance,
    seconds: route.time,
    steps: route.steps.map((s) => ({
      instruction: s.instruction,
      distance: s.distance,
    })),
    source: "AMap.Walking",
    verification: "provider_geometry_checked",
    snapDistances: {
      start: distanceMeters(path[0], start.coordinateGcj02),
      end: distanceMeters(path.at(-1)!, end.coordinateGcj02),
    },
  };
}
