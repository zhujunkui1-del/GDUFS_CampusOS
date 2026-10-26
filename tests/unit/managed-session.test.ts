import { it, expect, vi } from "vitest";
vi.mock("@cloudflare/playwright", () => ({
  launch: vi.fn(),
  connect: vi.fn(),
}));
import { launch, connect } from "@cloudflare/playwright";
import { ManagedXhs } from "../../services/cloud-search/managed-xhs.mjs";
it("persists managed authentication only as authenticated ciphertext and refuses wrong keys or tampering", async () => {
  let saved: Uint8Array | undefined;
  const put = vi.fn(async (_key: string, bytes: Uint8Array) => {
    saved = new Uint8Array(bytes);
  });
  const bucket = {
    put,
    get: async () =>
      saved ? { arrayBuffer: async () => saved!.slice().buffer } : null,
  };
  const env = {
    PROFILE_KEY: Buffer.alloc(32, 7).toString("base64"),
    SESSIONS: bucket,
  };
  const state = {
    cookies: [{ name: "fixture-session", value: "fixture-private-value" }],
    origins: [],
  };
  const a = new ManagedXhs({}, env);
  Object.assign(a, { context: { storageState: async () => state } });
  await a.save();
  expect(Buffer.from(saved!).toString()).not.toContain("fixture-private-value");
  await a.save();
  expect(put).toHaveBeenCalledTimes(1);
  const b = new ManagedXhs({}, env);
  expect(await b.restore()).toEqual(state);
  await expect(
    new ManagedXhs(
      {},
      { ...env, PROFILE_KEY: Buffer.alloc(32, 8).toString("base64") },
    ).restore(),
  ).rejects.toThrow();
  saved![15] ^= 1;
  await expect(new ManagedXhs({}, env).restore()).rejects.toThrow();
});
it("keeps a QR session alive beyond its expiry and reconnects after an isolate restart", async () => {
  const values = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (k: string) => values.get(k),
      put: async (k: string, v: unknown) => {
        values.set(k, v);
      },
      delete: async (k: string) => values.delete(k),
    },
    waitUntil: vi.fn(),
  };
  const page = {
    goto: vi.fn(),
    waitForFunction: vi.fn(async () => {}),
    isClosed: () => false,
  };
  const context = {
    newPage: async () => page,
    on: vi.fn(),
    pages: () => [page],
  };
  const browser = {
    newContext: async () => context,
    isConnected: () => true,
    sessionId: () => "fixture-browser",
    contexts: () => [context],
  };
  vi.mocked(launch).mockResolvedValue(browser as never);
  vi.mocked(connect).mockResolvedValue(browser as never);
  const env = { BROWSER: {}, SESSIONS: { get: async () => null } };
  await new ManagedXhs(ctx, env).ensure();
  expect(launch).toHaveBeenLastCalledWith(env.BROWSER, { keep_alive: 240000 });
  await new ManagedXhs(ctx, env).ensure();
  expect(connect).toHaveBeenCalledWith(env.BROWSER, "fixture-browser");
  expect(launch).toHaveBeenCalledTimes(1);
});
it("accepts explicit source authentication, excludes guest identities and ignores foreign responses", async () => {
  const a = new ManagedXhs({}, {}),
    save = vi.fn(async () => {});
  Object.assign(a, { save });
  const response = (host: string, data: unknown) => ({
    url: () => `https://${host}/api/sns/web/v1/user/me`,
    status: () => 200,
    json: async () => data,
  });
  await a.observeResponse(
    response("webapi.rednote.com", {
      success: true,
      code: 0,
      data: { guest: true, user_id: "fixture-guest" },
    }),
  );
  await a.observeResponse(
    response("foreign.test", {
      success: true,
      code: 0,
      data: { guest: false, user_id: "fixture-auth" },
    }),
  );
  expect(save).not.toHaveBeenCalled();
  await a.observeResponse(
    response("webapi.rednote.com", {
      success: true,
      code: 0,
      data: { guest: false, user_id: "fixture-auth" },
    }),
  );
  expect(a.authConfirmed).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  expect(JSON.stringify(a.sourceEvents)).not.toContain("fixture-auth");
  Object.assign(a, {
    home: {
      evaluate: async () => ({
        loggedIn: false,
        login: true,
        verification: false,
      }),
    },
  });
  expect(await a.state()).toBe("logged_in");
  await a.observeResponse(
    response("webapi.rednote.com", {
      success: true,
      code: 0,
      data: { guest: true, user_id: "fixture-guest" },
    }),
  );
  expect(await a.state()).toBe("login_required");
});
it("reports a source 471 login challenge instead of waiting for the same QR indefinitely", async () => {
  const a = new ManagedXhs({}, {});
  Object.assign(a, {
    home: {
      evaluate: async () => ({
        loggedIn: false,
        login: true,
        verification: false,
      }),
    },
  });
  await a.observeResponse({
    url: () =>
      "https://edith.xiaohongshu.com/api/sns/web/v1/login/qrcode/status",
    status: () => 471,
    json: async () => ({ code: 0, success: true, data: {} }),
  });
  expect(await a.state()).toBe("verification_required");
});
