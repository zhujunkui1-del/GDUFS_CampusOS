// D-054: the owner explicitly requested this HQ article be published.
// Default is a no-network plan. --apply publishes only the explicitly requested HQ article.
import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const base = "https://campusos-preview.zhujunkui1.workers.dev";
const targets = [
  {
    id: "content-8de39637-4cd5-4eff-8e3d-97ea4d788dc2",
    sourceId: "GDUFS-SRC-0017",
  },
];
const untouched = "content-2a1a1c4e-0833-4186-afa6-e7696982513b";
if (!process.argv.includes("--apply")) {
  console.log(
    JSON.stringify({
      mode: "no-network-plan",
      base,
      targets,
      operations:
        "single publish/withdraw, batch publish/withdraw/publish; final HQ published; other withdrawals preserved",
    }),
  );
  process.exit(0);
}
const dir = "docs/verification/two-state-2026-10-20";
mkdirSync(dir, { recursive: true });
const secret = JSON.parse(
  readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
);
const credential =
  secret.CONSOLE_AUTH_MODE === "admin_password"
    ? readFileSync("CampusOS_Codex_完整设计文档_v2/key.md", "utf8")
        .replace(/^\uFEFF/, "")
        .trim()
    : secret.CONSOLE_ADMIN_ACCESS_KEY;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
    viewport: { width: 1188, height: 871 },
  }),
  page = await context.newPage();
let auth;
const report = {
  startedAt: new Date().toISOString(),
  ownerAuthorization:
    "2026-10-20 six browser comments; only the explicitly requested HQ article",
  targets,
  steps: [],
  complete: false,
};
const save = () =>
  writeFileSync(
    dir + "/owner-publication.json",
    JSON.stringify(report, null, 2) + "\n",
  );
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
            "publishedAt",
            "sourceUpdatedAt",
            "validUntil",
            "publisher",
            "campusScope",
            "summary",
            "tags",
            "extractedFields",
          ].map((k) => [k, d[k]]),
        ),
      ),
    )
    .digest("hex");
async function api(path) {
  const r = await context.request.get(base + "/api/" + path);
  const b = await r.json();
  if (!r.ok() || !b.ok) throw Error("READ_" + r.status() + "_" + b.error?.code);
  return b.data;
}
async function records() {
  const rows = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const r = await api("admin/v2/articles?limit=50&offset=" + offset);
    rows.push(...r.items);
    if (rows.length >= r.total) break;
  }
  return rows;
}
async function verify(state) {
  const receipts = [];
  for (const target of targets) {
    const d = await api("admin/content/" + target.id);
    expect(d.publicationState).toBe(state);
    expect(facts(d)).toBe(report.before.find((r) => r.id === d.id).factsHash);
    const r = await context.request.get(
      base + "/api/public/content?id=" + d.id,
    );
    expect(r.status()).toBe(state === "published" ? 200 : 404);
    receipts.push({
      id: d.id,
      state: d.publicationState,
      version: d.version,
      publicStatus: r.status(),
      originalFactsUnchanged: true,
    });
  }
  report.steps.push({ at: new Date().toISOString(), receipts });
  save();
}
async function selectTargets() {
  await page.goto(base + "/admin/reviews");
  await expect(page.locator(".console-source-row").first()).toBeVisible();
  const selected = new Set();
  for (let n = 0; n < 10 && selected.size < targets.length; n++) {
    for (const target of targets) {
      const row = page
        .locator(".console-v2-select-row")
        .filter({ has: page.locator(`a[href*="article=${target.id}"]`) });
      if ((await row.count()) && !selected.has(target.id)) {
        await row.locator('input[type="checkbox"]').check();
        selected.add(target.id);
      }
    }
    if (selected.size === targets.length) break;
    const next = page.getByRole("button", { name: "下一页", exact: true });
    if (await next.isDisabled()) break;
    const href = await page
      .locator(".console-source-row")
      .first()
      .getAttribute("href");
    await next.click();
    await expect(
      page.locator(".console-source-row").first(),
    ).not.toHaveAttribute("href", href);
  }
  expect(selected.size).toBe(targets.length);
}
async function batch(action, state) {
  await selectTargets();
  await page.getByRole("button", { name: action, exact: true }).click();
  await expect(
    page.getByText(`已处理${targets.length}篇`, { exact: true }),
  ).toBeVisible();
  await verify(state);
}
try {
  await page.goto(base + "/admin");
  await page.getByLabel("管理员访问密钥", { exact: true }).fill(credential);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible();
  auth = await api("console-auth");
  expect(auth.actor.role).toBe("admin");
  const baseline = await records();
  report.before = [];
  for (const target of targets) {
    const d = await api("admin/content/" + target.id);
    expect(d.sourceId).toBe(target.sourceId);
    expect(d.rightsScope).toBe("metadata_only");
    report.before.push({
      id: d.id,
      sourceId: d.sourceId,
      title: d.title,
      url: d.url,
      version: d.version,
      state: d.publicationState,
      factsHash: facts(d),
    });
  }
  save();
  const first = targets[0];
  await page.goto(
    `${base}/admin/sources?record=${first.sourceId}&article=${first.id}`,
  );
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.locator(".console-badge")).toHaveText(["已发布", "已发布"]);
  expect(
    (
      await context.request.get(base + "/api/public/content?id=" + first.id)
    ).status(),
  ).toBe(200);
  await page.screenshot({
    path: dir + "/single-published.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(page.locator(".console-badge")).toHaveText(["待审核", "待审核"]);
  expect(
    (
      await context.request.get(base + "/api/public/content?id=" + first.id)
    ).status(),
  ).toBe(404);
  await page.screenshot({ path: dir + "/single-pending.png", fullPage: true });
  await batch("批量发布", "published");
  await batch("批量撤回", "pending");
  await batch("批量发布", "published");
  await page.screenshot({ path: dir + "/batch-published.png", fullPage: true });
  const after = await records();
  const others = baseline.filter((r) => !targets.some((t) => t.id === r.id));
  expect(after.length).toBe(baseline.length);
  expect(
    others.every(
      (r) => after.find((d) => d.id === r.id)?.version === r.version,
    ),
  ).toBe(true);
  expect(
    (
      await context.request.get(base + "/api/public/content?id=" + untouched)
    ).status(),
  ).toBe(404);
  report.otherDocumentsUnchanged = others.length;
  report.untouched404 = untouched;
  report.library404 = (
    await context.request.get(
      base +
        "/api/public/content?id=content-76b1fc0b-ace5-4db2-bb5f-b029dd771d78",
    )
  ).status();
  expect(report.library404).toBe(404);
  report.complete = true;
  report.finishedAt = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      published: targets.length,
      otherDocumentsUnchanged: others.length,
      untouched404: true,
      complete: true,
    }),
  );
} finally {
  if (auth)
    await context.request.delete(base + "/api/console-auth", {
      headers: { Origin: base, "X-Console-CSRF": auth.csrf },
    });
  await browser.close();
}
