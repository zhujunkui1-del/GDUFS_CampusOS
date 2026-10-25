import {
  ARTICLE_CLASSIFIER_VERSION,
  ArticleAnalysisSchema,
  type ArticleAnalysisInput,
  type ArticleEvidence,
  type ArticleTimePoint,
} from "@/domain/console/article-analysis";
import { articleText, evidenceValid } from "./article-text";
/** Evidence is checked against canonical source text, not merely valid JSON. */
export function validateArticleAnalysis(
  input: ArticleAnalysisInput,
  raw: unknown,
) {
  const a = ArticleAnalysisSchema.parse(raw),
    text = articleText(input);
  if (a.classifierVersion !== ARTICLE_CLASSIFIER_VERSION)
    throw Error("ARTICLE_CLASSIFIER_VERSION_MISMATCH");
  const check = (e: ArticleEvidence) => {
    if (!evidenceValid(text, e)) throw Error("ARTICLE_EVIDENCE_MISMATCH");
  };
  const point = (p: ArticleTimePoint | null) => {
    if (!p) return;
    check(p.evidence);
    if (p.evidence.text !== p.raw)
      throw Error("ARTICLE_TIME_EVIDENCE_MISMATCH");
    if (p.inferred && !p.inferenceBasis)
      throw Error("ARTICLE_INFERENCE_WITHOUT_BASIS");
    if (p.at && p.date !== p.at.slice(0, 10))
      throw Error("ARTICLE_TIME_DATE_MISMATCH");
  };
  for (const e of a.classificationEvidence) check(e);
  for (const event of a.activities) {
    for (const e of event.evidence) check(e);
    point(event.startsAt);
    point(event.endsAt);
    for (const w of event.registrationWindows) {
      point(w.start);
      point(w.end);
      for (const e of w.evidence) check(e);
    }
    for (const d of event.otherDeadlines) {
      point(d.time);
      check(d.evidence);
    }
  }
  for (const e of [
    ...a.knowledge.conditions,
    ...a.knowledge.steps,
    ...a.knowledge.materials,
  ])
    check(e);
  point(a.knowledge.effectiveFrom);
  point(a.knowledge.effectiveUntil);
  if (a.bodyAvailable !== text.bodyAvailable)
    throw Error("ARTICLE_BODY_AVAILABILITY_MISMATCH");
  return a;
}
