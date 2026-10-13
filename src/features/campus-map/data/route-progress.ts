import type { Coordinate } from "./campus";
import { distanceMeters } from "./geometry";

// Project onto real path segments; never snap to an invented link across a building.
export function projectOnPath(point: Coordinate, path: readonly Coordinate[]) {
  let best = {
    coordinate: path[0],
    distance: Infinity,
    along: 0,
    index: 0,
    fraction: 0,
  };
  let along = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const scale = Math.cos((point[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * scale,
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - a[0]) * scale * dx + (point[1] - a[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const coordinate: Coordinate = [
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
    ];
    const distance = distanceMeters(point, coordinate);
    const length = distanceMeters(a, b);
    if (distance < best.distance)
      best = {
        coordinate,
        distance,
        along: along + length * t,
        index: i - 1,
        fraction: t,
      };
    along += length;
  }
  return { ...best, total: along };
}
