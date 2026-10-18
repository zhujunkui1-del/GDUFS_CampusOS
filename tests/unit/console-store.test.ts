import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ConsoleStore, filterPublicContent } from "@/lib/server/console/store";
import {
  createConsoleSession,
  requireConsole,
  closeConsoleSession,
  consoleCsrf,
  type ConsoleBindings,
} from "@/lib/server/console/auth";
import { sourceTypeNames } from "@/domain/console/contracts";
const actor = {
  id: "test-admin",
  email: "test-admin@example.invalid",
  role: "admin" as const,
};
const input = {
  displayName: "隔离测试来源",
  sourceAliases: [],
  sourceType: "official_web",
  subtype: "测试",
  organization: "隔离测试",
  campusScope: "all",
  websiteUrl: "https://example.invalid/source",
  wechatId: null,
  evidenceUrls: ["https://example.invalid/proof"],
  priority: 1,
  connectorType: "disabled",
  connectorConfig: {},
  fetchPolicy: { mode: "disabled", maxRequests: 0 },
};
describe("Console public content governance", () => {
  let fixture: ReturnType<typeof sqliteD1>, store: ConsoleStore;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite
      .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
      .run(actor.id, actor.email);
    store = new ConsoleStore(fixture.db, actor);
  });
  afterEach(() => fixture.close());
  async function source() {
    return (
      await store.createSource({
        ...input,
        websiteUrl: input.websiteUrl + "/" + crypto.randomUUID(),
        commandId: crypto.randomUUID(),
      })
    ).id;
  }
  async function ready(id: string) {
    let s = await store.source(id);
    await store.verifySource(id, {
      commandId: crypto.randomUUID(),
      expectedVersion: s.version,
      status: "verified",
      officialStatus: "verified_official",
      permissionStatus: "approved",
      note: "隔离测试：人工核对归属及许可",
      evidenceUrls: input.evidenceUrls,
      authorityConfirmed: true,
    });
    s = await store.source(id);
    await store.enableSource(id, {
      commandId: crypto.randomUUID(),
      expectedVersion: s.version,
      enabled: true,
    });
  }
  async function content(id: string) {
    return (
      await store.writeContent(undefined, {
        sourceId: id,
        title: "隔离测试文章",
        body: "未采集的隔离测试夹具 <script>alert(1)</script>",
        url: "https://example.invalid/article",
        kind: "knowledge",
        contentType: "guide",
        rightsScope: "licensed_full_text",
        knowledgeCategory: "campus_life",
        campusScope: "all",
        validUntil: null,
        publishedAt: null,
        extractedFields: {},
        commandId: crypto.randomUUID(),
        expectedVersion: 0,
      })
    ).id;
  }
  it("creates candidates and allows an explicit registry enable without inventing verification", async () => {
    const id = await source(),
      s = await store.source(id);
    expect(s.verificationStatus).toBe("candidate");
    expect(s.enabled).toBe(false);
    expect((await store.sources({})).total).toBe(1);
    await expect(
      store.enableSource(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
        enabled: true,
      }),
    ).resolves.toMatchObject({ version: 2 });
    expect((await store.source(id)).verificationStatus).toBe("candidate");
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) AS n FROM console_commands")
        .get(),
    ).toMatchObject({ n: 2 });
  });
  it("can reject a candidate without inventing evidence, but cannot verify it", async () => {
    const id = await source();
    const value = {
      commandId: crypto.randomUUID(),
      expectedVersion: 1,
      status: "verified",
      officialStatus: "unverified",
      permissionStatus: "unreviewed",
      authorityConfirmed: false,
      evidenceUrls: [],
      note: "没有可核实的公开证据",
    };
    await expect(store.verifySource(id, value)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await store.verifySource(id, {
      ...value,
      commandId: crypto.randomUUID(),
      status: "rejected",
    });
    expect(await store.source(id)).toMatchObject({
      verificationStatus: "rejected",
      enabled: false,
      evidenceUrls: [],
    });
  });
  it("keeps commands idempotent and rejects revision conflict without audit lies", async () => {
    const commandId = crypto.randomUUID(),
      a = await store.createSource({ ...input, commandId });
    expect(await store.createSource({ ...input, commandId })).toMatchObject({
      id: a.id,
      idempotent: true,
    });
    await expect(
      store.createSource({ ...input, displayName: "different", commandId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await store.enableSource(a.id, {
      commandId: crypto.randomUUID(),
      expectedVersion: 1,
      enabled: false,
    });
    await expect(
      store.enableSource(a.id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await store.audit({})).items).toHaveLength(2);
  });
  it("does not promote unofficial/student media through normal edit or verification", async () => {
    const id = (
      await store.createSource({
        ...input,
        sourceType: "student_media",
        commandId: crypto.randomUUID(),
      })
    ).id;
    await expect(
      store.verifySource(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
        status: "verified",
        officialStatus: "verified_official",
        permissionStatus: "approved",
        note: "隔离测试主体",
        authorityConfirmed: false,
        evidenceUrls: input.evidenceUrls,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect((await store.source(id)).officialStatus).toBe("unverified");
  });
  it("withdraws through one authoritative gate and invalidation queue, preserving other sources", async () => {
    const a = await source(),
      b = await source();
    await ready(a);
    await ready(b);
    const id = await content(a);
    let d = await store.document(id);
    await store.review(id, {
      commandId: crypto.randomUUID(),
      expectedVersion: d.version,
      decision: "approved",
      note: "隔离人工审核",
    });
    d = await store.document(id);
    await store.publish(id, {
      commandId: crypto.randomUUID(),
      expectedVersion: d.version,
      note: "隔离批准发布",
    });
    d = await store.document(id);
    expect(
      await filterPublicContent(fixture.db, [{ id, version: d.version }]),
    ).toHaveLength(1);
    const oldVersion = d.version;
    await store.publish(
      id,
      {
        commandId: crypto.randomUUID(),
        expectedVersion: d.version,
        note: "隔离撤回",
      },
      true,
    );
    expect(
      await filterPublicContent(fixture.db, [{ id, version: oldVersion }]),
    ).toEqual([]);
    expect((await store.source(b)).enabled).toBe(true);
    expect(
      fixture.sqlite
        .prepare(
          "SELECT count(*) AS n FROM content_index_invalidations WHERE document_id=?",
        )
        .get(id),
    ).toMatchObject({ n: 3 });
    expect((await store.document(id)).versions).toHaveLength(4);
  });
  it("requires actual event date/place confirmation, does not publish model guesses", async () => {
    const a = await source();
    await ready(a);
    const id = (
      await store.writeContent(undefined, {
        sourceId: a,
        title: "隔离活动",
        body: "隔离夹具",
        url: "https://example.invalid/event",
        kind: "event",
        campusScope: "unknown",
        validUntil: null,
        publishedAt: null,
        extractedFields: {},
        expectedVersion: 0,
        commandId: crypto.randomUUID(),
      })
    ).id;
    let d = await store.document(id);
    await store.review(id, {
      commandId: crypto.randomUUID(),
      expectedVersion: d.version,
      decision: "approved",
      note: "仅审核原文",
    });
    d = await store.document(id);
    await expect(
      store.publish(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: d.version,
        note: "尝试发布",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(
      await filterPublicContent(fixture.db, [{ id, version: d.version }]),
    ).toEqual([]);
  });
  it("denies reviewer writes and revoked administrator races", async () => {
    const id = await source();
    fixture.sqlite
      .prepare(
        "INSERT INTO console_admins(id,email,role) VALUES('reviewer','r@example.invalid','reviewer')",
      )
      .run();
    const reviewer = new ConsoleStore(fixture.db, {
      id: "reviewer",
      email: "r@example.invalid",
      role: "reviewer",
    });
    await expect(
      reviewer.enableSource(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    fixture.sqlite
      .prepare("UPDATE console_admins SET status='revoked' WHERE id=?")
      .run(actor.id);
    await expect(
      store.enableSource(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("archives one source without deleting its provenance or another source", async () => {
    const a = await source(),
      b = await source();
    await store.archiveSource(a, {
      commandId: crypto.randomUUID(),
      expectedVersion: 1,
    });
    await expect(store.source(a)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await store.source(b)).displayName).toBe(input.displayName);
    expect(
      fixture.sqlite
        .prepare("SELECT archived_at FROM knowledge_sources WHERE id=?")
        .get(a),
    ).toMatchObject({ archived_at: expect.any(String) });
  });
  it("has distinct channel labels for same names", () => {
    expect(sourceTypeNames.wechat_service).not.toBe(
      sourceTypeNames.mini_program,
    );
  });
  it("uses real local revocable sessions, no client roles and no raw token in CSRF", async () => {
    const config: ConsoleBindings = {
      db: fixture.db,
      environment: "local",
      mode: "local_key",
      secret: "isolated-test-signing-secret-64-characters-long",
      localKey: "isolated-local-admin-key-more-than-forty-characters",
      emails: ["local@example.invalid"],
      team: "",
      audience: "",
    };
    const req = new Request("http://127.0.0.1:8787/api/console-auth", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:8787" },
    });
    const session = await createConsoleSession(
      req,
      { key: config.localKey },
      config,
    );
    const cookie = session.cookie.split(";")[0];
    expect(session.csrf).not.toContain(".");
    expect(session.csrf).not.toContain(cookie.split("=")[1]);
    expect(session.csrf).toBe(await consoleCsrf(cookie.split("=")[1], config));
    const write = new Request("http://127.0.0.1:8787/api/admin/sources", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:8787",
        Cookie: cookie,
        "X-Console-CSRF": session.csrf,
      },
    });
    expect((await requireConsole(write, true, config)).actor.email).toBe(
      "local@example.invalid",
    );
    await expect(
      requireConsole(
        new Request(write.url, {
          method: "POST",
          headers: { Cookie: cookie, Origin: "https://evil.invalid" },
        }),
        true,
        config,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ctx = await requireConsole(write, true, config);
    await closeConsoleSession(write, ctx);
    await expect(requireConsole(write, false, config)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      createConsoleSession(
        req,
        { key: config.localKey, role: "admin" },
        config,
      ),
    ).rejects.toBeDefined();
  });
});
