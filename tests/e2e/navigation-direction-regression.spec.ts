import { test, expect } from "@playwright/test";

for (const name of ["又康超市", "伟腾图文", "三饭打印店"])
  test(`service ${name} uses local routing without AMap`, async ({ page }) => {
    const onlineRequests: string[] = [];
    page.on("request", (request) => {
      if (/webapi\.amap\.com|\/_AMapService|\/api\/amap/.test(request.url()))
        onlineRequests.push(request.url());
    });
    await page.goto("/map");
    await expect(page.getByTestId("campus-map")).toHaveAttribute(
      "data-status",
      "ready",
    );
    await page
      .getByRole("button", { name: "校园步行导航", exact: true })
      .click();
    for (const [which, value] of [
      ["起点", "南苑7栋"],
      ["终点", name],
    ]) {
      await page.getByLabel("导航" + which, { exact: true }).fill(value);
      await page
        .getByRole("region", { name: which + "地点建议" })
        .getByRole("button", { name: new RegExp(value) })
        .first()
        .click();
    }
    await page
      .getByRole("button", { name: "规划步行路线", exact: true })
      .click();
    await expect(page.locator(".route-result")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始步行导航", exact: true }),
    ).toBeVisible();
    expect(onlineRequests).toEqual([]);
  });

for (const canvas of [false, true])
  test(`orientation changes actual bearing with GPS denied (${canvas ? "canvas" : "webgl"})`, async ({
    page,
  }) => {
    await page.addInitScript((canvas) => {
      Object.defineProperty(navigator, "geolocation", {
        value: {
          watchPosition: (
            _success: unknown,
            fail: (e: { code: number }) => void,
          ) => {
            setTimeout(() => fail({ code: 1 }), 0);
            return 1;
          },
          clearWatch: () => {},
        },
      });
      if (canvas) {
        const original = HTMLCanvasElement.prototype.getContext;
        Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
          value: function (
            this: HTMLCanvasElement,
            ...args: Parameters<typeof original>
          ) {
            return String(args[0]).startsWith("webgl")
              ? null
              : original.apply(this, args);
          },
        });
      }
    }, canvas);
    await page.goto("/map");
    const map = page.getByTestId("campus-map");
    await expect(map).toHaveAttribute("data-status", "ready");
    await expect(map).toHaveAttribute(
      "data-renderer",
      canvas ? "canvas2d" : "webgl2",
    );
    await page
      .getByRole("button", { name: "校园步行导航", exact: true })
      .click();
    for (const [which, name] of [
      ["起点", "南苑7栋"],
      ["终点", "图书馆"],
    ]) {
      await page.getByLabel("导航" + which, { exact: true }).fill(name);
      await page
        .getByRole("region", { name: which + "地点建议" })
        .getByRole("button", { name: new RegExp(name) })
        .first()
        .click();
    }
    await page
      .getByRole("button", { name: "规划步行路线", exact: true })
      .click();
    await page
      .getByRole("button", { name: "开始步行导航", exact: true })
      .click();
    const heading = await page
      .locator(".navigation-arrow svg")
      .evaluate((el) =>
        Number(
          (el as SVGElement).style.transform.match(
            /rotate\(([-\d.]+)deg\)/,
          )![1],
        ),
      );
    expect(Math.abs(heading)).toBeGreaterThan(1);
    await page
      .getByRole("button", { name: "切换路线方向朝上", exact: true })
      .click();
    await expect
      .poll(async () =>
        Math.abs(
          ((Number(await map.getAttribute("data-bearing")) - heading + 540) %
            360) -
            180,
        ),
      )
      .toBeLessThan(1);
    await page.getByRole("button", { name: "切换朝北", exact: true }).click();
    await expect
      .poll(async () =>
        Math.abs(Number(await map.getAttribute("data-bearing"))),
      )
      .toBeLessThan(1);
  });
