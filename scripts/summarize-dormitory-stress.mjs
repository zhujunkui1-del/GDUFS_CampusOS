import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const directory =
  process.env.STRESS_OUTPUT || "docs/performance/dormitory-2026-10-15";
const raw = await readFile(directory + "/raw.json");
const data = JSON.parse(raw);
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const quantile = (a, p) => {
  const b = a.filter(Number.isFinite).sort((x, y) => x - y);
  return b[Math.floor((b.length - 1) * p)] ?? null;
};
const metric = (a, name) => a.find((m) => m.name === name)?.value ?? null;
const groups = new Map();
for (const c of data.cases) {
  const key = `${c.viewport.name}-${c.count}-${c.variant}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(c);
}
const summary = {
  browser: data.browser,
  assetSha256: data.assetSha256,
  actualPhone: false,
  cases: [],
};
for (const cases of groups.values()) {
  const c = cases[0];
  const actions = {};
  for (const kind of [
    ...new Set(cases.flatMap((c) => c.actions.map((a) => a.kind))),
  ]) {
    const runs = cases.map((c) => c.actions.find((a) => a.kind === kind));
    const samples = runs.flatMap((a) => a.samples);
    actions[kind] = {
      effectiveFpsMedian: quantile(
        runs.map((a) => (a.samples.length * 1000) / a.elapsed),
        0.5,
      ),
      frameMsMedian: quantile(
        samples.map((s) => s.dt).filter((v) => v > 0),
        0.5,
      ),
      frameMsP95: quantile(
        samples.map((s) => s.dt).filter((v) => v > 0),
        0.95,
      ),
      frameMsP99: quantile(
        samples.map((s) => s.dt).filter((v) => v > 0),
        0.99,
      ),
      modelDrawsMean: mean(samples.map((s) => s.calls)),
      totalGlDrawsMean: mean(samples.map((s) => s.glDraws)),
      submittedModelTrianglesMean: mean(samples.map((s) => s.triangles)),
      modelCpuSubmitMsMean: mean(samples.map((s) => s.modelFrameCpuMs)),
      hiddenRuns: runs.filter((a) => a.visibility === "hidden").length,
    };
  }
  summary.cases.push({
    viewport: c.viewport,
    count: c.count,
    variant: c.variant,
    repeats: cases.length,
    geometryTriangles: c.metadata.geometryTriangles,
    assetBytes: c.metadata.bytes,
    readyMsMedian: quantile(
      cases.map((c) => c.metadata.readyMs),
      0.5,
    ),
    navigationMsMedian: quantile(
      cases.map((c) => c.navigationMs),
      0.5,
    ),
    parseMsMedian: quantile(
      cases.map((c) => c.metadata.parseMs),
      0.5,
    ),
    constructionMsMedian: quantile(
      cases.map((c) => c.metadata.constructionMs),
      0.5,
    ),
    pageJsHeapReadyMbMedian: quantile(
      cases.map((c) => metric(c.memoryBefore, "JSHeapUsedSize") / 1048576),
      0.5,
    ),
    pageJsHeapDeltaMbMedian: quantile(
      cases.map(
        (c) =>
          (metric(c.memoryAfter, "JSHeapUsedSize") -
            metric(c.memoryBefore, "JSHeapUsedSize")) /
          1048576,
      ),
      0.5,
    ),
    geometries: c.actions[0].renderer.geometries,
    textures: c.actions[0].renderer.textures,
    gpu: c.metadata.gpu,
    gpuTimerAvailable: c.metadata.gpuTimerAvailable,
    errors: cases.flatMap((c) => c.errors),
    actions,
  });
}
await writeFile(
  directory + "/summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
await writeFile(directory + "/raw.json.gz", gzipSync(raw));
const header =
  "viewport,count,variant,action,fps_median,frame_ms_p50,frame_ms_p95,model_draws,total_gl_draws,submitted_model_triangles,model_cpu_submit_ms,ready_ms,page_js_heap_mb\n";
const csv = summary.cases
  .flatMap((c) =>
    Object.entries(c.actions).map(([kind, a]) =>
      [
        c.viewport.name,
        c.count,
        c.variant,
        kind,
        a.effectiveFpsMedian,
        a.frameMsMedian,
        a.frameMsP95,
        a.modelDrawsMean,
        a.totalGlDrawsMean,
        a.submittedModelTrianglesMean,
        a.modelCpuSubmitMsMean,
        c.readyMsMedian,
        c.pageJsHeapReadyMbMedian,
      ].join(","),
    ),
  )
  .join("\n");
await writeFile(directory + "/metrics.csv", header + csv + "\n");
console.log(
  `${data.cases.length} measured runs; ${summary.cases.length} grouped scenarios`,
);
