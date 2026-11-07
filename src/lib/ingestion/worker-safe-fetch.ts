import { approvedUrl, type WebProfile } from "./profiles";
import { robotsAllow, robotsCrawlDelay } from "./robots";

export type WorkerPageObservation = {
  status: number;
  html: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
  wallMs: number;
  hash: string;
};

const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export class WorkerSafeWebFetcher {
  requests = 0;
  lastStarted = 0;
  robots: string | null = null;
  beforeRequest?: () => Promise<void>;
  private delayMs: number;

  constructor(
    readonly profile: WebProfile,
    readonly limit = Number.MAX_SAFE_INTEGER,
    delayMs = profile.requestIntervalMs ?? 1000,
  ) {
    this.delayMs = delayMs;
  }

  async get(
    raw: string,
    kind: "robots" | "sitemap" | "list" | "detail",
    validators?: { etag?: string | null; lastModified?: string | null },
  ): Promise<WorkerPageObservation> {
    const url = new URL(approvedUrl(this.profile, raw, kind));
    if (
      kind !== "robots" &&
      (this.robots === null || !robotsAllow(this.robots, url.pathname))
    )
      throw Error("ROBOTS_DENIED");
    if (this.requests >= this.limit) throw Error("REQUEST_LIMIT");
    const wait = this.delayMs - (Date.now() - this.lastStarted);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    await this.beforeRequest?.();
    this.lastStarted = Date.now();
    this.requests++;
    const started = Date.now(),
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "CampusOS-Research/0.1 (official public information collection)",
          // Some Spring Boot portals answer 500 when the Accept header has no
          // wildcard; keep */* so content negotiation never fails.
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          ...(validators?.etag ? { "If-None-Match": validators.etag } : {}),
          ...(validators?.lastModified
            ? { "If-Modified-Since": validators.lastModified }
            : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
    const status = response.status;
    if (
      (status >= 300 && status < 400 && status !== 304) ||
      [401, 403, 429].includes(status)
    ) {
      await response.body?.cancel();
      throw Error(status >= 300 && status < 400 ? "REDIRECT_REFUSED" : "BLOCKED");
    }
    const mime = response.headers.get("content-type") || "";
    if (
      status === 200 &&
      !(
        /^(text\/html|text\/plain|application\/xhtml\+xml)/i.test(mime) ||
        (kind === "sitemap" && /^(application|text)\/xml/i.test(mime))
      )
    ) {
      await response.body?.cancel();
      throw Error("MIME_NOT_ALLOWED");
    }
    // fetch() transparently decodes gzip/br but keeps the Content-Encoding
    // header, so a present encoding is not a size signal. The byte counter
    // below enforces the decoded cap for every response.
    if (Number(response.headers.get("content-length")) > 524288) {
      await response.body?.cancel();
      throw Error("TOO_LARGE");
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 524288) {
          await reader.cancel();
          throw Error("TOO_LARGE");
        }
        chunks.push(value);
      }
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const charset = mime.match(/charset=([\w-]+)/i)?.[1] || "utf-8";
    let html: string;
    try {
      html = new TextDecoder(charset, { fatal: true }).decode(data);
    } catch {
      throw Error("ENCODING_ERROR");
    }
    if (kind === "robots") {
      if (![200, 404].includes(status)) throw Error("ROBOTS_UNAVAILABLE");
      this.robots = status === 404 ? "" : html;
      this.delayMs = Math.max(
        this.delayMs,
        robotsCrawlDelay(this.robots),
      );
    }
    return {
      status,
      html,
      bytes,
      etag: response.headers.get("etag")?.slice(0, 200) || null,
      lastModified: response.headers.get("last-modified")?.slice(0, 200) || null,
      wallMs: Date.now() - started,
      hash: hex(await crypto.subtle.digest("SHA-256", data)),
    };
  }
}
