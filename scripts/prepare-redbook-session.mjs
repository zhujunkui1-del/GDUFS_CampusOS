// Human login in the existing dedicated source profile. No daily-browser scan.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const directory = ".map-tools/xhs-provider-eval";
const nextAccount = process.argv.includes("--next-account");
const captureOnly = process.argv.includes("--capture-only");
await fs.mkdir(directory, { recursive: true });
const context = await chromium.launchPersistentContext(
  "services/external-search/runtime/" +
    (nextAccount
      ? "xiaohongshu-browser-profile-next-account"
      : "xiaohongshu-browser-profile"),
  { channel: "msedge", headless: false, timeout: 20000 },
);
let platform = null,
  closed = false,
  capturedPlatform = null;
context.on("close", () => {
  closed = true;
});
context.on("response", async (response) => {
  try {
    const url = new URL(response.url());
    if (
      !["edith.xiaohongshu.com", "webapi.rednote.com"].includes(url.hostname) ||
      !url.pathname.endsWith("/user/me")
    )
      return;
    const data = await response.json();
    const sourcePlatform =
      url.hostname === "webapi.rednote.com" ? "rednote" : "xhs";
    if (
      platform === sourcePlatform &&
      (data.data?.guest === true || [-100, -101].includes(data.code))
    )
      platform = null;
    if (
      response.status() === 200 &&
      data.success === true &&
      data.data?.guest === false &&
      (data.data.user_id || data.data.userId)
    )
      platform = sourcePlatform;
  } catch {
    /* No login is inferred from a missing or failed source response. */
  }
});
try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://www.xiaohongshu.com/explore", {
    waitUntil: "domcontentloaded",
    timeout: 18000,
  });
  console.log(
    JSON.stringify({
      dedicatedLoginWindowOpened: true,
      waitingForHuman: !captureOnly,
      profile: nextAccount ? "next-account" : "original",
    }),
  );
  const end = Date.now() + (captureOnly ? 15000 : 20 * 60 * 1000);
  while (!capturedPlatform && !closed && Date.now() < end) {
    if (!platform) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const candidate = platform;
    await page.waitForTimeout(800);
    if (platform !== candidate || closed) continue;
    const cookies = (await context.cookies()).filter((c) =>
      /(^|\.)(xiaohongshu|rednote)\.com$/.test(c.domain),
    );
    if (platform !== candidate) continue;
    await fs.writeFile(
      directory +
        (nextAccount ? "/next-account-session.json" : "/local-session.json"),
      JSON.stringify({
        cookies,
        origins: [],
        authenticatedPlatform: candidate,
        capturedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    capturedPlatform = candidate;
  }
  const receipt = {
    at: new Date().toISOString(),
    authenticated: !!capturedPlatform,
    platform: capturedPlatform,
    closedBeforeCapture: closed,
    source: "native browser user/me",
    profile: nextAccount ? "next-account" : "original",
  };
  await fs.writeFile(
    directory +
      (nextAccount
        ? "/next-account-login-receipt.json"
        : "/login-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
  if (!capturedPlatform) process.exitCode = 2;
} finally {
  await context.close().catch(() => {});
}
