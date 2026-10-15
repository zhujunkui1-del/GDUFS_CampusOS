import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { publicWorkerEnvironment } from "./worker-env.mjs";

const result = spawnSync(
  process.execPath,
  [
    "node_modules/@opennextjs/cloudflare/dist/cli/index.js",
    "build",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
const file = ".open-next/cloudflare/next-env.mjs";
const { content, privateValues } = publicWorkerEnvironment(
  readFileSync(file, "utf8"),
);
writeFileSync(file, content);
let scanned = 0;
for (const relative of readdirSync(".open-next", { recursive: true })) {
  const path = join(".open-next", relative);
  if (!statSync(path).isFile()) continue;
  scanned++;
  const bytes = readFileSync(path);
  if (privateValues.some((value) => bytes.includes(Buffer.from(value)))) {
    console.error(
      "Worker build rejected: private environment value found in generated output.",
    );
    process.exit(1);
  }
}
console.log(
  `Worker environment sanitized; ${scanned} generated files checked. Server credentials require runtime bindings.`,
);
