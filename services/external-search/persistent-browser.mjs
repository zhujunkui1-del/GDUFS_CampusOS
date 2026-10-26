// Normal dedicated Edge profile. No default-browser cookie access, UA spoofing,
// CAPTCHA handling, posting, likes or private messages. Public page-state shapes
// follow xpzouying/xiaohongshu-mcp (Apache-2.0); credentials stay on this machine.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

export function parseSavedCookies(data) {
  const cookies = Array.isArray(data) ? data : data.cookies || [];
  return cookies
    .filter(
      (c) =>
        typeof c.name === "string" &&
        typeof c.value === "string" &&
        /^(?:\.)?xiaohongshu\.com$/.test(c.domain || ""),
    )
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      ...(typeof c.expires === "number" && c.expires > 0
        ? { expires: c.expires }
        : {}),
      ...(["Strict", "Lax", "None"].includes(c.sameSite)
        ? { sameSite: c.sameSite }
        : {}),
    }));
}
export function sessionFromState(
  info,
  loginVisible = false,
  verificationVisible = false,
) {
  if (verificationVisible) return "verification_required";
  if (info && !info.guest && (info.userId || info.user_id)) return "logged_in";
  if (loginVisible) return "login_required";
  return "unknown";
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export class PersistentXhsBrowser {
  constructor(runtime) {
    this.runtime = runtime;
    this.profile = path.join(runtime, "xiaohongshu-browser-profile");
    this.context = null;
    this.starting = null;
    this.home = null;
    this.watcher = null;
  }
  async contextForSession() {
    if (this.context) return this.context;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      await fs.mkdir(this.profile, { recursive: true });
      const used = await exists(
        path.join(this.runtime, "browser-profile-initialized.json"),
      );
      const context = await chromium.launchPersistentContext(this.profile, {
        channel: "msedge",
        headless: false,
        viewport: { width: 1280, height: 900 },
      });
      this.context = context;
      context.on("close", () => {
        this.context = null;
        this.home = null;
        this.watcher = null;
      });
      if (!used) {
        // One-time migration of the already-authorized dedicated source session.
        // Never overwrite a live browser profile from the old JSON on restart.
        try {
          const data = JSON.parse(
            await fs.readFile(
              path.join(this.runtime, "data/cookies.json"),
              "utf8",
            ),
          );
          await context.addCookies(parseSavedCookies(data));
        } catch {
          /* A failed import does not imply that login succeeded. */
        }
        await fs.writeFile(
          path.join(this.runtime, "browser-profile-initialized.json"),
          JSON.stringify({
            initializedAt: new Date().toISOString(),
            profile: this.profile,
          }),
          { mode: 0o600 },
        );
      }
      this.home = context.pages()[0] || (await context.newPage());
      try {
        await this.home.goto("https://www.xiaohongshu.com/explore", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      } catch {
        /* Keep the real page visible for the owner; report unknown on failure. */
      }
      return context;
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async inspect() {
    const page = this.home;
    if (!page || page.isClosed()) return { state: "unknown", loggedIn: null };
    try {
      const result = await page.evaluate(() => {
        const state = window.__INITIAL_STATE__;
        const ref = state?.user?.userInfo;
        const info = ref?.value ?? ref?._value ?? ref;
        const qr = document.querySelector(
          ".login-container .qrcode-img,.login-modal .qrcode-img",
        );
        const login =
          !!qr &&
          qr.getClientRects().length > 0 &&
          getComputedStyle(qr).visibility !== "hidden";
        return {
          info: info
            ? {
                guest: !!info.guest,
                hasIdentity: !!(info.userId || info.user_id),
              }
            : null,
          login,
          verification: /安全验证|访问验证|Security Verification/i.test(
            document.title,
          ),
        };
      });
      const state = sessionFromState(
        result.info?.hasIdentity
          ? { guest: result.info.guest, userId: "present" }
          : null,
        result.login,
        result.verification,
      );
      return {
        state,
        loggedIn:
          state === "logged_in"
            ? true
            : state === "login_required"
              ? false
              : null,
        provider: "persistent-edge",
        profilePersistent: true,
      };
    } catch {
      return {
        state: "unknown",
        loggedIn: null,
        provider: "persistent-edge",
        profilePersistent: true,
      };
    }
  }
  async status() {
    await this.contextForSession();
    if ((await this.inspect()).state !== "login_required") {
      try {
        await this.home.reload({
          waitUntil: "domcontentloaded",
          timeout: 12000,
        });
      } catch {
        return { state: "unknown", loggedIn: null };
      }
    }
    return this.inspect();
  }
  async open() {
    await this.contextForSession();
    await this.home.bringToFront();
    if (!this.watcher) {
      this.watcher = this.home
        .waitForFunction(
          () => {
            const ref = window.__INITIAL_STATE__?.user?.userInfo;
            const info = ref?.value ?? ref?._value ?? ref;
            return !!info && !info.guest && !!(info.userId || info.user_id);
          },
          null,
          { timeout: 240000 },
        )
        .then(async () => {
          await fs.writeFile(
            path.join(this.runtime, "browser-session-metadata.json"),
            JSON.stringify({
              lastConfirmedAt: new Date().toISOString(),
              state: "logged_in",
              profilePersistent: true,
            }),
            { mode: 0o600 },
          );
        })
        .catch(() => {})
        .finally(() => {
          this.watcher = null;
        });
    }
    return this.inspect();
  }
  async login() {
    const current = await this.status();
    if (current.state === "logged_in") return current;
    if (current.state === "login_required") {
      try {
        await this.home.reload({
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
      } catch {
        return { state: "unknown", loggedIn: null };
      }
    }
    await this.open();
    let result = await this.inspect();
    if (
      result.state === "logged_in" ||
      result.state === "verification_required"
    )
      return result;
    const page = this.home;
    const qr = page
      .locator(".login-container .qrcode-img,.login-modal .qrcode-img")
      .filter({ visible: true })
      .first();
    if (!(await qr.isVisible())) {
      // Only open the platform's login UI. Never log out or delete a saved profile.
      const login = page
        .getByText("登录", { exact: true })
        .filter({ visible: true })
        .first();
      if (await login.isVisible()) await login.click({ timeout: 3000 });
    }
    try {
      await qr.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      return this.inspect();
    }
    result = await this.inspect();
    if (result.state !== "login_required") return result;
    const png = await qr.screenshot({ type: "png", timeout: 5000 });
    if (png.length > 130000) return result;
    return {
      ...result,
      qr: "data:image/png;base64," + png.toString("base64"),
      qrExpiresAt: Date.now() + 180000,
    };
  }
  async close() {
    const ctx = this.context;
    if (ctx) await ctx.close();
  }
  async withPage(signal, action) {
    signal?.throwIfAborted();
    const ctx = await this.contextForSession();
    const page = await ctx.newPage();
    const stop = () => void page.close().catch(() => {});
    signal?.addEventListener("abort", stop, { once: true });
    try {
      return await action(page);
    } finally {
      signal?.removeEventListener("abort", stop);
      await page.close().catch(() => {});
    }
  }
  async search(query, limit, signal) {
    await this.contextForSession();
    const status = await this.inspect();
    if (status.state === "login_required")
      return { status: "login_required", items: [] };
    if (status.state === "verification_required")
      return { status: "unavailable", items: [] };
    return this.withPage(signal, async (page) => {
      const url = new URL("https://www.xiaohongshu.com/search_result");
      url.searchParams.set("keyword", query);
      url.searchParams.set("source", "web_explore_feed");
      await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForFunction(
        () => {
          const r = window.__INITIAL_STATE__?.search?.feeds;
          const items = r?.value ?? r?._value ?? r;
          return Array.isArray(items) && items.length > 0;
        },
        null,
        { timeout: 12000 },
      );
      const feeds = await page.evaluate(() => {
        const r = window.__INITIAL_STATE__?.search?.feeds;
        const values = r?.value ?? r?._value ?? r;
        return values
          .filter(
            (f) => f.modelType === "note" && f.id && f.xsecToken && f.noteCard,
          )
          .slice(0, 8)
          .map((f) => ({
            id: f.id,
            token: f.xsecToken,
            title: f.noteCard.displayTitle || "",
            author:
              f.noteCard.user?.nickname || f.noteCard.user?.nickName || "",
          }));
      });
      const items = await Promise.all(
        feeds.slice(0, limit).map(async (feed, index) => {
          const original = new URL(
            "https://www.xiaohongshu.com/explore/" +
              encodeURIComponent(feed.id),
          );
          original.searchParams.set("xsec_token", feed.token);
          original.searchParams.set("xsec_source", "pc_search");
          let detail = null;
          if (index < 2 && !signal?.aborted) {
            try {
              detail = await this.withPage(signal, async (detailPage) => {
                await detailPage.goto(original.href, {
                  waitUntil: "domcontentloaded",
                  timeout: 15000,
                });
                await detailPage.waitForFunction(
                  (id) => {
                    const r = window.__INITIAL_STATE__?.note?.noteDetailMap;
                    const map = r?.value ?? r?._value ?? r;
                    return !!map?.[id]?.note;
                  },
                  feed.id,
                  { timeout: 10000 },
                );
                return detailPage.evaluate((id) => {
                  const r = window.__INITIAL_STATE__?.note?.noteDetailMap;
                  const map = r?.value ?? r?._value ?? r;
                  const note = map?.[id]?.note;
                  return note
                    ? {
                        title: note.title,
                        desc: note.desc,
                        time: note.time,
                        author:
                          note.user?.nickname || note.user?.nickName || "",
                      }
                    : null;
                }, feed.id);
              });
            } catch {
              /* Keep metadata honest; no image/comment content is invented. */
            }
          }
          const time = Number(detail?.time);
          const date =
            Number.isFinite(time) && time > 0
              ? new Date(time > 1e12 ? time : time * 1000)
              : null;
          const title = String(
              detail?.title || feed.title || "小红书笔记",
            ).slice(0, 250),
            snippet = String(detail?.desc || "").slice(0, 700);
          return {
            title,
            originalUrl: original.href,
            sourceName: (
              "小红书 · " + (detail?.author || feed.author || "笔记作者")
            ).slice(0, 160),
            platform: "xiaohongshu",
            authority: "student_experience",
            evidenceKind: snippet ? "page_excerpt" : "title_only",
            snippet: snippet || title,
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
      return { status: items.length ? "ok" : "empty", items };
    });
  }
}
