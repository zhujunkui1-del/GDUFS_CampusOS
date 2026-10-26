import { it, expect } from "vitest";
import { PublicNoteCache } from "../../services/external-search/cache.mjs";
it("caches actual excerpts without changing their retrieval date", () => {
  let now = 0;
  const cache = new PublicNoteCache(() => now, 120, 2);
  const item = {
    evidenceKind: "page_excerpt",
    retrievedAt: "original",
    snippet: "test",
  };
  cache.put("a", [item]);
  expect(cache.get("a", 1)).toEqual([item]);
  now = 120;
  expect(cache.get("a", 1)).toBeNull();
});
it("does not cache metadata-only results or empty searches", () => {
  const cache = new PublicNoteCache();
  cache.put("a", [{ evidenceKind: "title_only" }]);
  cache.put("b", []);
  expect(cache.get("a", 1)).toBeNull();
  expect(cache.get("b", 1)).toBeNull();
});
it("bounds entry count and respects each result limit", () => {
  const cache = new PublicNoteCache(() => 0, 120, 2);
  const items = [
    { evidenceKind: "page_excerpt" },
    { evidenceKind: "title_only" },
  ];
  cache.put("a", items);
  cache.put("b", items);
  cache.put("c", items);
  expect(cache.get("a", 1)).toBeNull();
  expect(cache.get("b", 1)).toHaveLength(1);
});
