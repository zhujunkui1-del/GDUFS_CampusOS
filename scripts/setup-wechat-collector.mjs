// Creates a source-scoped credential using the normal administrator API.
// No token is printed or committed; --apply is required for writes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
const base = "https://campusos-preview.zhujunkui1.workers.dev";
const directory = "D:/WeChat MP Tools/data/CampusOS_collector";
const configPath = directory + "/config.json";
assertPreviewTarget(
  parse(readFileSync("wrangler.jsonc", "utf8")),
  process.env.CLOUDFLARE_ACCOUNT_ID,
);
if (!process.argv.includes("--apply")) {
  console.log(
    JSON.stringify({
      mode: "plan",
      base,
      configPath,
      operation:
        "issue a 90-day credential scoped to the existing collector registry",
    }),
  );
  process.exit(0);
}
if (existsSync(configPath)) {
  const previous = JSON.parse(readFileSync(configPath, "utf8"));
  if (previous.campusosOrigin !== base) throw Error("EXISTING_ORIGIN_DIFFERS");
  const r = await fetch(base + "/api/collector/sources", {
    headers: { Authorization: "Bearer " + previous.token },
  });
  if (r.ok) {
    console.log(
      JSON.stringify({
        configured: true,
        reusedCredential: true,
        configPath,
        sources: (await r.json()).data.sources.length,
      }),
    );
    process.exit(0);
  }
  throw Error("EXISTING_CREDENTIAL_REQUIRES_EXPLICIT_ROTATION");
}
const secrets = JSON.parse(
  readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
);
const challenge = await fetch(base + "/api/console-auth").then((r) => r.json());
if (!challenge.ok) throw Error("AUTH_CHALLENGE_UNAVAILABLE");
const key =
  secrets.CONSOLE_AUTH_MODE === "admin_password"
    ? pbkdf2Sync(
        readFileSync("CampusOS_Codex_完整设计文档_v2/key.md", "utf8")
          .replace(/^\uFEFF/, "")
          .trim(),
        Buffer.from(challenge.data.credentialDerivation.salt, "hex"),
        600000,
        32,
        "sha256",
      ).toString("hex")
    : secrets.CONSOLE_ADMIN_ACCESS_KEY;
const response = await fetch(base + "/api/console-auth", {
  method: "POST",
  headers: { Origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({ key }),
});
const auth = await response.json();
if (!response.ok || !auth.ok)
  throw Error("ADMIN_AUTH_FAILED:" + auth.error?.code);
const cookie = response.headers.get("set-cookie")?.split(";")[0];
const headers = {
  Origin: base,
  Cookie: cookie,
  "X-Console-CSRF": auth.data.csrf,
  "Content-Type": "application/json",
};
async function call(path, body) {
  const r = await fetch(base + "/api/admin/collector" + path, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const b = await r.json();
  if (!r.ok || !b.ok) throw Error("COLLECTOR_CONFIG_FAILED:" + b.error?.code);
  return b.data;
}
try {
  const overview = await call("");
  const sourceIds = overview.sources.map((s) => s.source_id);
  if (sourceIds.length !== 78) throw Error("EXPECTED_78_REGISTRY_SOURCES");
  const credential = await call("/credentials", {
    label: "CampusOS 本地阅读HTML同步",
    sourceIds,
    validityDays: 90,
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        campusosOrigin: base,
        token: credential.token,
        dataDirectory: directory,
        exportDirectories: ["D:/WeChat MP Tools/data/articles_full"],
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(
    directory + "/credential-receipt.json",
    JSON.stringify(
      {
        id: credential.id,
        issuedAt: new Date().toISOString(),
        validityDays: 90,
        sourceCount: sourceIds.length,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      configured: true,
      credentialPrinted: false,
      sources: sourceIds.length,
      configPath,
    }),
  );
} finally {
  await fetch(base + "/api/console-auth", { method: "DELETE", headers });
}
