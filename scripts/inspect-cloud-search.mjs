import fs from "node:fs/promises";
const secret = JSON.parse(
  await fs.readFile(".map-tools/cloud-search/secrets.json", "utf8"),
);
const action = process.argv[2] || "status";
if (
  ![
    "status",
    "login",
    "poll",
    "search",
    "web",
    "restart",
    "source-probe",
    "managed-probe",
    "managed-restart",
    "verify",
  ].includes(action)
)
  throw Error("Unknown diagnostic action");
const route = [
  "restart",
  "source-probe",
  "managed-probe",
  "managed-restart",
].includes(action)
  ? "/maintenance/" + action
  : ["search", "web"].includes(action)
    ? "/v1/search"
    : "/v1/session/" + action;
const input = ["search", "web"].includes(action)
  ? {
      kind: action === "web" ? "web" : "xiaohongshu",
      query: process.argv[3] || "广外 南校 一饭",
      limit: 2,
      policy: {
        intent: action === "web" ? "official" : "experience",
        officialOnly: action === "web",
        campus: true,
      },
      onlyXhs: false,
    }
  : {};
const start = performance.now();
const response = await fetch(
  "https://campusos-preview-cloud-search.zhujunkui1.workers.dev" + route,
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + secret.SERVICE_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(90000),
  },
);
let data = {};
try {
  data = await response.json();
} catch {}
if (data.qr) {
  await fs.writeFile(
    "services/external-search/runtime/cloud-login.png",
    Buffer.from(data.qr.split(",")[1], "base64"),
  );
  data = { ...data, qr: "[private QR saved locally]" };
}
if (data.url) {
  await fs.writeFile(
    "services/external-search/runtime/cloud-verification.json",
    JSON.stringify(data),
  );
  data = { ...data, url: "[private verification URL saved locally]" };
}
const out = {
  at: new Date().toISOString(),
  httpStatus: response.status,
  implementation: response.headers.get("X-Source-Implementation"),
  elapsedMs: Math.round(performance.now() - start),
  ...data,
};
await fs.writeFile(
  "docs/verification/cloud-search/" + action + ".json",
  JSON.stringify(out, null, 2),
);
console.log(
  JSON.stringify({
    ...out,
    items: data.items?.map((i) => ({
      title: i.title,
      url: i.originalUrl,
      body: i.evidenceKind,
    })),
  }),
);
