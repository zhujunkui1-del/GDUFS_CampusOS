// Isolated diagnostics of existing CampusOS behavior, not a new production adapter.
// Synthetic articles and in-memory SQLite only. No network/model/preview D1.
import { describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import {
  extractEvents,
  originalDate,
  OfficialWebConnector,
} from "@/lib/ingestion/connector";
import { EventCandidateSchema } from "@/domain/console/ingestion";
import { IngestionStore } from "@/lib/server/console/ingestion-store";
import { webProfiles } from "@/lib/ingestion/profiles";

function database() {
  const f = sqliteD1();
  for (const id of ["synthetic-source-1", "synthetic-source-2"])
    f.sqlite
      .prepare(
        "INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json) VALUES(?,?,'manual','[]','[]','{}')",
      )
      .run(id, "隔离合成来源");
  for (const [id, source] of [
    ["synthetic-doc-1", "synthetic-source-1"],
    ["synthetic-doc-2", "synthetic-source-2"],
  ])
    f.sqlite
      .prepare(
        "INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain) VALUES(?,?,'隔离合成活动',?,'合成正文',?,'2026-10-17T00:00:00Z','unknown','campus_announcements')",
      )
      .run(id, source, `https://example.invalid/${id}`, id);
  return f;
}

describe("research diagnostics: current pipeline versus S3 frozen semantics", () => {
  it("R01 publication and event time remain independent", () => {
    const published = originalDate("发布时间：2020-03-01");
    const [event] = extractEvents(
      "活动名称：隔离合成讲座\n活动时间：2026年10月20日14:30",
    );
    expect(published).toBe("2020-03-01");
    expect(event.startsAt).toBe("2026-10-20T06:30:00.000Z");
  });
  it("R02 registration deadline is not an event start", () => {
    const [event] = extractEvents(
      "活动名称：隔离合成报名\n报名截止：2026年10月19日12:00",
    );
    expect(event.registrationDeadline).toBe("2026-10-19T04:00:00.000Z");
    expect(event.startsAt).toBeNull();
  });
  it("R03 observed gap: date-only event precision needs a future DTO", () => {
    expect(originalDate("2026年10月20日")).toBe("2026-10-20");
    const [event] = extractEvents(
      "活动名称：隔离合成活动\n活动时间：2026年10月20日\n报名截止：2026年10月19日",
    );
    expect(event.startsAt).toBeNull();
    expect(event.registrationDeadline).toBeNull();
    expect(
      EventCandidateSchema.safeParse({ ...event, startsAt: "2026-10-20" })
        .success,
    ).toBe(false);
    // This records missing date-only fields. It does not approve this gap for S3-C.
  });
  it("R04 unanchored relative time is unknown, never today's event", () => {
    const [event] = extractEvents(
      "活动名称：隔离合成活动\n活动时间：下周五下午两点",
    );
    expect(event.startsAt).toBeNull();
    expect(originalDate("下周五")).toBeNull();
  });
  it("R05 one notice can produce two distinct event candidates", () => {
    const events = extractEvents(
      "活动名称：合成甲\n活动时间：2026年10月20日 14:00\n活动名称：合成乙\n活动时间：2026年10月21日 15:00",
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.title)).toEqual(["合成甲", "合成乙"]);
    expect(new Set(events.map((e) => e.startsAt)).size).toBe(2);
  });
  it("R06 verified event identity can reference two source documents without title merging", () => {
    const f = database();
    try {
      f.sqlite
        .prepare(
          "INSERT INTO campus_events(id,title,campus_scope) VALUES('synthetic-event','隔离合成活动','unknown')",
        )
        .run();
      for (const document of ["synthetic-doc-1", "synthetic-doc-2"])
        f.sqlite
          .prepare(
            "INSERT INTO event_sources(event_id,document_id) VALUES('synthetic-event',?)",
          )
          .run(document);
      expect(
        f.sqlite.prepare("SELECT * FROM event_sources").all(),
      ).toHaveLength(2);
      expect(
        f.sqlite.prepare("SELECT * FROM campus_events").all(),
      ).toHaveLength(1);
      expect(() =>
        f.sqlite
          .prepare(
            "INSERT INTO event_sources(event_id,document_id) VALUES('synthetic-event','synthetic-doc-1')",
          )
          .run(),
      ).toThrow();
      expect(
        f.sqlite.prepare("SELECT * FROM console_public_documents").all(),
      ).toHaveLength(0);
      // Explicit synthetic association, not an implemented automatic semantic merge.
    } finally {
      f.close();
    }
  });
  it("R07 cancellation and postponement remain explicit pending candidate signals", () => {
    const [cancelled] = extractEvents("活动名称：合成活动\n通知：活动取消");
    const [postponed] = extractEvents(
      "活动名称：合成活动\n通知：延期至另行通知",
    );
    expect(cancelled.changeStatus).toBe("cancelled");
    expect(postponed.changeStatus).toBe("postponed");
    expect(postponed.startsAt).toBeNull();
    expect("timeVerified" in postponed).toBe(false);
  });
  it("R08 absent body/date cannot be called complete extraction", () => {
    const profile = webProfiles[0];
    const connector = new OfficialWebConnector(profile);
    const url = profile.origin + "/info/1005/999001.htm";
    expect(() => connector.parse("<title>合成</title>", url)).toThrow(
      "PARSE_ERROR",
    );
    const parsed = connector.parse(
      '<html><head><title>合成</title></head><body><div class="v_news_content"></div></body></html>',
      url,
    );
    expect(parsed.bodyTextChars).toBe(0);
    expect(parsed.publishedAt).toBeNull();
    expect(connector.normalize(parsed, url).rightsScope).toBe("metadata_only");
    // An existing empty container is parseable; completeness needs its own gate.
  });
  it("R09 observed gap: one source+URL origin cannot store all finder observations", () => {
    const f = database();
    try {
      const statement = f.sqlite.prepare(
        "INSERT INTO document_origins(id,source_id,document_id,canonical_url,entry_url,first_seen_at,last_seen_at) VALUES(?,'synthetic-source-1','synthetic-doc-1','https://example.invalid/shared',?,'2026-10-17','2026-10-17')",
      );
      statement.run("synthetic-origin-1", "https://example.invalid/finder-one");
      expect(() =>
        statement.run(
          "synthetic-origin-2",
          "https://example.invalid/finder-two",
        ),
      ).toThrow();
      expect(
        f.sqlite.prepare("SELECT * FROM document_origins").all(),
      ).toHaveLength(1);
      // Future bounded discovery provenance must not create a second article or fake sourceId.
    } finally {
      f.close();
    }
  });
  it("R10 blocked interface pauses the existing job and rejects another claim", async () => {
    const f = sqliteD1();
    const actor = {
      id: "synthetic-ingest-admin",
      email: "synthetic@example.invalid",
      role: "admin" as const,
    };
    const p = webProfiles[1];
    try {
      f.sqlite
        .prepare(
          "INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')",
        )
        .run(actor.id, actor.email);
      f.sqlite
        .prepare(
          "INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,console_managed,channel_type,website_url,enabled,verification_status,official_status,permission_status,authorization_status) VALUES(?,'隔离合成','official_web','[]','[]','{\"mode\":\"manual\",\"maxRequests\":2}',1,'official_web',?,1,'verified','verified_official','approved','approved')",
        )
        .run(p.sourceId, p.origin + "/");
      f.sqlite
        .prepare(
          "INSERT INTO source_collection_policies(source_id,rule_version,rights_scope,evidence_urls_json,note,robots_status,expires_at_ms,approved_by,updated_at) VALUES(?,?,'metadata_only','[]','synthetic offline',404,?,?,?)",
        )
        .run(
          p.sourceId,
          p.ruleVersion,
          Date.now() + 86400000,
          actor.id,
          new Date().toISOString(),
        );
      const store = new IngestionStore(f.db, actor);
      const job = await store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
        maxArticles: 1,
      });
      const lease = await store.claim(job.id, {
        commandId: crypto.randomUUID(),
        expectedVersion: Number(job.version),
      });
      await store.commit(job.id, {
        commandId: crypto.randomUUID(),
        expectedVersion: lease.version,
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        url: lease.url,
        status: 403,
        outcome: "blocked",
        bytes: 0,
        requests: 1,
        etag: null,
        lastModified: null,
        bodyHash: null,
        publishedRaw: null,
      });
      const paused = await store.job(job.id);
      expect(paused).toMatchObject({
        control_state: "paused",
        status: "failed",
        error_code: "BLOCKED",
      });
      await expect(
        store.claim(job.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: Number(paused.version),
        }),
      ).rejects.toThrow();
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
});
