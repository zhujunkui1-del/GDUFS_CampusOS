import { it, expect } from "vitest";
import { dateGateFixture, command } from "../fixtures/date-gate";
import { readPublicContent } from "@/lib/server/console/public-content";

it("jumps directly beyond the legacy offset cap, preserves cursor navigation and current visibility", async () => {
  const f = await dateGateFixture();
  try {
    for (let i = 0; i < 225; i++)
      await f.article(`jump-${String(i).padStart(3, "0")}`, "2026-10-24");
    f.sqlite
      .prepare(
        "INSERT INTO document_classification_overrides(document_id,radar_category,knowledge_category,updated_by,updated_at) SELECT id,'lecture',NULL,?,'2026-10-31' FROM knowledge_documents WHERE id LIKE 'jump-%' ON CONFLICT(document_id) DO UPDATE SET radar_category='lecture',knowledge_category=NULL",
      )
      .run(f.actor.id);
    const query = { surface: "radar", category: "lecture", limit: 20 };
    const deep = await readPublicContent(f.db, { ...query, page: 12 });
    expect(deep.offset).toBe(220);
    expect(deep.items.map((x) => x.id)).toEqual([
      "jump-220",
      "jump-221",
      "jump-222",
      "jump-223",
      "jump-224",
    ]);
    expect(deep.hasMore).toBe(false);
    const first = await readPublicContent(f.db, { ...query, page: 1 });
    const cursor = await readPublicContent(f.db, {
      ...query,
      cursor: first.nextCursor,
    });
    const numbered = await readPublicContent(f.db, { ...query, page: 2 });
    expect(cursor.items.map((x) => x.id)).toEqual(
      numbered.items.map((x) => x.id),
    );
    const filtered = await readPublicContent(f.db, {
      ...query,
      q: "jump-22",
      page: 2,
      limit: 2,
    });
    expect(filtered.items.map((x) => x.id)).toEqual(["jump-222", "jump-223"]);
    const d = await f.store.document("jump-222");
    await f.store.publish(
      d.id,
      { ...command(d.version), note: "隔离分页下架测试" },
      true,
    );
    const clamped = await readPublicContent(f.db, { ...query, page: 999 });
    expect(clamped.offset).toBe(220);
    expect(clamped.items.map((x) => x.id)).not.toContain("jump-222");
    expect(
      (
        await readPublicContent(f.db, {
          surface: "knowledge",
          category: "campus_life",
          limit: 1,
          page: 2,
        })
      ).items[0].id,
    ).toBe("spring");
    await expect(
      readPublicContent(f.db, { ...query, page: 0 }),
    ).rejects.toThrow();
    await expect(
      readPublicContent(f.db, { ...query, page: 2, cursor: first.nextCursor }),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
