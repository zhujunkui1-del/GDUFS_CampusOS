import { parseHTML } from "linkedom";
import { evidenceWindow } from "@/lib/retrieval/evidence-window";
import { isOfficialCampusUrl } from "./policy";
import type { ExternalItem } from "@/domain/retrieval/external";
const home = "https://www.gdufs.edu.cn";
const plain = (html: string) => {
  const { document } = parseHTML("<div>" + html + "</div>");
  for (const node of document.querySelectorAll(
    "script,style,noscript,template",
  ))
    node.remove();
  return (document.querySelector("div")?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
};
export function universityKeywords(query: string) {
  return query
    .normalize("NFKC")
    .replace(
      /广东外语外贸大学|广外|大学城(?:校区)?|南校(?:区)?|白云山(?:校区)?/g,
      " ",
    )
    .replace(
      /有哪些人|有哪些|哪几位|有谁|是谁|什么|名单|介绍|简介|身份|[？?。]/g,
      " ",
    )
    .replace(
      /(?:是不是|是否|是|的)(?:\s*的)?(?=\s*(?:首席专家|校长|院长|书记|教授|院士|导师))/g,
      " ",
    )
    .replace(/(?:吗|呢)\s*$/, "")
    .replace(/^\s*的/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
async function text(response: Response, cap = 384000) {
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("OFFICIAL_HTTP");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("OFFICIAL_EMPTY");
  const decoder = new TextDecoder();
  let out = "",
    size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > cap) throw Error("OFFICIAL_LIMIT");
      out += decoder.decode(part.value, { stream: true });
    }
    return out + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function readOfficialArticle(
  url: string,
  signal: AbortSignal,
  transport: typeof fetch,
) {
  if (
    !isOfficialCampusUrl(url) ||
    !/\.(?:htm|html)$/i.test(new URL(url).pathname)
  )
    throw Error("OFFICIAL_URL");
  const article = await text(
    await transport(url, { redirect: "manual", signal }),
  );
  const { document } = parseHTML(article);
  const node = document.querySelector(
    ".v_news_content, #vsb_content, [id^=vsb_content_]",
  );
  const date = document
    .querySelector('meta[name="PubDate"]')
    ?.getAttribute("content")
    ?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return {
    body: node ? plain(node.innerHTML) : "",
    publishedAt: date && Number.isFinite(Date.parse(date)) ? date : null,
  };
}
/** Public university search UI's tourist/full-text mode; no login, tracking or private indexes. */
export async function searchOfficialUniversity(
  query: string,
  limit: number,
  parent: AbortSignal,
  transport: typeof fetch,
) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(9000)]);
  const keywords = universityKeywords(query);
  if (keywords.length < 2) throw Error("OFFICIAL_QUERY");
  const html = await text(
    await transport(home + "/", { redirect: "manual", signal }),
  );
  const owner = html.match(/var\s+appOwner\s*=\s*["'](\d{1,20})["']/)?.[1];
  if (!owner || !/var\s+urlPrefix\s*=\s*["']\/aop_component\//.test(html))
    throw Error("OFFICIAL_CONFIG");
  const response = await transport(
    home + "/aop_component/webber/search/search/search/queryPage",
    {
      method: "POST",
      redirect: "manual",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "tourist",
        owner,
      },
      body: JSON.stringify({
        aliasName: "article_data,open_data",
        keyWord: keywords,
        searchType: "text",
        searchScope: "3",
        searchOperator: 1,
        orderType: "date",
        owner,
        token: "tourist",
        auditing: ["1", "5"],
        filterTerm: { wbsourceid: ["0", "6"] },
        page: { current: 0, size: 10 },
        language: "chinese",
        isMatchQuery: false,
      }),
    },
  );
  const data = JSON.parse(await text(response));
  if (
    data.code !== "0000" ||
    !data.data?.page ||
    !Array.isArray(data.data.page.records ?? [])
  )
    throw Error("OFFICIAL_RESPONSE");
  const terms = keywords.split(" ").filter((t) => t.length >= 2);
  const rows = (data.data.page.records ?? [])
    .slice(0, 10)
    .flatMap((raw: Record<string, unknown>) => {
      if (typeof raw.url !== "string" || typeof raw.title !== "string")
        return [];
      let url: URL;
      try {
        url = new URL(raw.url, home);
      } catch {
        return [];
      }
      if (
        !isOfficialCampusUrl(url.href) ||
        !/\.(?:htm|html)$/i.test(url.pathname)
      )
        return [];
      const title = plain(raw.title).slice(0, 250),
        intro = plain(String(raw.intro || ""));
      return [
        {
          url: url.href,
          title,
          intro,
          score: terms.reduce(
            (n, t) =>
              n + (title.includes(t) ? 3 : 0) + (intro.includes(t) ? 1 : 0),
            0,
          ),
        },
      ];
    })
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
  const seen = new Set<string>();
  const selected = rows
    .filter((r: { url: string }) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    })
    .slice(0, Math.min(limit, 4));
  return Promise.all(
    selected.map(
      async (
        row: { url: string; title: string; intro: string },
        i: number,
      ): Promise<ExternalItem> => {
        let body = "",
          publishedAt: string | null = null;
        if (i < 2)
          try {
            ({ body, publishedAt } = await readOfficialArticle(
              row.url,
              signal,
              transport,
            ));
          } catch {
            /* Keep the returned search excerpt labelled as such. */
          }
        const evidence = body || row.intro;
        return {
          title: row.title,
          originalUrl: row.url,
          sourceName: "广外官方站内搜索",
          platform: "web",
          authority: "official",
          evidenceKind: body
            ? "page_excerpt"
            : evidence
              ? "search_excerpt"
              : "title_only",
          snippet: evidenceWindow(evidence || row.title, query, 700).text,
          publishedAt,
          retrievedAt: new Date().toISOString(),
          searchMode: "web",
          canConfirmAdministrativeFacts: !!body,
        };
      },
    ),
  );
}
