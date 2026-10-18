// Explicit existing preview, read-only browser operations. Credentials stay in
// the test process and are removed from diagnostics before anything is printed.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
if (process.argv.includes("--help")) {
  console.log(
    "Usage: node scripts/test-console-v2-preview.mjs [--local] [--controls] [--single]",
  );
  process.exit(0);
}
const local = process.argv.includes("--local");
const controls = process.argv.includes("--controls");
const single = process.argv.includes("--single");
if (controls && !local)
  throw Error("Controls test requires isolated local environment");
const dir =
  "docs/verification/console-v2/e/" + (local ? "browser" : "cloud-browser");
mkdirSync(dir, { recursive: true });
const secretValues = Object.entries(
  JSON.parse(
    readFileSync(
      local
        ? ".map-tools/s3-a/local-secrets.json"
        : ".map-tools/s3-a/preview-secrets.json",
      "utf8",
    ),
  ),
)
  .filter(
    ([k, v]) =>
      /key|secret|token|password/i.test(k) &&
      typeof v === "string" &&
      v.length >= 10,
  )
  .map(([, v]) => v);
secretValues.push(
  readFileSync("CampusOS_Codex_完整设计文档_v2/key.md", "utf8")
    .replace(/^\uFEFF/, "")
    .trim(),
);
const scrub = (text) =>
  secretValues.reduce(
    (value, secret) => value.split(secret).join("[REDACTED]"),
    text,
  );
const output = [];
for (const channel of controls || single ? ["chrome"] : ["chrome", "msedge"])
  for (const project of controls || single
    ? ["desktop"]
    : ["desktop", "mobile"]) {
    const env = {
      ...process.env,
      E2E_BASE_URL: local
        ? "http://127.0.0.1:8787"
        : "https://campusos-preview.zhujunkui1.workers.dev",
      CONSOLE_V2_LOCAL_E2E: local ? "1" : "0",
      CONSOLE_V2_EVIDENCE_DIR: dir,
      CONSOLE_V2_PREVIEW: local ? "0" : "1",
      PLAYWRIGHT_CHANNEL: channel,
      E2E_PROXY: "http://127.0.0.1:12451",
    };
    delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
    delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
    const label =
      channel +
      "-" +
      project +
      (controls ? "-controls" : single ? "-single" : "");
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        controls
          ? "tests/e2e/console-v2-simple-actions.spec.ts"
          : local
            ? "tests/e2e/console-v2.spec.ts"
            : "tests/e2e/console-v2-preview.spec.ts",
        "--project",
        project,
        "--workers",
        "1",
        "--reporter",
        "json",
        "--output",
        ".map-tools/console-v2/cloud-browser/" + label,
      ],
      { env, encoding: "utf8", maxBuffer: 16777216, timeout: 180000 },
    );
    let report;
    try {
      const raw = scrub(result.stdout || "");
      report = JSON.parse(raw.slice(raw.indexOf("{")));
    } catch {
      writeFileSync(
        dir + "/" + label + "-diagnostics.txt",
        scrub((result.stdout || "") + "\n" + (result.stderr || "")),
      );
      throw Error("Browser report unavailable; sanitized diagnostics retained");
    }
    writeFileSync(
      dir + "/" + label + "-report.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    const summary = { channel, project, ...report.stats, exit: result.status };
    output.push(summary);
    console.log(JSON.stringify(summary));
    if (result.status !== 0) break;
    // Natural rate window. Never reset or raise authentication/request limits.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(60000, 61000 - (Date.now() % 60000))),
    );
  }
writeFileSync(
  dir +
    (controls
      ? "/controls-results.json"
      : single
        ? "/single-results.json"
        : "/results.json"),
  JSON.stringify(output, null, 2) + "\n",
);
if (
  output.length !== (controls || single ? 1 : 4) ||
  output.some((r) => r.unexpected || r.exit)
)
  process.exitCode = 1;
