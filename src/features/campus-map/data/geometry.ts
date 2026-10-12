import type { Coordinate } from "./campus";

export function pointInPolygon(
  point: readonly number[],
  polygon: readonly (readonly number[])[],
) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
export function boundsOf(
  points: readonly (readonly number[])[],
): [Coordinate, Coordinate] {
  if (!points.length) throw new Error("缺少范围坐标。");
  return [
    [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
    ],
    [
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ],
  ];
}
export function distanceMeters(a: readonly number[], b: readonly number[]) {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians,
    dLng = (b[0] - a[0]) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * radians) *
      Math.cos(b[1] * radians) *
      Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
