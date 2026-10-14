"use client";
import { useCampusMap } from "./campus-map-provider";

const labels = { "2d": "2D", "2.5d": "2.5D", "3d": "3D" };

export function MapViewButtons({ onChange }: { onChange?: () => void }) {
  const map = useCampusMap();
  const next =
    map.mode === "2d"
      ? "2.5d"
      : map.mode === "2.5d" && map.modelAvailable && map.modelState !== "error"
        ? "3d"
        : "2d";
  return (
    <button
      className="map-mode-button"
      data-testid="map-mode-trigger"
      disabled={map.status !== "ready" || (next === "2.5d" && !map.supports3D)}
      aria-label={`地图模式，当前${labels[map.mode]}，切换为${labels[next]}`}
      aria-busy={map.mode === "3d" && map.modelState === "loading"}
      title={`切换为${labels[next]}`}
      onClick={() => {
        onChange?.();
        map.setMode(next);
      }}
    >
      {labels[map.mode]}
    </button>
  );
}
