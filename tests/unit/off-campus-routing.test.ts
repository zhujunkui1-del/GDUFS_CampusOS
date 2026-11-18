import { it, expect } from "vitest";
import { planCampusRoute } from "@/features/campus-map/data/plan-campus-route";
import { campusData, type Coordinate } from "@/features/campus-map/data/campus";
import {
  toGcj02,
  toWgs84,
} from "@/features/campus-map/adapters/online-services";
import { distanceMeters } from "@/features/campus-map/data/geometry";
import type { RoutePoint } from "@/features/campus-map/adapters/amap-adapter";
import { planBaiyunRoute } from "@/features/campus-map/data/baiyun-routing";
import baiyun from "@/features/campus-map/data/baiyun-map.json";
const point = (p: Coordinate): RoutePoint => ({
  name: "地图选点",
  coordinateGcj02: toGcj02(p),
  zone: "connection",
  source: "user_map_selection",
});
it("University Town guides external endpoints through the closest actual gate in both directions", async () => {
  const outside = point([113.37, 23.04]);
  const place = campusData.places.find((p) => p.name === "南苑7栋")!;
  const inside: RoutePoint = {
    ...point(place.coordinate),
    name: place.name,
    placeId: place.id,
    source: "campus_place",
    zone: place.zone,
  };
  const gate = campusData.places
    .filter((p) => p.category === "entrance")
    .sort(
      (a, b) =>
        distanceMeters(a.coordinate, toWgs84(outside.coordinateGcj02)) -
        distanceMeters(b.coordinate, toWgs84(outside.coordinateGcj02)),
    )[0];
  for (const [a, b] of [
    [outside, inside],
    [inside, outside],
  ]) {
    const route = await planCampusRoute(a, b);
    expect(route.solidPathGcj02!.length).toBeGreaterThan(2);
    expect(
      route
        .guidancePathsGcj02!.flat()
        .some((p) => distanceMeters(toWgs84(p), gate.coordinate) < 0.3),
    ).toBe(true);
    expect(route.pathGcj02[0]).toEqual(a.coordinateGcj02);
    expect(route.pathGcj02.at(-1)).toEqual(b.coordinateGcj02);
    expect(
      Math.abs(
        route.steps.reduce((n, s) => n + s.distance, 0) - route.distanceMeters,
      ),
    ).toBeLessThan(15);
  }
});
it("University Town connects both external endpoints directly with dashed guidance", async () => {
  const a = point([113.37, 23.04]),
    b = point([113.36, 23.03]);
  const route = await planCampusRoute(a, b);
  expect(route.solidPathGcj02).toEqual([]);
  expect(route.guidancePathsGcj02).toEqual([
    [a.coordinateGcj02, b.coordinateGcj02],
  ]);
});
it("Baiyun uses the closest real gate with symmetric dashed leads", () => {
  const inside = baiyun.places.find((p) => p.name === "第一教学楼")!,
    outside = { id: "external", name: "校外", coordinate: [113.27, 23.19] };
  const gate = baiyun.places
    .filter((p) => /门$/.test(p.name))
    .sort(
      (a, b) =>
        distanceMeters(
          a.coordinate as Coordinate,
          outside.coordinate as Coordinate,
        ) -
        distanceMeters(
          b.coordinate as Coordinate,
          outside.coordinate as Coordinate,
        ),
    )[0];
  for (const [a, b] of [
    [outside, inside],
    [inside, outside],
  ]) {
    const route = planBaiyunRoute(a, b);
    expect(route.guidance!.flat()).toContainEqual(gate.coordinate);
    expect(route.solidPath!.length).toBeGreaterThan(2);
    expect(route.path[0]).toEqual(a.coordinate);
    expect(route.path.at(-1)).toEqual(b.coordinate);
    expect(
      Math.abs(
        route.steps.reduce((n, s) => n + s.distance, 0) - route.distanceMeters,
      ),
    ).toBeLessThan(15);
  }
});
