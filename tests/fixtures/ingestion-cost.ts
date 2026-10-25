import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
import { ContentInputSchema } from "@/domain/console/contracts";
import { webProfiles } from "@/lib/ingestion/profiles";
import type { SqlDatabase } from "@/lib/server/assistant/database";
import { contentProvenanceSql } from "@/lib/server/console/ingestion-queries";

export function provenanceQuery(baseline: boolean) {
  const inputHash = (999).toString(16).padStart(64, "0"),
    id = "history-999";
  return baseline
    ? {
        sql: "SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM document_fetches f JOIN console_content_versions v ON v.document_id=f.document_id AND v.version=f.snapshot_version WHERE f.document_id=? AND EXISTS(SELECT 1 FROM console_document_controls dc WHERE dc.document_id=f.document_id AND dc.last_change_origin='source_author') AND f.status IN(200,304) AND v.content_revision=? AND v.input_hash=(SELECT input_hash FROM knowledge_documents WHERE id=f.document_id) AND f.outcome IN('ok','not_modified')) OR EXISTS(SELECT 1 FROM console_content_attestations WHERE document_id=? AND content_revision=? AND input_hash=?)",
        values: [id, 1, id, 1, inputHash],
      }
    : {
        sql: contentProvenanceSql,
        values: [id, 1, inputHash, id, 1, inputHash],
      };
}

const actor = {
  id: "cost-admin",
  email: "cost@example.invalid",
  role: "admin" as const,
};
const command = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});

export async function setupCostSource(db: SqlDatabase) {
  await db
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .bind(actor.id, actor.email)
    .run();
  const store = new ConsoleSyncStore(db, actor),
    profile = webProfiles[0];
  const source = await store.createGovernedSource({
    commandId: crypto.randomUUID(),
    displayName: "Isolated cost fixture",
    sourceType: "official_web",
    organization: "Fixture",
    campusScope: "all",
    websiteUrl: profile.origin,
    wechatId: null,
    evidenceUrls: [],
    priority: 3,
    connectorType: "disabled",
    fetchPolicy: { mode: "disabled", maxRequests: 0 },
    governance: {
      affiliation: "confirmed",
      operating: "active",
      affiliationEvidence: [profile.origin],
      operatingEvidence: [profile.origin],
      note: "Isolated fixture only",
      enabled: true,
      retainHistory: true,
    },
  });
  await db
    .prepare("UPDATE knowledge_sources SET id=? WHERE id=?")
    .bind(profile.sourceId, source.id)
    .run();
  await store.verifySource(profile.sourceId, {
    ...command(1),
    status: "verified",
    officialStatus: "verified_official",
    permissionStatus: "approved",
    authorityConfirmed: true,
    note: "Isolated fixture only",
    evidenceUrls: [profile.origin],
  });
  await store.setPolicy(profile.sourceId, {
    ...command(2),
    ruleVersion: profile.ruleVersion,
    rightsScope: "licensed_full_text",
    fullTextAuthorized: true,
    evidenceUrls: [profile.origin + "/robots.txt"],
    note: "Isolated fixture only",
    robotsStatus: 404,
    robotsHash: null,
    validityDays: 30,
  });
  return profile.sourceId;
}

// Uses the real claim/commit/publication path. The same workflow is bundled
// against HEAD and the working tree for the D1 before/after measurement.
export async function crawlCostFixture(db: SqlDatabase) {
  const store = new ConsoleSyncStore(db, actor),
    profile = webProfiles[0];
  await store.syncNow({
    commandId: crypto.randomUUID(),
    sourceId: profile.sourceId,
  });
  const job = await db
    .prepare("SELECT id FROM ingestion_jobs WHERE phase<>'complete'")
    .first<{ id: string }>();
  if (!job) throw new Error("Fixture task was not registered");
  const url = profile.origin + profile.detailPathPrefixes![0] + "999987.htm";
  async function claim() {
    const row = await store.job(job!.id);
    return store.claim(job!.id, command(Number(row.version)));
  }
  // Include consecutive list pages to measure the eliminated per-page source
  // updates, followed by one new article and automatic publication.
  for (let page = 1; page <= 4; page++) {
    const list = await claim();
    await store.commit(job.id, {
      ...command(list.version),
      leaseToken: list.leaseToken,
      fence: list.fence,
      url: list.url,
      status: 200,
      bytes: 50,
      requests: 1,
      outcome: "ok",
      etag: null,
      lastModified: null,
      bodyHash: null,
      publishedRaw: null,
      discovered: [],
      nextPage: profile.entryUrl.replace(/\.htm$/, "/" + page + ".htm"),
    });
  }
  const list = await claim();
  await store.commit(job.id, {
    ...command(list.version),
    leaseToken: list.leaseToken,
    fence: list.fence,
    url: list.url,
    status: 200,
    bytes: 80,
    requests: 1,
    outcome: "ok",
    etag: null,
    lastModified: null,
    bodyHash: null,
    publishedRaw: null,
    discovered: [url],
    discoveredDates: [{ url, publishedAt: "2026-10-25" }],
  });
  const detail = await claim();
  const payload = {
    ...command(detail.version),
    leaseToken: detail.leaseToken,
    fence: detail.fence,
    url: detail.url,
    status: 200,
    bytes: 200,
    requests: 1,
    outcome: "ok",
    etag: null,
    lastModified: null,
    bodyHash: "a".repeat(64),
    publishedRaw: "2026-10-25",
    bodyTextChars: 24,
    article: ContentInputSchema.parse({
      sourceId: profile.sourceId,
      title: "Isolated newly fetched article",
      url,
      body: "<p>Readable isolated article body.</p>",
      bodyFormat: "reading_html",
      bodyStatus: "complete",
      kind: "knowledge",
      campusScope: "all",
      validUntil: null,
      publishedAt: "2026-10-25",
      sourceUpdatedAt: null,
      contentType: "notice",
      rightsScope: "licensed_full_text",
      radarCategory: null,
      knowledgeCategory: "campus_life",
      publisher: null,
      summary: "Fixture article",
      tags: [],
      extractedFields: {},
    }),
  };
  await store.commit(job.id, payload);
  const published = await db
    .prepare("SELECT count(*) AS n FROM console_public_documents WHERE url=?")
    .bind(url)
    .first<{ n: number }>();
  if (published?.n !== 1) throw new Error("Automatic publication failed");
  return { published: published.n, jobId: job.id, url };
}
