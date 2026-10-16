import { test, expect } from "@playwright/test";
import { selectMapMode } from "./helpers/map-mode";
import { mkdir } from "node:fs/promises";

test.skip(
  process.env.CONSOLE_CLOUD_E2E !== "1",
  "Explicit isolated preview only; no local/cloud substitution",
);
test("real HTTPS preview keeps management closed and the public map independent", async ({
  page,
  request,
}, info) => {
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  for (const path of [
    "overview",
    "sources",
    "content",
    "jobs",
    "audit",
    "admins",
  ]) {
    const response = await request.get("/api/admin/" + path, {
      headers: { "X-User-Role": "admin", "X-User-Id": "forged" },
    });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.data).toBeUndefined();
  }
  const forged = await request.post("/api/admin/sources", {
    data: {
      userId: "admin",
      role: "admin",
      displayName: "MUST_NOT_BE_INSERTED",
    },
  });
  expect(forged.status()).toBe(503);
  const dir = "docs/verification/s3-a";
  await mkdir(dir, { recursive: true });
  const prefix = `${dir}/preview-${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
  await page.goto("/admin");
  await expect(
    page.getByText("管理员登录尚未配置。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "保存信息源" })).toHaveCount(0);
  await page.screenshot({ path: prefix + "-closed.png", fullPage: true });
  for (const section of ["sources", "jobs", "reviews", "content", "audit"]) {
    await page.goto(`/admin/${section}?record=not-authorized`);
    await expect(
      page.getByText("管理员登录尚未配置。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".console-source-row,.console-audit-row"),
    ).toHaveCount(0);
  }
  await page.getByRole("link", { name: "返回校园" }).click();
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  await selectMapMode(page, "2D");
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await selectMapMode(page, "2.5D");
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-detailed", "visible", {
    timeout: 30000,
  });
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: prefix + "-map.png" });
  await selectMapMode(page, "2D");
});
