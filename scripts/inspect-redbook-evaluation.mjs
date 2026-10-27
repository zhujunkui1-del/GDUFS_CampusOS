import fs from "node:fs/promises";
import { publicEvaluationReceipt } from "./evaluate-redbook.mjs";
const secret = JSON.parse(
  await fs.readFile(
    ".map-tools/xhs-provider-eval/cloud-eval-secrets.json",
    "utf8",
  ),
);
const action = process.argv[2] || "probe";
if (!["probe", "restart", "unauthorized"].includes(action))
  throw Error("Evaluation action");
const query = process.argv[3] || "广外 南校 一饭";
const before = performance.now();
const r = await fetch(
  "https://campusos-xhs-redbook-eval.zhujunkui1.workers.dev/" +
    (action === "restart" ? "restart" : "probe"),
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(action === "unauthorized"
        ? {}
        : { Authorization: "Bearer " + secret.SERVICE_TOKEN }),
    },
    body: JSON.stringify({ query, platform: "xhs" }),
    signal: AbortSignal.timeout(120000),
  },
);
const data = await r.json();
if (data.sessionDigest) {
  const expected = (
    await fs.readFile(
      ".map-tools/xhs-provider-eval/evaluation-session-sha256.txt",
      "utf8",
    )
  ).trim();
  data.sameSessionSnapshot = data.sessionDigest === expected;
  delete data.sessionDigest;
}
const out = {
  checkedAt: new Date().toISOString(),
  httpStatus: r.status,
  elapsedMs: Math.round(performance.now() - before),
  ...data,
};
const file = process.argv[4] || (action === "probe" ? "cloud-probe" : action);
if (!/^[a-z0-9-]{1,60}$/.test(file)) throw Error("Receipt filename");
await fs.writeFile(
  "docs/verification/redbook-evaluation-2026-10-27/authenticated/" +
    file +
    ".json",
  JSON.stringify(publicEvaluationReceipt(out), null, 2),
);
await fs.writeFile(
  ".map-tools/xhs-provider-eval/" + file + "-raw.json",
  JSON.stringify(out, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify(
    {
      ...out,
      items: out.items?.map((i) => ({
        title: i.title,
        bodyAvailable: i.bodyAvailable,
      })),
    },
    null,
    2,
  ),
);
