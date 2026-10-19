import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.TWO_STATE_LOCAL_E2E !== "1",
  "Isolated local publication workflow only",
);
test.use({ trace: "off" });
test.setTimeout(90000);
test("single and batch publication expose exactly two states", async ({
  page,
}, info) => {
  const base = process.env.E2E_BASE_URL!;
  expect(new URL(base).hostname).toBe("127.0.0.1");
  const secrets = JSON.parse(
    readFileSync(".map-tools/s3-a/local-secrets.json", "utf8"),
  );
  const dir = process.env.SOURCE_SYNC_EVIDENCE_DIR!;
  mkdirSync(dir, { recursive: true });
  await page.goto("/admin");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(secrets.CONSOLE_LOCAL_ACCESS_KEY);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible();
  const auth = (await (await page.request.get("/api/console-auth")).json())
    .data;
  const api = async (path: string, method = "GET", data?: unknown) => {
    const r = await page.request.fetch(base + "/api/admin/" + path, {
      method,
      data,
      headers: { Origin: base, "X-Console-CSRF": auth.csrf },
    });
    const body = await r.json();
    expect(r.status(), body.error?.message).toBe(200);
    return body.data;
  };
  const prefix = "二状态隔离" + randomUUID().slice(0, 8);
  const origin = "https://two-state-" + randomUUID().slice(0, 8) + ".invalid/";
  const s = await api("v2/sources", "POST", {
    commandId: randomUUID(),
    displayName: prefix,
    sourceType: "official_web",
    organization: "本地隔离验证",
    websiteUrl: origin,
    wechatId: null,
    campusScope: "all",
    evidenceUrls: [],
    priority: 3,
    connectorType: "disabled",
    fetchPolicy: { mode: "disabled", maxRequests: 0 },
    governance: {
      affiliation: "confirmed",
      operating: "active",
      affiliationEvidence: [origin],
      operatingEvidence: [origin],
      note: "仅本地隔离测试",
      enabled: true,
      retainHistory: true,
    },
  });
  const source = await api("sources/" + s.id);
  const batch = await api("content/import", "POST", {
    commandId: randomUUID(),
    sourceId: s.id,
    sourceVersion: source.version,
    items: [0, 1].map((n) => ({
      title: prefix + n,
      url: origin + randomUUID(),
      publishedAt: "2026-10-19",
      contentType: "notice",
      bodyStatus: "not_provided",
      campusScope: "all",
    })),
  });
  const ids: string[] = batch.items.map((r: { id: string }) => r.id);
  const publicStatus = async (id: string, status: number) =>
    expect(
      (await page.request.get("/api/public/content?id=" + id)).status(),
    ).toBe(status);
  await page.goto(`/admin/sources?record=${s.id}&article=${ids[0]}`);
  await expect(page.locator(".console-badge")).toHaveText(["待审核", "待审核"]);
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.locator(".console-badge")).toHaveText(["已发布", "已发布"]);
  await publicStatus(ids[0], 200);
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(page.locator(".console-badge")).toHaveText(["待审核", "待审核"]);
  await publicStatus(ids[0], 404);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-pending.png`,
    fullPage: true,
  });
  await page.goto("/admin/reviews");
  await page.getByText("筛选与排序", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "状态", exact: true }).locator("option"),
  ).toHaveText(["全部", "已发布", "待审核"]);
  await page
    .getByRole("textbox", { name: "搜索文章", exact: true })
    .fill(prefix);
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator(".console-v2-select-row")).toHaveCount(2);
  for (const label of ["批量退回", "批量拒绝", "批量批准"])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  async function runBatch(label: string, expected: string, status: number) {
    for (const row of await page.locator(".console-v2-select-row").all())
      await row.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(".console-source-row > span")).toHaveText([
      expected,
      expected,
    ]);
    for (const id of ids) await publicStatus(id, status);
  }
  await runBatch("批量发布", "已发布", 200);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-published.png`,
    fullPage: true,
  });
  await runBatch("批量撤回", "待审核", 404);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
});
