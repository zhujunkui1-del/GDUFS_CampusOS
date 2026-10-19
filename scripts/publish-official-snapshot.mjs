import { build } from "esbuild";
import { mkdirSync } from "node:fs";
mkdirSync(".map-tools/console-v2", { recursive: true });
await build({
  entryPoints: ["src/lib/ingestion/source-admission.ts"],
  outfile: ".map-tools/console-v2/source-admission.mjs",
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  logLevel: "silent",
});
const { planSourceAdmission, assertBatchPublication } =
  await import("../.map-tools/console-v2/source-admission.mjs");
// Explicit owner-authorized one-off run. Uses the existing Console command/audit APIs only.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
const base = "https://campusos-preview.zhujunkui1.workers.dev",
  dir = "docs/verification/source-sync-2026-10-19";
const ids = [
  "GDUFS-SRC-0024",
  "GDUFS-SRC-0012",
  "GDUFS-SRC-0008",
  "GDUFS-SRC-0017",
  "GDUFS-SRC-0010",
];
const snapshots = ids.map((id) =>
  JSON.parse(readFileSync(dir + "/" + id + "-latest.json", "utf8")),
);
if (
  snapshots.some(
    (s) =>
      s.items.length > 10 ||
      s.errors.length ||
      ![200, 404].includes(s.robotsStatus),
  )
)
  throw Error("Verified bounded collection required");
if (!process.argv.includes("--apply")) {
  console.log(
    JSON.stringify({
      target: base,
      scope: snapshots.map((s) => ({
        sourceId: s.sourceId,
        articles: s.items.length,
      })),
      mode: "read-only-plan",
    }),
  );
  process.exit(0);
}
const before = JSON.parse(readFileSync(dir + "/before.json", "utf8"));
const protection = JSON.parse(
  readFileSync(dir + "/withdrawal-repair.json", "utf8"),
).records;
const protectedIds = protection.map((d) => d.id);
const originallyWithdrawn = before.sources.flatMap((s) =>
  s.articles.items
    .filter((d) => d.publication_status === "withdrawn")
    .map((d) => d.id),
);
if (originallyWithdrawn.some((id) => !protectedIds.includes(id)))
  throw Error("INCOMPLETE_WITHDRAWAL_PROTECTION");
const path = dir + "/sync-results.json";
const report = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {
      startedAt: new Date().toISOString(),
      target: base,
      ownerAuthorization:
        "2026-10-19指定五来源，每源最近最多10篇，同步校园雷达和校园知识",
      sources: [],
      failures: [],
      complete: false,
      modelCalls: 0,
      thirdPartyFullTextPersisted: false,
    };
if (report.complete) {
  console.log(
    JSON.stringify({
      complete: true,
      alreadyCompleted: true,
      published: report.published,
    }),
  );
  process.exit(0);
}
const save = () => writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
const values = JSON.parse(
  readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
);
const key =
  values.CONSOLE_AUTH_MODE === "admin_password"
    ? readFileSync("CampusOS_Codex_完整设计文档_v2/key.md", "utf8")
        .replace(/^\uFEFF/, "")
        .trim()
    : values.CONSOLE_ADMIN_ACCESS_KEY;
