import { spawnSync } from "node:child_process";
const result = spawnSync("python", ["scripts/verify_database.py"], {
  stdio: "inherit",
});
if (result.error) {
  console.error("需要可用的 Python 3（使用 python 命令）。");
  process.exit(1);
}
process.exit(result.status ?? 1);
