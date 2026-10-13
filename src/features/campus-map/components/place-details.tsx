"use client";
import Link from "next/link";
import { Drawer } from "@base-ui/react/drawer";
import { useRef, useSyncExternalStore, type RefObject } from "react";
import {
  X,
  Navigation,
  Bookmark,
  Sparkles,
  ExternalLink,
  MapPin,
} from "lucide-react";
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
                  <Drawer.Description>校园公开地点资料</Drawer.Description>
                  <p className="place-position">
                    <MapPin size={16} />
                    {place.coordinate.map((v) => v.toFixed(6)).join(", ")}
                    <small>WGS84 地物标注位置</small>
                  </p>
                  <p>
                    {place.navigationVerified
                      ? "下沉隧道及两端台阶已由负责人确认正常步行通行。开放状态以现场为准。"
                      : "建筑入口与开放时间尚未核验。导航以附近步行道路为终点，也可在地图上选择已知可通行的位置。"}
                  </p>
                  {place.parentId && (
                    <p>
                      分栋名称按负责人确认的朝北顺序标注，使用复合建筑原始轮廓；未生成独立分栋边界。
                    </p>
                  )}
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
                  <div className="place-source">
                    <a href={place.sourceUrl} target="_blank" rel="noreferrer">
                      OpenStreetMap 地物原始记录
                      <ExternalLink size={13} />
                    </a>
                    <span>
                      采集：{place.fetchedAt.slice(0, 10)} · 地物来源已核对
                    </span>
                    {place.nameSource && (
                      <span>
                        名称：
                        {place.nameSource.startsWith("负责人逐栋确认")
                          ? "负责人逐栋确认"
                          : place.nameSource}{" "}
                        · {place.nameReviewedAt}
                      </span>
                    )}
                    <span>
                      {place.navigationVerified
                        ? `通行：${place.navigationSource} · ${place.navigationReviewedAt}。开放状态以现场为准。`
                        : "出入口、服务信息与当前通行情况待核验。"}
                    </span>
                  </div>
                </Drawer.Content>
              )}
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
