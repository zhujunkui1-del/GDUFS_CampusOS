import { expect, test } from "@playwright/test";

function policy(enabled: boolean) {
  return {
    version: 20,
    enabled,
    order: ["deepseek", "stepfun"],
    tiers: [
      {
        id: "deepseek",
        configured: true,
        enabled: true,
        ready: true,
        model: "deepseek-flash",
        testedAt: "2026-11-01T08:30:09.440Z",
        policyVersion: "deepseek-default-v1",
      },
      {
        id: "stepfun",
        configured: true,
        enabled: true,
        ready: true,
        model: "step-3.5-flash-2603",
        testedAt: "2026-11-01T08:30:05.000Z",
        policyVersion: "stepfun-plan-v1",
      },
      {
        id: "gdufs",
        configured: false,
        enabled: false,
        ready: false,
        code: "MODEL_TEST_REQUIRED",
      },
    ],
    fallback: false,
    updatedAt: "2026-11-20T03:00:00.000Z",
    canManage: true,
    health: { providers: [], failures: [], hours: 24 },
  };
}

test("the platform model master switch saves on the first click", async ({
  page,
}) => {
  let enabled = true;
  const posts: Array<Record<string, unknown>> = [];

  await page.route("**/api/console-auth", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          authenticated: true,
          mode: "local",
          environment: "local",
          csrf: "fixture-csrf",
          actor: {
            id: "fixture-admin",
            email: "3287390083@qq.com",
            role: "admin",
          },
        },
      },
    }),
  );
  await page.route("**/api/admin/v2/platform-models*", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      enabled = body.enabled === true;
      return route.fulfill({ json: { ok: true, data: { version: 21 } } });
    }
    return route.fulfill({ json: { ok: true, data: policy(enabled) } });
  });

  await page.goto("/admin/platform-models");
  const nav = page.getByRole("navigation", { name: "后台导航" });
  const link = nav.getByRole("link", { name: "平台模型" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/admin/platform-models");
  await expect(
    page.getByRole("heading", { name: "平台模型", level: 1 }),
  ).toBeVisible();

  // 总闸是一次点击即保存的开关，不应该依赖下方的「保存顺序与层级」。
  await page.getByRole("button", { name: "停用平台模型" }).click();
  await expect(page.getByText("平台模型已停用。")).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].enabled).toBe(false);
  await expect(
    page.getByRole("button", { name: "启用平台模型" }),
  ).toBeVisible();

  await page
    .locator(".console-sidebar")
    .screenshot({ path: "test-results/console-sidebar.png" });
});
