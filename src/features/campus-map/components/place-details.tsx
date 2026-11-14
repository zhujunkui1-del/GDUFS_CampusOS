"use client";
import { BuildingInfo } from "./building-info";
import { Drawer } from "@base-ui/react/drawer";
import { useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { X, Navigation, Maximize2, Minimize2 } from "lucide-react";
import { useCampusMap } from "./campus-map-provider";
import { categoryNames, zoneName } from "../data/campus";

const compactQuery =
  "(max-width: 760px), (max-width: 1024px) and (max-height: 500px)";
const snapPoints = [0.62, 1];
function compactSnapshot() {
  return window.matchMedia(compactQuery).matches;
}
function subscribe(listener: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function PlaceDetails({
  finalFocus,
  onNavigate,
}: {
  finalFocus: RefObject<HTMLInputElement | null>;
  onNavigate(): void;
}) {
  const map = useCampusMap(),
    place = map.selected;
  const compact = useSyncExternalStore(subscribe, compactSnapshot, () => false);
  const [snapPoint, setSnapPoint] = useState<Drawer.Root.SnapPoint | null>(
    0.62,
  );
  const expanded = snapPoint === 1;
  const close = useRef<HTMLButtonElement>(null);
  return (
    <Drawer.Root
      key={compact ? "compact" : "regular"}
      open={!!place}
      onOpenChange={(open) => {
        if (!open) map.closeDetails();
      }}
      modal={false}
      disablePointerDismissal
      swipeDirection={compact ? "down" : "left"}
      snapPoints={compact ? snapPoints : undefined}
      snapPoint={compact ? snapPoint : undefined}
      onSnapPointChange={setSnapPoint}
    >
      <Drawer.Portal>
        <Drawer.Viewport className="place-details-viewport">
          <Drawer.Popup
            className="place-details-panel"
            initialFocus={close}
            finalFocus={() => {
              // A touch selection must never restore focus to the search input:
              // mobile browsers open the keyboard even after the drawer closes.
              if (compact) return false;
              const active = document.activeElement;
              // Closing motion may finish after the user opens another control.
              // Keep their new focus instead of dismissing the mode menu.
              if (
                active instanceof HTMLElement &&
                active !== document.body &&
                !active.closest(".place-details-panel")
              )
                return false;
              return finalFocus.current || false;
            }}
          >
            <div className="place-details-frame">
              <div
                className="place-drag-handle"
                role={compact ? "separator" : undefined}
                aria-label="调整建筑详情高度"
                aria-orientation="horizontal"
                aria-valuemin={62}
                aria-valuemax={100}
                aria-valuenow={expanded ? 100 : 62}
                tabIndex={compact ? 0 : undefined}
                onKeyDown={(event) => {
                  if (["ArrowUp", "Home"].includes(event.key)) {
                    event.preventDefault();
                    setSnapPoint(1);
                  } else if (["ArrowDown", "End"].includes(event.key)) {
                    event.preventDefault();
                    setSnapPoint(0.62);
                  }
                }}
              >
                <span />
              </div>
              <div className="place-details-topline">
                <p>
                  {place
                    ? `${zoneName(place.zone)} · ${categoryNames[place.category]}`
                    : ""}
                </p>
                {compact && (
                  <button
                    type="button"
                    className="icon-button place-size-toggle"
                    aria-label={expanded ? "收起建筑详情" : "展开建筑详情"}
                    onClick={() => setSnapPoint(expanded ? 0.62 : 1)}
                  >
                    {expanded ? (
                      <Minimize2 size={19} />
                    ) : (
                      <Maximize2 size={19} />
                    )}
                  </button>
                )}
                <Drawer.Close
                  ref={close}
                  className="icon-button"
                  aria-label="关闭地点详情"
                >
                  <X size={19} />
                </Drawer.Close>
              </div>
              <Drawer.Content className="place-details-content">
                <div className="place-details-heading">
                  <Drawer.Title>{place?.name || "地点详情"}</Drawer.Title>
                  {place && (
                    <button className="primary-button" onClick={onNavigate}>
                      <Navigation size={16} />
                      选择导航终点
                    </button>
                  )}
                </div>
                {place && <BuildingInfo key={place.id} id={place.id} />}
              </Drawer.Content>
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
