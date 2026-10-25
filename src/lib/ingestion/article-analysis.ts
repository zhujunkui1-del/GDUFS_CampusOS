import type { ArticleAnalysisInput } from "@/domain/console/article-analysis";
import { classifyArticleContent } from "./article-intent";
import { extractArticleStructure } from "./article-times";
import { validateArticleAnalysis } from "./article-validation";
export function analyzeArticle(input: ArticleAnalysisInput) {
  return validateArticleAnalysis(
    input,
    extractArticleStructure(input, classifyArticleContent(input)),
  );
}
