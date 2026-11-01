import { it, expect } from "vitest";
import {
  deviceHeading,
  locationHalo,
} from "@/features/campus-map/data/device-location";
it("renders the halo at one quarter radius without changing positioning accuracy", () => {
  const center = [113.39131405, 23.0680465] as const,
    accuracy = 80,
    ring = locationHalo(center, accuracy);
  expect(ring).toHaveLength(49);
  expect(ring[0][1] - center[1]).toBeCloseTo(20 / 111320, 10);
  expect(ring[0]).toEqual(ring.at(-1));
  expect(accuracy).toBe(80);
});
it("uses an actual iOS compass heading including north", () => {
  expect(
    deviceHeading({ alpha: null, absolute: false, webkitCompassHeading: 0 }),
  ).toBe(0);
  expect(
    deviceHeading({
      alpha: null,
      absolute: false,
      webkitCompassHeading: 125,
      webkitCompassAccuracy: 8,
    }),
  ).toBe(125);
});
it("converts absolute heading and screen orientation", () => {
  expect(deviceHeading({ alpha: 270, absolute: true })).toBe(90);
  expect(deviceHeading({ alpha: 270, absolute: true }, 90)).toBe(180);
});
it("does not invent a phone heading from relative orientation or unreliable compass data", () => {
  expect(deviceHeading({ alpha: 90, absolute: false })).toBeNull();
  expect(deviceHeading({ alpha: null, absolute: true })).toBeNull();
  expect(
    deviceHeading({
      alpha: null,
      absolute: false,
      webkitCompassHeading: 100,
      webkitCompassAccuracy: -1,
    }),
  ).toBeNull();
});
