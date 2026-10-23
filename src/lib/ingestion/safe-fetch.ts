// Local Node executor only. TLS + DNS pinning; no cookies, redirects or private IPs.
import { lookup } from "node:dns/promises";
import { request, Agent } from "node:https";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { approvedUrl, type WebProfile } from "./profiles";
import { robotsAllow, robotsCrawlDelay } from "./robots";
export { robotsAllow } from "./robots";
export function isPublicAddress(ip: string) {
  if (isIP(ip) === 6)
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export type PageObservation = {
  status: number;
  html: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
  wallMs: number;
  hash: string;
};
export class SafeWebFetcher {
  // Explicit direct agent preserves the verified public-IP pin even if the CLI
  // uses an environment proxy for Cloudflare API authentication.
  readonly directAgent = new Agent({ keepAlive: false });
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
  ): Promise<PageObservation> {
    const url = new URL(approvedUrl(this.profile, raw, kind));
    if (
      kind !== "robots" &&
      (this.robots === null || !robotsAllow(this.robots, url.pathname))
    )
      throw Error("ROBOTS_DENIED");
    if (this.requests >= this.limit) throw Error("REQUEST_BUDGET");
    const wait = this.delayMs - (Date.now() - this.lastStarted);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(() => reject(Error("DNS_TIMEOUT")), 10000);
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address)))
      throw Error("PRIVATE_ADDRESS");
    const address = addresses.find((x) => x.family === 4) || addresses[0];
    await this.beforeRequest?.();
    this.requests++;
    this.lastStarted = Date.now();
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          agent: this.directAgent,
          family: address.family,
          headers: {
            "User-Agent":
              "CampusOS-Research/0.1 (manual bounded public-metadata review)",
            Accept: "text/html,text/plain;q=0.8",
            "Accept-Encoding": "identity",
            ...(validators?.etag ? { "If-None-Match": validators.etag } : {}),
            ...(validators?.lastModified
              ? { "If-Modified-Since": validators.lastModified }
              : {}),
          },
          lookup: (_host, _options, callback) =>
            callback(null, address.address, address.family),
          timeout: 15000,
        },
        (res) => {
          const status = res.statusCode || 0;
          if (
            (status >= 300 && status < 400 && status !== 304) ||
            [401, 403, 429].includes(status)
          ) {
            res.resume();
            reject(
              Error(
                status >= 300 && status < 400 ? "REDIRECT_REFUSED" : "BLOCKED",
              ),
            );
            return;
          }
          const mime = String(res.headers["content-type"] || "");
          if (
            status === 200 &&
            !(
              /^(text\/html|text\/plain|application\/xhtml\+xml)/i.test(mime) ||
              (kind === "sitemap" && /^(application|text)\/xml/i.test(mime))
            )
          ) {
            res.resume();
            reject(Error("MIME_NOT_ALLOWED"));
            return;
          }
          if (
            Number(res.headers["content-length"]) > 524288 ||
            (res.headers["content-encoding"] &&
              res.headers["content-encoding"] !== "identity")
          ) {
            res.resume();
            reject(Error("TOO_LARGE"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 524288) {
              req.destroy(Error("TOO_LARGE"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const data = Buffer.concat(chunks);
            const charset = mime.match(/charset=([\w-]+)/i)?.[1] || "utf-8";
            let html: string;
            try {
              html = new TextDecoder(charset, { fatal: true }).decode(data);
            } catch {
              reject(Error("ENCODING_ERROR"));
              return;
            }
            if (kind === "robots") {
              if (![200, 404].includes(status)) {
                reject(Error("ROBOTS_UNAVAILABLE"));
                return;
              }
              this.robots = status === 404 ? "" : html;
              this.delayMs = Math.max(
                this.delayMs,
                robotsCrawlDelay(this.robots),
              );
            }
            resolve({
              status,
              html,
              bytes,
              etag: res.headers.etag?.slice(0, 200) || null,
              lastModified: res.headers["last-modified"]?.slice(0, 200) || null,
              wallMs: Date.now() - started,
              hash: createHash("sha256").update(data).digest("hex"),
            });
          });
        },
      );
      const deadline = setTimeout(() => req.destroy(Error("TIMEOUT")), 15000);
      req.on("close", () => clearTimeout(deadline));
      req.on("timeout", () => req.destroy(Error("TIMEOUT")));
      req.on("error", reject);
      req.end();
    });
  }
}
