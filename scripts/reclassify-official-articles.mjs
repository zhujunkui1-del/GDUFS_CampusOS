// Owner's 2026-10-19 correction, limited to the previously published 47 IDs.
// No import, body write, moderation reversal, or withdrawal restoration.
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
const dir = "docs/verification/article-ui-2026-10-19",
  priorDir = "docs/verification/source-sync-2026-10-19";
mkdirSync(dir, { recursive: true });
mkdirSync("test-results", { recursive: true });
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
const prior = JSON.parse(readFileSync(priorDir + "/sync-results.json", "utf8"));
const protectedIds = JSON.parse(
  readFileSync(priorDir + "/withdrawal-repair.json", "utf8"),
).records.map((r) => r.id);
const plan = prior.sources.flatMap((s) =>
  s.records
    .filter((r) => r.published)
    .map((r) => ({
      id: r.id,
      sourceId: s.sourceId,
      title: r.title,
      url: r.url,
      ...classifyArticle(r.title),
    })),
);
if (
  !prior.complete ||
  plan.length !== 47 ||
  new Set(plan.map((r) => r.id)).size !== 47 ||
  plan.some(
    (r) =>
      protectedIds.includes(r.id) ||
      !!r.radarCategory === !!r.knowledgeCategory,
  )
)
  throw Error("INVALID_FROZEN_SCOPE");
writeFileSync(
  dir + "/classification-plan.json",
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      records: plan,
      protectedIds,
      radar: plan.filter((r) => r.radarCategory).length,
      knowledge: plan.filter((r) => r.knowledgeCategory).length,
    },
    null,
    2,
  ) + "\n",
);
if (!process.argv.includes("--apply")) {
  console.log(
    JSON.stringify({
      mode: "plan",
      records: plan.length,
      radar: plan.filter((r) => r.radarCategory).length,
      knowledge: plan.filter((r) => r.knowledgeCategory).length,
    }),
  );
  process.exit(0);
}
const file = dir + "/classification-results.json";
const report = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : {
      startedAt: new Date().toISOString(),
      records: [],
      skipped: [],
      protectedIds,
      complete: false,
    };
if (report.complete) {
  console.log(JSON.stringify({ complete: true, alreadyCompleted: true }));
  process.exit(0);
}
const save = () => writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
const base = "https://campusos-preview.zhujunkui1.workers.dev";
const secrets = JSON.parse(
  readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
);
const key = readFileSync("CampusOS_Codex_完整设计文档_v2/key.md", "utf8")
  .replace(/^\uFEFF/, "")
  .trim();
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext();
let csrf,
  lastCall = 0;
const facts = (d) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          [
            "sourceId",
            "title",
            "url",
            "body",
            "bodyStatus",
            "kind",
            "campusScope",
            "validUntil",
            "publishedAt",
            "sourceUpdatedAt",
            "contentType",
            "rightsScope",
            "publisher",
            "summary",
            "tags",
            "extractedFields",
          ].map((k) => [k, d[k]]),
        ),
      ),
    )
    .digest("hex");
async function api(path, method = "GET", data) {
  await new Promise((r) =>
    setTimeout(r, Math.max(0, 750 - (Date.now() - lastCall))),
  );
  lastCall = Date.now();
  const r = await context.request.fetch(base + "/api/" + path, {
    method,
    data,
    headers: { Origin: base, ...(csrf ? { "X-Console-CSRF": csrf } : {}) },
    timeout: 30000,
  });
  const result = await r.json();
  if (!r.ok() || !result.ok)
    throw Error("API_" + r.status() + "_" + (result.error?.code || "FAILED"));
  return result.data;
}
try {
  const page = await context.newPage();
  await page.goto(base + "/admin");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(
      secrets.CONSOLE_AUTH_MODE === "admin_password"
        ? key
        : secrets.CONSOLE_ADMIN_ACCESS_KEY,
    );
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page
    .getByRole("heading", { name: "内容运营总览", exact: true })
    .waitFor();
  const auth = await api("console-auth");
  if (auth.actor.role !== "admin") throw Error("ADMIN_REQUIRED");
  csrf = auth.csrf;
  for (const r of plan) {
    if (
      report.records.some((d) => d.id === r.id) ||
      report.skipped.some((d) => d.id === r.id)
    )
      continue;
    const before = await api("admin/content/" + r.id);
    if (
      before.sourceId !== r.sourceId ||
      before.url !== r.url ||
      before.title !== r.title ||
      protectedIds.includes(before.id)
    )
      throw Error("IDENTITY_CHANGED");
    if (
      before.publicationStatus !== "published" ||
      before.reviewStatus !== "approved"
    ) {
      report.skipped.push({ id: r.id, reason: "current moderation preserved" });
      save();
      continue;
    }
    const commandId = randomUUID();
    await api("admin/v2/classify/" + r.id, "POST", {
      commandId,
      expectedVersion: before.version,
      radarCategory: r.radarCategory,
      knowledgeCategory: r.knowledgeCategory,
    });
    const after = await api("admin/content/" + r.id);
    if (
      facts(before) !== facts(after) ||
      after.publicationStatus !== "published" ||
      after.radarCategory !== r.radarCategory ||
      after.knowledgeCategory !== r.knowledgeCategory
    )
      throw Error("CLASSIFICATION_INVARIANT_FAILED");
    report.records.push({
      ...r,
      commandId,
      beforeVersion: before.version,
      version: after.version,
      factsHash: facts(after),
      originalFactsUnchanged: true,
    });
    save();
    console.log(
      JSON.stringify({ updated: report.records.length, total: plan.length }),
    );
  }
  for (const id of protectedIds) {
    const d = await api("admin/content/" + id);
    if (d.publicationStatus !== "withdrawn") throw Error("WITHDRAWAL_CHANGED");
    const r = await context.request.get(base + "/api/public/content?id=" + id);
    if (r.status() !== 404) throw Error("PROTECTED_ARTICLE_VISIBLE");
  }
  report.complete = true;
  report.finishedAt = new Date().toISOString();
  save();
} finally {
  if (csrf)
    await context.request.delete(base + "/api/console-auth", {
      headers: { Origin: base, "X-Console-CSRF": csrf },
    });
  await browser.close();
}
