import {
  campusData,
  searchCampusPlaces,
  categoryNames,
} from "@/features/campus-map/data/campus";

import { buildingProfileId } from "@/features/campus-map/data/building-groups";
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s（）()]/g, "")
    .replace(/办公(?=楼)|[栋座](?=教学楼)/g, "");
const places = searchCampusPlaces("");
const names = places.map((place) => ({
  place,
  names: [
    place.name,
    ...(place.aliases || []).filter((name) => name.length >= 3),
  ].map(normalize),
}));

export function buildingActivityPlaceIds(id: string) {
  return new Set(
    campusData.places
      .filter(
        (place) =>
          buildingProfileId(place.id) === buildingProfileId(id) ||
          place.parentId === id,
      )
      .map((place) => place.id),
  );
}

export function articleMapPlace(
  raw: string | null,
  campus: "university_town" | "baiyun" | "online" | "unknown" = "unknown",
) {
  if (
    !raw ||
    campus === "baiyun" ||
    campus === "online" ||
    /白云|北校区|校外|线上|线下地点待定/.test(raw)
  )
    return null;
  const text = normalize(raw).replace(
    /广东外语外贸大学|广外|大学城校区|大学城|南校区/g,
    "",
  );
  const matches = new Map(
    names
      .filter((entry) =>
        entry.names.some((name) => name.length >= 2 && text.includes(name)),
      )
      .map((entry) => [entry.place.id, entry.place]),
  );
  const campusKnown = campus === "university_town" || /大学城|南校区/.test(raw);
  if (!campusKnown) {
    const specific = [...matches.values()].filter(
      (place) =>
        normalize(place.name) !== normalize(categoryNames[place.category]) &&
        text.includes(normalize(place.name)),
    );
    matches.clear();
    for (const place of specific) matches.set(place.id, place);
  }
  // Room codes identify an existing building, never an invented room coordinate.
  if (campusKnown)
    for (const place of places) {
      const parts = normalize(place.name).match(
        /^([\p{Script=Han}]+)([A-Z])[栋座]?$/u,
      );
      if (!parts) continue;
      const [, kind, letter] = parts;
      const pattern = new RegExp(
        `(?:^|[^A-Z0-9])(?:${kind})?${letter}(?:栋|座|号楼|楼)?(?:${kind})?[-]?([1-9]\\d{2,3})(?!\\d)`,
      );
      if (
        pattern.test(text) &&
        (places.some((candidate) => {
          const prefix = normalize(candidate.name).match(
            /^([\p{Script=Han}]+)[A-Z][栋座]?$/u,
          )?.[1];
          return prefix && text.includes(prefix);
        })
          ? text.includes(kind)
          : place.category === "teaching")
      )
        matches.set(place.id, place);
      if (new RegExp(`${letter}(?:栋|座)?${kind}`).test(text))
        matches.set(place.id, place);
    }
  const unique = [...matches.values()].filter(
    (place) =>
      ![...matches.values()].some((other) => other.parentId === place.id),
  );
  return unique.length === 1
    ? {
        placeId: unique[0].id,
        name: unique[0].name,
        precision: "building" as const,
      }
    : null;
}
