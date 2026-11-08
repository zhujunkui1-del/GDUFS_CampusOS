import { articleText } from "@/lib/ingestion/article-text";
import type { ArticleAnalysisInput } from "@/domain/console/article-analysis";
import { lexicalTokens } from "./terms";
export function chunkArticle(input: ArticleAnalysisInput, rights: string) {
  const projection = articleText(input);
  const evidenceType =
    rights === "metadata_only" || !projection.bodyAvailable
      ? "metadata"
      : rights === "excerpt_and_link"
        ? "excerpt"
        : "full_text";
  const text =
    evidenceType === "metadata"
      ? projection.title
      : evidenceType === "excerpt"
        ? projection.text.slice(0, 500)
        : projection.text;
  if (
    !["metadata_only", "excerpt_and_link", "licensed_full_text"].includes(
      rights,
    )
  )
    return null;
  const chunks: {
    text: string;
    start: number;
    end: number;
    ordinal: number;
    terms: string;
  }[] = [];
  let start = 0;
  // A converted student handbook is one document of ~200k characters; the old
  // ceiling of 160 would silently drop the tail of every long reference file.
  while (start < text.length && chunks.length < 480) {
    let end = Math.min(start + 900, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start + 450) end = newline;
    }
    const value = text.slice(start, end);
    chunks.push({
      text: value,
      start,
      end,
      ordinal: chunks.length,
      terms: lexicalTokens(value).join(" "),
    });
    if (end === text.length) break;
    start = Math.max(start + 1, end - 90);
  }
  return {
    text,
    chunks,
    evidenceType: evidenceType as "metadata" | "excerpt" | "full_text",
    basis:
      evidenceType === "metadata"
        ? ("title" as const)
        : ("normalized_text" as const),
    truncated: chunks.at(-1)?.end !== text.length,
    titleTerms: lexicalTokens(projection.title).join(" "),
  };
}
