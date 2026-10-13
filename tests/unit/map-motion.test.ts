import { describe, expect, it } from "vitest";
import {
  cssTimeMilliseconds,
  mapEase,
} from "@/features/campus-map/data/map-motion";
describe("map camera motion", () => {
  it("keeps CSS seconds and milliseconds equivalent after production minification", () => {
    expect(cssTimeMilliseconds("600ms")).toBe(600);
    expect(cssTimeMilliseconds("0.6s")).toBe(600);
    expect(cssTimeMilliseconds(".24s")).toBe(240);
    expect(cssTimeMilliseconds(" 240ms ")).toBe(240);
    expect(cssTimeMilliseconds("")).toBe(600);
  });
  it("moves quickly first and eases toward the target", () => {
    expect(mapEase(0)).toBeCloseTo(0);
    expect(mapEase(1)).toBeCloseTo(1);
    expect(mapEase(0.25)).toBeGreaterThan(0.75);
    expect(mapEase(0.5) - mapEase(0.25)).toBeGreaterThan(
      mapEase(0.75) - mapEase(0.5),
    );
  });
});
