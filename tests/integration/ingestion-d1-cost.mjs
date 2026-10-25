import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const directory = path.resolve(
  "test-results/ingestion-cost-" + crypto.randomUUID(),
);
await fs.mkdir(directory, { recursive: true });
const originalFiles = new Set([
  "src/lib/server/console/ingestion-store.ts",
  "src/lib/server/console/v2-sync.ts",
  "src/lib/server/console/v2-automation.ts",
  "src/lib/server/console/store.ts",
]);
const baselineRef = "9794d9e";
const bundles = {};
for (const version of ["before", "after"]) {
  const outfile = path.join(directory, version + ".mjs");
  await build({
    entryPoints: ["tests/fixtures/ingestion-cost.ts"],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins:
      version === "before"
        ? [
            {
              name: "baseline-from-git",
              setup(builder) {
                builder.onLoad({ filter: /\.ts$/ }, (args) => {
                  const relative = path
                    .relative(process.cwd(), args.path)
                    .replaceAll("\\", "/");
                  if (originalFiles.has(relative))
                    return {
                      contents: execFileSync(
                        "git",
                        ["show", baselineRef + ":" + relative],
                        { encoding: "utf8" },
                      ),
                      loader: "ts",
                    };
                });
              },
            },
          ]
        : [],
  });
  bundles[version] = await import(pathToFileURL(outfile).href);
}

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default {fetch(){return new Response('isolated fixture')}}",
    compatibilityDate: "2026-10-12",
    d1Databases: { BEFORE: "ingestion-before", AFTER: "ingestion-after" },
  }),
);

