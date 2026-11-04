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
      <MapWorkspace />
    </>
  );
}
