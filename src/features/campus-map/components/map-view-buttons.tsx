"use client";
import { useCampusMap } from "./campus-map-provider";

export function MapViewButtons({ onChange }: { onChange?: () => void }) {
  const map = useCampusMap();
  const ready = map.status === "ready";
  const target = map.mode === "2d" ? "2.5d" : "2d";
  return (
    <>
      <button
        disabled={!ready || (map.mode === "2d" && !map.supports3D)}
        onClick={() => {
          onChange?.();
          map.setMode(target);
        }}
        aria-label={target === "2d" ? "切换为2D" : "切换为2.5D"}
      >
        {map.mode === "2.5d" ? "2.5D" : "2D"}
      </button>
      <button
        disabled={!ready || !map.modelAvailable || map.modelState === "loading"}
        onClick={() => {
          onChange?.();
          map.setMode(map.mode === "3d" ? "2.5d" : "3d");
        }}
        aria-label={
          map.modelState === "error"
            ? "重试3D"
            : map.mode === "3d"
              ? "返回2.5D"
              : "切换为3D"
        }
        aria-pressed={map.mode === "3d"}
        title={
          map.modelState === "error" ? "3D加载失败，点击重试" : "南苑7栋3D"
        }
      >
        {map.modelState === "loading" ? "…" : "3D"}
      </button>
    </>
  );
}
