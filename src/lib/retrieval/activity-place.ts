import { searchCampusPlaces } from "@/features/campus-map/data/campus";
export function articleMapPlace(raw: string | null) {
  if (!raw || !/大学城|南校区/.test(raw) || /白云|北校区|校外|线上/.test(raw))
    return null;
  const normalized = raw
    .replace(/广东外语外贸大学|广外|大学城校区|大学城|南校区|[（()）]/g, "")
    .trim();
  const matches = searchCampusPlaces("").filter((p) =>
    [p.name, ...(p.aliases || [])].some(
      (n) => n.length >= 3 && normalized.includes(n),
    ),
  );
  const unique = [...new Map(matches.map((p) => [p.id, p])).values()];
  return unique.length === 1
    ? {
        placeId: unique[0].id,
        name: unique[0].name,
        precision: "building" as const,
      }
    : null;
}
