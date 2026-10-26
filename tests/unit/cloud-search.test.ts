import { it, expect, vi } from "vitest";
import {
  createCloudSearch,
  cloudSourceSession,
  cloudVerification,
} from "@/lib/server/external-search/cloud";
vi.mock("@cloudflare/containers", () => ({ Container: class {} }));
vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
import worker from "../../services/cloud-search/worker.mjs";
const input = {
  kind: "web" as const,
  query: "广外图书馆借阅规则",
  limit: 2,
  policy: { intent: "official" as const, officialOnly: true, campus: true },
  onlyXhs: false,
};
it("cloud transport sends only validated requests and reports unavailable without invented results", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      provider: "cloud-fixture",
      status: "ok",
      items: [],
      durationMs: 10,
    }),
  );
  const result = await createCloudSearch({ fetch }, "fixture-token")(input);
  expect(result.provider).toBe("cloud-fixture");
  const req = fetch.mock.calls[0][0] as Request;
  expect(req.url).toBe("https://cloud-search.internal/v1/search");
  expect(req.headers.get("Authorization")).toBe("Bearer fixture-token");
  expect(await req.json()).toEqual(input);
  expect((await createCloudSearch(undefined, undefined)(input)).items).toEqual(
    [],
  );
});
it("administrator verification only accepts short-lived Cloudflare viewer URLs", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        url: "https://live.browser.run/ui/view?fixture=true",
        expiresAt: Date.now() + 300000,
      }),
    );
  expect((await cloudVerification({ fetch }, "fixture-token")).url).toContain(
    "https://live.browser.run/ui/",
  );
  fetch.mockResolvedValue(
    Response.json({
      url: "https://foreign.test/login",
      expiresAt: Date.now() + 300000,
    }),
  );
  await expect(cloudVerification({ fetch }, "fixture-token")).rejects.toThrow();
});
it("admin cloud state is a live cloud response, independent of old local snapshots", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      state: "logged_in",
      checkedAt: Date.now(),
      qr: null,
      qrExpiresAt: null,
    }),
  );
  expect(
    await cloudSourceSession({ fetch }, "fixture-token", "status"),
  ).toMatchObject({ location: "cloud", state: "logged_in" });
});
it("cloud worker rejects unauthorized requests and arbitrary routes before starting a container", async () => {
  const getByName = vi.fn(),
    env = {
      SERVICE_TOKEN: "fixture-only",
      PROFILE_KEY: "fixture-profile",
      SEARCH_CONTAINER: { getByName },
    };
  expect(
    (
      await worker.fetch(
        new Request("https://cloud.test/v1/search", { method: "POST" }),
        env,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await worker.fetch(
        new Request("https://cloud.test/internal/profile/export", {
          method: "POST",
          headers: { Authorization: "Bearer fixture-only" },
        }),
        env,
      )
    ).status,
  ).toBe(404);
  expect(getByName).not.toHaveBeenCalled();
});
