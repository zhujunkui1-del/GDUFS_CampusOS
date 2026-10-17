// Read-only existing Worker analytics; aggregated values are not per-API samples.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(parse(readFileSync("wrangler.jsonc", "utf8")), account);
const output = execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
  { token } = JSON.parse(output.slice(output.indexOf("{")));
const start = process.argv[2],
  end = new Date().toISOString();
const outputDirectory = process.argv[3] || "docs/verification/s3-b";
if (!/^docs\/verification\/[\w/-]+$/.test(outputDirectory))
  throw Error("Invalid report directory");
if (
  !start ||
  !Number.isFinite(Date.parse(start)) ||
  Date.parse(end) - Date.parse(start) > 3600000 ||
  Date.parse(start) > Date.parse(end)
)
  throw Error("Specify a past start within one hour");
const gql = (query) =>
  previewCloudflareJson("https://api.cloudflare.com/client/v4/graphql", token, {
    query,
  });
let report;
try {
  const schema = await gql(
    'query MetricDescriptions { __type(name:"AccountWorkersInvocationsAdaptiveQuantiles") { fields { name description } } }',
  );
  const descriptions =
    schema.__type?.fields?.filter((x) =>
      /^(cpuTimeP50|cpuTimeP95|cpuTimeP99|wallTimeP50|wallTimeP95)$/.test(
        x.name,
      ),
    ) || [];
  const data = await gql(
    `query BoundedPreviewMetrics { viewer { accounts(filter:{accountTag:"${account}"}) { workersInvocationsAdaptive(limit:20,filter:{scriptName:"campusos-preview",datetime_geq:"${new Date(start).toISOString()}",datetime_leq:"${end}"}) { sum {requests errors subrequests} quantiles {cpuTimeP50 cpuTimeP95 cpuTimeP99 wallTimeP50 wallTimeP95} dimensions {status} } } } }`,
  );
  report = {
    recordedAt: end,
    start,
    end,
    actualCloudGraphQL: true,
    grouping:
      "Whole existing preview Worker, by invocation status; includes all routes/traffic in this window, not per-ingestion CPU.",
    sampled: true,
    fieldDescriptions: descriptions,
    groups: data.viewer.accounts[0]?.workersInvocationsAdaptive || [],
    longTermFreeCapacityVerified: false,
  };
} catch (error) {
  report = {
    recordedAt: end,
    start,
    end,
    actualCloudGraphQL: false,
    reason: error.message,
    perApiCpuVerified: false,
    longTermFreeCapacityVerified: false,
  };
}
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  outputDirectory + "/cloud-metrics.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
