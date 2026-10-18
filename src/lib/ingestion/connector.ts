// Node/local runner only: never imported by a Worker API or client bundle.
import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";
import { ContentInputSchema } from "@/domain/console/contracts";
import type { Checkpoint } from "@/domain/console/ingestion";
import { approvedUrl, type WebProfile } from "./profiles";
import { parseCampusTime } from "./time";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (node: { textContent: string | null } | null) =>
  node?.textContent?.replace(/\s+/g, " ").trim() || "";
function cleanBodyText(root: {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<unknown>;
  textContent: string | null;
}) {
  const chunks: string[] = [];
  let nodes = 0;
  const walk = (node: typeof root, depth: number) => {
    if (++nodes > 20000 || depth > 200) throw Error("TOO_LARGE");
    if (node.nodeType === 3) {
      chunks.push(node.textContent || "");
      return;
    }
    const block =
      /^(P|DIV|LI|TR|TD|TH|BR|H[1-6]|SECTION|ARTICLE|BLOCKQUOTE)$/.test(
        node.nodeName,
      );
    if (block) chunks.push("\n");
    for (const child of Array.from(node.childNodes))
      walk(child as typeof root, depth + 1);
    if (block) chunks.push("\n");
  };
  walk(root, 0);
  return chunks
    .join("")
    .split(/\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
export function originalDate(raw: string) {
  const parsed = parseCampusTime(raw);
  return parsed.iso || parsed.date;
}
export { extractEvents } from "./time";
export class OfficialWebConnector {
  readonly sourceId: string;
  readonly ruleVersion: string;
  constructor(readonly profile: WebProfile) {
    this.sourceId = profile.sourceId;
    this.ruleVersion = profile.ruleVersion;
  }
  discover(html: string, page = this.profile.entryUrl) {
    approvedUrl(this.profile, page, "list");
    const { document } = parseHTML(html);
    const urls: string[] = [];
    let nextPage: string | null = null;
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href")!;
      let resolved: string;
      try {
        resolved = new URL(href, page).toString();
        const u = approvedUrl(this.profile, resolved);
        if (!urls.includes(u)) urls.push(u);
      } catch {}
      if (/下一页|下页/.test(text(a)))
        try {
          nextPage = approvedUrl(
            this.profile,
            new URL(href, page).toString(),
            "list",
          );
        } catch {}
    }
    return { urls: urls.slice(0, 10), nextPage };
  }
  async fetch(
    url: string,
    request: (url: string) => Promise<{ html: string }>,
  ) {
    approvedUrl(this.profile, url);
    return request(url);
  }
  parse(html: string, url: string) {
    approvedUrl(this.profile, url);
    if (Buffer.byteLength(html) > 524288) throw Error("TOO_LARGE");
    const { document } = parseHTML(html);
    if (
      /验证码|访问过于频繁|安全验证|需要登录/.test(
        text(document.querySelector("title")),
      )
    )
      throw Error("BLOCKED");
    document
      .querySelectorAll(
        "script,style,noscript,iframe,input,button,select,textarea,[hidden],[aria-hidden='true'],[style*='display:none'],[style*='display: none']",
      )
      .forEach((x) => x.remove());
    const rawTitle = text(document.querySelector(this.profile.titleSelector));
    const title = rawTitle.endsWith(this.profile.titleSuffix)
      ? rawTitle.slice(0, -this.profile.titleSuffix.length)
      : rawTitle;
    const dates = [...document.querySelectorAll(this.profile.dateSelector)]
      .map(text)
      .filter(
        (s) =>
          s.includes(this.profile.dateLabel + "：") ||
          s.includes(this.profile.dateLabel + ":"),
      );
    const values = [
      ...new Set(
        dates
          .map((s) =>
            s.split(new RegExp(this.profile.dateLabel + "[：:]"))[1]?.trim(),
          )
          .filter(Boolean),
      ),
    ];
    const dateText = values.length === 1 ? values[0] : "";
    const body = document.querySelector(this.profile.bodySelector);
    if (!title || !body) throw Error("PARSE_ERROR");
    const bodyText = cleanBodyText(body);
    if (bodyText.length > 50000) throw Error("TOO_LARGE");
    const attachments = [...body.querySelectorAll("a[href]")]
      .flatMap((a) => {
        try {
          return [
            {
              url: approvedUrl(
                this.profile,
                new URL(a.getAttribute("href")!, url).toString(),
                "attachment",
              ),
              name: text(a).slice(0, 200),
            },
          ];
        } catch {
          return [];
        }
      })
      .slice(0, 3);
    return {
      title: title.slice(0, 250),
      dateText: dateText.slice(0, 100),
      publishedAt: originalDate(dateText),
      bodyText,
      attachments,
      bodyTextChars: bodyText.length,
      bodyHash: hash(
        JSON.stringify([
          bodyText,
          [...body.querySelectorAll("img")].map((x) => x.getAttribute("src")),
          attachments,
        ]),
      ),
      imageCount: body.querySelectorAll("img").length,
    };
  }
  normalize(
    parsed: ReturnType<OfficialWebConnector["parse"]>,
    url: string,
    rightsScope:
      | "metadata_only"
      | "excerpt_and_link"
      | "licensed_full_text" = "metadata_only",
  ) {
    const title = parsed.title;
    const radarCategory = /讲座|论坛/.test(title)
      ? "lecture"
      : /竞赛|大赛|比赛/.test(title)
        ? "competition"
        : /就业|招聘|升学/.test(title)
          ? "education_career"
          : /奖学金|助学金/.test(title)
            ? "scholarship_opportunity"
            : /通知|公告/.test(title)
              ? "campus_notice"
              : null;
    const knowledgeCategory = /教务|选课|考试/.test(title)
      ? "academic_affairs"
      : /后勤|停水|停电|食堂/.test(title)
        ? "campus_life"
        : /奖学金|助学金/.test(title)
          ? "scholarship_policy"
          : /就业|招聘/.test(title)
            ? "education_career"
            : /通知|公告/.test(title)
              ? "administrative_services"
              : null;
    return ContentInputSchema.parse({
      sourceId: this.sourceId,
      title,
      url: approvedUrl(this.profile, url),
      body:
        rightsScope === "metadata_only"
          ? "仅登记公开元数据，未保存第三方正文。"
          : rightsScope === "excerpt_and_link"
            ? parsed.bodyText.slice(0, 500)
            : parsed.bodyText,
      bodyStatus:
        rightsScope === "metadata_only"
          ? "not_provided"
          : rightsScope === "excerpt_and_link"
            ? "partial"
            : "complete",
      kind: "knowledge",
      campusScope: "unknown",
      publishedAt: parsed.publishedAt,
      sourceUpdatedAt: null,
      validUntil: null,
      extractedFields: {},
      contentType: /通知|公告/.test(title) ? "notice" : "news",
      rightsScope,
      radarCategory,
      knowledgeCategory,
      publisher: this.profile.name,
      summary: "",
      tags: [
        ...(/AI|人工智能/i.test(title) ? ["AI"] : []),
        ...(/志愿/.test(title) ? ["志愿服务"] : []),
        ...(/信息素养/.test(title) ? ["信息素养"] : []),
      ],
    });
  }
  validate(article: unknown) {
    return ContentInputSchema.parse(article);
  }
  checkpoint(value: Checkpoint) {
    return { ...value, urls: [...value.urls] };
  }
  report(stats: Record<string, number>) {
    return { ...stats, modelCalls: 0 };
  }
}
