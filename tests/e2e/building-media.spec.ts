import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
const seed = JSON.parse(
  readFileSync("src/features/campus-map/data/building-profiles.json", "utf8"),
);

test.skip(
  process.env.BUILDING_MEDIA_E2E !== "1",
  "Dedicated local media acceptance",
);
test.setTimeout(90000);
test.use({ actionTimeout: 15000 });
const library = "osm-way-307250998";
const photo = "public" + seed[library].photos[0];

test("building photos open in a secondary gallery and feedback accepts private photos", async ({
  page,
}, info) => {
  expect(new URL(process.env.E2E_BASE_URL!).hostname).toMatch(
    /^(127\.0\.0\.1|localhost)$/,
  );
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "查看图书馆", exact: true }).click();
  const details = page.locator(".place-details-panel");
  await expect(details.locator(".building-photo-preview img")).toHaveCount(3);
  await expect(details.locator(".building-info")).toContainText(
    "图书阅览与学习场所",
  );
  expect(
    await details
      .locator(".building-photo-preview img")
      .evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            (node as HTMLImageElement).complete &&
            (node as HTMLImageElement).naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  await details.getByRole("button", { name: /更多图片/ }).click();
  await expect(
    details.getByRole("heading", { name: "更多图片" }),
  ).toBeVisible();
  await expect(details.locator(".building-gallery img")).toHaveCount(
    seed[library].photos.length,
  );
  mkdirSync("docs/verification/building-media", { recursive: true });
  await page.screenshot({
    path: `docs/verification/building-media/${info.project.name}-gallery.png`,
  });
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: "关闭地点详情" }).click();
  await page.getByRole("button", { name: "留言区", exact: true }).click();
  await page
    .getByPlaceholder("写下你的问题、建议或补充的信息源")
    .fill("本地图片上传验收 " + info.project.name);
  await page.locator(".feedback-form input[type=file]").setInputFiles(photo);
  await expect(page.locator(".feedback-files li")).toHaveCount(1);
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/public/feedback") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交留言", exact: true }).click();
  expect((await sent).status()).toBe(200);
  await expect(page.locator(".feedback-form [role=status]")).toHaveText(
    "已提交",
  );
  await expect(page.locator(".feedback-files li")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭留言区" }).click();
  await expect(
    page.getByText("本地图片上传验收 " + info.project.name, { exact: true }),
  ).toHaveCount(0);
});

test("administrator edits building media and downloads feedback attachments", async ({
  page,
  playwright,
}, info) => {
  const base = process.env.E2E_BASE_URL!;
  expect(new URL(base).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const secrets = JSON.parse(
    readFileSync(".map-tools/s3-a/local-secrets.json", "utf8"),
  );
  await page.goto("/admin/buildings");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(secrets.CONSOLE_LOCAL_ACCESS_KEY);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "建筑管理", exact: true }),
  ).toBeVisible();
  const original = (
    await (await page.request.get("/api/public/building?id=" + library)).json()
  ).data;
  const auth = (await (await page.request.get("/api/console-auth")).json())
    .data;
  try {
    await page.getByLabel("建筑", { exact: true }).selectOption(library);
    await expect(page.getByLabel("建筑", { exact: true })).toHaveValue(library);
    await page
      .getByLabel("简介", { exact: true })
      .fill(original.description + "\n本地编辑验收");
    await page.getByRole("button", { name: "下移图片1", exact: true }).click();
    await page
      .locator(".building-editor input[type=file]")
      .setInputFiles(photo);
    await expect(page.locator(".building-editor-photos figure")).toHaveCount(
      original.photos.length + 1,
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".building-editor [role=status]")).toHaveText(
      "已保存",
    );
    const edited = (
      await (
        await page.request.get("/api/public/building?id=" + library)
      ).json()
    ).data;
    expect(edited.description).toContain("本地编辑验收");
    expect(edited.photos[0]).toBe(original.photos[1]);
    expect(
      (await page.request.get(edited.photos.at(-1))).headers()["content-type"],
    ).toBe("image/webp");
    mkdirSync("docs/verification/building-media", { recursive: true });
    await page.screenshot({
      path: `docs/verification/building-media/${info.project.name}-admin.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "反馈", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "反馈", exact: true }),
    ).toBeVisible();
    const attachment = page.locator(".feedback-attachments a").first();
    await expect(attachment).toBeVisible();
    const url = await attachment.getAttribute("href");
    const download = await page.request.get(url!);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment;");
    expect((await download.body()).length).toBeGreaterThan(1000);
    const anonymous = await playwright.request.newContext();
    expect((await anonymous.get(base + url)).status()).toBe(401);
    await anonymous.dispose();
  } finally {
    const restore = await page.request.post(
      "/api/admin/v2/buildings/" + library,
      {
        headers: { Origin: base, "X-Console-CSRF": auth.csrf },
        data: { description: original.description, photos: original.photos },
      },
    );
    expect(restore.status()).toBe(200);
  }
});
