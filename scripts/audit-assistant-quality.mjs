import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { previewCloudflareJson } from "./preview-network.mjs";
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const token = JSON.parse(auth.slice(auth.indexOf("{"))).token;
const url =
  "https://api.cloudflare.com/client/v4/accounts/5328fbf5ef7ef40f7743723c2c192499/d1/database/18299abc-b38b-4494-8d12-8ab4d482c304/query";
const corpus = JSON.parse(
  await fs.readFile(
    "docs/verification/assistant-quality-2026-11-03/public-corpus.json",
    "utf8",
  ),
);
const ids = [11, 28, 29].map((i) => corpus[i].id);
const results = await previewCloudflareJson(url, token, {
  sql: `SELECT d.id,d.title,d.content_revision,d.input_hash,d.body_status,d.rights_scope,r.content_revision AS indexed_revision,r.input_hash AS indexed_hash,r.chunk_count,r.evidence_type,r.status,r.text_hash FROM console_public_documents p JOIN knowledge_documents d ON d.id=p.id LEFT JOIN article_search_documents r ON r.document_id=d.id WHERE d.id IN(?,?,?) OR instr(d.title,'三下乡')>0 OR instr(d.title,'全运会')>0 LIMIT 40`,
  params: ids,
});
await fs.writeFile(
  "docs/verification/assistant-quality-2026-11-03/public-index-audit.json",
  JSON.stringify(results, null, 2),
);
console.log(
  JSON.stringify(
    results[0].results.map(
      ({
        id,
        title,
        body_status,
        rights_scope,
        content_revision,
        indexed_revision,
        chunk_count,
      }) => ({
        id,
        title,
        body_status,
        rights_scope,
        content_revision,
        indexed_revision,
        chunk_count,
      }),
    ),
    null,
    2,
  ),
);
const policies = await previewCloudflareJson(url, token, {
  sql: `SELECT d.id,s.id AS source_id,s.manual_policy_version,s.manual_rights_scope,s.manual_policy_expires_at_ms,p.rights_scope,p.expires_at_ms FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE d.id IN(?,?,?)`,
  params: ids,
});
await fs.writeFile(
  "docs/verification/assistant-quality-2026-11-03/public-policy-audit.json",
  JSON.stringify(policies, null, 2),
);
console.log(JSON.stringify(policies[0].results, null, 2));
