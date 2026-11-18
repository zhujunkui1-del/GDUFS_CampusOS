import { campusData } from "./campus";
import baiyun from "./baiyun-map.json";
export const buildingPlaces = [
  ...campusData.places.map((place) => ({
    ...place,
    campus: "university" as const,
  })),
  ...baiyun.places.map((place) => ({
    ...place,
    hiddenLabel: false,
    labelPlaceId: undefined,
    campus: "baiyun" as const,
  })),
];
const sharedSports = new Set([
  "basketball",
  "badminton",
  "volleyball",
  "tennis",
  "swimming",
]);
export function buildingProfileId(id: string) {
  const place = buildingPlaces.find((place) => place.id === id);
  if (!place) return id;
  if (place.campus === "university" && sharedSports.has(place.category)) {
    const first = campusData.places.find(
      (item) => item.category === place.category && !item.hiddenLabel,
    )!;
    return first.labelPlaceId || first.id;
  }
  return place.labelPlaceId || place.id;
}
export function buildingProfileMembers(id: string) {
  const key = buildingProfileId(id);
  return buildingPlaces.filter((place) => buildingProfileId(place.id) === key);
}
export const managedBuildings = buildingPlaces.filter(
  (place) => !place.hiddenLabel && buildingProfileId(place.id) === place.id,
);
