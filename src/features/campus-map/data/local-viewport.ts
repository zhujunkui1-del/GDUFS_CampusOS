// Pure conservative perspective limits: constrain before paint, including gestures.
// MapLibre Mercator world uses 512px at zoom 0. Reserve perspective margin for
// its default field of view; no viewport corner may reveal missing map context.
export function viewportFootprint(
  width: number,
  height: number,
  pitch: number,
  bearing: number,
) {
  const rad = Math.PI / 180;
  const perspective =
    1 / Math.max(0.15, Math.cos(pitch * rad) - Math.sin(pitch * rad) / 3);
  const c = Math.abs(Math.cos(bearing * rad)),
    s = Math.abs(Math.sin(bearing * rad));
  return {
    width: (width * c + height * s) * perspective,
    height: (width * s + height * c) * perspective,
  };
}
