"use client";
import { useEffect } from "react";
import { X } from "lucide-react";
import { useCampusMap } from "./campus-map-provider";
export function LocationNotice() {
  const map = useCampusMap(),
    id = map.locationNoticeId;
  const visible = map.locationNoticeVisible,
    dismiss = map.dismissLocationNotice;
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => dismiss(id), 6000);
    return () => clearTimeout(t);
  }, [id, visible, dismiss]);
  if (!map.locationNoticeVisible) return null;
  return (
    <div className="map-location-notice" role="status">
      <span>{map.locationMessage}</span>
      <button
        className="icon-button"
        aria-label="关闭定位提示"
        onClick={() => map.dismissLocationNotice(id)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
