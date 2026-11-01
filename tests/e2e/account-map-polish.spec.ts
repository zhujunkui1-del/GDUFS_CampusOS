import { test, expect } from "@playwright/test";

test.use({ trace: "off", video: "off" });

test("auth links have no guest shortcut and are centered at thirds", async ({
  page,
}) => {
  await page.goto("/account/login");
  await expect(page.getByRole("link", { name: "游客浏览" })).toHaveCount(0);
  const links = page.locator(".account-auth-links");
  await expect(links.getByRole("link")).toHaveCount(2);
  const offsets = await links.evaluate((e) => {
    const card = e.closest(".account-card")!.getBoundingClientRect();
    const css = getComputedStyle(e.closest(".account-card")!);
    const left = card.left + parseFloat(css.paddingLeft);
    const width =
      card.width -
      parseFloat(css.paddingLeft) -
      parseFloat(css.paddingRight) -
      2;
    return [...e.querySelectorAll("a")].map((a) => {
      const r = a.getBoundingClientRect();
      return (r.left + r.width / 2 - left) / width;
    });
  });
  expect(offsets[0]).toBeCloseTo(1 / 3, 1);
  expect(offsets[1]).toBeCloseTo(2 / 3, 1);
  await page.getByRole("link", { name: "注册账号", exact: true }).click();
  await expect(page.getByRole("link", { name: "游客浏览" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "去登录", exact: true }),
  ).toBeVisible();
});

test("touching a map label and closing its card never focuses a text field", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Touch focus regression");
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 30000 },
  );
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "查看文采园（一饭）", exact: true })
      .tap();
    await expect(page.locator(".place-details-frame")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "INPUT",
    );
    await page.getByRole("button", { name: "关闭地点详情", exact: true }).tap();
    await expect(page.locator(".place-details-frame")).not.toBeVisible();
    await expect(page.getByLabel("搜索校园地点")).not.toBeFocused();
  }
});

test("map account badge follows the same session avatar as My account", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Mobile account shortcut");
  // UI-only fixture: no real user's credentials, emails or account changes.
  let signedIn = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          available: true,
          mailAvailable: true,
          user: signedIn
            ? {
                id: "ui-avatar-fixture",
                username: "CampusUser",
                email: null,
                createdAt: 0,
              }
            : null,
        },
      },
    }),
  );
  await page.goto("/map");
  await expect(
    page.getByRole("link", { name: "我的账号，当前为游客", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".map-account-avatar")).toHaveCount(0);
  signedIn = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".map-account-avatar")).toHaveText("C");
  await page
    .getByRole("link", { name: "我的账号，CampusUser", exact: true })
    .click();
  await expect(page.locator(".account-monogram")).toHaveText("C");
});
