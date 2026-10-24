// Existing desktop execution only. No service installation, model or paid resource.
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { build } from "esbuild";
const args = process.argv.slice(2),
  option = (k) => args[args.indexOf(k) + 1];
if (!args.includes("--run")) {
  console.log(
    JSON.stringify({
      mode: "dry-run-no-network",
      usage:
        "--run --base <approved-preview-or-local> --token-file <ignored-file> [--watch]",
      batchJobs: 2,
      pollSeconds: 30,
      models: 0,
      computerMustRemainOnline: true,
    }),
  );
} else {
  const base = option("--base"),
    file = option("--token-file");
  if (
    ![
      "http://127.0.0.1:8787",
      "https://campusos-preview.zhujunkui1.workers.dev",
    ].includes(base) ||
    !args.includes("--token-file") ||
    !file
  )
    throw Error("EXPLICIT_APPROVED_ORIGIN_AND_TOKEN_FILE_REQUIRED");
  const token = readFileSync(file, "utf8").trim();
  if (!/^[\w-]{40,100}$/.test(token)) throw Error("INVALID_RUNNER_TOKEN");
  mkdirSync("test-results/console-v2", { recursive: true });
  const bundle = "test-results/console-v2/ingest-runner.mjs";
  await build({
    entryPoints: ["scripts/ingest-web-runner.ts"],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    tsconfig: "tsconfig.json",
    logLevel: "silent",
    packages: "external",
  });
  async function api(path, method = "GET") {
    const r = await fetch(base + "/api/console-runner/" + path, {
        method,
        headers: { Authorization: "Bearer " + token, Origin: base },
        signal: AbortSignal.timeout(20000),
      }),
      body = await r.json();
    if (!r.ok || !body.ok)
      throw Error("RUNNER_" + r.status + "_" + (body.error?.code || "FAILED"));
    return body.data;
  }
  let lastDispatch = 0;
  const skippedJobIds = new Set();
  do {
    try {
      const dispatch =
        Date.now() - lastDispatch >= 300000
            ? await api("dispatch", "POST")
            : { registered: 0, state: "polling" },
        list = await api("jobs"),
        summaries = [];
      if (dispatch.state !== "polling") lastDispatch = Date.now();
      for (const j of list.items
        .filter(
          (j) =>
            !skippedJobIds.has(j.id) &&
            j.lease_until_ms <= Date.now() &&
            j.next_run_after_ms <= Date.now(),
        )
        .slice(0, 2)) {
        const reportPath = `test-results/console-v2/${j.id}.json`;
        rmSync(reportPath, { force: true });
        const run = await new Promise((resolve) => {
          const child = spawn(
              process.execPath,
              [
            bundle,
            "--run",
            "--source",
            j.source_id,
            "--job",
            j.id,
            "--base",
            base,
            "--token-file",
            file,
            "--steps",
            "1000",
            "--report",
            reportPath,
          ],
          {
            env: process.env,
            stdio: ["ignore", "ignore", "pipe"],
            windowsHide: true,
          },
            ),
            stderr = [];
          let spawnError = null,
            heartbeatInFlight = false;
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk) => {
            if (stderr.join("").length < 1048576) stderr.push(chunk);
          });
          child.on("error", (error) => {
            spawnError = error;
          });
          const heartbeat = setInterval(() => {
              if (heartbeatInFlight) return;
              heartbeatInFlight = true;
              void api("jobs")
                .catch(() => {})
                .finally(() => {
                  heartbeatInFlight = false;
                });
            }, 30000),
            timeout = setTimeout(() => child.kill(), 3600000);
          child.on("close", (status, signal) => {
            clearInterval(heartbeat);
            clearTimeout(timeout);
            resolve({
              status,
              signal,
              error: spawnError,
              stderr: stderr.join("").slice(0, 1048576),
            });
          });
        });
        let result;
        try {
          result = JSON.parse(readFileSync(reportPath, "utf8"));
        } catch {
          /* Keep failures explicit. */
        }
        const stderrError = String(run.stderr || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) =>
            /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError):/.test(
              line,
            ),
          )
          ?.replace(/Bearer\s+[\w-]+/gi, "Bearer <REDACTED>")
          .slice(0, 180);
        const failed = run.status !== 0 || !!run.error;
        if (failed) skippedJobIds.add(j.id);
        summaries.push({
          jobId: j.id,
          completedProcess: run.status === 0,
          final: result?.final || null,
          failure: failed
            ? {
                exitCode: run.status,
                signal: run.signal,
                reason: run.error?.code || stderrError || "CHILD_PROCESS_FAILED",
              }
            : null,
        });
      }
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          registered: dispatch.registered,
          registrationState: dispatch.state,
          executions: summaries,
          models: 0,
        }),
      );
    } catch (error) {
      if (/RUNNER_(401|403)_/.test(String(error))) {
        console.error(
          "RUNNER_AUTH_REVOKED_OR_EXPIRED: renew the scoped credential before restarting.",
        );
        process.exitCode = 1;
        break;
      }
      console.error(
        "RUNNER_PAUSED_OR_FAILED: check Console policy, budget and scoped credential.",
      );
      if (!args.includes("--watch")) process.exitCode = 1;
    }
    if (!args.includes("--watch")) break;
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } while (true);
}
