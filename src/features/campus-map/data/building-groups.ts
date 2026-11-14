import { campusData } from "./campus";
const sharedSports = new Set([
  "basketball",
  "badminton",
  "volleyball",
  "tennis",
  "swimming",
]);
export function buildingProfileId(id: string) {
  const place = campusData.places.find((place) => place.id === id);
  if (!place) return id;
  if (sharedSports.has(place.category)) {
    const first = campusData.places.find(
      (item) => item.category === place.category && !item.hiddenLabel,
    )!;
    return first.labelPlaceId || first.id;
  }
  return place.labelPlaceId || place.id;
}
export function buildingProfileMembers(id: string) {
  const key = buildingProfileId(id);
  return campusData.places.filter(
    (place) => buildingProfileId(place.id) === key,
  );
}
export const managedBuildings = campusData.places.filter(
  (place) => !place.hiddenLabel && buildingProfileId(place.id) === place.id,
);
