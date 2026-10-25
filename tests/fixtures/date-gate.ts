import { consoleV2Fixture, sourceInput, confirmed } from "./console-v2";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
export const command = (expectedVersion: number, action?: string) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
  ...(action ? { action } : {}),
});
export async function dateGateFixture() {
  const f = await consoleV2Fixture(),
    store = new ConsoleSyncStore(f.db, f.actor);
  f.sqlite.exec(
    "UPDATE console_engine_settings SET earliest_import_day='2026-01-01'",
  );
  const source = await store.createGovernedSource(
    sourceInput({ governance: confirmed }),
  );
  async function article(id: string, date: string) {
    f.sqlite
      .prepare(
        "INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES(?,?,?,?,'<p>原文全文与CDN引用</p>','reading_html','complete',?,'2026-10-25','all','campus_announcements',?,1,?,'licensed_full_text','notice','campus_life')",
      )
      .run(
        id,
        source.id,
        id,
        "https://example.invalid/" + id,
        id,
        date,
        "a".repeat(64),
      );
    f.sqlite
      .prepare(
        "INSERT INTO console_revision_payloads(document_id,content_revision,input_hash,input_json,created_at) VALUES(?,1,?,'{\"body\":\"原文全文\"}','2026-10-25')",
      )
      .run(id, "a".repeat(64));
    if (!(await store.publishCollectedWebArticle(id)).published)
      throw new Error("Fixture publication failed");
    return id;
  }
  const ids = await Promise.all([
    article("spring", "2026-04-03"),
    article("autumn", "2026-10-24"),
    article("white", "2026-02-01"),
  ]);
  const visible = () =>
    f.sqlite
      .prepare("SELECT id FROM console_public_documents ORDER BY id")
      .all()
      .map((r) => r.id);
  const snapshot = () =>
    JSON.stringify({
      documents: f.sqlite
        .prepare("SELECT * FROM knowledge_documents ORDER BY id")
        .all(),
      versions: f.sqlite
        .prepare(
          "SELECT * FROM console_content_versions ORDER BY document_id,version",
        )
        .all(),
      payloads: f.sqlite
        .prepare(
          "SELECT * FROM console_revision_payloads ORDER BY document_id,content_revision",
        )
        .all(),
    });
  async function protect(id: string, active: boolean) {
    const d = await store.document(id);
    await store.protection({
      ...command(d.version),
      type: "document",
      targetId: id,
      active,
      historyExempt: true,
      expiresAt: null,
      reason: "白名单测试",
    });
  }
  async function gate(cutoff: string) {
    let p = await store.previewGate({ commandId: crypto.randomUUID(), cutoff });
    p = await store.actGate(
      String(p.id),
      command(Number(p.version), "confirm"),
    );
    while (p.state === "purging")
      p = await store.actGate(
        String(p.id),
        command(Number(p.version), "clean"),
      );
    return p;
  }
  return {
    ...f,
    store,
    source,
    ids,
    article,
    visible,
    snapshot,
    protect,
    gate,
  };
}
