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
  expect(route.path.length).toBeGreaterThan(2);
  const nodes = graph.nodes as Record<string, number[]>;
  const segments = new Set(
    graph.edges.flatMap((e) => {
      const a = JSON.stringify(nodes[String(e[0])]),
        b = JSON.stringify(nodes[String(e[1])]);
      return [a + "|" + b, b + "|" + a];
    }),
  );
  for (let i = 1; i < route.path.length; i++)
    expect(
      segments.has(
        JSON.stringify(route.path[i - 1]) + "|" + JSON.stringify(route.path[i]),
      ),
    ).toBe(true);
  expect(route.sourceWayIds.length).toBeGreaterThan(0);
});
it("refuses out-of-campus and identical endpoints instead of drawing a straight line", () => {
  const start = data.places.find((p) => p.name === "北校区图书馆")!;
  expect(() => planBaiyunRoute(start, start)).toThrow("不同");
  expect(() =>
    planBaiyunRoute(start, {
      id: "university",
      name: "大学城",
      coordinate: [113.39, 23.06],
    }),
  ).toThrow("步道");
});
