import { describe, it, expect } from "vitest";
import {
  campusData,
  searchCampusPlaces,
} from "@/features/campus-map/data/campus";
import {
  planLocalRoute,
  tunnelNetwork,
} from "@/features/campus-map/data/local-routing";
import {
  toGcj02,
  toWgs84,
} from "@/features/campus-map/adapters/online-services";
import { projectOnPath } from "@/features/campus-map/data/route-progress";
import type { RoutePoint } from "@/features/campus-map/adapters/amap-adapter";

function point(name: string): RoutePoint {
  const p = searchCampusPlaces(name).find((p) => p.name === name)!;
  return {
    name: p.name,
    placeId: p.id,
    zone: p.zone,
    coordinateGcj02: toGcj02(p.coordinate),
    source: "campus_place",
  };
}
describe("campus-wide owner-approved routing", () => {
  it("connects every dorm to teaching and laboratory through the tunnel", () => {
    const targets = [
      "教学楼A栋",
      "教学楼E栋",
      "实验楼A栋",
      "实验楼E栋",
      "图书馆",
    ];
    const started = performance.now();
    for (const p of campusData.places.filter((p) => p.category === "dormitory"))
      for (const goal of targets) {
        const route = planLocalRoute(point(p.name), point(goal));
        expect(route, `${p.name} -> ${goal}`).not.toBeNull();
        expect(
          route!.undergroundPathGcj02,
          `${p.name} -> ${goal}`,
        ).toHaveLength(1);
        expect(route!.distanceMeters).toBeGreaterThan(100);
      }
    console.info(
      "90 actual campus route computations ms",
      Math.round(performance.now() - started),
    );
  }, 20000);
  it("keeps three bridge anchors exact and provides connected crossing paths", () => {
    const names = [
      "语心桥（教学楼E栋）",
      "语心桥（教学楼F栋）",
      "语心桥（教学楼G栋）",
    ];
    for (const name of names) {
      const p = point(name);
      expect(
        campusData.places.find((v) => v.id === p.placeId)!.verification,
      ).toBe("owner_confirmed");
      const edges = tunnelNetwork.edges.filter(
        (e) => e.kind === "bridge" && e.name === name,
      );
      expect(edges).toHaveLength(1);
      expect(
        projectOnPath(toWgs84(p.coordinateGcj02), edges[0].geometry).distance,
      ).toBeLessThan(1);
    }
  });
  it("arrives at a building perimeter instead of its center", () => {
    const target = campusData.places.find((p) => p.name === "图书馆")!;
    const route = planLocalRoute(point("北苑1栋"), point("图书馆"))!;
    expect(
      projectOnPath(toWgs84(route.pathGcj02.at(-1)!), target.geometry!)
        .distance,
    ).toBeLessThan(1);
  });
});
