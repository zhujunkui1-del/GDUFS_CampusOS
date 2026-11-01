import type { Coordinate } from "./campus";
export function locationHalo(
  coordinate: readonly [number, number],
  accuracy: number,
): Coordinate[] {
  const radius = accuracy / 4;
  return Array.from({ length: 49 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 48;
    return [
      coordinate[0] +
        (Math.sin(angle) * radius) /
          (111320 * Math.cos((coordinate[1] * Math.PI) / 180)),
      coordinate[1] + (Math.cos(angle) * radius) / 111320,
    ] as Coordinate;
  });
}
export function deviceHeading(
  event: {
    alpha: number | null;
    absolute: boolean;
    webkitCompassHeading?: number;
    webkitCompassAccuracy?: number;
  },
  screenAngle = 0,
): number | null {
  let heading: number;
  if (
    typeof event.webkitCompassHeading === "number" &&
    Number.isFinite(event.webkitCompassHeading) &&
    event.webkitCompassHeading >= 0
  ) {
    if (
      typeof event.webkitCompassAccuracy === "number" &&
      event.webkitCompassAccuracy < 0
    )
      return null;
    heading = event.webkitCompassHeading;
  } else if (
    event.absolute &&
    typeof event.alpha === "number" &&
    Number.isFinite(event.alpha)
  )
    heading = 360 - event.alpha;
  else return null;
  return (((heading + screenAngle) % 360) + 360) % 360;
}
