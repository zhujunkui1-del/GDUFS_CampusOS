import { it, expect } from "vitest";
import { dateGateFixture as fixture, command } from "../fixtures/date-gate";
import { sourceInput, confirmed } from "../fixtures/console-v2";
import { readPublicContent } from "@/lib/server/console/public-content";

it("hides and restores articles without clearing or rewriting any document, body, version or publication receipt", async () => {
  const f = await fixture();
  try {
    await f.protect("white", true);
    const before = f.snapshot(),
      initial = f.visible();
    const preview = await f.store.previewGate({
      commandId: crypto.randomUUID(),
      cutoff: "2026-07-01",
    });
    expect(f.visible()).toEqual(initial);
    expect(f.snapshot()).toBe(before);
    let p = await f.store.actGate(
      String(preview.id),
      command(Number(preview.version), "confirm"),
    );
    while (p.state === "purging")
      p = await f.store.actGate(
        String(p.id),
        command(Number(p.version), "clean"),
      );
    expect(f.visible()).toEqual(["autumn", "white"]);
    expect(f.snapshot()).toBe(before);
    expect((await f.store.articlesV2({})).total).toBe(3);
    expect(
      f.sqlite
        .prepare("SELECT count(*) n FROM console_cleanup_tombstones")
        .get()?.n,
    ).toBe(0);
    const restored = await f.gate("2026-01-01");
    expect(Number(restored.restored_count)).toBe(1);
    expect(f.visible()).toEqual(initial);
    expect(f.snapshot()).toBe(before);
    expect(
      f.sqlite
        .prepare(
          "SELECT count(*) n FROM console_commands WHERE action='document.review'",
        )
        .get()?.n,
    ).toBe(0);
  } finally {
    f.close();
  }
});

it("honors whitelist changes immediately, invalidates grouped totals, and never restores a manual withdrawal", async () => {
  const f = await fixture();
  try {
    expect(
      (await readPublicContent(f.db, { surface: "knowledge", grouped: "1" }))
        .total,
    ).toBe(3);
    await f.gate("2026-07-01");
    expect(
      (await readPublicContent(f.db, { surface: "knowledge", grouped: "1" }))
        .total,
    ).toBe(1);
    await f.protect("spring", true);
    expect(f.visible()).toContain("spring");
    expect(
      (await readPublicContent(f.db, { surface: "knowledge", grouped: "1" }))
        .total,
    ).toBe(2);
    await f.protect("spring", false);
    expect(f.visible()).not.toContain("spring");
    const d = await f.store.document("spring");
    await f.store.publish(
      d.id,
      { ...command(d.version), note: "人工下架" },
      true,
    );
    await f.gate("2026-01-01");
    expect(f.visible()).toEqual(["autumn", "white"]);
    expect(
      f.sqlite
        .prepare(
          "SELECT hold_reason FROM console_document_controls WHERE document_id='spring'",
        )
        .get()?.hold_reason,
    ).toBe("manual_withdrawal");
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    f.close();
  }
});

it("uses Beijing date boundaries and honors both primary and linked source whitelists", async () => {
  const f = await fixture();
  try {
    await f.article("boundary", "2026-06-30T16:00:00.000Z");
    await f.gate("2026-07-01");
    expect(f.visible()).toEqual(["autumn", "boundary"]);
    const alias = await f.store.createGovernedSource(
      sourceInput({
        websiteUrl: "https://alias.example.invalid/",
        governance: confirmed,
      }),
    );
    f.sqlite
      .prepare(
        "INSERT INTO document_origins(id,source_id,document_id,canonical_url,entry_url,first_seen_at,last_seen_at) VALUES('alias',?,'spring','https://example.invalid/spring','https://alias.example.invalid/','2026-10-25','2026-10-25')",
      )
      .run(alias.id);
    await f.store.protection({
      ...command(alias.version),
      type: "source",
      targetId: alias.id,
      active: true,
      historyExempt: true,
      expiresAt: null,
      reason: "来源白名单",
    });
    expect(f.visible()).toEqual(["autumn", "boundary", "spring"]);
    const source = await f.store.sourceV2(f.source.id);
    await f.store.protection({
      ...command(source.version),
      type: "source",
      targetId: source.id,
      active: true,
      historyExempt: true,
      expiresAt: null,
      reason: "主来源白名单",
    });
    expect(f.visible()).toEqual(["autumn", "boundary", "spring", "white"]);
  } finally {
    f.close();
  }
});

it("rejects destructive batches from an old preview without modifying content", async () => {
  const f = await fixture();
  try {
    const before = f.snapshot();
    f.sqlite
      .prepare(
        "INSERT INTO console_cleanup_plans(id,admin_id,filters_json,state,mode,created_at,updated_at,confirmed_at) VALUES('old-plan',?,'{\"cutoff\":\"2026-07-01\"}','purging','date_gate','2026-10-25','2026-10-25','2026-10-25')",
      )
      .run(f.actor.id);
    await expect(
      f.store.actGate("old-plan", command(1, "clean")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(() =>
      f.sqlite
        .prepare(
          "INSERT INTO console_cleanup_guards(plan_id,document_id,document_version,cutoff,command_id) VALUES('old-plan','spring',2,'2026-07-01','old-command')",
        )
        .run(),
    ).toThrow("CONSOLE_DATE_GATE_VISIBILITY_ONLY");
    expect(f.snapshot()).toBe(before);
  } finally {
    f.close();
  }
});
