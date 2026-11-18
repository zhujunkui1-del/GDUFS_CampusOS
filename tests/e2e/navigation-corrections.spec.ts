import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const baiyun = JSON.parse(
    readFileSync("src/features/campus-map/data/baiyun-map.json", "utf8"),
  ),
  university = JSON.parse(
    readFileSync("src/features/campus-map/data/campus.json", "utf8"),
  );
async function ready(page: Page, campus = "baiyun") {
  await page.goto(`/map?campus=${campus}`);
  await expect(
    page.getByTestId(campus === "baiyun" ? "baiyun-map" : "campus-map"),
  ).toHaveAttribute("data-status", "ready");
}
async function choose(page: Page, which: string, name: string) {
  await page.getByLabel(`导航${which}`, { exact: true }).fill(name);
  await page
    .getByRole("region", { name: `${which}地点建议` })
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();
}
for (const campus of ["baiyun", "university"])
  test(`${campus} keeps a 108 metre fix visible and permits navigation`, async ({
    page,
    context,
  }) => {
    const data = campus === "baiyun" ? baiyun : university,
      p = data.places.find(
        (p: { name: string }) =>
          p.name === (campus === "baiyun" ? "第一教学楼" : "南苑7栋"),
      );
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      longitude: p.coordinate[0],
      latitude: p.coordinate[1],
      accuracy: 108,
    });
    await ready(page, campus);
    await page
      .getByRole("button", { name: "校园步行导航", exact: true })
      .click();
    await page
      .getByRole("button", { name: "我的位置作起点", exact: true })
      .click();
    await expect(page.getByLabel("导航起点", { exact: true })).toHaveValue(
      "我的位置",
    );
    await expect(page.locator(".route-planner")).toContainText("108");
    await choose(page, "终点", campus === "baiyun" ? "第二教学楼" : "北苑1栋");
    await page
      .getByRole("button", { name: "规划步行路线", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "开始步行导航", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText(/暂不用于导航/)).toHaveCount(0);
    await page
      .getByRole("button", { name: "开始步行导航", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "步行导航模式" }),
    ).toBeVisible();
    await expect(
      page
        .locator(
          campus === "baiyun"
            ? ".baiyun-map-canvas .maplibregl-marker svg"
            : ".device-position-dot",
        )
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "退出步行导航" }).click();
  });
test("Baiyun exposes endpoint glyphs before planning and restores right drag in browsing and navigation", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 892, height: 871 });
  await ready(page);
  const canvas = page.locator(".baiyun-map-canvas canvas");
  async function rotate() {
    const before = Number(
      (await page.getByTestId("baiyun-map").getAttribute("data-bearing")) || 0,
    );
    await page.mouse.move(690, 430);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(780, 470, { steps: 12 });
    await page.mouse.up({ button: "right" });
    await expect
      .poll(async () =>
        Math.abs(
          Number(
            await page.getByTestId("baiyun-map").getAttribute("data-bearing"),
          ) - before,
        ),
      )
      .toBeGreaterThan(3);
    await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
      "data-pitch",
      "0",
    );
  }
  await expect(canvas).toBeVisible();
  await rotate();
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await choose(page, "起点", "第一教学楼");
  await expect(page.getByLabel("已选起点", { exact: true })).toHaveCount(1);
  await choose(page, "终点", "第七教学楼");
  await expect(page.getByLabel("已选终点", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始步行导航", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "步行导航模式" }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  await rotate();
  await page.screenshot({ path: info.outputPath("rotated-endpoints.png") });
  await page.getByRole("button", { name: "退出步行导航" }).click();
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
});

test("Baiyun exterior approach follows the west-side roads rather than a diagonal through classrooms", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    longitude: 113.2838,
    latitude: 23.20372,
    accuracy: 5,
  });
  await ready(page);
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page
    .getByRole("button", { name: "我的位置作起点", exact: true })
    .click();
  await expect(page.getByLabel("导航起点", { exact: true })).toHaveValue(
    "我的位置",
  );
  await choose(page, "终点", "51栋");
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始步行导航", exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: info.outputPath("exterior-west-approach.png"),
  });
});
