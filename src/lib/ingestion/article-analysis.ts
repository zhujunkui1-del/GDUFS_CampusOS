import type { ArticleAnalysisInput } from "@/domain/console/article-analysis";
import { classifyArticleContent } from "./article-intent";
import { extractArticleStructure } from "./article-times";
import { validateArticleAnalysis } from "./article-validation";
import { calendarInput, calendarizeArticle } from "./calendar-extraction";
export function analyzeArticle(input: ArticleAnalysisInput) {
  input = calendarInput(input);
  return validateArticleAnalysis(
    input,
    calendarizeArticle(
      input,
      extractArticleStructure(input, classifyArticleContent(input)),
    ),
  );
}
