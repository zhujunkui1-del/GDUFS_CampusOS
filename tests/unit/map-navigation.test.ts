import { describe, expect, it } from "vitest";
import {
  campusData,
  searchCampusPlaces,
  placeLayer,
} from "@/features/campus-map/data/campus";
import { planVerifiedRoute } from "@/domain/maps/route-graph";
import {
  tunnelNetwork,
  planLocalRoute,
} from "@/features/campus-map/data/local-routing";
import review from "@/features/campus-map/data/walkway-review.json";
import { toGcj02 } from "@/features/campus-map/adapters/online-services";
import { projectOnPath } from "@/features/campus-map/data/route-progress";
import { locationError } from "@/features/campus-map/components/use-map-location";
import type { RoutePoint } from "@/features/campus-map/adapters/amap-adapter";

describe("owner-reviewed names and real walking topology", () => {
  it("keeps owner categories for the six precisely selected courts and Youyuan", () => {
    expect(placeLayer(searchCampusPlaces("友苑")[0])).toBe("dormitories");
    for (const id of ["1389859440", "1389859441"])
      expect(
        campusData.places.find((p) => p.id === "osm-way-" + id)?.category,
      ).toBe("badminton");
    for (const id of ["1389859416", "1389859418", "1389859420", "1389859423"])
      expect(
        campusData.places.find((p) => p.id === "osm-way-" + id)?.category,
      ).toBe("volleyball");
  });
  it("labels E/F/G and A-E without inventing separate building footprints", () => {
    for (const name of [
      "教学楼E栋",
      "教学楼F栋",
      "教学楼G栋",
      ...["A", "B", "C", "D", "E"].map((s) => "实验楼" + s + "栋"),
    ]) {
      const p = searchCampusPlaces(name)[0];
      expect(p.name).toBe(name);
      expect(p.parentId).toMatch(/^osm-relation-/);
      expect(p.geometry).toBeUndefined();
      const parent = campusData.places.find((v) => v.id === p.parentId)!;
      expect(
        parent.geometry?.some(
          (c) => c[0] === p.coordinate[0] && c[1] === p.coordinate[1],
        ),
      ).toBe(true);
    }
  });
  it("preserves actual shared nodes and a continuous tunnel corridor", () => {
    const testGraph = {
      ...tunnelNetwork,
      edges: tunnelNetwork.edges.map((e) => ({ ...e, verified: true })),
    };
    // Verification override belongs only to this isolated topology test.
    const route = planVerifiedRoute(
      testGraph,
      "osm-node-6110327053",
      "osm-node-6110327054",
    )!;
    expect(route.distanceMeters).toBeGreaterThan(100);
    expect(route.distanceMeters).toBeLessThan(300);
    expect(route.undergroundEdgeIds).toHaveLength(1);
    for (const e of testGraph.edges) {
      expect(e.geometry[0]).toEqual(
        testGraph.nodes.find((n) => n.id === e.from)?.coordinate,
      );
      expect(e.geometry.at(-1)).toEqual(
        testGraph.nodes.find((n) => n.id === e.to)?.coordinate,
      );
    }
  });
  it("routes the corridor only when its explicit owner review is approved", () => {
    const point = (id: string): RoutePoint => {
      const p = campusData.places.find((p) => p.id === id)!;
      return {
        name: p.name,
        coordinateGcj02: toGcj02(p.coordinate),
        zone: p.zone,
        source: "campus_place",
      };
    };
    const route = planLocalRoute(
      point("osm-node-6110327053"),
      point("osm-node-6110327054"),
    );
    if (review.approved) {
      expect(route?.source).toBe("CampusOS.OSM");
      expect(route?.undergroundPathGcj02).toHaveLength(1);
      expect(route?.distanceMeters).toBeGreaterThan(100);
      expect(route?.steps.every((s) => s.distance > 0)).toBe(true);
      const reverse = planLocalRoute(
        point("osm-node-6110327054"),
        point("osm-node-6110327053"),
      )!;
      expect(reverse.distanceMeters).toBeCloseTo(route!.distanceMeters, 1);
      expect(
        reverse.steps.some((s) => s.instruction.includes("离开隧道")),
      ).toBe(true);
    } else expect(route).toBeNull();
  });
  it("does not teleport a ground map selection into the tunnel below the road", () => {
    const midpoint = campusData.places.find(
      (p) => p.id === "osm-way-864205124",
    )!;
    const portal = campusData.places.find(
      (p) => p.id === "osm-node-6110327054",
    )!;
    const route = planLocalRoute(
      {
        name: "中环路地面选点",
        coordinateGcj02: toGcj02(midpoint.coordinate),
        zone: "connection",
        source: "user_map_selection",
      },
      {
        name: portal.name,
        coordinateGcj02: toGcj02(portal.coordinate),
        zone: portal.zone,
        source: "campus_place",
      },
    );
    expect(route).toBeNull();
  });
  it("projects GPS onto path geometry and distinguishes permission, unavailable and timeout errors", () => {
    const p = projectOnPath(
      [0.0005, 0.0001],
      [
        [0, 0],
        [0.001, 0],
      ],
    );
    expect(p.along / p.total).toBeCloseTo(0.5);
    expect(p.distance).toBeCloseTo(11.12, 1);
    expect(locationError(1)).toContain("权限");
    expect(locationError(2)).toContain("无法获取");
    expect(locationError(3)).toContain("超时");
  });
});
