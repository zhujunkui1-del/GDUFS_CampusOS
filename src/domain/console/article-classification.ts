import type { ArticleAnalysisInput } from "./article-analysis";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";

// Compatibility placement projection of the one shared content classifier.
export function classifyArticle(input: ArticleAnalysisInput | string) {
  const a = analyzeArticle(
    typeof input === "string"
      ? { title: input, body: "", bodyStatus: "not_provided" }
      : input,
  );
  return {
    radarCategory: a.radarCategory,
    knowledgeCategory: a.knowledgeCategory,
  };
}
