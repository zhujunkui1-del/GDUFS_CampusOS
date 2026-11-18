import { MapWorkspace } from "@/features/campus-map/components/map-workspace";
import manifest from "@/features/campus-map/data/local-map-manifest.json";
import { Suspense } from "react";

export default function MapPage() {
  return (
    <>
      <link
        rel="preload"
        as="fetch"
        href={manifest.url}
        crossOrigin="anonymous"
      />
      <Suspense
        fallback={<section className="map-workspace" aria-label="校园地图" />}
      >
        <MapWorkspace />
      </Suspense>
    </>
  );
}
