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
  it("can start a device route on the confirmed bridge", () => {
    const p = {
      ...point("语心桥"),
      source: "device_location" as const,
      placeId: undefined,
    };
    expect(planLocalRoute(p, point("实验楼C栋"))).not.toBeNull();
  });
  it("uses one bridge label for all three connected geometries", () => {
    expect(searchCampusPlaces("语心桥").map((p) => p.id)).toEqual([
      "owner-bridge-f",
    ]);
    expect(
      campusData.places.filter((p) => p.labelPlaceId === "owner-bridge-f"),
    ).toHaveLength(3);
    expect(searchCampusPlaces("体育馆北侧停车场")[0].name).toBe("停车场");
  });
  it("takes the teaching B to laboratory C shortcut through Yuxin bridge", () => {
    const route = planLocalRoute(point("教学楼B栋"), point("实验楼C栋"))!;
    expect(route).not.toBeNull();
    expect(route.steps.some((s) => s.instruction.includes("语心桥"))).toBe(
      true,
    );
    expect(route.distanceMeters).toBeLessThan(400);
    expect(
      Math.min(...route.pathGcj02.map((p) => toWgs84(p)[1])),
    ).toBeGreaterThan(23.0657);
  });
  it("guides a device position inside a dorm to the nearest campus path", () => {
    const start = {
      ...point("北苑1栋"),
      source: "device_location" as const,
      placeId: undefined,
    };
    const route = planLocalRoute(start, point("实验楼C栋"));
    expect(route).not.toBeNull();
    expect(route).toHaveProperty("approachPathGcj02");
    expect(route!.pathGcj02[0]).toEqual(start.coordinateGcj02);
    expect(route!.undergroundPathGcj02).toHaveLength(1);
  });
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
    for (const id of ["owner-bridge-e", "owner-bridge-f", "owner-bridge-g"]) {
      const place = campusData.places.find((v) => v.id === id)!;
      const p = { placeId: id, coordinateGcj02: toGcj02(place.coordinate) };
      expect(
        campusData.places.find((v) => v.id === p.placeId)!.verification,
      ).toBe("owner_confirmed");
      const edges = tunnelNetwork.edges.filter(
        (e) => e.kind === "bridge" && e.sourceUrl === "owner-review:" + id,
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
