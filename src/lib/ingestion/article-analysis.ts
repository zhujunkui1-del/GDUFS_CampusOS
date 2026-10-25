import {
  ArticleAnalysisSchema,
  type ArticleAnalysisInput,
} from "@/domain/console/article-analysis";
import { classifyArticleContent } from "./article-intent";
import { extractArticleStructure } from "./article-times";
export function analyzeArticle(input: ArticleAnalysisInput) {
  return ArticleAnalysisSchema.parse(
    extractArticleStructure(input, classifyArticleContent(input)),
  );
}
