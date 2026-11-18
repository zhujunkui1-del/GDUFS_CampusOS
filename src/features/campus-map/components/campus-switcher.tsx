"use client";
import Link from "next/link";
import { useCampusMap } from "./campus-map-provider";

export function CampusSwitcher() {
  const map = useCampusMap();
  return (
    <div className="map-context map-context-campuses">
      <Link className="compact-brand" href="/map">
        广外通 <span>CampusOS</span>
      </Link>
      <div
        className="campus-switcher"
        role="group"
        aria-label="选择校区"
        data-campus={map.campus}
      >
        <span className="campus-switcher-thumb" aria-hidden="true" />
        <button
          aria-pressed={map.campus === "university"}
          onClick={() => map.setCampus("university")}
        >
          大学城校区
        </button>
        <button
          aria-pressed={map.campus === "baiyun"}
          onClick={() => map.setCampus("baiyun")}
        >
          白云山校区
        </button>
      </div>
    </div>
  );
}
