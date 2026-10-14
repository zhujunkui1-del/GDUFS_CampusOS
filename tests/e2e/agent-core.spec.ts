import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { selectMapMode } from "./helpers/map-mode";

test("S2-A model status is truthful and closed chat leaves the real map usable", async ({
  page,
  request,
  browser,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const status = await request.get("/api/agent/status");
  expect(status.status()).toBe(200);
  const body = await status.json();
  expect(body.data.stage).toBe("S2-A");
  expect(body.data.chatAvailable).toBe(false);
  expect(body.data.skills).toEqual([]);
  if (process.env.E2E_MODEL_READY === "1") {
    expect(body.data.model.ready).toBe(true);
    expect(body.data.model.model.provider).toBe("deepseek");
  }
  expect(JSON.stringify(body)).not.toMatch(
    /fingerprint|apiKey|sk-[a-zA-Z0-9]{12}/,
  );
  const chat = await request.post("/api/agent/chat", {
    data: { message: "帮我找到南苑7栋。" },
  });
  expect(chat.status()).toBe(503);
  expect((await chat.json()).error.code).toBe("SERVICE_UNAVAILABLE");
  const forged = await request.post("/api/agent/chat", {
    data: { message: "hi", userId: "admin", provider: "mock" },
  });
  expect(forged.status()).toBe(400);
  const dir = process.env.E2E_AGENT_CAPTURE_DIR || "test-results/s2-a";
  await mkdir(dir, { recursive: true });
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  await page.goto("/api/agent/status");
  await page.screenshot({ path: `${dir}/${name}-model-status.png` });
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-detailed", "visible", {
    timeout: 30000,
  });
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-map.png` });
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await expect(page.locator("#campus-assistant")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: `${dir}/${name}-assistant-pending.png` });
  await page.getByRole("button", { name: "收起校园助理" }).click();
  await selectMapMode(page, "2D");
  await expect(map).toHaveAttribute("data-mode", "2d");
  expect(errors).toEqual([]);
  await writeFile(
    `${dir}/${name}.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        realPhone: false,
        modelStatus: body.data,
        businessChatTested: false,
        chatHttpStatus: chat.status(),
        forgedHttpStatus: forged.status(),
        mapVersion: await map.getAttribute("data-map-version"),
        modelSha: await map.getAttribute("data-model-asset-sha"),
        pageErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
});
