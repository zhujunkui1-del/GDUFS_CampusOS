// Read-only: no DNS, route, WAF, Worker or database mutations.
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import { previewCloudflareJson } from "./preview-network.mjs";
const directory = "docs/verification/map-stability-2026-11-04";
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(".map-tools/map-stability", { recursive: true });
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const token = JSON.parse(auth.slice(auth.indexOf("{"))).token;
const base =
  "https://api.cloudflare.com/client/v4/accounts/5328fbf5ef7ef40f7743723c2c192499";
const [domains, settings, deployments] = await Promise.all([
  previewCloudflareJson(base + "/workers/domains", token),
  previewCloudflareJson(
    base + "/workers/scripts/campusos-preview/settings",
    token,
  ),
  previewCloudflareJson(
    base + "/workers/scripts/campusos-preview/deployments",
    token,
  ),
]);
const result = {
  at: new Date().toISOString(),
  network:
    "This workstation only; proxy route if configured. No China Mobile/Unicom/Telecom/campus/mobile-network claim.",
  domains: domains
    .filter((d) => d.hostname === "gdufs.ccwu.cc")
    .map(({ hostname, service, environment }) => ({
      hostname,
      service,
      environment,
    })),
  databaseBindings: settings.bindings
    ?.filter((b) => b.type === "d1")
    .map(({ name, id }) => ({ name, id })),
  deployments: deployments.deployments
    ?.slice(0, 2)
    .map(({ id, created_on, versions }) => ({ id, created_on, versions })),
  dns: [],
  requests: [],
};
for (const hostname of [
  "gdufs.ccwu.cc",
  "campusos-preview.zhujunkui1.workers.dev",
]) {
  try {
    result.dns.push({
      hostname,
      addresses: await Promise.race([
        dns.lookup(hostname, { all: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("DNS timeout")), 5000),
        ),
      ]),
    });
  } catch {
    result.dns.push({ hostname, error: "DNS lookup unavailable" });
  }
}
const catalog = JSON.parse(
  await fs.readFile(
    "src/features/campus-map/data/building-model-catalog.json",
    "utf8",
  ),
);
const manifest = JSON.parse(
  await fs.readFile(
    "src/features/campus-map/data/local-map-manifest.json",
    "utf8",
  ),
);
for (const origin of [
  "https://gdufs.ccwu.cc",
  "https://campusos-preview.zhujunkui1.workers.dev",
]) {
  for (const path of [
    "/map",
    "/map",
    "/radar",
    manifest.url,
    "/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs",
    catalog.entries[0].assets["3d"].url,
  ]) {
    const headerPath = ".map-tools/map-stability/headers.txt";
    const args = [
      "--silent",
      "--show-error",
      "--compressed",
      "--max-time",
      "20",
      "--connect-timeout",
      "8",
      "--output",
      "NUL",
      "--dump-header",
      headerPath,
      "--write-out",
      "%{json}",
      origin + path,
    ];
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.HTTPS_PROXY || ""))
      args.push("--proxy", process.env.HTTPS_PROXY);
    try {
      const metrics = JSON.parse(
        execFileSync("curl.exe", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      const raw = await fs.readFile(headerPath, "utf8");
      const headers = Object.fromEntries(
        [
          ...raw.matchAll(
            /^(cache-control|content-type|content-encoding|etag|cf-cache-status|cf-ray|content-length):\s*(.*)$/gim,
          ),
        ].map((m) => [m[1].toLowerCase(), m[2].trim()]),
      );
      result.requests.push({
        origin,
        path,
        status: metrics.http_code,
        dnsMs: metrics.time_namelookup * 1000,
        tlsMs:
          Math.max(0, metrics.time_appconnect - metrics.time_connect) * 1000,
        ttfbMs: metrics.time_starttransfer * 1000,
        totalMs: metrics.time_total * 1000,
        transferredBytes: metrics.size_download,
        headers,
      });
    } catch {
      result.requests.push({
        origin,
        path,
        error: "Network request failed or timed out; no upstream body logged",
      });
    }
    await fs.writeFile(
      directory + "/network-baseline.json",
      JSON.stringify(result, null, 2),
    );
  }
}
console.log({
  domains: result.domains,
  databaseBindings: result.databaseBindings,
  requests: result.requests.length,
  failed: result.requests.filter((r) => r.error || r.status >= 400).length,
});
