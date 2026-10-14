import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: {} }),
}));
import { POST } from "@/app/api/agent/chat/route";
import { GET as agentStatus } from "@/app/api/agent/status/route";
import { GET as health } from "@/app/api/health/route";
import { mapRuntime } from "@/lib/server/map-env";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("S2-A HTTP fail-closed boundary", () => {
  it("bounds slow request bodies with a server deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const pending = POST(
      new Request("https://example.invalid/api/agent/chat", {
        method: "POST",
        body: new ReadableStream({ start() {} }),
        duplex: "half",
      } as RequestInit),
    );
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).status).toBe(504);
  });
  it("never forwards unregistered business requests to a paid model", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("https://example.invalid/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "南苑7栋" }),
      }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("rejects forged identity and oversized streaming body with no key reflection", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const body of [
      JSON.stringify({
        message: "test",
        userId: "admin",
        apiKey: "test-secret",
      }),
      JSON.stringify({ message: "x".repeat(9000) }),
    ]) {
      const response = await POST(
        new Request("https://example.invalid/api/agent/chat", {
          method: "POST",
          body,
        }),
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain(
        "test-secret",
      );
    }
  });
  it("returns truthful missing-model status without a network probe", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("MODEL_NAME", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const body = await (
      await agentStatus(new Request("https://example.invalid/api/agent/status"))
    ).json();
    expect(body.data.model).toEqual({
      ready: false,
      code: "MODEL_SELECTION_REQUIRED",
    });
    expect(body.data.chatAvailable).toBe(false);
    expect(body.data.skills).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("keeps map runtime and service health independent of broken model configuration", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("MODEL_BASE_URL", "bad-test-model-endpoint");
    expect(mapRuntime().env.APP_ENV).toBe("local");
    expect(
      (await health(new Request("https://example.invalid/api/health"))).status,
    ).toBe(200);
  });
});
