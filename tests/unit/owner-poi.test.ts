import { describe, expect, it } from "vitest";
import {
  campusData,
  searchCampusPlaces,
  buildingLabelParts,
  placeLayer,
} from "@/features/campus-map/data/campus";
import { pointInPolygon } from "@/features/campus-map/data/geometry";
import { planLocalRoute } from "@/features/campus-map/data/local-routing";
import { toGcj02 } from "@/features/campus-map/adapters/online-services";
import review from "@/features/campus-map/data/owner-poi-review.json";
import type { RoutePoint } from "@/features/campus-map/adapters/amap-adapter";

describe("owner gate coordinates and campus service point", () => {
  it("keeps all nine named gates at the exact supplied WGS84 coordinates", () => {
    const gates = review.points.filter((p) => p.category === "entrance");
    expect(gates).toHaveLength(9);
    for (const gate of gates) {
      const matches = campusData.places.filter((p) => p.name === gate.name);
      expect(matches).toHaveLength(1);
      expect(matches[0].coordinate).toEqual(gate.coordinate);
      expect(matches[0].crs).toBe("WGS84");
      expect(matches[0].navigationVerified).toBe(false);
      expect(searchCampusPlaces(gate.name)[0].id).toBe(gate.id);
      expect(placeLayer(matches[0])).toBe("buildings");
    }
  });
  it("renames places and preserves the previous search names", () => {
    expect(searchCampusPlaces("报告厅")[0].name).toBe("B8学术报告厅");
    expect(searchCampusPlaces("b8")[0].id).toBe("osm-way-651642991");
    expect(searchCampusPlaces("又康")[0].name).toBe("又康超市");
  });
  it("places the recharge service in North 1 without redirecting the dorm footprint to it", () => {
    const service = searchCampusPlaces("水电冷充值点")[0];
    const dorm = campusData.places.find((p) => p.id === service.parentId)!;
    expect(service.name).toBe("大学城校区水电冷充值点");
    expect(service.coordinate).toEqual([113.390697, 23.064485]);
    expect(dorm.name).toBe("北苑1栋");
    expect(pointInPolygon(service.coordinate, dorm.geometry!)).toBe(true);
    expect(placeLayer(service)).toBe("services");
    expect(buildingLabelParts(dorm.id)).toEqual([]);
    expect(buildingLabelParts("osm-relation-4105730")).toHaveLength(3);
    const point = (p: typeof service): RoutePoint => ({
      name: p.name,
      placeId: p.id,
      zone: p.zone,
      coordinateGcj02: toGcj02(p.coordinate),
      source: "campus_place",
    });
    const goal = searchCampusPlaces("教学楼B栋")[0];
    const route = planLocalRoute(point(service), point(goal));
    expect(route).not.toBeNull();
    expect(route!.undergroundPathGcj02).toHaveLength(1);
  });
});
