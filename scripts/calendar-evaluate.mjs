// Local labelled-source evaluation. Does not query or update D1.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const dir = ".map-tools/calendar-20261030";
fs.mkdirSync(dir, { recursive: true });
await build({
  stdin: {
    contents:
      'export {analyzeArticle} from "./src/lib/ingestion/article-analysis";export {extractArticleStructure} from "./src/lib/ingestion/article-times";',
    resolveDir: process.cwd(),
  },
  outfile: dir + "/evaluation.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const api = await import(pathToFileURL(path.resolve(dir + "/evaluation.mjs")));
const corpus = JSON.parse(
  fs.readFileSync("tests/fixtures/calendar-real-articles.json", "utf8"),
);
const results = corpus.cases.map((c) => {
  const current = api.analyzeArticle(c.input);
  const legacy = api.extractArticleStructure(c.input, {
    ...current,
    activities: [],
    calendar: undefined,
  });
  return {
    id: c.id,
    url: c.sourceUrl,
    expected: c.expected,
    before: legacy.activities
      .filter((a) => a.startsAt?.date)
      .map((a) => ({
        date: a.startsAt.date,
        end: a.endsAt?.date || null,
        time: a.startsAt.at?.slice(11, 16) || null,
        place: a.placeRaw,
      })),
    after: current.activities
      .filter((a) => a.calendar?.eligible)
      .map((a) => ({
        date: a.startsAt.date,
        end: a.endsAt?.date || null,
        time: a.startsAt.at?.slice(11, 16) || null,
        place: a.placeRaw,
      })),
  };
});
function score(key) {
  let found = 0,
    expected = 0,
    returned = 0,
    exact = 0,
    timeCorrect = 0,
    placeCorrect = 0,
    negativeFalse = 0;
  for (const r of results) {
    const a = r[key];
    expected += r.expected.dates.length;
    returned += a.length;
    found += r.expected.dates.filter((d) => a.some((a) => a.date === d)).length;
    exact += Number(
      JSON.stringify(a.map((a) => a.date)) === JSON.stringify(r.expected.dates),
    );
    if (r.expected.dates.length) {
      timeCorrect += Number(a[0]?.time === r.expected.time);
      placeCorrect += Number(
        r.expected.placeContains
          ? !!a[0]?.place?.includes(r.expected.placeContains)
          : a[0]?.place === null,
      );
    } else negativeFalse += Number(a.length > 0);
  }
  return {
    cases: results.length,
    positiveCases: results.filter((r) => r.expected.dates.length).length,
    expectedDates: expected,
    returnedDates: returned,
    matchingDates: found,
    dateRecall: found / expected,
    datePrecision: returned ? found / returned : 0,
    exactDateSetCases: exact,
    clockOrAbsenceCorrect: timeCorrect,
    placeOrAbsenceCorrect: placeCorrect,
    negativeFalseInclusions: negativeFalse,
  };
}
const report = {
  kind: corpus.kind,
  note: corpus.note,
  before: score("before"),
  after: score("after"),
  cases: results,
};
fs.mkdirSync("docs/verification/calendar-2026-10-30", { recursive: true });
fs.writeFileSync(
  "docs/verification/calendar-2026-10-30/evaluation.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ before: report.before, after: report.after }));
