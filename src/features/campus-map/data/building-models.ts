import raw from "./building-model-catalog.json";
import mapManifest from "./local-map-manifest.json";
import { campusData, type Coordinate } from "./campus";
import { MercatorCoordinate } from "maplibre-gl";

export const buildingModelCatalog = raw;
export type BuildingModelEntry = (typeof raw.entries)[number];
export type BuildingModelAsset = BuildingModelEntry["assets"]["3d"];
export const buildingModelsAvailable =
  raw.approvedForMap &&
  raw.mapVersion === mapManifest.version &&
  raw.mapVersion === campusData.mapVersion;
export function buildingModelForPlace(
  id: string | undefined,
): BuildingModelEntry | undefined {
  if (!id) return;
  const direct = raw.entries.find((e) => e.pickable && e.placeId === id);
  if (direct) return direct;
  const member = raw.entries.find(
    (e) => e.pickable && e.memberPlaceIds.some((member) => member === id),
  );
  if (member) return member;
  const parent = campusData.places.find((p) => p.id === id)?.parentId;
  return parent
    ? raw.entries.find(
        (e) =>
          e.pickable &&
          (e.placeId === parent ||
            e.memberPlaceIds.some((member) => member === parent)),
      )
    : undefined;
}
export function buildingModelCorners(
  entry: BuildingModelEntry,
  mode: "2.5d" | "3d",
) {
  const asset = entry.assets[mode],
    origin = MercatorCoordinate.fromLngLat([entry.origin[0], entry.origin[1]]),
    units = origin.meterInMercatorCoordinateUnits();
  return [asset.bounds.min[0], asset.bounds.max[0]].flatMap((x) =>
    [asset.bounds.min[2], asset.bounds.max[2]].flatMap((z) => {
      const q = new MercatorCoordinate(
        origin.x + x * units,
        origin.y + z * units,
      ).toLngLat();
      return [asset.bounds.min[1], asset.bounds.max[1]].map((height) => ({
        coordinate: [q.lng, q.lat] as Coordinate,
        height: Math.max(0, height),
      }));
    }),
  );
}
