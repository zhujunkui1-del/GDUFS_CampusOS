import { MapWorkspace } from "@/features/campus-map/components/map-workspace";
import manifest from "@/features/campus-map/data/local-map-manifest.json";

export default function MapPage() {
  return (
    <>
      <link
        rel="preload"
        as="fetch"
        href={manifest.url}
        crossOrigin="anonymous"
      />
      <link
        rel="modulepreload"
        href="/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs"
        crossOrigin="anonymous"
      />
      <link
        rel="modulepreload"
        href="/vendor/maplibre-6.14.0/maplibre-gl-shared.mjs"
        crossOrigin="anonymous"
      />
      <MapWorkspace />
    </>
  );
}
