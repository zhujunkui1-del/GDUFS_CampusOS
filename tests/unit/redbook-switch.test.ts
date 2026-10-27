import { it, expect, vi } from "vitest";
vi.mock("@cloudflare/containers", () => ({ Container: class {} }));
vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
import worker from "../../services/cloud-search/worker.mjs";
import { RelayResultSchema } from "@/domain/retrieval/relay";
const input = {
  kind: "xiaohongshu",
  query: "广外南校一饭有什么好吃的",
  limit: 2,
  policy: { intent: "experience", officialOnly: false, campus: true },
  onlyXhs: true,
};
const request = (path: string, body = {}) =>
  new Request("https://gateway.test" + path, {
    method: "POST",
    headers: { Authorization: "Bearer fixture-gateway" },
    body: JSON.stringify(body),
  });
function environment() {
  const browser = vi.fn(),
    web = vi.fn();
  return {
    SERVICE_TOKEN: "fixture-gateway",
    REDBOOK_TOKEN: "fixture-provider",
    PROFILE_KEY: "fixture-key",
    REDBOOK_SEARCH: { fetch: vi.fn() },
    MANAGED_XHS: { getByName: vi.fn(() => ({ fetch: browser })) },
    SEARCH_CONTAINER: { getByName: vi.fn(() => ({ fetch: web })) },
    browser,
    web,
  };
}
it("switches native search to the service binding with its separate token and real bounded evidence", async () => {
  const env = environment();
  env.REDBOOK_SEARCH.fetch.mockImplementation(async (req: Request) => {
    expect(req.url).toBe("https://redbook.internal/probe");
    expect(req.headers.get("Authorization")).toBe("Bearer fixture-provider");
    expect(await req.json()).toEqual({
      query: "广外南校一饭",
      platform: "xhs",
      limit: 2,
    });
    return Response.json({
      status: "ok",
      items: [
        {
          title: "Fixture note",
          originalUrl: "https://www.xiaohongshu.com/explore/fixture",
          sourceName: "小红书 · Fixture",
          bodyAvailable: true,
          snippet: "Fixture body",
        },
        {
          title: "Fixture metadata",
          originalUrl: "https://www.xiaohongshu.com/explore/fixture2",
          sourceName: "小红书",
          bodyAvailable: false,
        },
      ],
    });
  });
  const result = RelayResultSchema.parse(
    await (await worker.fetch(request("/v1/search", input), env)).json(),
  );
  expect(result.provider).toBe("xiaohongshu_redbook_cloud");
  expect(result.items[0]).toMatchObject({
    evidenceKind: "page_excerpt",
    authority: "student_experience",
    canConfirmAdministrativeFacts: false,
  });
  expect(result.items[1].evidenceKind).toBe("title_only");
  expect(env.browser).not.toHaveBeenCalled();
  expect(env.web).not.toHaveBeenCalled();
});
it("keeps ordinary web search on the existing container", async () => {
  const env = environment();
  env.web.mockResolvedValue(Response.json({ provider: "existing-web" }));
  await worker.fetch(
    request("/v1/search", { ...input, kind: "web", onlyXhs: false }),
    env,
  );
  expect(env.web).toHaveBeenCalledOnce();
  expect(env.REDBOOK_SEARCH.fetch).not.toHaveBeenCalled();
});
it("reports SDK login and preserves valid credentials when admin clicks login", async () => {
  const env = environment();
  env.REDBOOK_SEARCH.fetch.mockImplementation(async () =>
    Response.json({ authenticated: true, status: "ok" }),
  );
  for (const path of ["status", "poll", "login"]) {
    const result = await (
      await worker.fetch(request("/v1/session/" + path), env)
    ).json();
    expect(result).toMatchObject({ state: "logged_in", qr: null });
  }
  expect(env.browser).not.toHaveBeenCalled();
});
it("never restores or opens the retired main-account browser when the new session expires", async () => {
  const env = environment();
  env.REDBOOK_SEARCH.fetch.mockImplementation(async () =>
    Response.json({ authenticated: false, status: "login_required" }),
  );
  env.browser.mockResolvedValue(
    Response.json({
      state: "logged_in",
      checkedAt: Date.now(),
      qr: null,
      qrExpiresAt: null,
    }),
  );
  for (const action of ["status", "poll", "login"]) {
    const result = await (
      await worker.fetch(request("/v1/session/" + action), env)
    ).json();
    expect(result.state).toBe("login_required");
  }
  expect((await worker.fetch(request("/v1/session/verify"), env)).status).toBe(
    503,
  );
  expect(env.browser).not.toHaveBeenCalled();
});
