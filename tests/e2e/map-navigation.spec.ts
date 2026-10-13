import { test, expect } from "@playwright/test";
import { mockAMap } from "./map-fixture";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const review = JSON.parse(
  await readFile("src/features/campus-map/data/walkway-review.json", "utf8"),
);

test("typed endpoints, swapping, GPS denial and cleared exit", async ({
  page,
}) => {
  // Isolated supplier + geolocation fixture. No actual device location or quota used.
  await mockAMap(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (
          _success: unknown,
          failure: (e: { code: number }) => void,
        ) => failure({ code: 1 }),
        watchPosition: (
          _success: unknown,
          failure: (e: { code: number }) => void,
        ) => {
          setTimeout(() => failure({ code: 1 }), 0);
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(page.getByLabel("校园视角")).toHaveCount(0);
  await page.getByRole("button", { name: "定位我的位置", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("定位权限未获允许");
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page.getByLabel("导航起点").fill("教学楼E栋");
  await page
    .getByRole("region", { name: "起点地点建议" })
    .getByRole("button", { name: /教学楼E栋/ })
    .first()
    .click();
  await page.getByLabel("导航终点").fill("教学楼F栋");
  await page
    .getByRole("region", { name: "终点地点建议" })
    .getByRole("button", { name: /教学楼F栋/ })
    .first()
    .click();
  await page.getByRole("button", { name: "交换", exact: true }).click();
  await expect(page.getByLabel("导航起点")).toHaveValue("教学楼F栋");
  await expect(page.getByLabel("导航终点")).toHaveValue("教学楼E栋");
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(page.locator(".navigation-location-status")).toContainText(
    "定位权限未获允许",
  );
  await expect(
    page.getByRole("region", { name: "步行导航模式" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出步行导航" }).click();
  await expect(page.locator(".route-result")).toHaveCount(0);
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await page.getByLabel("导航起点").fill("不存在的地点");
  await expect(
    page.getByRole("button", { name: "规划步行路线", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".route-result")).toHaveCount(0);
});

test("controlled browser geolocation is opt-in and rejects an outside-campus position", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    longitude: 113.39131405,
    latitude: 23.0680465,
    accuracy: 15,
  });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(page.locator(".map-location-notice")).toHaveCount(0);
  await page.getByRole("button", { name: "定位我的位置", exact: true }).click();
  await expect(page.locator(".map-location-notice")).toContainText(
    "定位精度约15米",
  );
  await context.setGeolocation({
    longitude: 113.29,
    latitude: 23.2,
    accuracy: 10,
  });
  await page.getByRole("button", { name: "定位我的位置", exact: true }).click();
  await expect(page.locator(".map-location-notice")).toContainText("校外");
  expect(
    await page.evaluate(() => Object.values(localStorage).join(" ")),
  ).not.toMatch(/113\.391314|23\.068046/);
});

test("tunnel uses the real source corridor only after owner confirmation", async ({
  page,
}, testInfo) => {
  let onlineRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("amap.com")) onlineRequests++;
  });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  for (const [which, name] of [
    ["起点", "下沉隧道生活区入口"],
    ["终点", "下沉隧道教学区入口"],
  ] as const) {
    await page.getByLabel("导航" + which).fill(name);
    await page
      .getByRole("region", { name: which + "地点建议" })
      .getByRole("button", { name: new RegExp(name) })
      .click();
  }
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  if (review.approved) {
    await expect(page.locator(".route-result")).toHaveAttribute(
      "data-route-source",
      "CampusOS.OSM",
    );
    await expect(page.locator(".route-result")).toContainText("穿过下沉隧道");
    const dir = process.env.E2E_CAPTURE_DIR
      ? process.env.E2E_CAPTURE_DIR + "/tunnel-confirmed"
      : "docs/screenshots/s1/tunnel-confirmed";
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${testInfo.project.name}-tunnel-route.jpg`,
      type: "jpeg",
    });
    await writeFile(
      `${dir}/${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${testInfo.project.name}-result.json`,
      JSON.stringify(
        {
          source: "actual local OSM network / owner approved",
          fixtures: false,
          summary: await page.locator(".route-result").innerText(),
          providerRequests: onlineRequests,
        },
        null,
        2,
      ) + "\n",
    );
  } else
    await expect(page.locator(".route-planner .inline-error")).toContainText(
      "通行尚待负责人确认",
    );
  expect(onlineRequests).toBe(0);
});
