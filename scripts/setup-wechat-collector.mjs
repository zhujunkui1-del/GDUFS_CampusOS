// Creates a source-scoped credential using the normal administrator API.
// No token is printed or committed; --apply is required for writes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";
import { resolve, join } from "node:path";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
const base = "https://campusos-preview.zhujunkui1.workers.dev";
const toolsFlag = process.argv.indexOf("--tools-directory");
const toolsDirectory = resolve(
  toolsFlag >= 0 ? process.argv[toolsFlag + 1] : "D:/WeChat MP Tools_v2.3.1",
);
const directory = join(toolsDirectory, "data", "CampusOS_collector");
const configPath = directory + "/config.json";
let existingTokenId = null;
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
        "issue a revocable permanent credential scoped to the existing collector registry",
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
    const registry = (await r.json()).data;
    if (
      process.argv.includes("--make-permanent") ||
      !registry.accountDiscoveryEnabled
    ) {
      existingTokenId =
        registry.connectionId ||
        (existsSync(directory + "/credential-receipt.json")
          ? JSON.parse(
              readFileSync(directory + "/credential-receipt.json", "utf8"),
            ).id
          : null);
      if (!existingTokenId) throw Error("EXISTING_CONNECTION_ID_UNAVAILABLE");
    } else {
      console.log(
        JSON.stringify({
          configured: true,
          reusedCredential: true,
          configPath,
          sources: registry.sources.length,
        }),
      );
      process.exit(0);
    }
  } else {
    throw Error("EXISTING_CREDENTIAL_REQUIRES_EXPLICIT_ROTATION");
  }
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
  if (!sourceIds.length) throw Error("NO_REGISTRY_SOURCES");
  if (existingTokenId) {
    await call("/connection", {
      tokenId: existingTokenId,
      permanent: true,
      autoDiscoverSources: true,
    });
    const receiptPath = directory + "/credential-receipt.json";
    const receipt = existsSync(receiptPath)
      ? JSON.parse(readFileSync(receiptPath, "utf8"))
      : {
          id: existingTokenId,
          issuedAt:
            overview.tokens.find((t) => t.id === existingTokenId)?.created_at ||
            null,
        };
    writeFileSync(
      receiptPath,
      JSON.stringify(
        {
          ...receipt,
          validityDays: null,
          permanent: true,
          autoDiscoverSources: true,
          sourceCount: sourceIds.length,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        configured: true,
        permanent: true,
        sourceCount: sourceIds.length,
        credentialPrinted: false,
      }),
    );
  } else {
    const credential = await call("/credentials", {
      label: "CampusOS 本地阅读HTML同步",
      sourceIds,
      validityDays: 90,
      permanent: true,
    });
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          campusosOrigin: base,
          token: credential.token,
          dataDirectory: directory,
          exportDirectories: [join(toolsDirectory, "data", "articles_full")],
          maxUploadsPerCycle: 20,
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
          validityDays: null,
          permanent: true,
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
  }
} finally {
  await fetch(base + "/api/console-auth", { method: "DELETE", headers });
}
