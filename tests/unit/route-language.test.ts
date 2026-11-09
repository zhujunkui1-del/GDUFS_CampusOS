import { describe, expect, it } from "vitest";
import { navigationIntent } from "@/domain/agent/navigation-intent";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { normalizePlaceText } from "@/features/campus-map/data/campus-text";
import { CampusMapService } from "@/lib/server/maps/campus-map-service";

const service = new CampusMapService();
const context = {
  requestId: "test",
  sessionId: "test",
  permissions: [],
  campusId: "gdufs_university_town",
} as never;

const INFORMATICS = "osm-way-312536955";
const FAKE_GRASS = "osm-way-1389859437";

describe("map route language", () => {
  it("converts Chinese numerals in building names like the map service does", () => {
    expect(normalizePlaceText("南苑七栋")).toBe("南苑7栋");
    expect(normalizePlaceText("南苑十三栋")).toBe("南苑13栋");
    expect(normalizePlaceText(" 南苑7栋 ".trim())).toBe("南苑7栋");
  });

  it.each([
    "从南苑七栋到假草场",
    "从南苑七栋前往假草场",
    "从南苑七栋前往广外假草场",
    "怎么从南苑七栋前往假草场",
    "怎么从南苑七栋走到假草场",
  ])("parses both ends whatever the verb is: %s", (text) => {
    const intent = navigationIntent(text);
    expect(intent.routeQuestion).toBe(true);
    expect(intent.originIds).toEqual([INFORMATICS]);
    expect(intent.destinations.map((place) => place.id)).toEqual([FAKE_GRASS]);
    expect(intent.originMissing).toBe(false);
  });

  it.each([
    "请问怎么去大学城校区第一饭堂",
    "第一饭堂怎么去",
    "怎么去一饭",
    "第一食堂怎么走",
  ])("resolves the canteen name and asks for a start point: %s", (text) => {
    const intent = navigationIntent(text);
    expect(intent.routeQuestion).toBe(true);
    expect(intent.destinations.map((place) => place.id)).toEqual([
      "osm-way-313039048",
    ]);
    // 第一饭堂 has no origin, so the assistant must ask where the user is
    // instead of falling back to article search.
    expect(intent.needsLocation).toBe(true);
    expect(contentIntent(text).active).toBe(false);
  });

  it("keeps route sentences out of the article-retrieval chain", () => {
    for (const text of [
      "从南苑七栋前往广外假草场",
      "怎么从南苑七栋前往假草场",
      "从南苑七栋到假草场",
    ]) {
      const content = contentIntent(text);
      expect(content.active).toBe(false);
      expect(content.map).toBe(true);
    }
  });

  it("carries a previous destination into the next turn", () => {
    const intent = navigationIntent("南苑七栋", undefined, false, [
      "怎么去假草场",
    ]);
    expect(intent.routeQuestion).toBe(true);
    expect(intent.originIds).toEqual([INFORMATICS]);
    expect(intent.destinations.map((place) => place.id)).toEqual([FAKE_GRASS]);
  });

  it.each([
    ["第一饭堂", "osm-way-313039048"],
    ["第一食堂", "osm-way-313039048"],
    ["一食堂", "osm-way-313039048"],
    ["文采园", "osm-way-313039048"],
    ["大学城校区第一饭堂", "osm-way-313039048"],
    ["第二食堂", "osm-way-313039061"],
    ["博雅园", "osm-way-313039061"],
    ["第三食堂", "osm-way-313039057"],
    ["风采园", "osm-way-313039057"],
    ["广外假草场", "osm-way-1389859437"],
    ["人工草场", "osm-way-1389859437"],
  ])("searches %s as one unambiguous place", async (query, id) => {
    const found = await service.search({ query, limit: 5 }, context);
    expect(found.matches.map((match) => match.placeId)).toEqual([id]);
    expect(found.ambiguous).toBe(false);
  });

  it("does not let a print shop shadow the canteen", async () => {
    const found = await service.search({ query: "三饭", limit: 5 }, context);
    expect(found.matchType).toBe("exact");
    expect(found.matches.map((match) => match.placeId)).toEqual([
      "osm-way-313039057",
    ]);
  });
});

it("does not treat a service question as a route", () => {
  // 「路线怎么走」 asks about the bus line, not a path between two places.
  // Reading it as a route sent the map tool looking for a destination that
  // does not exist, and the user got 「未找到该地点或路线」.
  for (const text of ["校园里有校车吗，路线怎么走？", "校车怎么走？"]) {
    const intent = navigationIntent(text);
    expect(intent.routeQuestion).toBe(false);
    expect(contentIntent(text).map).toBe(false);
  }
});
