import { classifyArticle } from "@/domain/console/article-classification";
// Server-only parser shared by the local Node runner and scheduled Worker.
import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";
import { ContentInputSchema } from "@/domain/console/contracts";
import type { Checkpoint } from "@/domain/console/ingestion";
import { approvedUrl, type WebProfile } from "./profiles";
import { parseCampusTime } from "./time";
import { sanitizeReadingHtml } from "@/lib/server/console/reading-html";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (node: { textContent: string | null } | null) =>
  node?.textContent?.replace(/\s+/g, " ").trim() || "";
function absoluteHttpsReference(raw: string, pageUrl: string) {
  const value = raw.trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value))
    return value;
  try {
    const url = new URL(value, pageUrl);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function absoluteCssReferences(value: string, pageUrl: string) {
  return value.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    (_match, doubleQuoted, singleQuoted, unquoted) => {
      const resolved = absoluteHttpsReference(
        String(doubleQuoted ?? singleQuoted ?? unquoted ?? ""),
        pageUrl,
      );
      return resolved ? `url("${resolved.replaceAll('"', "%22")}")` : "none";
    },
  );
}
function absolutizeHtmlReferences(root: Element, pageUrl: string) {
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of [
      "src",
      "data-src",
      "data-original",
      "href",
      "poster",
      "xlink:href",
    ]) {
      const raw = element.getAttribute(attribute);
      if (!raw || raw.startsWith("#")) continue;
      const resolved = absoluteHttpsReference(raw, pageUrl);
      if (resolved) element.setAttribute(attribute, resolved);
    }
    const style = element.getAttribute("style");
    if (style)
      element.setAttribute("style", absoluteCssReferences(style, pageUrl));
    if (element.tagName.toLowerCase() === "style")
      element.textContent = absoluteCssReferences(
        element.textContent || "",
        pageUrl,
      );
  }
}
function embeddedAttachmentUrl(
  raw: string,
  pageUrl: string,
  profile: WebProfile,
  extension: "pdf" | "mp4",
) {
  try {
    const url = new URL(raw.replaceAll("\\/", "/"), pageUrl),
      keys = [...url.searchParams.keys()],
      allowedKeys = new Set(["afc", "oid", "tid", "nid", "e"]);
    if (
      url.protocol !== "https:" ||
      url.origin !== profile.origin ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/virtual_attach_file.vsb" ||
      url.searchParams.get("e")?.toLowerCase() !== `.${extension}` ||
      keys.length !== allowedKeys.size ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !allowedKeys.has(key)) ||
      !/^[A-Za-z0-9_+/=-]{1,512}$/.test(url.searchParams.get("afc") || "") ||
      !["oid", "tid", "nid"].every((key) =>
        /^\d{1,20}$/.test(url.searchParams.get(key) || ""),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function embeddedAttachments(
  document: Document,
  pageUrl: string,
  profile: WebProfile,
) {
  const found = new Map<string, "pdf" | "mp4">();
  for (const script of document.querySelectorAll("script")) {
    const source = script.textContent || "";
    for (const match of source.matchAll(
      /\bshowVsb(pdfIframe|Video)\s*\(\s*(["'])(.*?)\2/gi,
    )) {
      const extension = match[1].toLowerCase() === "pdfiframe" ? "pdf" : "mp4",
        url = embeddedAttachmentUrl(match[3], pageUrl, profile, extension);
      if (url) found.set(url, extension);
    }
  }
  for (const iframe of document.querySelectorAll("iframe[src]")) {
    try {
      const raw = iframe.getAttribute("src") || "",
        direct = embeddedAttachmentUrl(raw, pageUrl, profile, "pdf");
      if (direct) {
        found.set(direct, "pdf");
        continue;
      }
      const viewer = new URL(raw, pageUrl),
        keys = [...viewer.searchParams.keys()],
        file = viewer.searchParams.get("file");
      if (
        viewer.protocol !== "https:" ||
        viewer.origin !== profile.origin ||
        viewer.username ||
        viewer.password ||
        viewer.port ||
        viewer.pathname !== "/system/resource/pdfjs/viewer.html" ||
        keys.length !== 1 ||
        keys[0] !== "file" ||
        !file
      )
        continue;
      const url = embeddedAttachmentUrl(file, viewer.href, profile, "pdf");
      if (url) found.set(url, "pdf");
    } catch {
      continue;
    }
  }
  return [...found].slice(0, 5).map(([url, type]) => ({ url, type }));
}
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
    if (node.nodeType === 1 && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.nodeName))
      return;
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
    const { document } = parseHTML(html),
      configuredEntries = new Set(
        (this.profile.entryUrls || [this.profile.entryUrl]).map(
          (entry) => new URL(entry).href,
        ),
      );
    const candidates = new Map<
      string,
      { url: string; date: string | null; order: number }
    >();
    let nextPage: string | null = null;
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href")!;
      let resolved: string;
      try {
        resolved = new URL(href, page).toString();
        const u = approvedUrl(this.profile, resolved);
        if (!configuredEntries.has(u) && !candidates.has(u)) {
          const rowNode = a.closest("li") || a.parentElement || a;
          const row = text(rowNode);
          const dateNode = [...rowNode.querySelectorAll("time,span")]
            .map(text)
            .filter((s) => /^20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?$/.test(s))
            .at(-1);
          const leading = row.match(
            /(?:^|\s)(\d{1,2})\s+(20\d{2})[/.\-](\d{1,2})(?:\s|$)/,
          );
          const labeled = row.match(
            /发布时间[：:]?\s*(20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?)/,
          );
          const raw = leading
            ? `${leading[2]}-${leading[3].padStart(2, "0")}-${leading[1].padStart(2, "0")}`
            : labeled?.[1] ||
              dateNode ||
              row.match(/20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?/)?.[0];
          const date = raw ? parseCampusTime(raw).date : null;
          candidates.set(u, { url: u, date, order: candidates.size });
        }
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
    const rows = [...candidates.values()];
    if (rows.every((r) => r.date))
      rows.sort((a, b) => b.date!.localeCompare(a.date!) || a.order - b.order);
    const cutoff = this.profile.earliestImportDay;
    const datedRows = rows.filter((row) => row.date);
    const filtered = rows.filter(
      (row) =>
        (!cutoff || !row.date || row.date >= cutoff) &&
        (!this.profile.latestImportDay ||
          !row.date ||
          row.date <= this.profile.latestImportDay),
    );
    if (
      cutoff &&
      rows.length &&
      rows.every((row) => row.date && row.date < cutoff)
    )
      nextPage = null;
    const selected = filtered.slice(0, 50);
    return {
      urls: selected.map((r) => r.url),
      dates: selected.map(({ url, date }) => ({ url, publishedAt: date })),
      nextPage,
      allDatedBeforeCutoff:
        !!cutoff &&
        datedRows.length > 0 &&
        datedRows.every((row) => row.date! < cutoff),
      undatedUrls: rows.filter((row) => !row.date).map((row) => row.url),
    };
  }
  async fetch(
    url: string,
    request: (url: string) => Promise<{ html: string }>,
  ) {
    approvedUrl(this.profile, url);
    return request(url);
  }
  parse(html: string, url: string, publishedAtFromList?: string | null) {
    approvedUrl(this.profile, url);
    if (Buffer.byteLength(html) > 524288) throw Error("TOO_LARGE");
    const { document } = parseHTML(html);
    if (
      /验证码|访问过于频繁|安全验证|需要登录/.test(
        text(document.querySelector("title")),
      )
    )
      throw Error("BLOCKED");
    const rawTitle = text(document.querySelector(this.profile.titleSelector));
    const title =
      this.profile.titleSuffix && rawTitle.endsWith(this.profile.titleSuffix)
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
    // This CMS puts an explicit publication timestamp in its header rather than
    // the configured date node. Read only that labeled header, never body dates.
    const headerDates = values.length
      ? values
      : [
          ...new Set(
            [...document.querySelectorAll(".other-s")]
              .map(text)
              .map(
                (s) =>
                  s.match(
                    /发布日期[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/,
                  )?.[1],
              )
              .filter((value): value is string => !!value),
          ),
        ];
    const dateText =
      headerDates.length === 1 ? headerDates[0] : publishedAtFromList || "";
    const configuredBody = document.querySelector(this.profile.bodySelector),
      legacyBody = document.querySelector(".v_news_content"),
      galleryBody = document.querySelector("#content .pagepic_tablestyle_1"),
      galleryMode = !configuredBody && !legacyBody && !!galleryBody,
      sourceBody = configuredBody || legacyBody || galleryBody;
    if (!title || !sourceBody) throw Error("PARSE_ERROR");
    const media = embeddedAttachments(document, url, this.profile);
    // Some campus CMS templates hide the article node until their page script
    // removes inline display:none. Keep the configured article node itself,
    // then strip hidden descendants and active embeds inside the isolated copy.
    const body = sourceBody.cloneNode(true) as Element;
    body
      .querySelectorAll(
        "script,noscript,iframe,object,embed,form,input,button,select,textarea,[hidden],[aria-hidden='true'],[style*='display:none'],[style*='display: none']",
      )
      .forEach((x) => x.remove());
    if (galleryMode) {
      body.querySelectorAll("img").forEach((image) => image.remove());
      const encodedRefs =
        document.querySelector("#content > span")?.textContent || "";
      const imageUrls = [
        ...new Set(
          [...encodedRefs.matchAll(/\/virtual_attach_file\.vsb\?[^\s"'<>]+/g)]
            .map(([reference]) => {
              try {
                const imageUrl = new URL(reference, url);
                return imageUrl.protocol === "https:" &&
                  imageUrl.origin === this.profile.origin &&
                  !imageUrl.username &&
                  !imageUrl.password &&
                  ![...imageUrl.searchParams.keys()].some((key) =>
                    /^(uin|key|pass_ticket|appmsg_token|token|code)$/i.test(
                      key,
                    ),
                  )
                  ? imageUrl.href
                  : null;
              } catch {
                return null;
              }
            })
            .filter((value): value is string => !!value),
        ),
      ].slice(0, 50);
      for (const imageUrl of imageUrls) {
        const image = document.createElement("img");
        image.setAttribute("src", imageUrl);
        image.setAttribute("alt", title);
        image.setAttribute(
          "style",
          "display:block;max-width:100%;height:auto;margin:0 auto 16px",
        );
        body.appendChild(image);
      }
    }
    for (const attachment of media) {
      const description = document.createElement("p");
      description.textContent =
        attachment.type === "pdf"
          ? "正文以 PDF 附件提供。"
          : "正文包含视频附件，可在页面内播放。";
      body.appendChild(description);
      if (attachment.type === "pdf") {
        const link = document.createElement("a");
        link.setAttribute("href", attachment.url);
        link.textContent = "打开 PDF 附件";
        body.appendChild(link);
      } else {
        const video = document.createElement("video"),
          link = document.createElement("a");
        video.setAttribute("controls", "");
        video.setAttribute("preload", "none");
        video.setAttribute("src", attachment.url);
        link.setAttribute("href", attachment.url);
        link.textContent = "打开原始视频";
        video.appendChild(link);
        body.appendChild(video);
        body.appendChild(link.cloneNode(true));
      }
    }
    const rootStyle = body.getAttribute("style");
    if (rootStyle)
      body.setAttribute(
        "style",
        rootStyle
          .split(";")
          .filter(
            (rule) =>
              !/^\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*$/i.test(
                rule,
              ),
          )
          .join(";"),
      );
    const bodyText = cleanBodyText(body);
    if (bodyText.length > 50000) throw Error("TOO_LARGE");
    absolutizeHtmlReferences(body, url);
    const bodyHtml = sanitizeReadingHtml(body.outerHTML).html;
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
      bodyHtml,
      attachments,
      bodyTextChars: bodyText.length,
      bodyHash: hash(JSON.stringify([bodyText, bodyHtml, attachments])),
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
    const { radarCategory, knowledgeCategory } = classifyArticle({
      title,
      body: rightsScope === "metadata_only" ? "" : parsed.bodyText,
      bodyStatus:
        rightsScope === "metadata_only"
          ? "not_provided"
          : rightsScope === "excerpt_and_link"
            ? "partial"
            : "complete",
      publishedAt: parsed.publishedAt,
      sourceId: this.sourceId,
      originalUrl: url,
    });
    return ContentInputSchema.parse({
      sourceId: this.sourceId,
      title,
      url: approvedUrl(this.profile, url),
      body:
        rightsScope === "metadata_only"
          ? "仅登记公开元数据，未保存第三方正文。"
          : rightsScope === "excerpt_and_link"
            ? parsed.bodyText.slice(0, 500)
            : parsed.bodyHtml,
      ...(rightsScope === "licensed_full_text"
        ? { bodyFormat: "reading_html" as const }
        : {}),
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
      summary: parsed.bodyText.replace(/\s+/g, " ").slice(0, 200),
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
