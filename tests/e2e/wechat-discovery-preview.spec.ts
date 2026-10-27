import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
test.skip(
  process.env.WECHAT_DISCOVERY_LIVE !== "1",
  "Explicit owner source switch acceptance",
);
test.use({ trace: "off" });
test.setTimeout(90000);
test("GW source can be enabled without review and all 80 local publishers are registered", async ({
  page,
}) => {
  const base = "https://campusos-preview.zhujunkui1.workers.dev";
  const auth = JSON.parse(
    await readFile(".map-tools/wechat-auto/auth.json", "utf8"),
  );
  const split = auth.cookie.indexOf("=");
  await page
    .context()
    .addCookies([
      {
        name: auth.cookie.slice(0, split),
        value: auth.cookie.slice(split + 1),
        url: base,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      },
    ]);
  const id = "source-3c191a80-ca79-4fc6-a3bc-be9c3289cdf8";
  try {
    await page.goto(base + "/admin/sources?record=" + id, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "GW情报鹅", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "停运", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "启用", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "启用", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "停运", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("请先核验来源并确认采集许可。", { exact: true }),
    ).toHaveCount(0);
    const sub = await (
      await page.request.get(
        base + "/api/admin/v2/sources?type=wechat_subscription&limit=1",
      )
    ).json();
    const service = await (
      await page.request.get(
        base + "/api/admin/v2/sources?type=wechat_service&limit=1",
      )
    ).json();
    expect(sub.data.total + service.data.total).toBe(80);
    const source = await (
      await page.request.get(base + "/api/admin/v2/sources/" + id)
    ).json();
    expect(source.data.enabled).toBe(true);
    expect(source.data.publishedCount).toBeGreaterThan(0);
    await mkdir("docs/verification/wechat-discovery-2026-10-28", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/wechat-discovery-2026-10-28/gw-enabled.png",
      fullPage: false,
    });
    await writeFile(
      "docs/verification/wechat-discovery-2026-10-28/ui.json",
      JSON.stringify(
        {
          subscriptions: sub.data.total,
          services: service.data.total,
          id,
          enabled: source.data.enabled,
          permissionStatus: source.data.permissionStatus,
          verificationStatus: source.data.verificationStatus,
          publishedCount: source.data.publishedCount,
        },
        null,
        2,
      ),
    );
  } finally {
    const r = await page.request.get(base + "/api/admin/v2/sources/" + id);
    const data = (await r.json()).data;
    if (data && !data.enabled)
      await page.request.post(base + "/api/admin/sources/" + id + "/enabled", {
        headers: { Origin: base, "X-Console-CSRF": auth.csrf },
        data: {
          commandId: crypto.randomUUID(),
          expectedVersion: data.version,
          enabled: true,
        },
      });
  }
});
