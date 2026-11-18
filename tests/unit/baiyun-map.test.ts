import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import data from "@/features/campus-map/data/baiyun-map.json";
import { createLocalMapStyle } from "@/features/campus-map/adapters/local-map-style";

it("publishes the prepared OSM snapshot with intact courtyards and excludes the demolished dorm", () => {
  const bytes = readFileSync("public" + data.url);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(data.sha256);
  const geo = JSON.parse(bytes.toString());
  expect(geo.features).toHaveLength(data.features);
  expect(
    geo.features.some((f: { id: string }) => f.id === "osm-way-962945645"),
  ).toBe(false);
  for (const id of ["13030162", "13030163", "13030164"]) {
    const feature = geo.features.find(
      (f: { id: string }) => f.id === `osm-relation-${id}`,
    );
    expect(feature.geometry.type).toBe("Polygon");
    expect(feature.geometry.coordinates).toHaveLength(2);
  }
  expect(new Set(data.places.map((p) => p.id)).size).toBe(data.places.length);
  expect(data.places.some((p) => p.name === "第二教学楼")).toBe(true);
});
it("shares the existing flat-map palette without adding models or online tiles", () => {
  const style = createLocalMapStyle(data.url);
  expect(style.sources.campus).toMatchObject({
    type: "geojson",
    data: data.url,
  });
  expect(style.layers.find((l) => l.id === "buildings")).toMatchObject({
    type: "fill",
    paint: { "fill-color": "#e0d8ce" },
  });
  expect(style.layers.some((l) => l.type === "fill-extrusion")).toBe(false);
});
