import { readFileSync, writeFileSync } from "node:fs";
const root = "docs/verification/s2-e-cpu";
const json = (file) => JSON.parse(readFileSync(`${root}/${file}`, "utf8"));
const quantile = (values, p) => {
  const valid = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  return valid[Math.max(0, Math.ceil(valid.length * p) - 1)] ?? null;
};
const pair = (values) => ({
  n: values.filter(Number.isFinite).length,
  p50: quantile(values, 0.5),
  p95: quantile(values, 0.95),
});
const phases = ["before", "after", "final"].map((phase) => {
  const live = json(`${phase}/browser/chrome-desktop-live.json`).records;
  const cpu = json(`${phase}/invocations.json`)
    .records.filter((r) => r.path === "/api/agent/chat")
    .slice(0, live.length);
  const metrics = live.map((r) => r.result.metrics);
  return {
    phase,
    sameChromeDesktopScenarioCount: live.length,
    perScenario: live.map((record, i) => ({
      prompt: record.prompt,
      tools: record.tools,
      cpuMs: cpu[i]?.cpuTimeMs,
      invocationWallMs: cpu[i]?.wallTimeMs,
      firstTextMs: record.firstTextMs,
      completeMs: record.completeMs,
      d1Calls: record.result.metrics.timings.database.calls,
      outcome: record.result.error?.code || "completed",
    })),
    cpu: pair(cpu.map((r) => r.cpuTimeMs)),
    firstTextMs: pair(live.map((r) => r.firstTextMs)),
    completeMs: pair(live.map((r) => r.completeMs)),
    d1AwaitMs: pair(metrics.map((m) => m.timings.database.durationMs)),
    d1Calls: pair(metrics.map((m) => m.timings.database.calls)),
    mapActionMs: pair(metrics.map((m) => m.timings.mapActionMs)),
    modelRequests: metrics.reduce((n, m) => n + m.requests, 0),
    totalTokens: metrics.reduce((n, m) => n + m.totalTokens, 0),
  };
});
const result = {
  at: new Date().toISOString(),
  matchedScenariosAreOrderedControlledTests: true,
  warning:
    "Low sample nearest-rank percentiles. CPU excludes waiting. HKG versus NRT and isolate coldness were not controlled. Not proof of long-term stability.",
  phases,
  finalAllInvocations: json("final/cpu-summary.json"),
  finalD1Usage: json("final/d1-usage.json"),
};
writeFileSync(
  `${root}/comparison.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    phases.map(({ perScenario: _scenarios, ...rest }) => {
      void _scenarios;
      return rest;
    }),
    null,
    2,
  ),
);
