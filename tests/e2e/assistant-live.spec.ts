import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { installAgentEvidence } from "./helpers/agent-evidence";
test.afterEach(async ({ page }, info) => {
  if (process.env.E2E_LIVE_AGENT === "1")
    await writeFile(
      info.outputPath("partial-live.json"),
      JSON.stringify(
        await page
          .evaluate(
            () =>
              (window as Window & { __agentEvidence?: unknown[] })
                .__agentEvidence || [],
          )
          .catch(() => []),
        null,
        2,
      ),
    );
});

test("real DeepSeek A-G controls the real campus map through browser receipts", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit live API budget required",
  );
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installAgentEvidence(page);
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  const dir = process.env.E2E_LIVE_CAPTURE_DIR || "test-results/s2-c-live";
  await mkdir(dir, { recursive: true });
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  async function ask(message: string, failure = false) {
    if (!(await page.locator("#campus-assistant").isVisible())) {
      if (await page.locator(".place-details-frame").isVisible())
        await page
          .locator(".place-details-frame")
          .getByRole("button", { name: "问 AI", exact: true })
          .click();
      else await page.getByRole("button", { name: "打开校园助理" }).click();
    }
    const input = page.getByLabel("向校园助理提问");
    await expect(input).toBeEnabled({ timeout: 15000 });
    await input.fill(message);
    await input.press("Enter");
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "true",
    );
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "false",
      {
        timeout: 60000,
      },
    );
    if (!failure) await expect(page.locator(".assistant-error")).toHaveCount(0);
    return page.locator('[data-message-role="assistant"]').last();
  }
  await ask("帮我找到南苑7栋。");
  await expect(page.locator(".place-details-heading")).toContainText("南苑7栋");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-A-found.png` });
  await ask("这栋宿舍附近有什么食堂？");
  await expect(
    page.locator(".assistant-place-card").filter({ hasText: "风采园" }),
  ).toBeVisible();
  await page.screenshot({ path: `${dir}/${name}-C-nearby.png` });
  await ask("从南苑7栋去图书馆。");
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-B-map.png` });
  const markersClear = await page
    .locator(".route-endpoint")
    .evaluateAll((markers) =>
      markers.every((marker) => {
        const rect = marker.getBoundingClientRect();
        return [".map-top", ".assistant-panel", ".mobile-navigation"].every(
          (selector) => {
            const obstacle = document
              .querySelector(selector)
              ?.getBoundingClientRect();
            return (
              !obstacle ||
              obstacle.width === 0 ||
              obstacle.height === 0 ||
              rect.right <= obstacle.left ||
              rect.left >= obstacle.right ||
              rect.bottom <= obstacle.top ||
              rect.top >= obstacle.bottom
            );
          },
        );
      }),
    );
  expect(markersClear).toBe(true);
  if (!(await page.locator("#campus-assistant").isVisible()))
    await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "848 米",
  );
  await expect(
    page.locator(".assistant-route-card").last().locator("strong"),
  ).toHaveText("南苑7栋 → 图书馆");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-B-route.png` });
  await ask("把地图切换成3D。");
  await expect(map).toHaveAttribute("data-mode", "3d");
  await expect(map).toHaveAttribute("data-model-state", "ready");
  await page.screenshot({ path: `${dir}/${name}-D-3d.png` });
  await ask("清除刚刚的路线。");
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await ask("帮我找到南苑999栋。", true);
  await expect(page.locator(".assistant-error")).toContainText(
    /未找到|没有找到/,
  );
  await ask("找到南苑7栋。");
  await ask("那从这里去图书馆呢？");
  if (!(await page.locator("#campus-assistant").isVisible()))
    await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "南苑7栋",
  );
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await page.screenshot({ path: `${dir}/${name}-G-context.png` });
  const records = await page.evaluate(
    () =>
      (window as Window & { __agentEvidence?: unknown[] }).__agentEvidence ||
      [],
  );
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "南苑7栋 → 图书馆",
  );
  await page
    .locator(".assistant-route-card")
    .last()
    .getByRole("button", { name: "显示路线", exact: true })
    .click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-restored-route.png` });
  expect(errors).toEqual([]);
  await writeFile(
    `${dir}/${name}-live.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        realPhone: false,
        realModel: true,
        historyRestoredAfterReload: true,
        routeRestoredOnMapFromAnotherPage: true,
        mapVersion: await map.getAttribute("data-map-version"),
        modelSha: await map.getAttribute("data-model-asset-sha"),
        records,
        pageErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
});
