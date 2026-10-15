// Summarize sanitized browser evidence. Optional read-only local ledger never exports identities, messages or tickets.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "docs/verification/s2-c";
function summary(records) {
  const meters = records.map((r) => r.result?.metrics).filter(Boolean);
  const timed = meters.map((m) => m.durationMs).sort((a, b) => a - b);
  const sum = (key) => meters.reduce((n, m) => n + (m[key] || 0), 0);
  const known = meters.filter((m) => m.usageComplete);
  return {
    tasks: records.length,
    completed: records.filter((r) => r.result && !r.result.error).length,
    errors: records
      .filter((r) => r.result?.error)
      .map((r) => r.result.error.code),
    missingTerminalOrUsage: records.length - meters.length,
    incompleteUsage: meters.filter((m) => !m.usageComplete).length,
    upstreamRequests: sum("requests"),
    correctionRetries: sum("correctionRetries"),
    knownPromptTokens: sum("promptTokens"),
    knownCompletionTokens: sum("completionTokens"),
    knownCachedPromptTokens: sum("cachedPromptTokens"),
    knownTotalTokens: sum("totalTokens"),
    measuredDurationMs: timed.length
      ? {
          p50: timed[Math.ceil(timed.length * 0.5) - 1],
          p95: timed[Math.ceil(timed.length * 0.95) - 1],
          min: timed[0],
          max: timed.at(-1),
        }
      : null,
    estimatedKnownUsdRange: [0, 1].map((i) =>
      known.reduce((n, m) => n + (m.estimatedUsdRange?.[i] || 0), 0),
    ),
    costIsInvoice: false,
    unknownUsageIsNotZeroCost: true,
  };
}
const files = readdirSync(join(root, "live")).filter((f) =>
  /-(?:live|location|recovery)\.json$/.test(f),
);
const groups = Object.fromEntries(
  files.map((f) => {
    const evidence = JSON.parse(readFileSync(join(root, "live", f), "utf8"));
    return [f.replace(".json", ""), summary(evidence.records)];
  }),
);
const all = files.flatMap(
  (f) => JSON.parse(readFileSync(join(root, "live", f), "utf8")).records,
);
const output = {
  recordedAt: new Date().toISOString(),
  realModel: true,
  note: "Final saved browser matrix only; earlier debug runs are excluded here. Location cancellation lacks final usage. Latency includes tools/browser ACK and final model stream, not just network TTFT.",
  groups,
  total: summary(all),
};
writeFileSync(
  join(root, "metrics.json"),
  JSON.stringify(output, null, 2) + "\n",
);
if (process.argv.includes("--local-ledger")) {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = ".wrangler/state/v3/d1";
  for (const name of readdirSync(dir, { recursive: true }).filter((f) =>
    f.endsWith(".sqlite"),
  )) {
    const db = new DatabaseSync(join(dir, name), { readOnly: true });
    try {
      if (
        !db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runs'",
          )
          .get()
      )
        continue;
      const rows = db
        .prepare(
          "SELECT status,error_code,usage_json,charged_tokens FROM agent_runs WHERE owner_key IS NOT NULL",
        )
        .all();
      const records = rows.map((row) => ({
        result: {
          ...(row.status === "failed"
            ? { error: { code: row.error_code } }
            : {}),
          ...(row.usage_json ? { metrics: JSON.parse(row.usage_json) } : {}),
        },
      }));
      writeFileSync(
        join(root, "runtime-usage.json"),
        JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            includesDebugAndFailedRuns: true,
            notSupplierInvoice: true,
            ledgerCounts: Object.fromEntries(
              [...new Set(rows.map((r) => r.status))].map((s) => [
                s,
                rows.filter((r) => r.status === s).length,
              ]),
            ),
            quotaTokensReservedOrActual: rows.reduce(
              (n, r) => n + r.charged_tokens,
              0,
            ),
            summary: summary(records),
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      db.close();
    }
  }
}
console.log(JSON.stringify(output.total));
