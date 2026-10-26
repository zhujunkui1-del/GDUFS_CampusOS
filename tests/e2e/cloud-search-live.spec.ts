import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test.skip(
  process.env.CLOUD_SEARCH_LIVE !== "1",
  "Explicit Preview migration acceptance",
);
test.use({ trace: "off" });
test.setTimeout(180000);
test("new preferred model and live Agent chat remain usable for open validation", async ({
  page,
}) => {
  const status = (await (await page.request.get("/api/agent/status")).json())
    .data;
  expect(status.model.model.provider).toBe("stepfun");
  await installAgentEvidence(page);
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("向校园助理提问");
  await expect(async () => {
    if (!(await input.isVisible()))
      await page.getByRole("button", { name: "打开校园助理" }).click();
    await expect(input).toBeVisible({ timeout: 2000 });
  }).toPass({ intervals: [1000, 2000], timeout: 20000 });
  await input.fill("你好，简短介绍你能帮我做什么。");
  await input.press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "true",
  );
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 90000 },
  );
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  await expect(
    page.locator('[data-message-role="assistant"]').last(),
  ).not.toBeEmpty();
  await mkdir("docs/verification/cloud-search", { recursive: true });
  await writeFile(
    "docs/verification/cloud-search/live-model-chat.json",
    JSON.stringify(
      { model: status.model.model, evidence: await readAgentEvidence(page) },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "docs/verification/cloud-search/live-model-chat.png",
  });
});
test("live Agent uses cloud Internet search and cites official links with local runners stopped", async ({
  page,
}) => {
  await installAgentEvidence(page);
  await page.goto("/radar", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("向校园助理提问");
  await expect(async () => {
    if (!(await input.isVisible()))
      await page.getByRole("button", { name: "打开校园助理" }).click();
    await expect(input).toBeVisible({ timeout: 2000 });
  }).toPass({ intervals: [1000, 2000], timeout: 20000 });
  await input.fill(
    "请实际联网搜索广东外语外贸大学图书馆的借阅规则页面，给出真实官网链接即可。",
  );
  await input.press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "true",
  );
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 90000 },
  );
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  const last = page.locator('[data-message-role="assistant"]').last(),
    sources = last.locator(".assistant-sources");
  if (await sources.count()) await sources.locator("summary").click();
  await expect(
    last.locator('a[href*="lib.gdufs.edu.cn"]').first(),
  ).toBeVisible();
  await mkdir("docs/verification/cloud-search", { recursive: true });
  await writeFile(
    "docs/verification/cloud-search/live-web-agent.json",
    JSON.stringify(
      {
        answer: await last.innerText(),
        evidence: await readAgentEvidence(page),
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "docs/verification/cloud-search/live-web-agent.png",
  });
});
test.afterEach(async({page},info)=>{if(info.status!=="passed"&&!page.isClosed())await writeFile("docs/verification/cloud-search/web-agent-diagnostic.json",JSON.stringify({error:await page.locator(".assistant-error").allTextContents(),evidence:await readAgentEvidence(page)},null,2));});
