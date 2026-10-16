// Read-only, explicitly isolated preview audit. Never logs auth tokens or content.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { parse } from "comment-json";
import { assertPreviewTarget } from "../../scripts/preview-config.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
const target = assertPreviewTarget(config, account),
  id = config.env.preview.d1_databases[0].database_id;
const cli = (...args) => {
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        ["node_modules/wrangler/bin/wrangler.js", ...args, "--json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  } catch {
    throw Error(
      "Cloudflare authentication inspection failed; raw output withheld",
    );
  }
};
const who = cli("whoami");
if (!who.loggedIn || !who.accounts?.some((a) => a.id === account))
  throw Error("Authenticated account does not match explicit preview target");
const auth = cli("auth", "token");
if (!auth.token) throw Error("Cloudflare authentication unavailable");
async function cf(path, body) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    },
  );
  const j = await r.json();
  if (!r.ok || !j.success)
    throw Error(`Preview audit failed: HTTP ${r.status}`);
  return j.result;
}
const database = await cf(`/d1/database/${id}`);
if (database.name !== "campusos-preview" || database.uuid !== id)
  throw Error("Preview database mismatch");
async function sql(sql, params = []) {
  return (await cf(`/d1/database/${id}/query`, { sql, params }))[0].results;
}
const after = process.argv.includes("--after");
const migrations = await sql("SELECT name FROM d1_migrations ORDER BY id");
const counts = (
  await sql(
    "SELECT (SELECT count(*) FROM conversations) AS conversations,(SELECT count(*) FROM conversation_messages) AS messages,(SELECT count(*) FROM agent_runs) AS runs,(SELECT count(*) FROM assistant_route_refs) AS routes",
  )
)[0];
const fk = await sql("PRAGMA foreign_key_check");
const columns = await sql("PRAGMA table_info(conversations)");
const result = {
  recordedAt: new Date().toISOString(),
  previewTarget: {
    worker: target.worker,
    database: database.name,
    databaseId: id,
  },
  accountVerified: true,
  migrations: migrations.map((r) => r.name),
  counts,
  foreignKeyViolations: fk.length,
  hasTitle: columns.some((c) => c.name === "title"),
  hasDeletionMarker: columns.some((c) => c.name === "deleted_at_ms"),
  readOnly: true,
};
if (after) {
  const before = JSON.parse(
    readFileSync("docs/verification/conversations/preview-before.json", "utf8"),
  );
  result.contentCountsUnchangedByMigration =
    JSON.stringify(before.counts) === JSON.stringify(counts);
  result.routeAssociationRows = (
    await sql("SELECT count(*) AS n FROM assistant_conversation_routes")
  )[0].n;
}
if (process.argv.includes("--deleted-tests")) {
  result.deletedTestConversations = [];
  for (const file of readdirSync(
    "docs/verification/conversations/cloud-live",
  ).filter((f) => f.endsWith("-live.json"))) {
    const data = JSON.parse(
      readFileSync(
        "docs/verification/conversations/cloud-live/" + file,
        "utf8",
      ),
    );
    for (const conversationId of data.conversations) {
      if (!/^[0-9a-f-]{36}$/.test(conversationId))
        throw Error("Invalid controlled test identifier");
      const stats = (
        await sql(
          "SELECT c.deleted_at_ms IS NOT NULL AS deleted,(SELECT count(*) FROM conversation_messages m WHERE m.conversation_id=c.id) AS messages,(SELECT count(*) FROM assistant_actions a WHERE a.conversation_id=c.id) AS actions,(SELECT count(*) FROM assistant_conversation_routes cr WHERE cr.conversation_id=c.id) AS routeLinks,(SELECT count(*) FROM agent_runs r WHERE r.conversation_id=c.id) AS quotaRuns,(SELECT sum(charged_tokens) FROM agent_runs r WHERE r.conversation_id=c.id) AS chargedTokens FROM conversations c WHERE c.id=?",
          [conversationId],
        )
      )[0];
      if (
        !stats?.deleted ||
        stats.messages ||
        stats.actions ||
        stats.routeLinks ||
        !stats.quotaRuns ||
        !stats.chargedTokens
      )
        throw Error("Cloud deletion/quota invariant failed");
      result.deletedTestConversations.push({ test: file, ...stats });
    }
  }
}
const dir = "docs/verification/conversations";
mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir}/preview-${process.argv.includes("--deleted-tests") ? "deletion-audit" : after ? "after" : "before"}.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
