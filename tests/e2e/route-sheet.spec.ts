import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

for (const destination of ["图书馆", "体育馆"])
  test(`mobile walking panel drags between retained states with route to ${destination}`, async ({
    page,
    context,
    isMobile,
  }, info) => {
    await page.goto("/map");
    const map = page.getByTestId("campus-map");
    await expect(map).toHaveAttribute("data-status", "ready");
    await page
      .getByRole("button", { name: "校园步行导航", exact: true })
      .click();
    const panel = page.locator(".route-planner");
    if (!isMobile) {
      await expect(panel).toHaveAttribute("data-sheet", "desktop");
      await expect(
        page.getByRole("button", { name: "调整步行导航面板" }),
      ).toBeHidden();
      return;
    }
    for (const [which, name] of [
      ["起点", "南苑7栋"],
      ["终点", destination],
    ]) {
      await page.getByLabel("导航" + which).fill(name);
      await page
        .getByRole("region", { name: which + "地点建议" })
        .getByRole("button", { name: new RegExp(name) })
        .first()
        .click();
    }
    await page
      .getByRole("button", { name: "规划步行路线", exact: true })
      .click();
    await expect(map).toHaveAttribute("data-route-extent", /.+/);
    await expect(map).toHaveAttribute("data-camera-moving", "false");
    const dir = process.env.E2E_CAPTURE_DIR || "test-results/s2-d";
    const prefix = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-${destination === "图书馆" ? "library" : "gym"}`;
    await mkdir(dir, { recursive: true });
    const handle = page.getByRole("button", { name: "调整步行导航面板" });
    const samples: unknown[] = [];
    const touch = await context.newCDPSession(page);
    const capture = async () => {
      const sample = await page.evaluate(() => {
        const panel = document
          .querySelector(".route-planner")!
          .getBoundingClientRect();
        const top = document.querySelector(".map-top")!.getBoundingClientRect();
        const extent = JSON.parse(
          document.querySelector<HTMLElement>('[data-testid="campus-map"]')!
            .dataset.routeExtent!,
        );
        return {
          viewport: [innerWidth, innerHeight],
          visualViewport: [
            visualViewport?.height,
            visualViewport?.offsetTop,
            visualViewport?.scale,
          ],
          scrollY,
          style: document
            .querySelector<HTMLElement>(".route-planner")!
            .getAttribute("style"),
          panelTop: panel.top,
          panelHeight: panel.height,
          topBottom: top.bottom,
          extent,
        };
      });
      samples.push(sample);
      return sample;
    };
    async function drag(direction: "down" | "up") {
      const box = (await handle.boundingBox())!;
      const y = box.y + box.height / 2;
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: box.x + box.width / 2, y }],
      });
      for (let i = 1; i <= 8; i++) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: box.x + box.width / 2,
              y:
                direction === "down"
                  ? Math.min(810, y + (420 * i) / 8)
                  : y - (420 * i) / 8,
            },
          ],
        });
        await page.waitForTimeout(50);
        const sample = await capture();
        expect(sample.extent[3]).toBeLessThan(sample.panelTop);
        expect(sample.extent[1]).toBeGreaterThan(sample.topBottom);
      }
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(panel).toHaveAttribute(
        "data-sheet",
        direction === "down" ? "collapsed" : "expanded",
      );
      await expect(map).toHaveAttribute("data-camera-moving", "false");
      await page.waitForTimeout(400);
      const sample = await capture();
      await writeFile(
        `${dir}/${prefix}-route-sheet-partial.json`,
        JSON.stringify(samples, null, 2),
      );
      expect(sample.extent[3]).toBeLessThan(sample.panelTop);
      expect(sample.extent[1]).toBeGreaterThan(sample.topBottom);
    }
    await drag("down");
    await expect(
      page.getByRole("button", { name: "关闭导航面板" }),
    ).toBeVisible();
    await expect(page.getByLabel("导航起点")).toBeHidden();
    await page
      .getByRole("button", { name: "校园步行导航", exact: true })
      .click();
    await expect(panel).toBeVisible();
    await page.screenshot({ path: `${dir}/${prefix}-route-collapsed.png` });
    await drag("up");
    await expect(page.getByLabel("导航起点")).toHaveValue("南苑7栋");
    await page.screenshot({ path: `${dir}/${prefix}-route-expanded.png` });
    await handle.click();
    await expect(panel).toHaveAttribute("data-sheet", "collapsed");
    await handle.click();
    await expect(panel).toHaveAttribute("data-sheet", "expanded");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(panel).toHaveAttribute("data-sheet", "expanded");
    await handle.press("End");
    await expect(panel).toHaveAttribute("data-sheet", "collapsed");
    await handle.press("Home");
    await expect(panel).toHaveAttribute("data-sheet", "expanded");
    await page.getByRole("button", { name: "关闭导航面板" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".route-endpoint")).toHaveCount(0);
    await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
    await writeFile(
      `${dir}/${prefix}-route-sheet.json`,
      JSON.stringify(
        { actualPhone: false, pointerDrag: "CDP touch simulation", samples },
        null,
        2,
      ),
    );
  });

test("Beigang gate keeps its stable ID, old aliases and confirmed coordinates", async ({
  page,
}) => {
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByLabel("搜索校园地点").fill("贝岗门");
  const result = page
    .locator(".place-result")
    .filter({ hasText: "4号门（贝岗门）" });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator(".place-details-heading")).toContainText(
    "4号门（贝岗门）",
  );
});
