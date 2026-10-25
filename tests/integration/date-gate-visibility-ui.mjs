// Actual component + actual store/SQLite, with isolated fixture data only.
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const dir = "docs/verification/date-gate-visibility-2026-10-25";
mkdirSync(dir, { recursive: true });
mkdirSync("test-results", { recursive: true });
const serverFile = path.resolve("test-results/date-gate-ui-server.mjs"),
  clientFile = path.resolve("test-results/date-gate-ui-client.js");
await build({
  stdin: {
    contents:
      'export {dateGateFixture} from "./tests/fixtures/date-gate";export {consoleV2Api} from "./src/lib/server/console/v2-api";',
    resolveDir: process.cwd(),
  },
  outfile: serverFile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
await build({
  entryPoints: ["tests/fixtures/date-gate-ui.tsx"],
  outfile: clientFile,
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"', "process.env": '{}' },
  logLevel: "silent",
});
const { dateGateFixture, consoleV2Api } = await import(
  pathToFileURL(serverFile).href
);
const fixture = await dateGateFixture();
await fixture.protect("white", true);
const before = fixture.snapshot();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/client.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(readFileSync(clientFile));
      return;
    }
    if (url.pathname === "/rpc") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const route = new URL("http://127.0.0.1/" + url.searchParams.get("path"));
      const request = new Request(route, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body } : {}),
      });
      const result = await consoleV2Api(
        fixture.store,
        request,
        route.pathname.replace(/^\/v2\//, "").split("/"),
        Object.fromEntries(route.searchParams),
      );
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/client.js"></script></body></html>',
    );
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 950 },
  });
  const errors = [];
  page.on("pageerror", (e) => {errors.push(e.message);console.log(JSON.stringify({pageError:e.message}));});
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page
    .getByRole("button", { name: "预览门禁文章", exact: true })
    .waitFor();
  const records = [];
  for (const [date, expected, restore] of [
    ["2026-07-01", ["autumn", "white"], 0],
    ["2026-01-01", ["autumn", "spring", "white"], 1],
  ]) {
    await page.locator("input[type=date]").fill(date);
    await page
      .getByRole("button", { name: "预览门禁文章", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认门禁时间", exact: true })
      .waitFor();
    await page.screenshot({
      path: dir + "/preview-" + date + ".png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "确认门禁时间", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".console-feedback")
        ?.textContent?.includes("后台全文保留"),
    );
    assert.deepEqual(fixture.visible(), expected);
    assert.equal(fixture.snapshot(), before);
    const message = await page.locator(".console-feedback").innerText();
    assert.ok(message.includes("恢复 " + restore + " 篇"));
    records.push({
      date,
      visible: fixture.visible(),
      message,
      contentAndHistoryUnchanged: true,
    });
    await page.screenshot({
      path: dir + "/complete-" + date + ".png",
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  assert.equal(
    fixture.sqlite
      .prepare(
        "SELECT count(*) n FROM console_commands WHERE action='document.review'",
      )
      .get().n,
    0,
  );
  const report = {
    at: new Date().toISOString(),
    browser: "Edge headless",
    isolatedDatabase: true,
    realComponent: true,
    realStore: true,
    productionGateChanged: false,
    records,
    errors,
  };
  writeFileSync(
    dir + "/ui-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  fixture.close();
}
