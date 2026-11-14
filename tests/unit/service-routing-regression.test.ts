import { expect, it } from "vitest";
import { searchCampusPlaces } from "@/features/campus-map/data/campus";
import { planLocalRoute } from "@/features/campus-map/data/local-routing";
import { toGcj02 } from "@/features/campus-map/adapters/online-services";
import type { RoutePoint } from "@/features/campus-map/adapters/amap-adapter";

const point = (name: string): RoutePoint => {
  const place = searchCampusPlaces(name).find((p) => p.name === name)!;
  return {
    name,
    placeId: place.id,
    zone: place.zone,
    source: "campus_place",
    coordinateGcj02: toGcj02(place.coordinate),
  };
};
for (const name of ["又康超市", "伟腾图文", "三饭打印店"])
  it("routes to point service " + name + " on the local network", () => {
    const route = planLocalRoute(point("南苑7栋"), point(name));
    expect(route).not.toBeNull();
    expect(route!.source).toBe("CampusOS.OSM");
  });
