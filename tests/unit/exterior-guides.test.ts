import { it, expect } from "vitest";
import { planBaiyunRoute } from "@/features/campus-map/data/baiyun-routing";
import data from "@/features/campus-map/data/baiyun-map.json";
import exterior from "@/features/campus-map/data/baiyun-exterior.json";
import { segmentAvoids } from "@/features/campus-map/data/navigation-geometry";
import type { Coordinate } from "@/features/campus-map/data/campus";
it("routes the north-of-fourth-teaching exterior point around the west perimeter before entering the west gate", () => {
  const p = {
      id: "outside-fourth",
      name: "地图选点",
      coordinate: [113.2838, 23.20372],
    },
    end = data.places.find((p) => p.name === "51栋")!;
  const r = planBaiyunRoute(p, end);
  const lead = r.guidance![0];
  expect(lead.length).toBeGreaterThan(3);
  expect(lead).toContainEqual(
    data.places.find((p) => p.name === "广外西门")!.coordinate,
  );
  expect(lead.some((p) => p[0] < 113.2823 && p[1] < 23.203)).toBe(true);
  const obstacles = exterior.buildings.map((r) => [r as Coordinate[]]);
  for (let i = 1; i < lead.length; i++)
    expect(segmentAvoids(lead[i - 1], lead[i], obstacles)).toBe(true);
});
