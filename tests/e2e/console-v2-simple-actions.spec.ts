import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.CONSOLE_V2_LOCAL_E2E !== "1",
  "Disposable local Console only",
);
test.use({ trace: "off" });
test("six selections, literal search, compact controls and consistent page typography", async ({
  page,
}) => {
  expect(new URL(process.env.E2E_BASE_URL!).hostname).toBe("127.0.0.1");
  const secrets = JSON.parse(
    readFileSync(".map-tools/s3-a/local-secrets.json", "utf8"),
  );
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
  const prefix = "批量隔离" + randomUUID().slice(0, 8);
  for (let i = 0; i < 6; i++) {
    const result = await page.request.post("/api/admin/v2/sources", {
      headers: {
        Origin: process.env.E2E_BASE_URL!,
        "X-Console-CSRF": auth.csrf,
      },
      data: {
        commandId: randomUUID(),
        displayName: prefix + i,
        sourceType: "official_web",
        organization: "隔离测试",
        websiteUrl: `https://${prefix.slice(4)}-${i}.invalid/`,
        wechatId: null,
        campusScope: "all",
        sourceAliases: ["987654321"],
        evidenceUrls: [],
        priority: 3,
        connectorType: "disabled",
        fetchPolicy: { mode: "disabled", maxRequests: 0 },
      },
    });
    expect(result.status()).toBe(200);
  }
  await page.goto("/admin/whitelist");
  await page.getByText("加入白名单", { exact: true }).first().click();
  const search = page.getByLabel("搜索并选择对象", { exact: true });
  await search.fill("987654321");
  await expect(page.getByText("没有匹配对象", { exact: true })).toBeVisible();
  await expect(page.locator(".console-target-option")).toHaveCount(0);
  await search.fill(prefix);
  await expect(page.locator(".console-target-option")).toHaveCount(6);
  for (const box of await page
    .locator(".console-target-option")
    .getByRole("checkbox")
    .all())
    await box.check();
  await expect(page.getByText("已选 6 项", { exact: true })).toBeVisible();
  const button = page.getByRole("button", { name: "加入白名单", exact: true });
  const addStyle = await button.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
  }));
  expect(addStyle.width).toBeLessThan(180);
  expect(addStyle.height).toBeLessThanOrEqual(44);
  expect(addStyle.color).toBe("rgb(255, 255, 255)");
  expect(addStyle.background).toBe("rgb(18, 97, 187)");
  await button.click();
  await expect(page.getByText("已加入6项", { exact: true })).toBeVisible();
  const rows = page
    .locator(".console-whitelist-row")
    .filter({ hasText: prefix });
  await expect(rows).toHaveCount(6);
  for (const box of await rows.getByRole("checkbox").all()) await box.check();
  await page
    .getByRole("button", { name: "移除所选（6）", exact: true })
    .click();
  await expect(page.getByText("已移除6项", { exact: true })).toBeVisible();
  const typography = [];
  for (const route of [
    "/admin",
    "/admin/sources",
    "/admin/reviews",
    "/admin/retention",
    "/admin/whitelist",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main h1")).toHaveCSS("font-weight", "600");
    const style = await page
      .locator("main h1")
      .evaluate((el) => ({
        weight: getComputedStyle(el).fontWeight,
        family: getComputedStyle(el).fontFamily,
      }));
    expect(style.weight).toBe("600");
    typography.push({ route, ...style });
  }
  expect(new Set(typography.map((s) => s.family)).size).toBe(1);
  mkdirSync("docs/verification/console-v2/e", { recursive: true });
  writeFileSync(
    "docs/verification/console-v2/e/control-measurements.json",
    JSON.stringify(
      {
        localOnly: true,
        selections: 6,
        added: 6,
        removed: 6,
        hiddenAliasMatches: 0,
        addStyle,
        typography,
      },
      null,
      2,
    ),
  );
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
});
