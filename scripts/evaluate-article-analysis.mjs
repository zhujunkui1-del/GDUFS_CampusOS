import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = "test-results/article-analysis";
mkdirSync(dir, { recursive: true });
const file = path.resolve(dir + "/classifier.mjs");
await build({
  stdin: {
    contents:
      'export {analyzeArticle as classifyArticleContent} from "./src/lib/ingestion/article-analysis";',
    resolveDir: process.cwd(),
  },
  outfile: file,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { classifyArticleContent } = await import(
  pathToFileURL(file).href + "?t=" + Date.now()
);
const corpus = JSON.parse(readFileSync(dir + "/corpus.json", "utf8"));
const gold = JSON.parse(
  readFileSync("tests/fixtures/article-content-gold.json", "utf8"),
).documents;
const predictions = corpus.documents.map((d) => ({
  id: d.id,
  title: d.title,
  sourceUrl: d.url,
  sourceType: d.channel_type,
  oldDestination: d.knowledge_category ? "knowledge" : "radar",
  oldCategory: d.knowledge_category || d.radar_category,
  analysis: classifyArticleContent({
    documentId: d.id,
    title: d.title,
    body: d.body,
    bodyFormat: "plain",
    bodyStatus: d.body_status,
    sourceId: d.source_id,
    sourceName: d.display_name,
    originalUrl: d.url,
    publishedAt: d.published_at,
    contentType: d.content_type,
  }),
}));
const errors = [];
let correct = 0;
const counts = {},
  transitions = {},
  categories = {};
for (const p of predictions) {
  const a = p.analysis;
  counts[a.primaryDestination] = (counts[a.primaryDestination] || 0) + 1;
  const k = p.oldDestination + " -> " + a.primaryDestination;
  transitions[k] = (transitions[k] || 0) + 1;
  const cat = a.radarCategory || a.knowledgeCategory || "unknown";
  categories[a.primaryDestination + "/" + cat] =
    (categories[a.primaryDestination + "/" + cat] || 0) + 1;
  const g = gold.find((g) => g.id === p.id);
  if (g) {
    if (
      g.expectedDestination === a.primaryDestination &&
      g.expectedCategory === (a.radarCategory || a.knowledgeCategory)
    )
      correct++;
    else
      errors.push({
        id: p.id,
        title: p.title,
        expected: g.expectedDestination + "/" + g.expectedCategory,
        actual: a.primaryDestination + "/" + cat,
        reasons: a.classificationReasons,
        evidence: a.classificationEvidence,
      });
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  snapshotAt: corpus.capturedAt,
  documents: predictions.length,
  counts,
  transitions,
  categories,
  gold: {
    sample: gold.length,
    correct,
    errors,
    limitation:
      "Targeted initial reviewed sample; not an independent population accuracy estimate",
  },
  cloudUsage: corpus.usage,
  modelCalls: 0,
};
writeFileSync(dir + "/predictions.json", JSON.stringify(predictions) + "\n");
writeFileSync(dir + "/evaluation.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
