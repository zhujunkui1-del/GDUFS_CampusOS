import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2] || "docs/verification/s2-e-cpu/before";
const { records } = JSON.parse(readFileSync(`${dir}/invocations.json`, "utf8"));
const percentile = (values, p) =>
  values.toSorted((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * p) - 1)
  ] ?? null;
const paths = [...new Set(records.map((r) => r.path))];
const groups = paths.map((path) => {
  const rows = records.filter((r) => r.path === path);
  const cpu = rows.map((r) => r.cpuTimeMs).filter((v) => v !== null);
  const wall = rows.map((r) => r.wallTimeMs).filter((v) => v !== null);
  return {
    path,
    n: rows.length,
    measuredCpuN: cpu.length,
    cpuP50Ms: percentile(cpu, 0.5),
    cpuP95Ms: percentile(cpu, 0.95),
    cpuMaxMs: percentile(cpu, 1),
    wallP50Ms: percentile(wall, 0.5),
    wallP95Ms: percentile(wall, 0.95),
    over10ms: cpu.filter((v) => v > 10).length,
    outcomes: Object.fromEntries(
      [...new Set(rows.map((r) => r.outcome))].map((s) => [
        s,
        rows.filter((r) => r.outcome === s).length,
      ]),
    ),
  };
});
const result = {
  actualCloud: true,
  recordedAt: new Date().toISOString(),
  source:
    "Cloudflare Wrangler tail invocation CPU milliseconds; wall milliseconds are separate",
  total: records.length,
  exceededCpu: records.filter((r) => r.outcome === "exceededCpu").length,
  groups,
};
writeFileSync(
  `${dir}/cpu-summary.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
// Intentionally red while any key request exceeds Free's nominal 10ms. Zero
// errors alone is not a passing signal. Samples cannot prove long-term safety.
if (process.argv.includes("--assert-free") && groups.some((g) => g.over10ms))
  process.exitCode = 1;
