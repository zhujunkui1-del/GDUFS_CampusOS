import { z } from "zod";
import {
  ExternalItemSchema,
  type ExternalItem,
} from "@/domain/retrieval/external";
import { isOfficialCampusUrl, type ExternalPolicy } from "./policy";
import type { RelayInput, RelayUsage } from "@/domain/retrieval/relay";
import {
  searchOfficialUniversity,
  readOfficialArticle,
} from "./official-search";
type ProviderStatus =
  | "ok"
  | "empty"
  | "unavailable"
  | "login_required"
  | "rate_limited"
  | "not_configured"
  | "busy";
export type ProviderResult = {
  items: ExternalItem[];
  provider: string;
  status: ProviderStatus;
  durationMs: number;
  failureCode?:
    | "HTTP_ERROR"
    | "INVALID_RESPONSE"
    | "RESPONSE_LIMIT"
    | "FETCH_CONTEXT"
    | "NETWORK_ERROR"
    | "RATE_LIMITED";
  httpStatus?: number;
  edgeCode?: number;
  relayUsage?: RelayUsage;
  cacheHit?: boolean;
};
export type ExternalConfig = {
  gatewayUrl?: string;
  gatewayToken?: string;
  webEnabled?: boolean;
  exaApiKey?: string;
  relay?: (input: RelayInput, signal?: AbortSignal) => Promise<ProviderResult>;
};
async function boundedText(response: Response, limit = 256000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) throw Error("RESPONSE_LIMIT");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const Envelope = z.object({
  result: z
    .object({
      content: z.array(
        z.object({ type: z.string(), text: z.string().optional() }),
      ),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
async function exa(
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  transport: typeof fetch,
  apiKey?: string,
) {
  const response = await transport("https://mcp.exa.ai/mcp", {
    method: "POST",
    // workerd supports manual/error-status checking, not redirect:"error".
    // Never follow a redirect or forward credentials to another origin.
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
    signal,
  });
  if (response.status === 429) throw Error("RATE_LIMITED");
  if (!response.ok) {
    // Keep only a numeric edge error, never upstream response bodies.
    const edge = (await boundedText(response, 16000)).match(
      /(?:error code:|Error\s+)(\d{4})/i,
    )?.[1];
    throw Error(
      "PROVIDER_HTTP_" + response.status + (edge ? "_CF_" + edge : ""),
    );
  }
  const raw = await boundedText(response),
    frames = raw
      .split(/\r?\n/)
      .filter((s) => s.startsWith("data:"))
      .map((s) => s.slice(5).trim());
  const result = Envelope.parse(JSON.parse(frames.at(-1) || raw));
  if (!result.result && !result.error) throw Error("PROVIDER_UNAVAILABLE");
  const text = result.result?.content.map((c) => c.text || "").join("\n") || "";
  if (result.error || result.result?.isError)
    throw Error(
      /429|rate.limit|quota|credit.*(?:exceed|exhaust)/i.test(
        (result.error?.message || "") + text,
      )
        ? "RATE_LIMITED"
        : "PROVIDER_UNAVAILABLE",
    );
  return text;
}
export function parseWebResults(text: string) {
  return text.split(/\n(?=Title:\s)/).flatMap((block) => {
    const title = block.match(/^Title:\s*(.+)/m)?.[1],
      url = block.match(/^URL:\s*(https?:\/\/\S+)/m)?.[1];
    if (!title || !url) return [];
    const published = block.match(/^Published:\s*(.+)/m)?.[1];
    const snippet = block
      .split(/\r?\n/)
      .filter(
        (line) =>
          !/^Title:|^URL:|^Published:|^Author:|^Highlights:|^Text:/.test(line),
      )
      .join("\n")
      .replace(/\n---\s*$/, "")
      .trim();
    return [
      {
        title,
        url,
        published:
          published && Number.isFinite(Date.parse(published))
            ? published
            : null,
        text: snippet,
      },
    ];
  });
}
export async function searchWeb(
  query: string,
  policy: ExternalPolicy,
  limit: number,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
  onlyXhs = false,
  apiKey?: string,
): Promise<ProviderResult> {
  const started = performance.now(),
    provider = onlyXhs ? "exa_xiaohongshu_public" : "exa_web";
  const scope = onlyXhs
    ? "site:xiaohongshu.com"
    : policy.officialOnly || policy.intent === "mixed"
      ? "site:gdufs.edu.cn"
      : "";
  const scoped =
    (policy.campus && !/广外|广东外语外贸大学/.test(query)
      ? "广东外语外贸大学 "
      : "") +
    query +
    " " +
    scope;
  try {
    const timeout = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(11000),
    ]);
    const text = await exa(
      "web_search_exa",
      {
        query: scoped,
        objective: policy.officialOnly
          ? "Find original official university notices and rules. Exclude social opinions, keep dates and original source links."
          : "Find information directly answering the query, with source links. For Guangdong University of Foreign Studies (广外/GDUFS), reject other schools and unrelated restaurants or profiles. Student experience is anecdotal; do not confirm university rules from social posts.",
        numResults: limit,
      },
      timeout,
      transport,
      apiKey,
    );
    const parsed = parseWebResults(text);
    if (
      !parsed.length &&
      !/no (?:results|matches)|未找到|没有.*结果/i.test(text)
    )
      throw Error("PROVIDER_UNAVAILABLE");
    let rows = parsed
      .filter(
        (r) =>
          !policy.campus ||
          isOfficialCampusUrl(r.url) ||
          /广外|广东外语外贸|gdufs/i.test(r.title + " " + r.text),
      )
      .filter((r) => {
        try {
          const u = new URL(r.url);
          return (
            u.protocol === "https:" &&
            !u.username &&
            !u.password &&
            (!u.port || u.port === "443") &&
            (!policy.officialOnly || isOfficialCampusUrl(r.url)) &&
            (!onlyXhs ||
              ((u.hostname === "xiaohongshu.com" ||
                u.hostname.endsWith(".xiaohongshu.com")) &&
                /^\/(?:explore|discovery\/item)\/[\w-]+/.test(u.pathname)))
          );
        } catch {
          return false;
        }
      })
      .slice(0, limit);
    if (!rows.length && policy.officialOnly && !onlyXhs) {
      try {
        const items = await searchOfficialUniversity(
          query,
          limit,
          timeout,
          transport,
        );
        return {
          provider: "gdufs_official_site",
          status: items.length ? "ok" : "empty",
          items,
          durationMs: Math.round(performance.now() - started),
        };
      } catch {
        /* Keep a genuine empty primary result distinct from transport failures. */
      }
    }
    const pages = new Map<string, string>();
    if (
      rows.some((r) => isOfficialCampusUrl(r.url)) &&
      (policy.officialOnly || policy.intent === "mixed")
    ) {
      try {
        const detail = await exa(
          "web_fetch_exa",
          {
            urls: rows
              .filter((r) => isOfficialCampusUrl(r.url))
              .slice(0, 2)
              .map((r) => r.url),
            maxCharacters: 4500,
          },
          timeout,
          transport,
          apiKey,
        );
        for (const row of parseWebResults(detail)) pages.set(row.url, row.text);
      } catch {
        /* Search excerpts remain explicitly labelled; no invented page proof. */
      }
      await Promise.all(
        rows
          .filter((r) => isOfficialCampusUrl(r.url) && !pages.has(r.url))
          .slice(0, 2)
          .map(async (r) => {
            try {
              const read = await readOfficialArticle(r.url, timeout, transport);
              if (read.body) pages.set(r.url, read.body);
              if (read.publishedAt) r.published = read.publishedAt;
            } catch {
              /* Do not promote a search excerpt when the original page is unavailable. */
            }
          }),
      );
    }
    rows = rows.filter((r) => r.text || r.title);
    const items = rows.map((r) => {
      const official = isOfficialCampusUrl(r.url),
        xhs =
          new URL(r.url).hostname === "xiaohongshu.com" ||
          new URL(r.url).hostname.endsWith(".xiaohongshu.com"),
        page = pages.get(r.url),
        evidenceKind = page
          ? "page_excerpt"
          : r.text
            ? "search_excerpt"
            : "title_only";
      return ExternalItemSchema.parse({
        title: r.title.slice(0, 250),
        originalUrl: r.url,
        sourceName: official
          ? "广外官方网页"
          : xhs
            ? "小红书公开网页"
            : new URL(r.url).hostname,
        platform: xhs ? "xiaohongshu" : "web",
        authority: official
          ? "official"
          : xhs
            ? "student_experience"
            : "unverified",
        snippet: (page || r.text || r.title).slice(0, 700),
        publishedAt: r.published,
        retrievedAt: new Date().toISOString(),
        evidenceKind,
        searchMode: onlyXhs ? "public_web" : "web",
        canConfirmAdministrativeFacts:
          official && evidenceKind === "page_excerpt",
      });
    });
    return {
      items,
      provider,
      status: items.length ? "ok" : "empty",
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    if (
      policy.officialOnly &&
      !onlyXhs &&
      !signal?.aborted &&
      !(error instanceof Error && error.message === "RATE_LIMITED")
    ) {
      try {
        const items = await searchOfficialUniversity(
          query,
          limit,
          signal || AbortSignal.timeout(11000),
          transport,
        );
        return {
          provider: "gdufs_official_site",
          status: items.length ? "ok" : "empty",
          items,
          durationMs: Math.round(performance.now() - started),
        };
      } catch {
        /* Report the original failure; never invent evidence or bypass access checks. */
      }
    }
    const message = error instanceof Error ? error.message : "";
    return {
      items: [],
      provider,
      status:
        error instanceof Error && error.message === "RATE_LIMITED"
          ? "rate_limited"
          : "unavailable",
      durationMs: Math.round(performance.now() - started),
      failureCode: /Illegal invocation|this.*(?:fetch|Fetcher)/i.test(message)
        ? "FETCH_CONTEXT"
        : message === "RATE_LIMITED"
          ? "RATE_LIMITED"
          : /^PROVIDER_HTTP_/.test(message) ||
              message === "PROVIDER_UNAVAILABLE"
            ? "HTTP_ERROR"
            : message === "RESPONSE_LIMIT"
              ? "RESPONSE_LIMIT"
              : error instanceof SyntaxError || error instanceof z.ZodError
                ? "INVALID_RESPONSE"
                : "NETWORK_ERROR",
      ...(/^PROVIDER_HTTP_\d+/.test(message)
        ? {
            httpStatus: Number(message.match(/^PROVIDER_HTTP_(\d+)/)![1]),
            ...(message.match(/_CF_(\d+)/)
              ? { edgeCode: Number(message.match(/_CF_(\d+)/)![1]) }
              : {}),
          }
        : {}),
    };
  }
}
const GatewayResponse = z.object({
  cacheHit: z.boolean().optional(),
  status: z.enum(["ok", "empty", "unavailable", "login_required", "busy"]),
  items: z.array(ExternalItemSchema).max(4),
});
export async function searchXiaohongshu(
  query: string,
  limit: number,
  config: ExternalConfig,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
  recent = false,
): Promise<ProviderResult> {
  const started = performance.now(),
    provider = "xiaohongshu_mcp";
  if (config.relay)
    return config.relay(
      {
        kind: "xiaohongshu",
        query: query.slice(0, 300),
        limit,
        policy: {
          intent: "experience",
          officialOnly: false,
          campus: true,
          ...(recent ? { recent: true } : {}),
        },
        onlyXhs: false,
      },
      signal,
    );
  if (!config.gatewayUrl || !config.gatewayToken)
    return { provider, status: "not_configured", items: [], durationMs: 0 };
  try {
    const base = new URL(config.gatewayUrl);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      (base.port && base.port !== "443")
    )
      throw Error("INVALID_GATEWAY");
    const response = await transport(new URL("/v1/search", base), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.gatewayToken,
      },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(28000),
      ]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error("GATEWAY_UNAVAILABLE");
    }
    const result = GatewayResponse.parse(
      JSON.parse(await boundedText(response)),
    );
    return {
      ...result,
      provider,
      durationMs: Math.round(performance.now() - started),
    };
  } catch {
    return {
      provider,
      status: "unavailable",
      items: [],
      durationMs: Math.round(performance.now() - started),
    };
  }
}
