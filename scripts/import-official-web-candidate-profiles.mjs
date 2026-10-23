import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { parse } from "comment-json";
import { previewConsoleCredential } from "../tests/e2e/helpers/console-credential.ts";
import { assertPreviewTarget } from "./preview-config.mjs";

const previewUrl = "https://campusos-preview.zhujunkui1.workers.dev",
  apply = process.argv.includes("--apply"),
  manifestPath =
    "docs/verification/official-web-collection-preview/candidate-profiles.json",
  secretsPath = ".map-tools/s3-a/preview-secrets.json",
  config = parse(readFileSync("wrangler.jsonc", "utf8"));
assertPreviewTarget(config, process.env.CLOUDFLARE_ACCOUNT_ID);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")),
  credentialConfig = JSON.parse(readFileSync(secretsPath, "utf8"));
if (manifest.sourceCount !== 109 || manifest.profileCount < 1)
  throw new Error("候选入口清单的来源数量或配置数量异常。");

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(previewUrl + "/admin");
  const authResponse = await page.request.get(previewUrl + "/api/console-auth"),
    authEnvelope = await authResponse.json();
  let auth = authEnvelope.data;
  if (!auth?.authenticated) {
    const credential = previewConsoleCredential(credentialConfig);
    await page.getByLabel("管理员访问密钥", { exact: true }).fill(credential);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "官网采集", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const nextAuth = await page.request.get(previewUrl + "/api/console-auth");
    auth = (await nextAuth.json()).data;
  }
  if (
    auth?.authenticated !== true ||
    auth?.environment !== "preview" ||
    auth?.actor?.role !== "admin"
  )
    throw new Error("预览后台管理员会话校验失败。");

  const listResponse = await page.request.get(
      previewUrl + "/api/admin/v2/web-collection?limit=2000&offset=0",
    ),
    listEnvelope = await listResponse.json();
  if (!listResponse.ok() || !listEnvelope.ok)
    throw new Error("无法读取Preview官网来源清单。");
  const pageData = listEnvelope.data;
  if (pageData.total !== 109 || pageData.items.length !== 109)
    throw new Error(
      `Preview官网来源数量不匹配：预期109，实际${pageData.total}。`,
    );
  const currentById = new Map(pageData.items.map((item) => [item.id, item])),
    operations = [],
    skipped = [];

  for (const candidate of manifest.profiles) {
    const current = currentById.get(candidate.sourceId);
    if (!current) {
      skipped.push({
        sourceId: candidate.sourceId,
        reason: "preview_source_missing",
      });
      continue;
    }
    if (
      !current.websiteUrl ||
      new URL(current.websiteUrl).origin !==
        new URL(candidate.websiteUrl).origin
    ) {
      skipped.push({
        sourceId: candidate.sourceId,
        reason: "homepage_origin_mismatch",
      });
      continue;
    }
    if (current.policyReady) {
      skipped.push({
        sourceId: candidate.sourceId,
        reason: "preserved_current_policy",
      });
      continue;
    }
    const oldEntryUrls = current.entryUrls || [],
      oldPrefixes = current.articlePathPrefixes || [],
      entryUrls = [...new Set([...oldEntryUrls, ...candidate.entryUrls])],
      articlePathPrefixes = [
        ...new Set([...oldPrefixes, ...candidate.articlePathPrefixes]),
      ],
      oldProfile = current.profile || {};
    if (entryUrls.length > 50 || articlePathPrefixes.length > 50)
      throw new Error(`${candidate.sourceId} 超出Profile单源路径上限。`);
    if (
      oldEntryUrls.length === entryUrls.length &&
      oldEntryUrls.every((url) => entryUrls.includes(url)) &&
      oldPrefixes.length === articlePathPrefixes.length &&
      oldPrefixes.every((prefix) => articlePathPrefixes.includes(prefix))
    ) {
      skipped.push({
        sourceId: candidate.sourceId,
        reason: "already_imported",
        entryCount: oldEntryUrls.length,
        pathPrefixCount: oldPrefixes.length,
        configurationStatus: oldProfile.configurationStatus || "verified",
        policyReady: current.policyReady,
      });
      continue;
    }
    operations.push({
      id: current.id,
      displayName: current.displayName,
      expectedVersion: current.version,
      entryUrls,
      articlePathPrefixes,
      titleSelector: oldProfile.titleSelector || "h1, title",
      titleSuffix: oldProfile.titleSuffix || "",
      dateSelector: oldProfile.dateSelector || "time, .date, .time",
      dateLabel: oldProfile.dateLabel || "发布时间",
      bodySelector: oldProfile.bodySelector || "article, main",
      allowQueryUrls:
        oldProfile.allowQueryUrls === true || candidate.allowQueryUrls,
      requestIntervalMs: oldProfile.requestIntervalMs ?? 1000,
    });
  }

  const plan = {
    mode: apply ? "apply" : "dry-run",
    target: previewUrl,
    previewSourceCount: pageData.total,
    profileConfiguredCount: pageData.items.filter(
      (item) => item.profileConfigured,
    ).length,
    candidateProfileCount: pageData.items.filter(
      (item) => item.profile?.configurationStatus === "discovered",
    ).length,
    unconfiguredCount: pageData.items.filter((item) => !item.profileConfigured)
      .length,
    policyReadyCount: pageData.items.filter((item) => item.policyReady).length,
    discoveredProfileCount: manifest.profileCount,
    operations: operations.map((operation) => ({
      id: operation.id,
      displayName: operation.displayName,
      entryCount: operation.entryUrls.length,
      pathPrefixCount: operation.articlePathPrefixes.length,
      configurationStatus: "discovered",
      permissionWillRequireReview: true,
    })),
    skipped,
  };
  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const applied = [],
      failed = [];
    for (const operation of operations) {
      const response = await page.request.post(
        `${previewUrl}/api/admin/v2/web-collection/${encodeURIComponent(operation.id)}/profile`,
        {
          headers: {
            Origin: previewUrl,
            "X-Console-CSRF": auth.csrf,
          },
          data: {
            commandId: crypto.randomUUID(),
            expectedVersion: operation.expectedVersion,
            configurationStatus: "discovered",
            entryUrls: operation.entryUrls,
            articlePathPrefixes: operation.articlePathPrefixes,
            titleSelector: operation.titleSelector,
            titleSuffix: operation.titleSuffix,
            dateSelector: operation.dateSelector,
            dateLabel: operation.dateLabel,
            bodySelector: operation.bodySelector,
            allowQueryUrls: operation.allowQueryUrls,
            requestIntervalMs: operation.requestIntervalMs,
          },
        },
      );
      const envelope = await response.json();
      if (!response.ok() || !envelope.ok) {
        failed.push({
          id: operation.id,
          reason: envelope.error?.message || `HTTP ${response.status()}`,
        });
        continue;
      }
      applied.push({
        id: operation.id,
        displayName: operation.displayName,
        entryCount: operation.entryUrls.length,
        pathPrefixCount: operation.articlePathPrefixes.length,
        configurationStatus: "discovered",
      });
    }
    const report = {
      ...plan,
      mode: "applied",
      appliedCount: applied.length,
      failedCount: failed.length,
      applied,
      failed,
    };
    mkdirSync("docs/verification/official-web-collection-preview", {
      recursive: true,
    });
    writeFileSync(
      "docs/verification/official-web-collection-preview/import-result.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        target: previewUrl,
        appliedCount: applied.length,
        failedCount: failed.length,
        skippedCount: skipped.length,
      }),
    );
    if (failed.length) process.exitCode = 1;
  }
} finally {
  await browser.close();
}
