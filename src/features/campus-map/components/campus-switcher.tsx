"use client";
import Link from "next/link";
import { useCampusMap } from "./campus-map-provider";
import { CampusSegments } from "./campus-segments";

export function CampusSwitcher() {
  const map = useCampusMap();
  return (
    <div className="map-context map-context-campuses">
      <Link className="compact-brand" href="/map">
        广外通 <span>CampusOS</span>
      </Link>
      <CampusSegments value={map.campus} onChange={map.setCampus} />
    </div>
  );
}
