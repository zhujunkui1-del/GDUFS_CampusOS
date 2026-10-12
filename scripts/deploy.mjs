import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "comment-json";

const environment = process.argv[2];
if (!["preview", "production"].includes(environment)) {
  console.error("请选择 preview 或 production。");
  process.exit(1);
}
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
const database = config.env[environment].d1_databases[0];
if (
  !process.env.CLOUDFLARE_ACCOUNT_ID ||
  database.database_id === "00000000-0000-0000-0000-000000000000"
) {
  console.error(
    "部署尚未配置：需要 CLOUDFLARE_ACCOUNT_ID 和该环境真实的 D1 database_id。请先按 docs/DEPLOYMENT.md 配置账户、数据库和域名。",
  );
  process.exit(1);
}
const cli = "node_modules/@opennextjs/cloudflare/dist/cli/index.js";
for (const action of ["build", "deploy"]) {
  const result = spawnSync(
    process.execPath,
    [cli, action, "--env", environment],
    { stdio: "inherit", env: process.env },
  );
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
