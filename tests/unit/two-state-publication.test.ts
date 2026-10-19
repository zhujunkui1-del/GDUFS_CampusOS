import { describe, expect, it } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
import { readPublicContent } from "@/lib/server/console/public-content";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup() {
  const f = await consoleV2Fixture(),
    store = new ConsoleSyncStore(f.db, f.actor);
  const s = await store.createGovernedSource(
    sourceInput({ governance: confirmed }),
  );
  const result = await store.importBatch({
    commandId: crypto.randomUUID(),
    sourceId: s.id,
    sourceVersion: 1,
    items: [
      {
        title: "管理员待发公告",
        url: "https://example.invalid/article",
        publishedAt: "2026-10-19",
        contentType: "notice",
        bodyStatus: "not_provided",
        campusScope: "all",
      },
    ],
  });
  return { ...f, store, sourceId: s.id, id: result.items[0].id };
}
describe("administrator two-state publication", () => {
  it("publishes a pending article in one action and withdraws it back to pending", async () => {
    const f = await setup();
    try {
      let d = await f.store.document(f.id);
      await f.store.publish(d.id, cmd(d.version));
      expect((await readPublicContent(f.db, { id: d.id })).items).toHaveLength(
        1,
      );
      d = await f.store.document(d.id);
      expect(d.publicationState).toBe("published");
      expect((await f.store.articlesV2({ state: "published" })).total).toBe(1);
      await f.store.publish(d.id, cmd(d.version), true);
      expect((await f.store.document(d.id)).publicationState).toBe("pending");
      await expect(readPublicContent(f.db, { id: d.id })).rejects.toMatchObject(
        { code: "NOT_FOUND" },
      );
      expect((await f.store.articlesV2({ state: "pending" })).total).toBe(1);
      d = await f.store.document(d.id);
      await f.store.publish(d.id, cmd(d.version));
      expect((await f.store.document(d.id)).publicationState).toBe("published");
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("lets explicit administrator publication release an old rejection without automatic retries doing so", async () => {
    const f = await setup();
    try {
      let d = await f.store.document(f.id);
      await f.store.review(d.id, { ...cmd(d.version), decision: "rejected" });
      expect((await f.store.analyse(d.id)).published).toBe(false);
      d = await f.store.document(d.id);
      await f.store.publish(d.id, cmd(d.version));
      expect((await f.store.document(d.id)).publicationState).toBe("published");
      expect(
        f.sqlite
          .prepare(
            "SELECT review_hold,hold_reason FROM console_document_controls WHERE document_id=?",
          )
          .get(d.id),
      ).toMatchObject({ review_hold: null, hold_reason: null });
    } finally {
      f.close();
    }
  });
  it("reports approved-but-hidden articles as pending and preserves role and version checks", async () => {
    const f = await setup();
    try {
      let d = await f.store.document(f.id);
      await f.store.review(d.id, { ...cmd(d.version), decision: "approved" });
      d = await f.store.document(d.id);
      expect(d.reviewStatus).toBe("approved");
      expect(d.publicationState).toBe("pending");
      const row = (await f.store.articlesV2({ state: "pending" })).items[0];
      expect(row.publication_state).toBe("pending");
      await expect(
        f.store.publish(d.id, cmd(d.version - 1)),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      f.sqlite.exec(
        "INSERT INTO console_admins(id,email,role) VALUES('publish-ops','ops@example.invalid','operator')",
      );
      const ops = new ConsoleSyncStore(f.db, {
        id: "publish-ops",
        email: "ops@example.invalid",
        role: "operator",
      });
      await expect(ops.publish(d.id, cmd(d.version))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await f.store.document(d.id)).publicationState).toBe("pending");
    } finally {
      f.close();
    }
  });
});
