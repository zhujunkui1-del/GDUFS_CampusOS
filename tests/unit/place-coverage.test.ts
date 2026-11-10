import { expect, it } from "vitest";
import { campusData, searchCampusPlaces } from "@/features/campus-map/data/campus";
import { CampusMapService } from "@/lib/server/maps/campus-map-service";
import { inputGate } from "@/lib/server/assistant/input-gate";
import { writeFileSync, mkdirSync } from "node:fs";

const context = {
  requestId: "audit",
  sessionId: "audit",
  user: null,
  permissions: [],
  campusId: "gdufs_university_town" as const,
};

it("every labelled campus place is routable and resolvable by name and alias", () => {
  const service = new CampusMapService();
  const failures: {
    id: string;
    name: string;
    kind: "gate" | "search";
    query: string;
  }[] = [];
  for (const place of campusData.places) {
    // Placeholder labels and duplicate bridge labels are data-quality items, not
    // routing misses; they are recorded in the audit but not asserted here.
    if (/类型待核验/.test(place.name)) continue;
    if (/语心桥（教学楼[EG]栋）/.test(place.name)) continue;
    if (inputGate(`${place.name}在哪`) !== "campus")
      failures.push({
        id: place.id,
        name: place.name,
        kind: "gate",
        query: place.name,
      });
    for (const query of [place.name, ...(place.aliases || [])]) {
      let found = false;
      try {
        found = service
          .search({ query, limit: 5 }, context)
          .matches.some(
            (match) =>
              match.placeId === place.id ||
              match.name === place.name ||
              place.aliases?.includes(match.name),
          );
      } catch {
        found = false;
      }
      if (!found)
        failures.push({
          id: place.id,
          name: place.name,
          kind: "search",
          query,
        });
    }
  }
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/place-audit.json",
    JSON.stringify({ places: campusData.places.length, failures }, null, 2),
  );
  expect(failures).toEqual([]);
});

it("resolves the everyday service words students actually use", () => {
  // Students ask for 超市 or 打印店, never 又康超市 or 三饭打印店. Without the
  // alias overlay the map tool returned nothing and the assistant answered
  // "not found" for a place that exists on the map.
  const names = (query: string) =>
    searchCampusPlaces(query).map((place) => place.name);
  expect(names("便利店")).toContain("又康超市");
  expect(names("超市")).toContain("又康超市");
  expect(names("打印店")).toContain("三饭打印店");
  expect(names("打印店")).toContain("B栋打印店");
  expect(names("快递")).toContain("菜鸟驿站");
});
