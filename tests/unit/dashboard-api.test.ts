import { it, expect, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
const mocked = vi.hoisted(() => ({
  context: vi.fn(),
  auth: vi.fn(),
  bindings: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: mocked.context,
}));
vi.mock("@/lib/server/console/auth", async (original) => ({
  ...(await original<object>()),
  requireConsole: mocked.auth,
}));
vi.mock("@/lib/server/assistant/database", async (original) => ({
  ...(await original<object>()),
  assistantBindings: mocked.bindings,
}));
import { visitPost } from "@/lib/server/console/traffic";
import { consoleAdministration } from "@/lib/server/console/api";
import {
  sourceControlFinishPost,
  sourceSessionReportPost,
} from "@/lib/server/external-search/relay-api";

it("public visit writes reject cross-origin and rate-limited requests before SQL", async () => {
  const f = sqliteD1();
  try {
    const prepare = vi.spyOn(f.db, "prepare");
    mocked.context.mockReturnValue({
      env: {
        DB: f.db,
        MAP_RATE_LIMITER: { limit: async () => ({ success: false }) },
      },
    });
    const req = (origin: string) =>
      new Request("https://preview.test/api/public/visits", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID(), views: 1 }),
      });
    expect((await visitPost(req("https://other.invalid"))).status).toBe(403);
    expect((await visitPost(req("https://preview.test"))).status).toBe(429);
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
it("source session control requires the administrator role, including cached status", async () => {
  const f = sqliteD1();
  try {
    mocked.auth.mockResolvedValue({
      actor: {
        id: "operator",
        role: "operator",
        email: "fixture@example.invalid",
      },
      config: { db: f.db },
      sessionHash: "fixture",
    });
    const prepare = vi.spyOn(f.db, "prepare");
    for (const method of ["GET", "POST"]) {
      const r = await consoleAdministration(
        new Request("https://preview.test/api/admin/v2/source-session", {
          method,
          ...(method === "POST"
            ? {
                body: JSON.stringify({
                  kind: "session_control",
                  action: "login",
                }),
              }
            : {}),
        }),
      );
      expect(r.status).toBe(403);
    }
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
it("login QR callbacks and state reports reject unauthenticated callers before SQL", async () => {
  const f = sqliteD1();
  try {
    mocked.bindings.mockReturnValue({
      db: f.db,
      environment: "preview",
      externalSearch: {
        transport: "d1-relay",
        gatewayToken: "fixture-gateway-key-with-32-characters",
      },
    });
    const prepare = vi.spyOn(f.db, "prepare");
    for (const endpoint of [sourceControlFinishPost, sourceSessionReportPost]) {
      const r = await endpoint(
        new Request(
          "https://preview.test/api/agent/external-search/control-finish",
          { method: "POST", body: "{}" },
        ),
      );
      expect(r.status).toBe(401);
    }
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
