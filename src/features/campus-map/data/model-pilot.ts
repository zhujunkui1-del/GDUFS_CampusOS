import raw from "./nanyuan7-model.json";
import review from "./owner-model-review.json";
import manifest from "./local-map-manifest.json";
import { campusData } from "./campus";
import { MercatorCoordinate } from "maplibre-gl";

export const modelPilot = raw;
const place = campusData.places.find((p) => p.id === raw.placeId);
export const modelPilotAvailable =
  raw.mapVersion === manifest.version &&
  raw.mapVersion === campusData.mapVersion &&
  raw.mapVersion === review.mapVersion &&
  raw.placeId === review.placeId &&
  raw.heightMeters === review.heightMeters &&
  raw.levels === review.levels &&
  raw.modelVersion === review.model3D.modelVersion &&
  raw.assets.full.sha256 === review.model3D.assetSha256 &&
  raw.assets.low.sha256 === review.model3D.assetSha256 &&
  review.model3D.approvedForMap &&
  JSON.stringify(raw.geometry.coordinates[0]) ===
    JSON.stringify(place?.geometry);

export type PilotModelState = "idle" | "loading" | "ready" | "error";

// Display bounds include V2 roof/balcony projections; they never change the GIS footprint.
const origin = MercatorCoordinate.fromLngLat([raw.origin[0], raw.origin[1]]);
const scale = origin.meterInMercatorCoordinateUnits();
export const pilotModelCorners = [
  raw.modelBounds.min[0],
  raw.modelBounds.max[0],
].flatMap((x) =>
  [raw.modelBounds.min[2], raw.modelBounds.max[2]].flatMap((z) => {
    const point = new MercatorCoordinate(
      origin.x + x * scale,
      origin.y + z * scale,
    ).toLngLat();
    return [raw.modelBounds.min[1], raw.modelBounds.max[1]].map((height) => ({
      coordinate: [point.lng, point.lat] as [number, number],
      height,
    }));
  }),
);

export function pilotVolume(): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    properties: { sourceId: raw.placeId, heightMeters: raw.heightMeters },
    geometry: { type: "Polygon", coordinates: raw.geometry.coordinates },
  };
}
export function pilotCourtyard(): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    properties: { sourceId: raw.placeId },
    geometry: {
      type: "Polygon",
      coordinates: raw.courtyardGeometry.coordinates,
    },
  };
}
