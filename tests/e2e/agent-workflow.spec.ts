import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.skip(
  process.env.AGENT_WORKFLOW_E2E !== "1",
  "Isolated workflow interface fixtures",
);
test("runs the stream, distinguishes unused nodes, inspects results, and exports its own trace", async ({
  page,
}, info) => {
  expect(new URL(process.env.E2E_BASE_URL!).hostname).toMatch(
    /^(127\.0\.0\.1|localhost)$/,
  );
  const errors: string[] = [];
  const requests: { conversationId?: string }[] = [];
  const conversationId = crypto.randomUUID();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/agent/status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          chatAvailable: true,
          model: { model: { model: "fixture-runtime" } },
        },
      },
    }),
  );
  await page.route("**/api/agent/chat", async (route) => {
    expect(route.request().headers()["x-campusos-workflow"]).toBe("1");
    expect(route.request().headers()["x-console-csrf"]).toBe("fixture-csrf");
    requests.push(route.request().postDataJSON());
    const id = crypto.randomUUID();
    let n = 0;
    const frames: { type: string; payload: unknown }[] = [
      { type: "artifact.ready", payload: { started: true, conversationId } },
    ];
    for (const node of [
      "input",
      "gate",
      "route",
      "building",
      "events",
      "model",
      "expression",
      "output",
    ]) {
      for (const state of ["running", "success"]) {
        frames.push({
          type: "artifact.ready",
          payload: {
            workflow: {
              node,
              span: node + ":1",
              state,
              at: new Date().toISOString(),
              elapsedMs: n++ * 10,
              durationMs: state === "success" ? 10 : undefined,
              data:
                node === "building"
                  ? { description: "本地隔离建筑资料结果" }
                  : { status: state },
            },
          },
        });
      }
    }
    frames.push(
      ...["running", "error"].map((state) => ({
        type: "artifact.ready",
        payload: {
          workflow: {
            node: "model",
            span: "model:judge",
            phase: "evidence_check",
            state,
            at: new Date().toISOString(),
            elapsedMs: state === "error" ? 12000 : 0,
            durationMs: state === "error" ? 12000 : undefined,
            data: state === "error" ? { status: "超时" } : {},
          },
        },
      })),
      {
        type: "artifact.ready",
        payload: {
          cards: [
            {
              kind: "source",
              documentId: "fixture-activity",
              title: "隔离规则来源",
              sourceName: "隔离官网",
              originalUrl: "https://example.invalid/rules",
              publishedAt: null,
              snippet: "",
              evidenceType: "metadata",
              classificationState: "radar",
              validity: "unknown",
              readable: true,
              calendarLinks: [
                {
                  title: "隔离活动",
                  href:
                    "/calendar?date=2026-11-11&event=event-" + "a".repeat(40),
                },
              ],
            },
          ],
        },
      },
      {
        type: "message.delta",
        payload: { text: "隔离验收回答：图书馆有五层。" },
      },
      {
        type: "run.completed",
        payload: {
          metrics: {
            model: "fixture-runtime",
            requests: 1,
            totalTokens: 42,
            answerMode: "building_profile",
          },
        },
      },
    );
    const body = frames
      .map(
        (event, index) =>
          "data: " +
          JSON.stringify({
            runId: id,
            eventId: id + ":" + index,
            timestamp: new Date().toISOString(),
            ...event,
          }) +
          "\n\n",
      )
      .join("");
    await route.fulfill({ contentType: "text/event-stream", body });
  });
  let signedIn = false;
  await page.route("**/api/console-auth", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: signedIn
          ? {
              authenticated: true,
              mode: "key",
              csrf: "fixture-csrf",
              actor: {
                id: "fixture-console",
                email: "admin@example.invalid",
                role: "admin",
              },
            }
          : { authenticated: false, mode: "key" },
      },
    }),
  );
  await page.goto("/agent");
  await expect(page).toHaveURL(/\/admin\/agent$/);
  await expect(page.getByLabel("管理员访问密钥")).toBeVisible();
  await expect(page.locator(".agent-studio")).toHaveCount(0);
  signedIn = true;
  await page.goto("/admin");
  await page.getByRole("link", { name: "Agent工作流", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/agent$/);
  await expect(
    page.getByRole("heading", { name: "Agent 工作流", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".studio-runtime")).toContainText(
    "fixture-runtime",
  );
  const layoutDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出布局", exact: true }).click();
  const layoutFile = await layoutDownload;
  expect(layoutFile.suggestedFilename()).toBe("campusos-agent-layout.json");
  const layout = JSON.parse(readFileSync(await layoutFile.path(), "utf8"));
  expect(Object.keys(layout.positions)).toHaveLength(12);
  await expect(page.getByTestId("campus-map")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开校园助理", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.locator(".studio-answer")).toContainText("图书馆有五层");
  expect(requests.at(-1)?.conversationId).toBeUndefined();
  await expect(
    page.getByRole("link", { name: /隔离规则来源/ }),
  ).toHaveAttribute("href", "https://example.invalid/rules");
  await expect(page.getByRole("link", { name: /隔离活动/ })).toHaveAttribute(
    "href",
    "/calendar?date=2026-11-11&event=event-" + "a".repeat(40),
  );
  await expect(page.locator('[data-node="rag"]')).toHaveAttribute(
    "data-state",
    "skipped",
  );
  await expect(page.locator('[data-node="model"]')).toHaveAttribute(
    "data-state",
    "success",
  );
  await expect(page.locator('[data-node="model"]')).toContainText(
    "完成 · 核验超时",
  );
  await page.locator('[data-node="model"]').click();
  await expect(
    page.locator(".studio-record").filter({ hasText: "证据核验 · 超时" }),
  ).toContainText("12000 ms");
  await page.locator('[data-node="building"]').click();
  await expect(page.locator(".studio-inspector-body")).toContainText(
    "本地隔离建筑资料结果",
  );
  await page.getByRole("button", { name: "测试运行", exact: true }).click();
  await page.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.locator(".studio-answer")).toContainText("图书馆有五层");
  expect(requests.at(-1)?.conversationId).toBe(conversationId);
  await page.getByRole("button", { name: "新运行", exact: true }).click();
  await page.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.locator(".studio-answer")).toContainText("图书馆有五层");
  expect(requests.at(-1)?.conversationId).toBeUndefined();
  if (info.project.name === "desktop") {
    const node = page.locator('[data-node="route"]');
    const before = await node.getAttribute("style"),
      box = (await node.boundingBox())!;
    const edgesBefore = await page
      .locator(".flow-edge")
      .first()
      .getAttribute("d");
    const move = async () => {
      const b = (await node.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 75, b.y + b.height / 2 + 45, {
        steps: 10,
      });
      await page.mouse.up();
    };
    await move();
    expect(await node.getAttribute("style")).not.toBe(before);
    await page.reload();
    await expect(node).toHaveAttribute("style", before!);
    await move();
    const moved = await node.getAttribute("style");
    const count = await page.locator(".flow-edge").count();
    await page.getByRole("button", { name: "保存节点布局" }).click();
    await page.reload();
    await expect(node).toHaveAttribute("style", moved!);
    await expect(page.locator(".workflow-node")).toHaveCount(12);
    await expect(page.locator(".flow-edge")).toHaveCount(count);
    expect(await page.locator(".flow-edge").first().getAttribute("d")).toBe(
      edgesBefore,
    );
    const zoom = await page.locator(".studio-zoom > span").textContent();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.wheel(0, -200);
    await expect(page.locator(".studio-zoom > span")).not.toHaveText(zoom!);
    const pane = page.locator(".studio-inspector"),
      paneBefore = (await pane.boundingBox())!;
    const handle = (await page
      .getByRole("separator", { name: "调整侧栏宽度" })
      .boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
    await page.mouse.down();
    await page.mouse.move(handle.x - 120, handle.y + 100, { steps: 10 });
    await page.mouse.up();
    expect((await pane.boundingBox())!.width).toBeGreaterThan(
      paneBefore.width + 100,
    );
    await page.setViewportSize({ width: 760, height: 900 });
    expect((await pane.boundingBox())!.width).toBeLessThanOrEqual(460);
    const narrow = (await page
      .getByRole("separator", { name: "调整侧栏宽度" })
      .boundingBox())!;
    await page.mouse.move(narrow.x + narrow.width / 2, narrow.y + 100);
    await page.mouse.down();
    await page.mouse.move(narrow.x + 36, narrow.y + 100, { steps: 5 });
    await page.mouse.up();
    expect((await pane.boundingBox())!.width).toBeLessThan(440);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "运行", exact: true }).click();
    await expect(page.locator(".studio-answer")).toContainText("图书馆有五层");
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出运行", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("campusos-agent-run.json");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("agent-workflow.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "返回总览", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("link", { name: "总览", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
