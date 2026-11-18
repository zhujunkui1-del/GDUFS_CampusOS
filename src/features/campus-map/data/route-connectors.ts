import { distanceMeters, pointInPolygon } from "./geometry";
import type { Coordinate } from "./campus";
import { projectOnPath } from "./route-progress";
export function endpointAttachment(
  point: Coordinate,
  polygons: Coordinate[][],
  gates: Coordinate[],
  nodes: Coordinate[],
  options?: {
    segments?: Array<[Coordinate, Coordinate]>;
    inside?: boolean;
  },
) {
  const inside =
    options?.inside ?? polygons.some((p) => pointInPolygon(point, p));
  const nearest = (points: Coordinate[], p: Coordinate) =>
    points.reduce((a, b) =>
      distanceMeters(a, p) < distanceMeters(b, p) ? a : b,
    );
  const gate = inside ? point : nearest(gates, point);
  const road = options?.segments?.length
    ? options.segments
        .map((edge) => projectOnPath(gate, edge))
        .reduce((a, b) => (a.distance < b.distance ? a : b)).coordinate
    : nearest(nodes, gate);
  const path: Coordinate[] = [point];
  if (!inside && distanceMeters(path.at(-1)!, gate) > 0.1) path.push(gate);
  if (distanceMeters(path.at(-1)!, road) > 0.1) path.push(road);
  return { inside, road, path, gate };
}
