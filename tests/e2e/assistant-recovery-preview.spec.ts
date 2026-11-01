import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";

test.use({ trace: "off", video: "off" });
test("live Step-first assistant answers with real tools and visible sources", async ({
  page,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Controlled live model verification only",
  );
  test.setTimeout(120000);
  const status = await page.request.get("/api/agent/status");
  const state = (await status.json()).data;
  expect(state.chatAvailable).toBe(true);
  expect(state.model.model.provider).toBe("stepfun");
  await installAgentEvidence(page);
  await page.goto("/account");
  await page.getByRole("button", { name: "打开校园助理", exact: true }).click();
  const input = page.getByLabel("向校园助理提问");
  await expect(input).toBeEnabled();
  await input.fill("广外图书馆借阅规则是什么？请查校园知识并提供原文来源。");
  await input.press("Enter");
  await expect
    .poll(async () => (await readAgentEvidence(page)).at(-1)?.completeMs, {
      timeout: 90000,
    })
    .toBeTruthy();
  const record = (await readAgentEvidence(page)).at(-1)!;
  const result = record.result as {
    metrics: {
      model: string;
      requests: number;
      answerMode: string;
      modelFailureCode?: string;
      totalTokens: number;
      timings: unknown;
    };
    error?: unknown;
  };
  expect(result.error).toBeUndefined();
  expect(result.metrics.model).toBe(state.model.model.model);
  expect(result.metrics.requests).toBeGreaterThan(0);
  expect(result.metrics.answerMode).toBe("model");
  expect(result.metrics.modelFailureCode).toBeNull();
  expect(record.tools).toContain("search_campus_knowledge");
  expect(record.response.length).toBeGreaterThan(30);
  expect(record.response).not.toMatch(/<tool_call>|<function=|AI 暂不可用/);
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  const sources = page.locator(".assistant-sources").last();
  await sources.locator("summary").click();
  const links = await sources.locator("a[href]").evaluateAll((elements) =>
    elements.map((e) => ({
      title: e.textContent,
      url: (e as HTMLAnchorElement).href,
    })),
  );
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((x) => /^https?:/.test(x.url))).toBe(true);
  const out =
    process.env.E2E_CAPTURE_DIR || "verification/map-ai-recovery-2026-11-01";
  mkdirSync(out, { recursive: true });
  await page.screenshot({
    path: `${out}/${info.project.name}-ai.png`,
    fullPage: true,
  });
  writeFileSync(
    `${out}/${info.project.name}-ai.json`,
    JSON.stringify(
      {
        baseURL: info.project.use.baseURL,
        configuredProvider: state.model.model.provider,
        metrics: result.metrics,
        prompt: record.prompt,
        tools: record.tools,
        response: record.response,
        sources: links,
        latencyMs: record.completeMs,
        firstTextMs: record.firstTextMs,
      },
      null,
      2,
    ),
  );
});