const scrub = (s) =>
  [
    key,
    ...Object.values(values).filter(
      (v) => typeof v === "string" && v.length > 12,
    ),
  ].reduce((text, v) => text.split(v).join("[REDACTED]"), String(s));
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext();
let auth,
  lastCall = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, method = "GET", body) {
  await pause(Math.max(0, 750 - (Date.now() - lastCall)));
  lastCall = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await context.request.fetch(base + "/api/" + path, {
        method,
        ...(body === undefined ? {} : { data: body }),
        headers: {
          Origin: base,
          ...(auth?.csrf ? { "X-Console-CSRF": auth.csrf } : {}),
        },
        timeout: 30000,
      });
      const j = await r.json();
      if (!r.ok() || !j.ok)
        throw Error("API_" + r.status() + "_" + (j.error?.code || "ERROR"));
      return j.data;
    } catch (e) {
      if (attempt || !/API_5|timeout|ECONNRESET/.test(e.message)) throw e;
      await pause(2000);
    }
  }
}
const cmd = (expectedVersion) => ({ commandId: randomUUID(), expectedVersion });
await build({
  entryPoints: ["src/domain/console/article-classification.ts"],
  outfile: "test-results/article-classification.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { classifyArticle } =
  await import("../test-results/article-classification.mjs");
function classify(item) {
  return classifyArticle(item.title);
}

try {
  const page = await context.newPage();
  await page.goto(base + "/admin");
  await page.getByLabel("管理员访问密钥", { exact: true }).fill(key);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page
    .getByRole("heading", { name: "内容运营总览", exact: true })
    .waitFor();
  auth = await api("console-auth");
  if (auth.actor?.role !== "admin") throw Error("ADMIN_REQUIRED");
  for (const snapshot of snapshots) {
    const id = snapshot.sourceId;
    let section = report.sources.find((s) => s.sourceId === id);
    if (!section) {
      section = {
        sourceId: id,
        name: snapshot.name,
        collected: snapshot.items.length,
        records: [],
        skipped: [],
      };
      report.sources.push(section);
    }
    let source = await api("admin/sources/" + id);
    const evidence = [
      ...new Set([
        ...source.evidenceUrls,
        snapshot.entryUrl,
        new URL(snapshot.entryUrl).origin + "/",
        "https://www.gdufs.edu.cn/xkky/rdjz.htm",
      ]),
    ];
    if (
      source.verificationStatus !== "verified" ||
      source.officialStatus !== "verified_official" ||
      source.permissionStatus !== "approved"
    ) {
      await api("admin/sources/" + id + "/verify", "POST", {
        ...cmd(source.version),
        status: "verified",
        officialStatus: "verified_official",
        permissionStatus: "approved",
        authorityConfirmed: true,
        evidenceUrls: evidence,
        note: "负责人指定官网抓取及公开元数据索引；学校官网机构目录与当前官网栏目相互印证，不授予全文转载许可",
      });
      source = await api("admin/sources/" + id);
    }
    await api("admin/sources/" + id + "/enabled", "POST", {
      ...cmd(source.version),
      enabled: true,
    });
    source = await api("admin/sources/" + id);
    await api("admin/sources/" + id + "/collection-policy", "POST", {
      ...cmd(source.version),
      ruleVersion: snapshot.ruleVersion,
      rightsScope: "metadata_only",
      fullTextAuthorized: false,
      evidenceUrls: [
        snapshot.entryUrl,
        new URL(snapshot.entryUrl).origin + "/robots.txt",
      ],
      note: "负责人2026-10-19指定五官网最近最多10篇，实际robots与页面已检查，本轮仅元数据",
      validityDays: 1,
      robotsStatus: snapshot.robotsStatus,
      robotsHash: snapshot.robotsHash,
    });
    source = await api("admin/sources/" + id);
    await api("admin/sources/" + id + "/import-policy", "POST", {
      ...cmd(source.version),
      rightsScope: "metadata_only",
      evidenceUrls: [snapshot.entryUrl],
      note: "负责人明确要求同步这批公开文章元数据至校园雷达和校园知识；不保存第三方正文",
      fullTextAuthorized: false,
      validityDays: 30,
    });
    source = await api("admin/sources/" + id);
    const old = new Map(
      protection
        .filter((d) => d.sourceId === id)
        .map((a) => [a.url, { ...a, publication_status: "withdrawn" }]),
    );
    const rows = (await api("admin/v2/articles?sourceId=" + id + "&limit=50"))
      .items;
    let live = [];
    for (const row of rows) {
      const detail = await api("admin/content/" + row.id);
      live.push(detail);
    }
    const plan = planSourceAdmission(snapshot.items, live, protectedIds);
    section.records = section.records.filter(
      (r) => !protectedIds.includes(r.id),
    );
    for (const d of plan.skipped)
      if (!section.skipped.some((s) => s.id === d.id))
        section.skipped.push({
          id: d.id,
          url: d.url,
          reason: "保留此前人工撤回或否决状态",
        });
    const pending = [];
    for (const item of snapshot.items) {
      if (plan.skipped.some((d) => d.url === item.url)) continue;
      const previous = old.get(item.url),
        now = live.find((a) => a.url === item.url);
      if (
        previous?.publication_status === "withdrawn" ||
        now?.publicationStatus === "withdrawn" ||
        protectedIds.includes(now?.id)
      ) {
        if (!section.skipped.some((s) => s.url === item.url))
          section.skipped.push({
            id: now?.id || previous.id,
            url: item.url,
            title: item.title,
            reason: "保留此前人工撤回状态",
          });
        continue;
      }
      if (!now && plan.pending.some((p) => p.url === item.url))
        pending.push(item);
      else if (!section.records.some((s) => s.id === now.id))
        section.records.push({
          id: now.id,
          url: item.url,
          title: item.title,
          imported: false,
        });
    }
    for (let i = 0; i < pending.length; i += 2) {
      const chunk = pending.slice(i, i + 2),
        commandId = randomUUID();
      const result = await api("admin/content/import", "POST", {
        commandId,
        sourceId: id,
        sourceVersion: source.version,
        items: chunk.map((item) => ({
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          campusScope: /大学城/.test(item.title)
            ? "university_town"
            : /白云山/.test(item.title)
              ? "baiyun"
              : "unknown",
          contentType: item.contentType,
          ...classify(item),
          bodyStatus: "not_provided",
          originalChecked: true,
          discoveryUrls: [snapshot.entryUrl],
        })),
      });
      result.items.forEach((r, j) => {
        if (!section.records.some((x) => x.id === r.id))
          section.records.push({
            id: r.id,
            url: chunk[j].url,
            title: chunk[j].title,
            imported: r.outcome === "created",
            outcome: r.outcome,
            importCommandId: commandId,
          });
      });
      save();
    }
    for (const record of section.records) {
      assertBatchPublication(
        record.id,
        section.records.map((r) => r.id),
        protectedIds,
      );
      let d = await api("admin/content/" + record.id);
      if (
        d.publicationStatus === "withdrawn" ||
        ["returned", "rejected"].includes(d.reviewStatus)
      ) {
        record.skippedHumanDecision = true;
        record.published = false;
        continue;
      }
      if (d.publicationStatus !== "published") {
        if (d.reviewStatus !== "approved") {
          await api("admin/content/" + record.id + "/review", "POST", {
            ...cmd(d.version),
            decision: "approved",
          });
          d = await api("admin/content/" + record.id);
        }
        if (d.publicationStatus !== "published") {
          await api(
            "admin/content/" + record.id + "/publish",
            "POST",
            cmd(d.version),
          );
          d = await api("admin/content/" + record.id);
        }
      }
      record.published = d.publicationStatus === "published";
      record.version = d.version;
      save();
    }
    section.published = section.records.filter((r) => r.published).length;
    section.finishedAt = new Date().toISOString();
    save();
    console.log(
      JSON.stringify({
        source: section.name,
        collected: section.collected,
        new: section.records.filter((r) => r.imported).length,
        published: section.published,
        keptWithdrawn: section.skipped.length,
      }),
    );
  }
  const expected = report.sources.flatMap((s) =>
    s.records.filter((r) => r.published).map((r) => r.id),
  );
  report.public = {};
  for (const surface of ["radar", "knowledge"]) {
    const items = [];
    let more = true,
      offset = 0;
    while (more && offset <= 200) {
      const r = await api(
        "public/content?surface=" + surface + "&limit=20&offset=" + offset,
      );
      items.push(...r.items);
      more = r.hasMore;
      offset += 20;
    }
    report.public[surface] = {
      total: items.length,
      matched: expected.filter((id) => items.some((i) => i.id === id)).length,
      bodyReturned: items.some((i) => "body" in i),
    };
    if (expected.some((id) => !items.some((i) => i.id === id)))
      throw Error("PUBLIC_FEED_MISSING_" + surface);
  }
  report.collected = report.sources.reduce((n, s) => n + s.collected, 0);
  report.published = expected.length;
  report.keptWithdrawn = report.sources.reduce(
    (n, s) => n + s.skipped.length,
    0,
  );
  report.recoveryEvidence = "withdrawal-repair.json";
  report.complete = true;
  report.finishedAt = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      complete: true,
      collected: report.collected,
      published: report.published,
      keptWithdrawn: report.keptWithdrawn,
      public: report.public,
    }),
  );
} catch (e) {
  report.complete = false;
  report.failures.push({
    at: new Date().toISOString(),
    error: scrub(e.message || e),
  });
  save();
  console.log(
    JSON.stringify({ complete: false, error: scrub(e.message || e) }),
  );
  process.exitCode = 1;
} finally {
  if (auth) await api("console-auth", "DELETE").catch(() => {});
  await context.close();
  await browser.close();
}
