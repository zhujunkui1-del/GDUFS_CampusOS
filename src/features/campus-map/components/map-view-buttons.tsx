"use client";
import { Menu } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import { useCampusMap } from "./campus-map-provider";

const modes = ["2d", "2.5d", "3d"] as const;
const labels = { "2d": "2D", "2.5d": "2.5D", "3d": "3D" };

export function MapViewButtons({ onChange }: { onChange?: () => void }) {
  const map = useCampusMap();
  const ready = map.status === "ready";
  return (
    <Menu.Root
      modal={false}
      onOpenChange={(open) => {
        if (open) onChange?.();
      }}
    >
      <Menu.Trigger
        disabled={!ready}
        data-testid="map-mode-trigger"
        aria-label={`地图模式，当前${labels[map.mode]}`}
        aria-busy={map.mode === "3d" && map.modelState === "loading"}
        title="地图模式"
      >
        {labels[map.mode]}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="left"
          align="start"
          sideOffset={10}
          className="map-mode-positioner"
        >
          <Menu.Popup className="map-mode-menu" aria-label="地图模式">
            <Menu.RadioGroup value={map.mode}>
              {modes.map((mode) => (
                <Menu.RadioItem
                  key={mode}
                  value={mode}
                  closeOnClick
                  disabled={
                    (mode !== "2d" && !map.supports3D) ||
                    (mode === "3d" &&
                      (!map.modelAvailable || map.modelState === "loading"))
                  }
                  aria-label={
                    mode === "3d" && map.modelState === "error"
                      ? "重试3D"
                      : `切换为${labels[mode]}`
                  }
                  onClick={() => {
                    onChange?.();
                    map.setMode(mode);
                  }}
                  className="map-mode-item"
                >
                  <span>
                    {mode === "3d" && map.modelState === "error"
                      ? "3D · 重试"
                      : labels[mode]}
                  </span>
                  <Menu.RadioItemIndicator className="map-mode-check">
                    <Check size={16} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
