// Explicit preview-only operator setup. Never prints keys or copies credentials
// from another application. Re-running preserves the existing key.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { parse } from "comment-json";
import { z } from "zod";
import { assertPreviewTarget } from "./preview-config.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(parse(readFileSync("wrangler.jsonc", "utf8")), account);
const email = z
  .email()
  .toLowerCase()
  .parse(process.env.CONSOLE_BOOTSTRAP_EMAIL);
const path = ".map-tools/s3-a/preview-secrets.json";
mkdirSync(".map-tools/s3-a", { recursive: true });
let values;
if (existsSync(path)) values = JSON.parse(readFileSync(path, "utf8"));
else {
  values = {
    CONSOLE_AUTH_MODE: "admin_key",
    CONSOLE_ADMIN_EMAILS: email,
    CONSOLE_ORIGIN: "https://campusos-preview.zhujunkui1.workers.dev",
    CONSOLE_ADMIN_ACCESS_KEY: randomBytes(48).toString("base64url"),
    CONSOLE_SESSION_SECRET: randomBytes(48).toString("base64url"),
  };
  writeFileSync(path, JSON.stringify(values, null, 2) + "\n", { mode: 0o600 });
}
if (
  values.CONSOLE_AUTH_MODE !== "admin_key" ||
  values.CONSOLE_ADMIN_EMAILS !== email ||
  values.CONSOLE_ORIGIN !== "https://campusos-preview.zhujunkui1.workers.dev" ||
  values.CONSOLE_ADMIN_ACCESS_KEY?.length < 48 ||
  values.CONSOLE_SESSION_SECRET?.length < 48
)
  throw Error(
    "Existing preview Console configuration conflicts; no credentials changed",
  );
for (const other of [
  ".map-tools/s3-a/local-secrets.json",
  ".map-tools/s2-e/runtime-secrets.json",
])
  if (existsSync(other))
    for (const value of Object.values(JSON.parse(readFileSync(other, "utf8"))))
      if (
        value === values.CONSOLE_SESSION_SECRET ||
        value === values.CONSOLE_ADMIN_ACCESS_KEY
      )
        throw Error("Independent Console credentials are required");
if (process.argv.includes("--apply")) {
  const who = JSON.parse(
    execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", "whoami", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  if (!who.loggedIn || !who.accounts?.some((a) => a.id === account))
    throw Error("Preview account mismatch");
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "secret",
      "bulk",
      path,
      "--config",
      "wrangler.jsonc",
      "--env",
      "preview",
    ],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0)
    throw Error("Console preview Secret update failed; raw output withheld");
}
writeFileSync(
  ".map-tools/s3-a/admin-access-key.txt",
  values.CONSOLE_ADMIN_ACCESS_KEY + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    target: "campusos-preview",
    mode: "admin_key",
    secretNames: Object.keys(values),
    applied: process.argv.includes("--apply"),
    credentialFile: path,
    valuesPrinted: false,
    accessActivatedByThisTool: false,
    emailOwnershipVerified: false,
  }),
);
