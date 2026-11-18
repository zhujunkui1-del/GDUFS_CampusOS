import {
  campusData,
  searchCampusPlaces,
  categoryNames,
} from "@/features/campus-map/data/campus";

import { buildingProfileId } from "@/features/campus-map/data/building-groups";
import baiyun from "@/features/campus-map/data/baiyun-map.json";
type MappedPlace = {
  placeId: string;
  name: string;
  precision: "building";
  campus?: "baiyun";
};
function baiyunPlace(raw: string, campus: string): MappedPlace | null {
  if (campus === "university_town") return null;
  const text = normalize(raw),
    known = campus === "baiyun" || /白云山|北校区/.test(text);
  if (/大学城|南校区|校外|线上|腾讯会议|ZOOM/.test(text)) return null;
  const ids = new Set<string>();
  if (/明德报告厅/.test(text) && known) {
    const sixth = baiyun.places.find((p) => p.name === "第六教学楼");
    if (sixth) ids.add(sixth.id);
  }
  const digits = "一二三四五六七八九";
  for (const match of text.matchAll(
    /(?:^|[^一二三四五六七八九十\d])第?([一二三四五六七八九1-9])(?:教学楼|教)/g,
  )) {
    const number = /\d/.test(match[1])
      ? Number(match[1])
      : digits.indexOf(match[1]) + 1;
    const p = baiyun.places.find(
      (p) => p.name === `第${digits[number - 1]}教学楼`,
    );
    if (p) ids.add(p.id);
  }
  const matches = baiyun.places.filter((p) => {
    const name = normalize(p.name);
    return (
      name.length >= 3 &&
      text.includes(name) &&
      (known ||
        ![
          "体育馆",
          "体育场",
          "图书馆",
          "行政办公楼",
          "招待所",
          "干训楼",
        ].includes(p.name))
    );
  });
  for (const p of matches.filter(
    (p) =>
      !matches.some(
        (q) =>
          q.id !== p.id &&
          q.name.length > p.name.length &&
          q.name.includes(p.name),
      ),
  ))
    ids.add(p.id);
  if (known && /图书馆/.test(text))
    ids.add(baiyun.places.find((p) => p.name === "北校区图书馆")!.id);
  if (ids.size !== 1) return null;
  const place = baiyun.places.find((p) => p.id === [...ids][0])!;
  return {
    placeId: place.id,
    name: place.name,
    precision: "building",
    campus: "baiyun",
  };
}
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
  if (baiyun.places.some((p) => p.id === id)) return new Set([id]);
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
): MappedPlace | null {
  if (raw && campus !== "online" && !/线上|校外|线下地点待定/.test(raw)) {
    const match = baiyunPlace(raw, campus);
    if (match) return match;
  }
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
