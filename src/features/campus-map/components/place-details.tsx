"use client";
import { Drawer } from "@base-ui/react/drawer";
import { useRef, useSyncExternalStore, type RefObject } from "react";
import { X, Navigation } from "lucide-react";
import { useCampusMap } from "./campus-map-provider";
import { categoryNames, zoneName } from "../data/campus";

function compactSnapshot() {
  return window.matchMedia("(max-width: 760px)").matches;
}
function subscribe(listener: () => void) {
  const media = window.matchMedia("(max-width: 760px)");
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
  const close = useRef<HTMLButtonElement>(null);
  return (
    <Drawer.Root
      open={!!place}
      onOpenChange={(open) => {
        if (!open) map.closeDetails();
      }}
      modal={false}
      disablePointerDismissal
      swipeDirection={compact ? "down" : "left"}
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
              <div className="place-drag-handle" aria-hidden="true">
                <span />
              </div>
              <div className="place-details-topline">
                <p>
                  {place
                    ? `${zoneName(place.zone)} · ${categoryNames[place.category]}`
                    : ""}
                </p>
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
              </Drawer.Content>
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
