import { deviceHeading } from "../data/device-location";
type CompassEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};
let compassGranted = false;
export function watchDeviceHeading(update: (heading: number | null) => void) {
  let disposed = false,
    last = 0;
  const receive = (event: DeviceOrientationEvent) => {
    if (disposed || performance.now() - last < 80) return;
    const e = event as CompassEvent;
    const heading = deviceHeading(
      {
        alpha: e.alpha,
        absolute: e.absolute || e.type === "deviceorientationabsolute",
        webkitCompassHeading: e.webkitCompassHeading,
        webkitCompassAccuracy: e.webkitCompassAccuracy,
      },
      window.screen.orientation?.angle || 0,
    );
    if (heading !== null) {
      last = performance.now();
      update(heading);
    }
  };
  const attach = () => {
    if (disposed) return;
    window.addEventListener("deviceorientationabsolute", receive);
    window.addEventListener("deviceorientation", receive);
  };
  const sensor =
    window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: (absolute?: boolean) => Promise<string>;
    };
  if (sensor?.requestPermission && !compassGranted) {
    try {
      void sensor
        .requestPermission(true)
        .then((result) => {
          if (result === "granted") {
            compassGranted = true;
            attach();
          }
        })
        .catch(() => {});
    } catch {
      /* Position remains usable without compass permission. */
    }
  } else attach();
  return () => {
    disposed = true;
    window.removeEventListener("deviceorientationabsolute", receive);
    window.removeEventListener("deviceorientation", receive);
    update(null);
  };
}
