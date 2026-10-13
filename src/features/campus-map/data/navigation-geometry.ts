import type { Coordinate } from "./campus";
import { pointInPolygon, distanceMeters } from "./geometry";
import { projectOnPath } from "./route-progress";
export function segmentCrossing(
  a: Coordinate,
  b: Coordinate,
  c: Coordinate,
  d: Coordinate,
): Coordinate | null {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    ex = d[0] - c[0],
    ey = d[1] - c[1],
    den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-16) return null;
  const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den,
    u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
    ? [a[0] + t * dx, a[1] + t * dy]
    : null;
}
export function onOrInside(p: Coordinate, ring: Coordinate[]) {
  return pointInPolygon(p, ring) || projectOnPath(p, ring).distance < 0.3;
}
export function segmentInside(
  a: Coordinate,
  b: Coordinate,
  ring: Coordinate[],
) {
  const fractions = [0, 1];
  for (let i = 1; i < ring.length; i++) {
    const p = segmentCrossing(a, b, ring[i - 1], ring[i]);
    if (p)
      fractions.push(
        distanceMeters(a, p) / Math.max(0.001, distanceMeters(a, b)),
      );
  }
  fractions.sort((a, b) => a - b);
  return fractions.slice(1).every((t, i) => {
    const u = (t + fractions[i]) / 2;
    return onOrInside(
      [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u],
      ring,
    );
  });
}
export function segmentAvoids(
  a: Coordinate,
  b: Coordinate,
  polygons: Coordinate[][][],
) {
  let prepared = obstacleCache.get(polygons);
  if (!prepared) {
    prepared = polygons.map((rings) => ({
      rings,
      bounds: [
        Math.min(...rings[0].map((p) => p[0])),
        Math.min(...rings[0].map((p) => p[1])),
        Math.max(...rings[0].map((p) => p[0])),
        Math.max(...rings[0].map((p) => p[1])),
      ],
    }));
    obstacleCache.set(polygons, prepared);
  }
  return prepared.every(({ rings, bounds }) => {
    const outer = rings[0];
    if (
      Math.max(a[0], b[0]) < bounds[0] ||
      Math.min(a[0], b[0]) > bounds[2] ||
      Math.max(a[1], b[1]) < bounds[1] ||
      Math.min(a[1], b[1]) > bounds[3]
    )
      return true;
    const fractions = [0, 1];
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++) {
        const p = segmentCrossing(a, b, ring[i - 1], ring[i]);
        if (p)
          fractions.push(
            distanceMeters(a, p) / Math.max(0.001, distanceMeters(a, b)),
          );
      }
    fractions.sort((a, b) => a - b);
    return fractions.slice(1).every((t, i) => {
      const u = (t + fractions[i]) / 2,
        p: Coordinate = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      return (
        !pointInPolygon(p, outer) ||
        rings.slice(1).some((r) => pointInPolygon(p, r)) ||
        projectOnPath(p, outer).distance < 0.25
      );
    });
  });
}
const obstacleCache = new WeakMap<
  Coordinate[][][],
  { rings: Coordinate[][]; bounds: number[] }[]
>();
export function closestToBoundary(
  a: Coordinate,
  b: Coordinate,
  ring: Coordinate[],
) {
  let best = { road: a, boundary: ring[0], distance: Infinity };
  for (let i = 1; i < ring.length; i++) {
    const c = ring[i - 1],
      d = ring[i],
      cross = segmentCrossing(a, b, c, d);
    if (cross) return { road: cross, boundary: cross, distance: 0 };
    for (const p of [a, b]) {
      const s = projectOnPath(p, [c, d]);
      if (s.distance < best.distance)
        best = { road: p, boundary: s.coordinate, distance: s.distance };
    }
    for (const p of [c, d]) {
      const s = projectOnPath(p, [a, b]);
      if (s.distance < best.distance)
        best = { road: s.coordinate, boundary: p, distance: s.distance };
    }
  }
  return best;
}
export function headingBetween(a: Coordinate, b: Coordinate) {
  return (
    ((Math.atan2(
      (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180),
      b[1] - a[1],
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}