function splitSql(text) {
  const result = [];
  let buffer = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("--")) continue;
    buffer += line + "\n";
    if (
      line.trim().endsWith(";") &&
      (!/^CREATE TRIGGER/i.test(buffer.trim()) ||
        line.trim() === "END;" ||
        /^BEGIN\b.*\bEND;$/.test(line.trim()))
    ) {
      result.push(buffer);
      buffer = "";
    }
  }
  assert.equal(buffer.trim(), "");
  return result;
}
function measured(db) {
  const costs = [];
  const record = (sql, r) => {
    costs.push({ sql, read: r.meta.rows_read, written: r.meta.rows_written });
    return r;
  };
  const wrap = (sql, raw) => ({
    bind(...values) {
      return wrap(sql, raw.bind(...values));
    },
    raw,
    sql,
    async all() {
      return record(sql, await raw.all());
    },
    async first() {
      return (await this.all()).results[0] || null;
    },
    async run() {
      return record(sql, await raw.run());
    },
  });
  return {
    costs,
    db: {
      prepare(sql) {
        return wrap(sql, db.prepare(sql));
      },
      async batch(statements) {
        const values = await db.batch(statements.map((s) => s.raw));
        values.forEach((r, i) => record(statements[i].sql, r));
        return values;
      },
    },
  };
}
async function seed(db, sourceId) {
  const triggers = (
    await db
      .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
      .all()
  ).results;
  // Fixture population alone bypasses business triggers; all are restored before
  // measuring the real store. Foreign keys remain enabled throughout.
  await db.batch(triggers.map((t) => db.prepare(`DROP TRIGGER "${t.name}"`)));
  await db
    .prepare(
      "INSERT INTO ingestion_jobs(id,source_id,status,phase) VALUES('historical-job',?,'completed','complete')",
    )
    .bind(sourceId)
    .run();
  for (let start = 0; start < 1000; start += 50) {
    const statements = [];
    for (let i = start; i < start + 50; i++) {
      const id = "history-" + i,
        url = "https://fixture.invalid/" + i,
        hash = i.toString(16).padStart(64, "0");
      statements.push(
        db
          .prepare(
            "INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash) VALUES(?,?,?,?,'Fixture body',?,'2026-10-25','all','campus_announcements','2026-10-25',1,?)",
          )
          .bind(id, sourceId, "Old fixture " + i, url, hash, hash),
        db
          .prepare(
            "INSERT INTO console_content_versions(document_id,version,snapshot_json,content_revision,input_hash,created_at) VALUES(?,1,'{}',1,?,'2026-10-25')",
          )
          .bind(id, hash),
        db
          .prepare(
            "INSERT INTO document_origins(id,source_id,document_id,canonical_url,entry_url,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,'2026-10-25','2026-10-25')",
          )
          .bind(id, sourceId, id, url, "https://fixture.invalid/list"),
        db
          .prepare(
            "INSERT INTO console_document_controls(document_id,last_change_origin) VALUES(?,'source_author')",
          )
          .bind(id),
      );
      for (let j = 0; j < 4; j++)
        statements.push(
          db
            .prepare(
              "INSERT INTO document_fetches(id,job_id,source_id,document_id,snapshot_version,url,checked_at,status,outcome,bytes,body_hash) VALUES(?,'historical-job',?,?,1,?,'2026-10-25',200,'ok',20,?)",
            )
            .bind(id + "-" + j, sourceId, id, url, "old-" + i),
          db
            .prepare(
              "INSERT INTO ingestion_job_steps(job_id,step_key,url,stage,outcome,bytes,document_id,created_at) VALUES('historical-job',?,?,'fetch','ok',20,?,'2026-10-25')",
            )
            .bind(id + "-" + j, url, id),
        );
      statements.push(
        db
          .prepare(
            "INSERT INTO content_index_invalidations(document_id,version,reason) VALUES(?,1,'fixture')",
          )
          .bind(id),
        db
          .prepare(
            "INSERT INTO console_intake_skips(id,job_id,source_id,canonical_url,reason,observed_at) VALUES(?,'historical-job',?,?,'cutoff','2026-10-25')",
          )
          .bind(id, sourceId, url + "/skip"),
      );
    }
    for (let k = 0; k < statements.length; k += 100)
      await db.batch(statements.slice(k, k + 100));
  }
  await db.batch(triggers.map((t) => db.prepare(t.sql)));
}
const report = {
  fixture: {
    documents: 1000,
    fetches: 4000,
    jobSteps: 4000,
    externalRequests: 0,
    listPages: 5,
    newArticles: 1,
  },
  baselineRef,
  versions: {},
};
try {
  const files = (await fs.readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const version of ["before", "after"]) {
    const raw = await mf.getD1Database(
      version === "before" ? "BEFORE" : "AFTER",
    );
    for (const file of files.filter((f) => f < "0042")) {
      try {
        await raw.batch(
          splitSql(await fs.readFile("migrations/" + file, "utf8")).map((sql) =>
            raw.prepare(sql),
          ),
        );
      } catch (error) {
        throw new Error("Migration fixture: " + file, { cause: error });
      }
    }
    const sourceId = await bundles[version].setupCostSource(raw);
    await seed(raw, sourceId);
    if (version === "after")
      await raw.batch(
        splitSql(
          await fs.readFile(
            "migrations/0042_ingestion_lookup_indexes.sql",
            "utf8",
          ),
        ).map((sql) => raw.prepare(sql)),
      );
    const measurement = measured(raw),
      result = await bundles[version].crawlCostFixture(measurement.db);
    const totals = measurement.costs.reduce(
      (sum, r) => ({
        read: sum.read + r.read,
        written: sum.written + r.written,
      }),
      { read: 0, written: 0 },
    );
    report.versions[version] = {
      ...totals,
      published: result.published,
      sqlCalls: measurement.costs.length,
      topReads: [...measurement.costs]
        .sort((a, b) => b.read - a.read)
        .slice(0, 8),
    };
    const query = bundles[version].provenanceQuery(version === "before");
    const provenance = await raw
      .prepare(query.sql)
      .bind(...query.values)
      .all();
    assert.deepEqual(provenance.results, [{ ok: 1 }]);
    report.versions[version].provenanceProbe = {
      read: provenance.meta.rows_read,
      written: provenance.meta.rows_written,
    };
  }
  const resultPath = path.resolve("test-results/ingestion-d1-cost.json");
  await fs.writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  assert.equal(
    report.versions.before.published,
    report.versions.after.published,
  );
  assert.ok(
    report.versions.after.read < report.versions.before.read * 0.25,
    "Read usage must fall by at least 75%",
  );
  assert.ok(
    report.versions.after.written < report.versions.before.written,
    "Total writes including new index maintenance must decrease",
  );
} finally {
  await mf.dispose();
}
