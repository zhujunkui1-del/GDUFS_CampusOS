import type { Coordinate } from "./campus";
import { boundsOf } from "./geometry";

// Viewport context only; these margins never alter campus or route geography.
export function campusViewport(points: readonly Coordinate[]) {
  const [sw, ne] = boundsOf(points);
  const latitude = (sw[1] + ne[1]) / 2;
  const latMargin = 250 / 111320;
  const lngMargin = 250 / (111320 * Math.cos((latitude * Math.PI) / 180));
  const southwest: Coordinate = [sw[0] - lngMargin, sw[1] - latMargin];
  const northeast: Coordinate = [ne[0] + lngMargin, ne[1] + latMargin];
  const ring: Coordinate[] = [
    southwest,
    [northeast[0], southwest[1]],
    northeast,
    [southwest[0], northeast[1]],
    southwest,
  ];
  return { southwest, northeast, ring };
}

export const CAMPUS_MIN_ZOOM = 15;
export const CAMPUS_MAX_ZOOM = 20;
export const CAMPUS_PITCH = 38;

export function fitCampusView(
  points: readonly Coordinate[],
  size: { width: number; height: number },
  padding: readonly number[],
  pitch = 0,
  rotation = 0,
) {
  const [sw, ne] = boundsOf(points);
  const mercatorY = (latitude: number) => {
    const sin = Math.sin((latitude * Math.PI) / 180);
    return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  };
  const dx = (256 * (ne[0] - sw[0])) / 360;
  const dy = 256 * (mercatorY(sw[1]) - mercatorY(ne[1]));
  const angle = (rotation * Math.PI) / 180;
  const rotatedDx =
    Math.abs(dx * Math.cos(angle)) + Math.abs(dy * Math.sin(angle));
  const rotatedDy =
    Math.abs(dx * Math.sin(angle)) + Math.abs(dy * Math.cos(angle));
  const width = Math.max(80, size.width - padding[2] - padding[3]);
  const height = Math.max(80, size.height - padding[0] - padding[1]);
  const zoom =
    Math.log2(
      Math.min(
        width / Math.max(rotatedDx, 0.00001),
        height / Math.max(rotatedDy, 0.00001),
      ),
    ) -
    Math.max(0, pitch) / 110;
  return {
    center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2] as Coordinate,
    zoom: Math.max(CAMPUS_MIN_ZOOM, Math.min(17.4, zoom)),
  };
}
