import { it, expect, vi } from "vitest";
import { LocalMapAdapter } from "@/features/campus-map/adapters/local-map-adapter";
import { campusData } from "@/features/campus-map/data/campus";
it.each(["selected", "route", "navigation"])(
  "changes pitch only with %s context",
  (context) => {
    const animateCamera = vi.fn(),
      animatePoints = vi.fn();
    const map = Object.create(LocalMapAdapter.prototype) as LocalMapAdapter;
    Object.assign(map, {
      supports3D: true,
      native: { getBearing: () => 0, getZoom: () => 16.2 },
      routes: new Map(
        context === "route"
          ? [
              [
                "route",
                {
                  pathGcj02: [
                    [113.39, 23.06],
                    [113.391, 23.061],
                  ],
                },
              ],
            ]
          : [],
      ),
      activeRouteId: context === "route" ? "route" : undefined,
      selected:
        context === "selected"
          ? campusData.places.find((p) => p.name === "南苑12栋")!.id
          : undefined,
      navigationHasPosition: context === "navigation",
      lastFollow: context === "navigation" ? [113.39, 23.06] : undefined,
      animateCamera,
      animatePoints,
    });
    map.setPitch(38);
    expect(animateCamera).toHaveBeenCalledWith({ pitch: 38 });
    expect(animatePoints).not.toHaveBeenCalled();
  },
);
