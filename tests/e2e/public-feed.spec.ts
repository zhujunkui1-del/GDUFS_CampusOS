import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.SOURCE_SYNC_LOCAL_E2E !== "1",
  "Explicit isolated local Worker only",
);
test.use({ trace: "off" });
test.setTimeout(90000);
test("real D1 metadata reaches radar and knowledge, with filtering and immediate withdrawal", async ({
  page,
}, info) => {
  const base = process.env.E2E_BASE_URL!;
  expect(new URL(base).hostname).toBe("127.0.0.1");
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
  const sync = page.getByRole("button", {
      name: "立即检查到期来源",
      exact: true,
    }),
    pause = page.getByRole("button", { name: /^(暂停|恢复)自动同步$/ });
  await expect(sync).toHaveAttribute("type", "button");
  await expect(sync).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(sync).toHaveCSS("background-color", "rgb(18, 97, 187)");
  expect(
    await sync.evaluate((el) => el.previousElementSibling?.textContent),
  ).toMatch(/暂停自动同步|恢复自动同步/);
  if (info.project.name === "desktop") {
    const a = await pause.boundingBox(),
      b = await sync.boundingBox();
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(b!.y).toBe(a!.y);
  }
  const dir =
    process.env.SOURCE_SYNC_EVIDENCE_DIR ||
    "docs/verification/source-sync-2026-10-19/local-browser";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-dashboard.png`,
    fullPage: true,
  });
  const auth = (await (await page.request.get("/api/console-auth")).json())
    .data;
  const request = async (path: string, method = "GET", data?: unknown) => {
    const r = await page.request.fetch(base + "/api/admin/" + path, {
      method,
      data,
      headers: { Origin: base, "X-Console-CSRF": auth.csrf },
    });
    const j = await r.json();
    expect(r.status(), j.error?.message).toBe(200);
    return j.data;
  };
  const prefix = "雷达知识隔离" + randomUUID().slice(0, 8);
  const origin = "https://feed-" + randomUUID().slice(0, 8) + ".invalid/";
  const s = await request("v2/sources", "POST", {
    commandId: randomUUID(),
    displayName: prefix + "来源",
    sourceType: "official_web",
    organization: "仅本地隔离验证",
    websiteUrl: origin,
    wechatId: null,
    campusScope: "all",
    evidenceUrls: [],
    priority: 3,
    connectorType: "disabled",
    fetchPolicy: { mode: "disabled", maxRequests: 0 },
  });
  const cmd = (expectedVersion: number) => ({
    commandId: randomUUID(),
    expectedVersion,
  });
  await request("sources/" + s.id + "/verify", "POST", {
    ...cmd(1),
    status: "verified",
    officialStatus: "verified_official",
    permissionStatus: "approved",
    authorityConfirmed: true,
    evidenceUrls: [origin],
    note: "隔离fixture，不是真实校园来源",
  });
  await request("sources/" + s.id + "/enabled", "POST", {
    ...cmd(2),
    enabled: true,
  });
  await request("sources/" + s.id + "/import-policy", "POST", {
    ...cmd(3),
    rightsScope: "metadata_only",
    evidenceUrls: [origin],
    note: "隔离元数据用途",
    fullTextAuthorized: false,
    validityDays: 1,
  });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await request("content/import", "POST", {
      commandId: randomUUID(),
      sourceId: s.id,
      sourceVersion: 4,
      items: [
        {
          title:
            prefix +
            (i === 0 ? "近期通知" : i === 1 ? "较早通知" : "未批准通知"),
          url: origin + randomUUID(),
          publishedAt: i === 1 ? "2025-11-19" : "2026-10-19",
          contentType: "notice",
          knowledgeCategory: "campus_life",
          radarCategory: "campus_notice",
          campusScope: "all",
          bodyStatus: "not_provided",
        },
      ],
    });
    const id = r.items[0].id;
    ids.push(id);
    if (i < 2) {
      let d = await request("content/" + id);
      await request("content/" + id + "/review", "POST", {
        ...cmd(d.version),
        decision: "approved",
      });
      d = await request("content/" + id);
      await request("content/" + id + "/publish", "POST", cmd(d.version));
    }
  }
  for (const surface of ["radar", "knowledge"]) {
    await page.goto("/" + surface);
    await page.getByLabel("搜索标题", { exact: true }).fill(prefix);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".public-feed-card")).toHaveCount(2);
    await expect(page.locator(".public-feed-card").first()).toContainText(
      "近期通知",
    );
    await expect(page.locator(".public-feed-card").first()).toContainText(
      "原文发布：2026-10-19",
    );
    await expect(
      page.getByText(prefix + "未批准通知", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-${surface}.png`,
      fullPage: true,
    });
  }
  const current = await request("content/" + ids[0]);
  await request(
    "content/" + ids[0] + "/withdraw",
    "POST",
    cmd(current.version),
  );
  await page.getByRole("button", { name: "刷新内容", exact: true }).click();
  await expect(page.locator(".public-feed-card")).toHaveCount(1);
  expect(
    (await page.request.get("/api/public/content?id=" + ids[0])).status(),
  ).toBe(404);
  const remaining = await request("content/" + ids[1]);
  await request(
    "content/" + ids[1] + "/withdraw",
    "POST",
    cmd(remaining.version),
  );
  await page.request.delete(base + "/api/console-auth", {
    headers: { Origin: base, "X-Console-CSRF": auth.csrf },
  });
});
