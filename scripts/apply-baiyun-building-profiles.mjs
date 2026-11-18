// Reviewed public building descriptions; fills empty fields and preserves edits.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
const source = JSON.parse(
  readFileSync("docs/research/baiyun/building-profiles-reviewed.json", "utf8"),
);
const places = JSON.parse(
  readFileSync("src/features/campus-map/data/baiyun-map.json", "utf8"),
).places;
const credits = JSON.parse(
  readFileSync(
    "src/features/campus-map/data/building-photo-credits.json",
    "utf8",
  ),
);
const records = source.records.map((r) => ({
  ...r,
  photos: r.name === "北校区图书馆" ? Object.keys(credits) : r.photos,
}));
for (const record of records)
  if (
    !places.some((p) => p.id === record.id && p.name === record.name) ||
    !record.sources.length
  )
    throw Error("Unreviewed building profile");
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const dir = ".map-tools/baiyun-building-research-20261118";
mkdirSync(dir, { recursive: true });
const values = records
  .map(
    (r) =>
      `(${quote(r.id)},${quote(r.description)},${quote(JSON.stringify(r.photos))},strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
  .join(",\n");
const sql = `INSERT INTO building_profiles(place_id,description,photos_json,updated_at) VALUES ${values}
ON CONFLICT(place_id) DO UPDATE SET
description=CASE WHEN length(trim(building_profiles.description))=0 THEN excluded.description ELSE building_profiles.description END,
photos_json=CASE WHEN json_array_length(building_profiles.photos_json)=0 THEN excluded.photos_json ELSE building_profiles.photos_json END,
updated_at=CASE WHEN length(trim(building_profiles.description))=0 OR (json_array_length(building_profiles.photos_json)=0 AND json_array_length(excluded.photos_json)>0) THEN excluded.updated_at ELSE building_profiles.updated_at END;
INSERT INTO console_audit_logs(id,actor_id,actor_label,action,target_type,target_id) VALUES(${quote(crypto.randomUUID())},'owner-authorized-maintenance','负责人授权建筑资料补全','building.research_fill','building','baiyun-20261118');`;
writeFileSync(dir + "/apply.sql", sql);
writeFileSync(dir + "/reviewed.json", JSON.stringify(records, null, 2));
console.log(
  JSON.stringify({
    profiles: records.length,
    photos: records.reduce((n, r) => n + r.photos.length, 0),
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
  }),
);
if (!process.argv.includes("--apply")) process.exit(0);
assertPreviewTarget(
  parse(readFileSync("wrangler.jsonc", "utf8")),
  process.env.CLOUDFLARE_ACCOUNT_ID,
);
const args = [
  "node_modules/wrangler/bin/wrangler.js",
  "d1",
  "execute",
  "campusos-preview",
  "--env",
  "preview",
  "--remote",
];
const backup = spawnSync(
  process.execPath,
  [
    ...args,
    "--command",
    `SELECT * FROM building_profiles WHERE place_id IN (${records.map((r) => quote(r.id)).join(",")})`,
    "--json",
  ],
  { encoding: "utf8" },
);
if (backup.status) throw Error("Building backup failed");
writeFileSync(dir + "/before.json", backup.stdout);
const result = spawnSync(
  process.execPath,
  [...args, "--file", dir + "/apply.sql", "--json"],
  { encoding: "utf8" },
);
writeFileSync(dir + "/result.json", result.stdout);
if (result.status) {
  console.error(result.stderr);
  process.exit(result.status || 1);
}
console.log("Reviewed profiles applied; existing non-empty fields preserved.");
const after = spawnSync(
  process.execPath,
  [
    ...args,
    "--command",
    `SELECT * FROM building_profiles WHERE place_id IN (${records.map((r) => quote(r.id)).join(",")})`,
    "--json",
  ],
  { encoding: "utf8" },
);
if (after.status) throw Error("Profile readback failed");
writeFileSync(dir + "/after.json", after.stdout);
