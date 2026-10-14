import raw from "./nanyuan7-model.json";
import review from "./owner-model-review.json";
import manifest from "./local-map-manifest.json";
import { campusData } from "./campus";

export const modelPilot = raw;
const place = campusData.places.find((p) => p.id === raw.placeId);
export const modelPilotAvailable =
  raw.mapVersion === manifest.version &&
  raw.mapVersion === campusData.mapVersion &&
  raw.mapVersion === review.mapVersion &&
  raw.placeId === review.placeId &&
  raw.heightMeters === review.heightMeters &&
  raw.levels === review.levels &&
  JSON.stringify(raw.geometry.coordinates[0]) ===
    JSON.stringify(place?.geometry);

export type PilotModelState = "idle" | "loading" | "ready" | "error";

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
