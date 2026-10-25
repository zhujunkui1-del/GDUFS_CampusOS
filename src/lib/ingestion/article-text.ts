import { parseHTML } from "linkedom";
import {
  ArticleAnalysisInputSchema,
  type ArticleAnalysisInput,
  type ArticleEvidence,
} from "@/domain/console/article-analysis";

export type ArticleText = {
  title: string;
  text: string;
  paragraphs: { text: string; start: number; end: number }[];
  links: { label: string; url: string }[];
  bodyAvailable: boolean;
};
// This is an analysis projection. It never rewrites the saved reading HTML or fetches media.
export function articleText(raw: ArticleAnalysisInput): ArticleText {
  const input = ArticleAnalysisInputSchema.parse(raw),
    links: ArticleText["links"] = [];
  let body = input.bodyStatus === "not_provided" ? "" : input.body;
  if (input.bodyFormat === "reading_html" && body) {
    const { document } = parseHTML(
        '<main id="analysis-root">' + body + "</main>",
      ),
      root = document.querySelector("#analysis-root")!;
    root
      .querySelectorAll(
        "script,style,noscript,template,nav,iframe,form,input,button",
      )
      .forEach((n) => n.remove());
    for (const a of root.querySelectorAll("a[href]")) {
      try {
        const url = new URL(
          a.getAttribute("href")!,
          input.originalUrl || undefined,
        );
        if (url.protocol === "https:")
          links.push({ label: (a.textContent || "").trim(), url: url.href });
      } catch {
        /* Unknown relative links stay unknown. */
      }
    }
    for (const n of root.querySelectorAll("br")) n.replaceWith("\n");
    for (const n of root.querySelectorAll(
      "p,div,section,article,h1,h2,h3,h4,li,tr,blockquote,dt,dd",
    )) {
      n.prepend("\n");
      n.append("\n");
    }
    body = root.textContent || "";
  }
  const text = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((p) => p.replace(/[\t\f\v \u00a0\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  let cursor = 0;
  const paragraphs = text
    ? text.split("\n").map((text) => {
        const start = cursor;
        cursor += text.length + 1;
        return { text, start, end: start + text.length };
      })
    : [];
  return {
    title: input.title.replace(/\s+/g, " ").trim(),
    text,
    paragraphs,
    links,
    bodyAvailable: !!text,
  };
}
export function evidence(
  text: ArticleText,
  field: "title" | "body",
  start: number,
  end: number,
  role: string,
): ArticleEvidence {
  const source = field === "title" ? text.title : text.text;
  return {
    field,
    startOffset: start,
    endOffset: end,
    text: source.slice(start, end),
    role,
  };
}
export function evidenceValid(text: ArticleText, item: ArticleEvidence) {
  return (
    text[item.field === "title" ? "title" : "text"].slice(
      item.startOffset,
      item.endOffset,
    ) === item.text
  );
}
