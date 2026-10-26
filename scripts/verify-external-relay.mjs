// Controlled Preview transport check; never reads browser cookies or public corpus.
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const config = parse(await fs.readFile("wrangler.jsonc", "utf8"));
const target = assertPreviewTarget(config, account);
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const endpoint =
  "https://api.cloudflare.com/client/v4/accounts/" +
  account +
  "/d1/database/" +
  target.databaseId +
  "/query";
const costs = [];
let jobId;
const db = {
  prepare(sql) {
    let params = [];
    const statement = {
      bind(...p) {
        params = p;
        return statement;
      },
      async all() {
        const rows = await previewCloudflareJson(endpoint, token, {
          sql,
          params,
        });
        const r = rows[0];
        if (!r?.success) throw Error("Relay SQL failed");
        costs.push({
          rowsRead: r.meta?.rows_read || 0,
          rowsWritten: r.meta?.rows_written || 0,
        });
        if (sql.startsWith("INSERT INTO agent_external_search_jobs"))
          jobId = params[0];
        return r;
      },
      async run() {
        return statement.all();
      },
    };
    return statement;
  },
};
const outfile = path.resolve(
  "services/external-search/runtime/verify-relay.mjs",
);
await build({
  entryPoints: ["src/lib/server/external-search/relay.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { createDbRelay } = await import(pathToFileURL(outfile).href);
const kind = process.argv[2] === "xiaohongshu" ? "xiaohongshu" : "web";
const input = {
  kind,
  query: kind === "web" ? "广外 图书馆 借阅规则" : "广外大学城食堂推荐",
  limit: 2,
  policy: {
    intent: kind === "web" ? "official" : "experience",
    officialOnly: kind === "web",
    campus: true,
  },
  onlyXhs: false,
};
const result = await createDbRelay(db, "acceptance:" + crypto.randomUUID())(
  input,
  AbortSignal.timeout(30000),
);
const report = {
  at: new Date().toISOString(),
  preview: true,
  transport: "outbound-https-d1-relay",
  jobId,
  input,
  result,
  costs,
};
await fs.mkdir("docs/verification/external-search/xhs-logged-in", {
  recursive: true,
});
await fs.writeFile(
  "docs/verification/external-search/xhs-logged-in/relay-" + kind + ".json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    kind,
    status: result.status,
    count: result.items.length,
    durationMs: result.durationMs,
    relayUsage: result.relayUsage,
  }),
);
if (result.status !== "ok" || !result.items.length) process.exitCode = 1;
