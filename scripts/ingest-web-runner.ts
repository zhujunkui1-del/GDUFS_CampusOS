import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { webProfiles } from "../src/lib/ingestion/profiles";
import type { WebProfile } from "../src/lib/ingestion/profiles";
import {
  OfficialWebConnector,
  extractEvents,
} from "../src/lib/ingestion/connector";
import { SafeWebFetcher } from "../src/lib/ingestion/safe-fetch";
import { pbkdf2Sync } from "node:crypto";
const args = process.argv.slice(2),
  option = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
if (!args.includes("--run")) {
  console.log(
    JSON.stringify({
      mode: "dry-run-no-network",
      profiles: webProfiles.map((x) => ({
        sourceId: x.sourceId,
        entryUrl: x.entryUrl,
        ruleVersion: x.ruleVersion,
      })),
      usage:
        "--run --source <id> [--job <id>] [--token-file <ignored-path>] --base <localhost8787|preview> --report <path>",
      requestPacing: "per-source setting",
      modelCalls: 0,
    }),
  );
} else {
  const base = option("--base") || "http://127.0.0.1:8787";
  if (
    ![
      "http://127.0.0.1:8787",
      "http://localhost:8787",
      "https://campusos-preview.zhujunkui1.workers.dev",
    ].includes(base)
  )
    throw Error("UNAPPROVED_API_ORIGIN");
  const remote = base.startsWith("https:");
  const tokenPath = option("--token-file"),
    runnerToken = tokenPath ? readFileSync(tokenPath, "utf8").trim() : "";
  if (runnerToken && !/^[\w-]{40,100}$/.test(runnerToken))
    throw Error("INVALID_RUNNER_TOKEN");
  const secrets = runnerToken
    ? {}
    : JSON.parse(
        readFileSync(
          remote
            ? ".map-tools/s3-a/preview-secrets.json"
            : ".map-tools/s3-a/local-secrets.json",
          "utf8",
        ),
      );
  let key = remote
    ? secrets.CONSOLE_ADMIN_ACCESS_KEY
    : secrets.CONSOLE_LOCAL_ACCESS_KEY;
  let cookie = "",
    csrf = "";
  const rpcTimes: number[] = [];
  const api = async <T = Record<string, unknown>>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const started = performance.now();
    const target = runnerToken
      ? path.replace("/api/admin/", "/api/console-runner/")
      : path.replace(
          /\/api\/admin\/jobs\/([\w-]+)\/permit$/,
          "/api/admin/v2/permits/$1",
        );
    const r = await fetch(base + target, {
      method,
      headers: {
        Origin: base,
        ...(runnerToken ? { Authorization: "Bearer " + runnerToken } : {}),
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-Console-CSRF": csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    rpcTimes.push(Math.round(performance.now() - started));
    const response = await r.json();
    if (!r.ok || !response.ok) {
      const message = String(response.error?.message || "")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 120);
      throw Error(
        `API_${r.status}_${response.error?.code || "ERROR"}_${target}${
          message ? `:${message}` : ""
        }`,
      );
    }
    if (path === "/api/console-auth" && method === "POST")
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    return response.data as T;
  };
  if (!runnerToken) {
    const mode = await api<{ credentialDerivation?: { salt: string } }>(
      "/api/console-auth",
    );
    if (mode.credentialDerivation) {
      const password = readFileSync(
        "CampusOS_Codex_完整设计文档_v2/key.md",
        "utf8",
      )
        .replace(/^\uFEFF/, "")
        .trim();
      key = pbkdf2Sync(
        password,
        Buffer.from(mode.credentialDerivation.salt, "hex"),
        600000,
        32,
        "sha256",
      ).toString("hex");
    }
    csrf = (await api<{ csrf: string }>("/api/console-auth", "POST", { key }))
      .csrf;
  }
  const events: Record<string, unknown>[] = [];
  let websiteRequests = 0,
    jobId = option("--job") || "";
  try {
    const sourceId = option("--source") || "";
    if (!sourceId) throw Error("SOURCE_ID_REQUIRED");
    const policyRecord = await api<{
      profile: WebProfile;
      policy: { rights_scope: string; expires_at_ms: number } | null;
    }>("/api/admin/sources/" + sourceId + "/collection-policy");
    const profile = policyRecord.profile;
    const connector = new OfficialWebConnector(profile),
      fetcher = new SafeWebFetcher(profile);
    if (args.includes("--approve-metadata"))
      throw Error("SOURCE_POLICIES_MUST_BE_APPROVED_IN_CONSOLE");
    if (runnerToken && !jobId)
      throw Error("SCOPED_RUNNER_REQUIRES_REGISTERED_JOB");
    if (!jobId)
      jobId = (
        await api<{ id: string }>("/api/admin/jobs", "POST", {
          commandId: crypto.randomUUID(),
          sourceId,
          maxArticles: 1,
          mode: args.includes("--revalidate") ? "revalidate" : "incremental",
        })
      ).id;
    if (!policyRecord.policy || policyRecord.policy.expires_at_ms <= Date.now())
      throw Error("SOURCE_POLICY_EXPIRED");
    const policyRights = policyRecord.policy.rights_scope;
    if (
      policyRights !== "metadata_only" &&
      policyRights !== "excerpt_and_link" &&
      policyRights !== "licensed_full_text"
    )
      throw Error("POLICY_SCOPE_REQUIRED");
    let licensedWrites = 0;
    const maxSteps = Number(option("--steps") || 1000);
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 1000)
      throw Error("INVALID_STEP_LIMIT");
    for (let step = 0; step < maxSteps; step++) {
      const row = await api<Record<string, unknown>>(
        "/api/admin/jobs/" + jobId,
      );
      if (row.source_id !== sourceId) throw Error("JOB_SOURCE_MISMATCH");
      if (
        row.phase === "complete" ||
        row.control_state !== "active" ||
        row.status === "failed"
      )
        break;
      if (Number(row.next_run_after_ms) > Date.now())
        await new Promise((r) =>
          setTimeout(
            r,
            Math.min(31000, Number(row.next_run_after_ms) - Date.now() + 50),
          ),
        );
      const lease = await api<{
        version: number;
        fence: number;
        leaseToken: string;
        phase: string;
        url: string;
        publishedAtFromList: string | null;
        validators: { etag: string | null; lastModified: string | null };
      }>("/api/admin/jobs/" + jobId + "/claim", "POST", {
        commandId: crypto.randomUUID(),
        expectedVersion: row.version,
      });
      fetcher.beforeRequest = () =>
        api("/api/admin/jobs/" + jobId + "/permit", "POST", {
          leaseToken: lease.leaseToken,
          fence: lease.fence,
          version: lease.version,
        }).then(() => {});
      const before = fetcher.requests;
      const started = performance.now();
      let result: Record<string, unknown> = {
        url: lease.url,
        status: 0,
        bytes: 0,
        requests: 0,
        outcome: "network_error",
        etag: null,
        lastModified: null,
        bodyHash: null,
        publishedRaw: null,
        discovered: [],
        discoveredDates: [],
        nextPage: null,
      };
      try {
        if (fetcher.robots === null)
          await fetcher.get(profile.origin + "/robots.txt", "robots");
        const page = await fetcher.get(
          lease.url,
          lease.phase === "discover" ? "list" : "detail",
          lease.phase === "fetch" ? lease.validators : undefined,
        );
        result = {
          ...result,
          status: page.status,
          bytes: page.bytes,
          etag: page.etag,
          lastModified: page.lastModified,
        };
        if (page.status === 304) result.outcome = "not_modified";
        else {
          if (page.status !== 200) throw Error("HTTP_NOT_OK");
          if (lease.phase === "discover") {
            const found = connector.discover(page.html, lease.url);
            result = {
              ...result,
              outcome: "ok",
              discovered: found.urls,
              discoveredDates: found.dates,
              nextPage: found.nextPage,
            };
          } else {
            const parsed = connector.parse(
                page.html,
                lease.url,
                lease.publishedAtFromList,
              ),
              article = connector.validate(
                connector.normalize(parsed, lease.url, policyRights),
              );
            // Only the current server-approved usage scope can retain text.
            result = {
              ...result,
              outcome: "ok",
              article,
              bodyHash: parsed.bodyHash,
              publishedRaw: parsed.dateText,
              bodyTextChars: parsed.bodyTextChars,
              attachments: parsed.attachments,
              events:
                article.rightsScope === "metadata_only"
                  ? []
                  : extractEvents(article.body),
            };
            events.push({
              url: lease.url,
              parse: "metadata_ok",
              publishedAt: parsed.publishedAt,
              bodyTextChars: parsed.bodyTextChars,
              imageCount: parsed.imageCount,
              fullTextPersisted: policyRights !== "metadata_only",
            });
          }
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : "NETWORK_ERROR";
        const invalidArgument =
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_ARGUMENT";
        result.outcome = /BLOCKED|DENIED|REDIRECT|PRIVATE|ROBOTS|MIME/.test(
          code,
        )
          ? "blocked"
          : /TOO_LARGE/.test(code)
            ? "too_large"
            : invalidArgument || /PARSE|ENCODING/.test(code)
              ? "parse_error"
              : "network_error";
        events.push({
          url: lease.url,
          error:
            error instanceof Error &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : code.replace(/[^A-Z_]/g, "").slice(0, 40),
        });
      }
      result.requests = fetcher.requests - before;
      websiteRequests = fetcher.requests;
      const commit = {
        ...result,
        commandId: crypto.randomUUID(),
        expectedVersion: lease.version,
        leaseToken: lease.leaseToken,
        fence: lease.fence,
      };
      await api("/api/admin/jobs/" + jobId + "/commit", "POST", commit);
      if (
        result.outcome === "ok" &&
        lease.phase === "fetch" &&
        policyRights !== "metadata_only"
      )
        licensedWrites++;
      events.push({
        phase: lease.phase,
        outcome: result.outcome,
        wallMs: Math.round(performance.now() - started),
        requests: result.requests,
      });
      if (result.outcome !== "ok" && result.outcome !== "not_modified") break;
    }
    const final = await api<Record<string, unknown>>(
      "/api/admin/jobs/" + jobId,
    );
    const report = {
      recordedAt: new Date().toISOString(),
      environment: remote ? "real-cloudflare-preview" : "local-worker",
      sourceId,
      jobId,
      final: {
        status: final.status,
        controlState: final.control_state,
        phase: final.phase,
        found: final.found_count,
        bodyTextParsed: final.body_count,
        duplicates: final.duplicate_count,
        errors: final.error_count,
        reservedRequests: final.request_count,
      },
      websiteRequests,
      events,
      apiWallMs: rpcTimes,
      modelCalls: 0,
      fullTextPersisted: licensedWrites > 0,
      autoApproved: null,
      autoPublished: null,
    };
    const path = option("--report");
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(JSON.stringify(report));
    if (final.status !== "completed" && !option("--steps"))
      process.exitCode = 1;
  } finally {
    if (!runnerToken) await api("/api/console-auth", "DELETE").catch(() => {});
  }
}
