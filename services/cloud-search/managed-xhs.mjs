import { launch, connect } from "@cloudflare/playwright";
import { Buffer } from "node:buffer";
import {
  RelayInputSchema,
  RelayResultSchema,
} from "../../src/domain/retrieval/relay";
import { SourceSessionResultSchema } from "../../src/domain/console/dashboard";
import { xiaohongshuQuery } from "../external-search/query.mjs";
import { PublicNoteCache } from "../external-search/cache.mjs";
import { sourceQrImage } from "../external-search/qr-image.mjs";
const objectKey = "managed-xhs-state-v1.enc",
  aad = new TextEncoder().encode("campusos-preview:managed-xhs:v1");
const json = (status, data) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Source-Implementation": "managed-session-v2",
    },
  });
export class ManagedXhs {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.browser = null;
    this.context = null;
    this.home = null;
    this.opening = null;
    this.busy = false;
    this.cache = new PublicNoteCache();
    this.savedHash = "";
    this.qrIssuedAt = 0;
    this.sourceEvents = [];
    this.authConfirmed = false;
    this.verificationRequired = false;
  }
  async key() {
    return crypto.subtle.importKey(
      "raw",
      Buffer.from(this.env.PROFILE_KEY, "base64"),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }
  async hash(text) {
    return Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ).toString("hex");
  }
  async restore() {
    const saved = await this.env.SESSIONS.get(objectKey);
    if (!saved) return undefined;
    const bytes = new Uint8Array(await saved.arrayBuffer());
    if (bytes.length > 1048576 || bytes.length < 29)
      throw Error("SESSION_FORMAT");
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: aad },
      await this.key(),
      bytes.slice(12),
    );
    const text = new TextDecoder().decode(data);
    this.savedHash = await this.hash(text);
    return JSON.parse(text);
  }
  async save() {
    const text = JSON.stringify(
      await this.context.storageState({ indexedDB: true }),
    );
    if (new TextEncoder().encode(text).length > 1048000)
      throw Error("SESSION_LIMIT");
    const hash = await this.hash(text);
    if (hash === this.savedHash) return;
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        await this.key(),
        new TextEncoder().encode(text),
      );
    const bytes = new Uint8Array(12 + encrypted.byteLength);
    bytes.set(iv);
    bytes.set(new Uint8Array(encrypted), 12);
    await this.env.SESSIONS.put(objectKey, bytes);
    this.savedHash = hash;
  }
  async ensure() {
    if (this.browser?.isConnected() && this.home && !this.home.isClosed())
      return;
    if (!this.opening)
      this.opening = (async () => {
        this.sourceEvents = (await this.ctx.storage?.get("sourceEvents")) || [];
        const sessionId = await this.ctx.storage?.get("browserSession");
        if (sessionId) {
          try {
            this.browser = await connect(this.env.BROWSER, sessionId);
            this.context = this.browser.contexts()[0];
            this.home = this.context?.pages().find((p) => !p.isClosed());
            if (this.context && this.home) {
              this.verificationRequired = !!(await this.ctx.storage?.get(
                "verificationRequired",
              ));
              this.observe();
              return;
            }
            await this.browser.close();
          } catch {
            /* Expired browser sessions fall back to encrypted state. */
          }
        }
        const state = await this.restore();
        this.browser = await launch(this.env.BROWSER, { keep_alive: 240000 });
        await this.ctx.storage?.put("browserSession", this.browser.sessionId());
        this.qrIssuedAt = 0;
        this.authConfirmed = false;
        this.verificationRequired = false;
        await this.ctx.storage?.delete("verificationRequired");
        this.context = await this.browser.newContext({
          locale: "zh-CN",
          ...(state ? { storageState: state } : {}),
        });
        this.observe();
        this.home = await this.context.newPage();
        await this.home.goto("https://www.xiaohongshu.com/explore", {
          waitUntil: "domcontentloaded",
          timeout: 18000,
        });
        await this.home
          .waitForFunction(
            () =>
              !!document.querySelector(".qrcode-img,.login-btn") ||
              (() => {
                const r = window.__INITIAL_STATE__?.user?.userInfo,
                  i = r?.value ?? r?._value ?? r;
                return i?.guest === false && !!(i.userId || i.user_id);
              })() ||
              /安全限制/.test(document.title),
            null,
            { timeout: 10000 },
          )
          .catch(() => {});
      })().finally(() => {
        this.opening = null;
      });
    await this.opening;
  }
  observe() {
    this.context.on("response", (response) =>
      this.ctx.waitUntil(this.observeResponse(response)),
    );
  }
  async observeResponse(response) {
    try {
      const url = new URL(response.url());
      if (
        ![
          "edith.xiaohongshu.com",
          "www.xiaohongshu.com",
          "webapi.rednote.com",
        ].includes(url.hostname) ||
        !url.pathname.includes("/api/")
      )
        return;
      const data = await response.json(),
        value = data?.data;
      const sourceState =
        response.status() === 471
          ? "verification_required"
          : /\/user\/me$/.test(url.pathname) && data?.code === -101
            ? "session_expired"
            : /\/user\/me$/.test(url.pathname) &&
                data?.success === true &&
                value?.guest === true
              ? "guest"
              : /\/user\/me$/.test(url.pathname) &&
                  data?.success === true &&
                  value?.guest === false &&
                  (value.user_id || value.userId)
                ? "authenticated"
                : null;
      if (sourceState && this.sourceEvents.at(-1)?.state !== sourceState) {
        this.sourceEvents.push({
          state: sourceState,
          httpStatus: response.status(),
          code: data?.code,
          at: Date.now(),
        });
        this.sourceEvents = this.sourceEvents.slice(-12);
        await this.ctx.storage?.put("sourceEvents", this.sourceEvents);
      }
      if (response.status() === 471 && /\/login\//.test(url.pathname)) {
        this.verificationRequired = true;
        await this.ctx.storage?.put("verificationRequired", true);
      }
      if (
        /\/user\/me$/.test(url.pathname) &&
        (data?.code === -101 || value?.guest === true)
      ) {
        this.authConfirmed = false;
        this.cache = new PublicNoteCache();
      }
      if (
        response.status() !== 200 ||
        data?.success !== true ||
        data?.code !== 0
      )
        return;
      if (
        /\/user\/me$/.test(url.pathname) &&
        value?.guest === false &&
        (value.user_id || value.userId)
      ) {
        this.authConfirmed = true;
        this.verificationRequired = false;
        await this.ctx.storage?.delete("verificationRequired");
        await this.save();
      }
    } catch {
      /* Authentication is never inferred from a failed response. */
    }
  }
  async state() {
    const result = await this.home.evaluate(() => {
      const ref = window.__INITIAL_STATE__?.user?.userInfo,
        info = ref?.value ?? ref?._value ?? ref,
        qr = document.querySelector(".qrcode-img");
      return {
        loggedIn:
          (!!info && info.guest === false && !!(info.userId || info.user_id)) ||
          [
            ...document.querySelectorAll(
              ".main-container .user .link-wrapper .channel",
            ),
          ].some(
            (el) =>
              el.getClientRects().length > 0 &&
              getComputedStyle(el).visibility !== "hidden",
          ),
        login:
          !!qr &&
          qr.getClientRects().length > 0 &&
          getComputedStyle(qr).visibility !== "hidden",
        verification:
          /安全验证|访问验证|安全限制|访问受限|Security Verification/.test(
            document.title,
          ),
      };
    });
    return result.verification || this.verificationRequired
      ? "verification_required"
      : result.loggedIn || this.authConfirmed
        ? "logged_in"
        : result.login
          ? "login_required"
          : "unknown";
  }
  async session(action) {
    await this.ensure();
    if (action === "verify") {
      const cdp = await this.context.newCDPSession(this.home);
      try {
        const { devtoolsFrontendUrl } = await cdp.send(
          "Cloudflare.getLiveView",
          { mode: "tab", expiresInMs: 300000 },
        );
        return { url: devtoolsFrontendUrl, expiresAt: Date.now() + 300000 };
      } finally {
        await cdp.detach();
      }
    }
    let state = await this.state();
    if (
      action === "login" &&
      state !== "logged_in" &&
      state !== "verification_required"
    ) {
      {
        await this.home.reload({
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        this.qrIssuedAt = 0;
      }
      const qr = this.home
        .locator(".qrcode-img")
        .filter({ visible: true })
        .first();
      if (!(await qr.isVisible())) {
        const button = this.home
          .getByRole("button", { name: /^登录$|^Log in$|^Sign in$/ })
          .filter({ visible: true })
          .first();
        if (await button.isVisible()) await button.click({ timeout: 3000 });
      }
      try {
        await qr.waitFor({ state: "visible", timeout: 5000 });
        const image = await sourceQrImage(qr);
        this.qrIssuedAt = Date.now();
        if (image)
          return SourceSessionResultSchema.parse({
            state: "login_required",
            checkedAt: Date.now(),
            qr: image,
            qrExpiresAt: Date.now() + 180000,
          });
      } catch {
        /* No QR is fabricated when the source is unavailable. */
      }
      state = await this.state();
    }
    if (state === "logged_in") await this.save();
    return { state, checkedAt: Date.now(), qr: null, qrExpiresAt: null };
  }
  async search(raw) {
    const input = RelayInputSchema.parse(raw),
      start = performance.now();
    if (input.kind !== "xiaohongshu") throw Error("WRONG_PROVIDER");
    const keyword = xiaohongshuQuery(input.query) || input.query,
      cached = this.cache.get(keyword, input.limit);
    if (cached)
      return {
        provider: "xiaohongshu_cloud_browser",
        status: "ok",
        items: cached,
        durationMs: Math.round(performance.now() - start),
        cacheHit: true,
      };
    await this.ensure();
    const session = await this.state();
    if (session === "login_required" || session === "verification_required")
      return {
        provider: "xiaohongshu_cloud_browser",
        status: session === "login_required" ? "login_required" : "unavailable",
        items: [],
        durationMs: Math.round(performance.now() - start),
      };
    const page = await this.context.newPage();
    try {
      const url = new URL("https://www.xiaohongshu.com/search_result");
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("source", "web_explore_feed");
      await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForFunction(
        () => {
          const ref = window.__INITIAL_STATE__?.search?.feeds,
            f = ref?.value ?? ref?._value ?? ref;
          return Array.isArray(f) && f.length > 0;
        },
        null,
        { timeout: 10000 },
      );
      const feeds = await page.evaluate(() => {
        const ref = window.__INITIAL_STATE__?.search?.feeds,
          feeds = ref?.value ?? ref?._value ?? ref;
        return feeds
          .filter(
            (f) => f.modelType === "note" && f.id && f.xsecToken && f.noteCard,
          )
          .slice(0, 4)
          .map((f) => ({
            id: f.id,
            token: f.xsecToken,
            title: f.noteCard.displayTitle || "",
            author:
              f.noteCard.user?.nickname || f.noteCard.user?.nickName || "",
          }));
      });
      const items = await Promise.all(
        feeds.slice(0, input.limit).map(async (feed, index) => {
          const url = new URL(
            "https://www.xiaohongshu.com/explore/" +
              encodeURIComponent(feed.id),
          );
          url.searchParams.set("xsec_token", feed.token);
          url.searchParams.set("xsec_source", "pc_search");
          let detail = null;
          if (index < 2) {
            const detailPage = await this.context.newPage();
            try {
              await detailPage.goto(url.href, {
                waitUntil: "domcontentloaded",
                timeout: 10000,
              });
              await detailPage.waitForFunction(
                (id) =>
                  !!window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]?.note,
                feed.id,
                { timeout: 4000 },
              );
              detail = await detailPage.evaluate((id) => {
                const n =
                  window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]?.note;
                return n
                  ? { title: n.title, desc: n.desc, time: n.time }
                  : null;
              }, feed.id);
            } catch {
            } finally {
              await detailPage.close();
            }
          }
          const text = String(detail?.desc || "").slice(0, 700),
            at = Number(detail?.time),
            date =
              Number.isFinite(at) && at > 0
                ? new Date(at > 1e12 ? at : at * 1000)
                : null;
          return {
            title: String(detail?.title || feed.title || "小红书笔记").slice(
              0,
              250,
            ),
            originalUrl: url.href,
            sourceName: (
              "小红书" + (feed.author ? " · " + feed.author : "")
            ).slice(0, 160),
            platform: "xiaohongshu",
            authority: "student_experience",
            evidenceKind: text ? "page_excerpt" : "title_only",
            snippet: text || String(feed.title || "小红书笔记"),
            publishedAt:
              date && Number.isFinite(date.getTime())
                ? date.toISOString()
                : null,
            retrievedAt: new Date().toISOString(),
            searchMode: "platform",
            canConfirmAdministrativeFacts: false,
          };
        }),
      );
      this.cache.put(keyword, items);
      await this.save();
      return RelayResultSchema.parse({
        provider: "xiaohongshu_cloud_browser",
        status: items.length ? "ok" : "empty",
        items,
        durationMs: Math.round(performance.now() - start),
        cacheHit: false,
      });
    } finally {
      await page.close();
    }
  }
  async fetch(request) {
    if (this.busy) return json(503, { status: "busy" });
    this.busy = true;
    const path = new URL(request.url).pathname,
      start = performance.now();
    try {
      if (path === "/maintenance/managed-probe") {
        await this.ensure();
        const page = await this.home.evaluate(() => {
          const ref = window.__INITIAL_STATE__?.user?.userInfo,
            info = ref?.value ?? ref?._value ?? ref,
            nav = document.querySelector(
              ".main-container .user .link-wrapper .channel",
            ),
            qr = document.querySelector(".qrcode-img");
          return {
            title: document.title,
            path: location.pathname,
            guest: info?.guest,
            hasIdentity: !!(info?.userId || info?.user_id),
            navVisible: !!nav && nav.getClientRects().length > 0,
            qrVisible: !!qr && qr.getClientRects().length > 0,
          };
        });
        return json(200, {
          page,
          sourceEvents: this.sourceEvents,
          state: await this.state(),
          persisted: !!(await this.env.SESSIONS.head(objectKey)),
        });
      }
      if (path === "/maintenance/managed-restart") {
        if (this.context && (await this.state()) === "logged_in")
          await this.save();
        await this.browser?.close();
        this.browser = null;
        this.context = null;
        this.home = null;
        this.authConfirmed = false;
        this.verificationRequired = false;
        this.cache = new PublicNoteCache();
        await this.ctx.storage?.delete("browserSession");
        await this.ctx.storage?.delete("verificationRequired");
        return json(200, { restarted: true });
      }
      if (path === "/v1/search")
        return json(200, await this.search(await request.json()));
      return json(200, await this.session(path.split("/").at(-1)));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "managed.source.failure",
          operation: path,
          errorType: error?.name || "Error",
        }),
      );
      return json(
        200,
        path === "/v1/search"
          ? {
              provider: "xiaohongshu_cloud_browser",
              status: "unavailable",
              items: [],
              durationMs: Math.round(performance.now() - start),
            }
          : {
              state: "unavailable",
              checkedAt: Date.now(),
              qr: null,
              qrExpiresAt: null,
            },
      );
    } finally {
      this.busy = false;
    }
  }
}
