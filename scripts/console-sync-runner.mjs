// Existing desktop execution only. No service installation, model or paid resource.
import { readFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
            j.lease_until_ms <= Date.now() && j.next_run_after_ms <= Date.now(),
        )) {
        const reportPath = `test-results/console-v2/${j.id}.json`;
        const run = spawnSync(
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
            encoding: "utf8",
            env: process.env,
            timeout: 3600000,
            maxBuffer: 1048576,
          },
        );
        let result;
        try {
          result = JSON.parse(readFileSync(reportPath, "utf8"));
        } catch {
          /* Keep failures explicit. */
        }
        summaries.push({
          jobId: j.id,
          completedProcess: run.status === 0,
          final: result?.final || null,
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
