// Controlled Preview derived-data operations. No article or publication updates.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const dir = ".map-tools/calendar-20261030";
fs.mkdirSync(dir, { recursive: true });
const mode =
  process.argv.find((a) => /^--(predict|apply|enrich|restore|probe)/.test(a)) ||
  "--predict";
await build({
  stdin: {
    contents:
      'export {calendarInput,calendarizeArticle} from "./src/lib/ingestion/calendar-extraction";export {validateArticleAnalysis} from "./src/lib/ingestion/article-validation";export {analyzeArticle} from "./src/lib/ingestion/article-analysis";export {analysisStatements} from "./src/lib/server/console/article-analysis";export {enrichCalendar,calendarMedia,CALENDAR_AI_MODEL} from "./src/lib/server/calendar/enrichment";export {reserveCalendarModel} from "./src/lib/server/calendar/processor";export {extractArticleStructure} from "./src/lib/ingestion/article-times";export {readCalendar} from "./src/lib/server/calendar/query";',
    resolveDir: process.cwd(),
  },
  outfile: dir + "/maintenance.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const api = await import(
  pathToFileURL(path.resolve(dir + "/maintenance.mjs")) + "?t=" + Date.now()
);
const snapshot = JSON.parse(fs.readFileSync(dir + "/snapshot.json", "utf8")),
  documents = snapshot.documents;
if (mode === "--predict") {
  const previous = fs.existsSync(dir + "/predictions.json")
    ? new Map(
        JSON.parse(fs.readFileSync(dir + "/predictions.json")).map((r) => [
          r.id,
          r,
        ]),
      )
    : new Map();
  const rows = [],
    reasons = {},
    nature = {};
  for (const d of documents) {
    try {
      const input = api.calendarInput({
        documentId: d.id,
        title: d.title,
        body: d.body,
        bodyFormat: d.body_format,
        bodyStatus: d.body_status,
        publishedAt: d.published_at,
        sourceId: d.source_id,
        sourceName: d.display_name,
        originalUrl: d.url,
        calendarSources:
          previous.get(d.id)?.input.body === d.body
            ? previous.get(d.id).input.calendarSources || []
            : [],
      });
      const base = d.analysis_json
        ? JSON.parse(d.analysis_json)
        : api.analyzeArticle(input);
      if (
        previous.get(d.id)?.input.body === d.body &&
        previous.get(d.id)?.analysis?.calendar
      )
        base.calendar = previous.get(d.id).analysis.calendar;
      const analysis = api.validateArticleAnalysis(
        input,
        api.calendarizeArticle(input, base),
      );
      rows.push({ id: d.id, input, analysis });
      reasons[analysis.calendar.reason] =
        (reasons[analysis.calendar.reason] || 0) + 1;
      for (const a of analysis.activities.filter((a) => a.calendar?.eligible))
        nature[a.calendar.nature] = (nature[a.calendar.nature] || 0) + 1;
    } catch (e) {
      rows.push({ id: d.id, error: e.message });
    }
  }
  fs.writeFileSync(dir + "/predictions.json", JSON.stringify(rows));
  const summary = {
    articles: rows.length,
    acceptedArticles: rows.filter(
      (r) => r.analysis?.calendar.status === "accepted",
    ).length,
    events: rows.reduce(
      (n, r) =>
        n +
        (r.analysis?.activities.filter((a) => a.calendar?.eligible).length ||
          0),
      0,
    ),
    needsEnrichment: rows.filter(
      (r) => r.analysis?.calendar.status === "needs_enrichment",
    ).length,
    errors: rows
      .filter((r) => r.error)
      .map((r) => ({ id: r.id, error: r.error })),
    reasons,
    nature,
  };
  fs.writeFileSync(
    dir + "/offline-summary.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
  process.exit(summary.errors.length ? 2 : 0);
}
const config = parse(fs.readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const dbId = config.env.preview.d1_databases[0].database_id;
const rawAuth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(rawAuth.slice(rawAuth.indexOf("{")));
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };
async function query(body) {
  const rows = await previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
    token,
    body,
  );
  for (const r of rows) {
    usage.rowsRead += r.meta.rows_read;
    usage.rowsWritten += r.meta.rows_written;
    usage.queries++;
  }
  return rows;
}
const db = {
  prepare(sql) {
    return {
      sql,
      params: [],
      bind(...args) {
        this.params = args;
        return this;
      },
      async all() {
        return (await query({ sql: this.sql, params: this.params }))[0];
      },
      async first() {
        return (await this.all()).results[0] || null;
      },
      async run() {
        return await this.all();
      },
    };
  },
  async batch(stmts) {
    return query({
      batch: stmts.map((s) => ({ sql: s.sql, params: s.params })),
    });
  },
};
const live = async (ids) =>
  (
    await query({
      sql: `SELECT d.id,d.input_hash,d.content_revision,x.calendar_version,x.projection_hash FROM knowledge_documents d LEFT JOIN document_article_analysis x ON x.document_id=d.id WHERE d.id IN(${ids.map(() => "?").join(",")}) AND EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id)`,
      params: ids,
    })
  )[0].results;
if (mode.startsWith("--enrich") || mode === "--probe") {
  const limit = Math.min(20, Number(mode.split("=")[1] || 1)),
    rows = JSON.parse(fs.readFileSync(dir + "/predictions.json"));
  const selected = rows
    .filter(
      (r) =>
        (r.analysis?.calendar.status === "needs_enrichment" ||
          mode === "--probe") &&
        api.calendarMedia(r.input).length,
    )
    .filter(
      (r) =>
        !process.argv.some((a) => a.startsWith("--id=")) ||
        r.id === process.argv.find((a) => a.startsWith("--id=")).slice(5),
    )
    .sort((a, b) =>
      (b.input.publishedAt || "").localeCompare(a.input.publishedAt || ""),
    )
    .slice(0, limit);
  const results = [];
  const cf = async (route, body) => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/${route}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      },
    );
    const j = await response.json();
    if (!response.ok || !j.success)
      throw Error(
        "CLOUDFLARE_AI_" +
          response.status +
          "_" +
          (j.errors || []).map((e) => e.code).join(","),
      );
    return j.result;
  };
  const ai = {
    run: (model, input) => cf("run/" + model, input),
    toMarkdown: (file) => {
      const form = new FormData();
      form.append("files", file.blob, file.name);
      return cf("tomarkdown", form);
    },
  };
  for (const r of selected) {
    if (
      !(await live([r.id])).some(
        (l) => l.input_hash === documents.find((d) => d.id === r.id).input_hash,
      )
    )
      continue;
    try {
      const result = await api.enrichCalendar(r.input, r.analysis, ai, () =>
        api.reserveCalendarModel(db),
      );
      r.input = result.input;
      r.analysis = result.analysis;
      results.push({
        id: r.id,
        metrics: result.metrics,
        proposal: result.proposal,
        status: r.analysis.calendar.status,
        events: r.analysis.activities
          .filter((a) => a.calendar?.eligible)
          .map((a) => ({
            title: a.title,
            start: a.startsAt,
            end: a.endsAt,
            place: a.placeRaw,
            origins: a.calendar.origins,
          })),
      });
    } catch (e) {
      results.push({ id: r.id, error: e.message });
    }
    fs.writeFileSync(dir + "/predictions.json", JSON.stringify(rows));
    fs.writeFileSync(
      dir + "/enrichment.json",
      JSON.stringify({ model: api.CALENDAR_AI_MODEL, results, usage }, null, 2),
    );
    console.log(JSON.stringify(results.at(-1)));
  }
  process.exit(0);
}
if (mode === "--apply") {
  const predictions = JSON.parse(fs.readFileSync(dir + "/predictions.json"));
  if (predictions.some((r) => r.error))
    throw Error("Resolve offline errors first");
  const report = {
    startedAt: new Date().toISOString(),
    applied: [],
    stale: [],
    usage,
  };
  for (let i = 0; i < predictions.length; i += 10) {
    const group = predictions.slice(i, i + 10),
      current = await live(group.map((r) => r.id)),
      stmts = [];
    for (const r of group) {
      const original = documents.find((d) => d.id === r.id),
        d = current.find((l) => l.id === r.id);
      if (
        !d ||
        d.input_hash !== original.input_hash ||
        d.content_revision !== original.content_revision
      ) {
        report.stale.push(r.id);
        continue;
      }
      stmts.push(
        ...(await api.analysisStatements(
          db,
          r.id,
          d.content_revision,
          d.input_hash,
          r.input,
          r.analysis,
        )),
      );
      report.applied.push(r.id);
    }
    if (stmts.length) await db.batch(stmts);
    fs.writeFileSync(dir + "/application.json", JSON.stringify(report));
    if (i % 200 === 0)
      console.log(JSON.stringify({ processed: i + group.length, usage }));
  }
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(dir + "/application.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      applied: report.applied.length,
      stale: report.stale.length,
      usage,
    }),
  );
  process.exit(0);
}
if (mode === "--restore") {
  // Rebuild legacy activity projection for current public revisions; source data is untouched.
  const report = { restored: [], stale: [], usage };
  for (const d of documents) {
    const current = (await live([d.id]))[0];
    if (
      !current ||
      current.input_hash !== d.input_hash ||
      current.content_revision !== d.content_revision
    ) {
      report.stale.push(d.id);
      continue;
    }
    const base = JSON.parse(d.analysis_json);
    delete base.calendar;
    const restored = api.extractArticleStructure(
      {
        title: d.title,
        body: d.body,
        bodyFormat: d.body_format,
        bodyStatus: d.body_status,
        publishedAt: d.published_at,
        originalUrl: d.url,
      },
      { ...base, activities: [] },
    );
    const json = JSON.stringify(restored);
    await query({
      batch: [
        {
          sql: "UPDATE document_article_analysis SET analysis_json=?,projection_hash=?,calendar_version='',calendar_status='excluded',calendar_attempts=0,calendar_lease_until_ms=0 WHERE document_id=? AND input_hash=? AND content_revision=?",
          params: [
            json,
            "calendar-rollback",
            d.id,
            d.input_hash,
            d.content_revision,
          ],
        },
        {
          sql: "DELETE FROM article_activity_index WHERE document_id=? AND EXISTS(SELECT 1 FROM knowledge_documents d WHERE d.id=? AND d.input_hash=? AND d.content_revision=?)",
          params: [d.id, d.id, d.input_hash, d.content_revision],
        },
        {
          sql: "INSERT INTO article_activity_index(document_id,activity_key,title,kind,category,starts_day,starts_at,ends_day,ends_at,place_raw,registration_requirement,group_key) SELECT ?,json_extract(value,'$.key'),json_extract(value,'$.title'),json_extract(value,'$.kind'),json_extract(value,'$.category'),json_extract(value,'$.startsAt.date'),json_extract(value,'$.startsAt.at'),json_extract(value,'$.endsAt.date'),json_extract(value,'$.endsAt.at'),json_extract(value,'$.placeRaw'),json_extract(value,'$.registrationStatus'),NULL FROM json_each(?,'$.activities') WHERE EXISTS(SELECT 1 FROM knowledge_documents d WHERE d.id=? AND d.input_hash=? AND d.content_revision=?)",
          params: [d.id, json, d.id, d.input_hash, d.content_revision],
        },
        {
          sql: "INSERT INTO article_registration_windows(document_id,activity_key,ordinal,starts_day,starts_at,ends_day,ends_at) SELECT ?,json_extract(e.value,'$.key'),w.key,json_extract(w.value,'$.start.date'),json_extract(w.value,'$.start.at'),json_extract(w.value,'$.end.date'),json_extract(w.value,'$.end.at') FROM json_each(?,'$.activities') e,json_each(e.value,'$.registrationWindows') w WHERE EXISTS(SELECT 1 FROM knowledge_documents d WHERE d.id=? AND d.input_hash=? AND d.content_revision=?)",
          params: [d.id, json, d.id, d.input_hash, d.content_revision],
        },
      ],
    });
    report.restored.push(d.id);
    fs.writeFileSync(dir + "/rollback.json", JSON.stringify(report));
  }
  console.log(
    JSON.stringify({
      restored: report.restored.length,
      stale: report.stale.length,
      usage,
    }),
  );
  process.exit(0);
}
throw Error("Unknown operation");
