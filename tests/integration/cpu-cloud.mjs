// Account-scoped, read-only diagnostics for the one authorized preview Worker.
// Authentication and profile binaries never enter the evidence directory.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "comment-json";
import { assertPreviewTarget } from "../../scripts/preview-config.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
const target = assertPreviewTarget(config, account);
const dir = process.env.CPU_CAPTURE_DIR || "docs/verification/s2-e-cpu/before";
mkdirSync(dir, { recursive: true });
function cli(...args) {
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        ["node_modules/wrangler/bin/wrangler.js", ...args, "--json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  } catch {
    throw Error("Cloudflare authentication failed; raw output withheld");
  }
}
const who = cli("whoami");
if (!who.loggedIn || !who.accounts?.some((a) => a.id === account))
  throw Error("Authenticated account does not match isolated preview");
const { token } = cli("auth", "token");
if (!token) throw Error("Cloudflare authentication unavailable");
async function call(path, body, raw = false) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (raw && response.ok) return response;
  const value = await response.json();
  if (!response.ok || !value.success)
    return {
      failed: true,
      status: response.status,
      errors: (value.errors || []).map((e) => ({
        code: e.code,
        message: e.message,
      })),
    };
  return value.result;
}
if (process.argv.includes("--usage")) {
  const start = Date.parse(process.env.CPU_WINDOW_START || "");
  const end = Date.parse(process.env.CPU_WINDOW_END || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw Error("Explicit bounded UTC usage window required");
  const id = config.env.preview.d1_databases[0].database_id;
  const database = await call(`/d1/database/${id}`);
  if (database.name !== "campusos-preview" || database.uuid !== id)
    throw Error("Preview database identity mismatch");
  const query = async (sql, params = []) => {
    const value = await call(`/d1/database/${id}/query`, { sql, params });
    if (value.failed) throw Error("Read-only preview usage query failed");
    return value[0].results;
  };
  const usage = await query(
    `SELECT status,error_code,count(*) AS runs,
    sum(json_extract(usage_json,'$.requests')) AS upstream_requests,
    sum(json_extract(usage_json,'$.totalTokens')) AS total_tokens,
    sum(json_extract(usage_json,'$.promptTokens')) AS prompt_tokens,
    sum(json_extract(usage_json,'$.completionTokens')) AS completion_tokens,
    sum(json_extract(usage_json,'$.cachedPromptTokens')) AS cached_prompt_tokens,
    sum(json_extract(usage_json,'$.estimatedUsdRange[0]')) AS estimated_usd_low,
    sum(json_extract(usage_json,'$.estimatedUsdRange[1]')) AS estimated_usd_high,
    sum(json_extract(usage_json,'$.timings.database.calls')) AS measured_d1_calls,
    sum(json_extract(usage_json,'$.timings.database.readQueries')) AS measured_read_statements,
    sum(json_extract(usage_json,'$.timings.database.writeQueries')) AS measured_write_statements
    FROM agent_runs WHERE started_at_ms>=? AND started_at_ms<? GROUP BY status,error_code`,
    [start, end],
  );
  const quotas = await query(
    "SELECT count(*) AS requests_in_rolling_24h,sum(charged_tokens) AS charged_tokens_in_rolling_24h FROM agent_runs WHERE started_at_ms>?",
    [Date.now() - 86400000],
  );
  const result = {
    at: new Date().toISOString(),
    actualPreviewD1: true,
    numericOnly: true,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    scope: "All preview runs in this bounded window; no private rows retrieved",
    usage,
    quotas,
    foreignKeyViolations: (await query("PRAGMA foreign_key_check")).length,
  };
  writeFileSync(`${dir}/d1-usage.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} else if (process.argv.includes("--metrics")) {
  const start = process.env.CPU_WINDOW_START;
  if (!start || !Number.isFinite(Date.parse(start)))
    throw Error("Explicit UTC window start required");
  const end = new Date().toISOString();
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query($account: String!, $start: Time!, $end: Time!) {
      viewer { accounts(filter: {accountTag: $account}) {
        workersInvocationsAdaptive(limit: 100, filter: {scriptName: "campusos-preview", datetime_geq: $start, datetime_leq: $end}) {
          dimensions { status }
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP95 wallTimeP50 wallTimeP95 }
        }
        d1AnalyticsAdaptiveGroups(limit: 10, filter: {databaseId: "${config.env.preview.d1_databases[0].database_id}", datetime_geq: $start, datetime_leq: $end}) {
          sum { rowsRead rowsWritten }
        }
      }}
    }`,
      variables: { account, start, end },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  const result = {
    recordedAt: end,
    start,
    actualCloudMetrics: true,
    status: response.status,
    cpuUnit: "microseconds",
    data: value.data?.viewer?.accounts?.[0] || null,
    errors: value.errors?.map(({ message }) => ({ message })),
  };
  writeFileSync(`${dir}/metrics.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} else if (process.argv.includes("--profile")) {
  const version = process.env.CPU_WORKER_VERSION;
  if (!/^[a-f0-9-]{36}$/.test(version || ""))
    throw Error("Explicit active version required");
  const began = new Date().toISOString();
  const result = await call(
    `/workers/workers/${target.worker}/versions/${version}/profile`,
    { duration_ms: 10000, profile_type: "cpu" },
    true,
  );
  let evidence;
  if (result instanceof Response) {
    mkdirSync(".map-tools/cpu", { recursive: true });
    const binary = new Uint8Array(await result.arrayBuffer());
    const file = `.map-tools/cpu/${process.env.CPU_PROFILE_LABEL || "profile"}.pprof.gz`;
    writeFileSync(file, binary);
    evidence = {
      began,
      ended: new Date().toISOString(),
      activeVersion: version,
      captured: true,
      bytes: binary.byteLength,
      privateBinary: file,
    };
  } else
    evidence = {
      began,
      ended: new Date().toISOString(),
      captured: false,
      ...result,
    };
  writeFileSync(
    `${dir}/profile-status.json`,
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} else {
  const deployments = await call(
    `/workers/scripts/${target.worker}/deployments`,
  );
  const settings = await call(`/workers/scripts/${target.worker}/settings`);
  const database = await call(
    `/d1/database/${config.env.preview.d1_databases[0].database_id}`,
  );
  const result = {
    at: new Date().toISOString(),
    accountMatched: true,
    worker: target.worker,
    deployments: deployments.failed
      ? deployments
      : deployments.deployments?.map((d) => ({
          id: d.id,
          versions: d.versions,
          created_on: d.created_on,
        })),
    settings: settings.failed
      ? settings
      : {
          compatibility_date: settings.compatibility_date,
          compatibility_flags: settings.compatibility_flags,
          usage_model: settings.usage_model,
          limits: settings.limits,
          observability: settings.observability,
          bindings: settings.bindings?.map(({ name, type }) => ({
            name,
            type,
          })),
        },
    database: {
      name: database.name,
      version: database.version,
      size: database.file_size,
    },
    runtimeStatus: await (
      await fetch(
        "https://campusos-preview.zhujunkui1.workers.dev/api/agent/status",
      )
    ).json(),
  };
  writeFileSync(
    `${dir}/environment.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
