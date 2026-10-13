"use client";
import Link from "next/link";
import { Drawer } from "@base-ui/react/drawer";
import { useRef, useSyncExternalStore, type RefObject } from "react";
import { X, Navigation, Bookmark, Sparkles, ExternalLink } from "lucide-react";
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
            finalFocus={finalFocus}
          >
            <div className="place-details-frame">
              <div className="place-drag-handle" aria-hidden="true">
                <span />
              </div>
              <div className="place-details-heading">
                <div>
                  <p>
                    {place
                      ? `${zoneName(place.zone)} · ${categoryNames[place.category]}`
                      : ""}
                  </p>
                  <Drawer.Title>{place?.name || "地点详情"}</Drawer.Title>
                </div>
                <Drawer.Close
                  ref={close}
                  className="icon-button"
                  aria-label="关闭地点详情"
                >
                  <X size={19} />
                </Drawer.Close>
              </div>
              {place && (
                <Drawer.Content className="place-details-content">
                  <div className="place-detail-actions">
                    <button className="primary-button" onClick={onNavigate}>
                      <Navigation size={16} />
                      选择导航终点
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => map.askAssistant(place)}
                    >
                      <Sparkles size={16} />问 AI
                    </button>
                  </div>
                  <Link className="detail-favorite" href="/account">
                    <Bookmark size={16} />
                    收藏需登录账号服务
                  </Link>
                  <a
                    className="place-source-link"
                    href={place.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看来源 <ExternalLink size={16} />
                  </a>
                </Drawer.Content>
              )}
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
