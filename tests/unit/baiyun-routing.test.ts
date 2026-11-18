import { projectOnPath } from "@/features/campus-map/data/route-progress";
import type { Coordinate } from "@/features/campus-map/data/campus";
import { it, expect } from "vitest";
import data from "@/features/campus-map/data/baiyun-map.json";
import graph from "@/features/campus-map/data/baiyun-walking.json";
import { planBaiyunRoute } from "@/features/campus-map/data/baiyun-routing";
it("connects the Baiyun library and second teaching building through actual OSM edges", () => {
  const start = data.places.find((p) => p.name === "北校区图书馆")!,
    end = data.places.find((p) => p.name === "第二教学楼")!;
  const route = planBaiyunRoute(start, end);
  expect(route.distanceMeters).toBeGreaterThan(50);
  expect(route.distanceMeters).toBeLessThan(2000);
  expect(route.solidPath!.length).toBeGreaterThan(2);
  const nodes = graph.nodes as Record<string, number[]>;
  const segments = graph.edges.map(
    (e) => [nodes[String(e[0])], nodes[String(e[1])]] as Coordinate[],
  );
  for (let i = 1; i < route.solidPath!.length; i++)
    expect(
      segments.some(
        (edge) =>
          projectOnPath(route.solidPath![i - 1], edge).distance < 0.05 &&
          projectOnPath(route.solidPath![i], edge).distance < 0.05,
      ),
    ).toBe(true);
  expect(route.sourceWayIds.length).toBeGreaterThan(0);
});
it("accepts off-campus dashed guidance and refuses identical endpoints", () => {
  const start = data.places.find((p) => p.name === "北校区图书馆")!;
  expect(() => planBaiyunRoute(start, start)).toThrow("不同");
  const external = planBaiyunRoute(start, {
    id: "outside",
    name: "校外",
    coordinate: [113.39, 23.06],
  });
  expect(external.guidance!.length).toBeGreaterThan(0);
  const direct = planBaiyunRoute(
    { id: "a", name: "外A", coordinate: [113.4, 23.1] },
    { id: "b", name: "外B", coordinate: [113.5, 23.2] },
  );
  expect(direct.solidPath).toEqual([]);
  expect(direct.guidance).toHaveLength(1);
});
