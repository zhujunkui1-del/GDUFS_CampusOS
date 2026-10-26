import { it, expect, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
const mocked = vi.hoisted(() => ({ bindings: vi.fn() }));
vi.mock("@/lib/server/assistant/database", () => ({
  assistantBindings: mocked.bindings,
}));
import {
  relayClaimPost,
  relayFinishPost,
} from "@/lib/server/external-search/relay-api";
const token = "fixture-only-gateway-key-with-thirty-two-characters";
function request(route: string, body: unknown, key = token) {
  return new Request(
    "https://preview.test/api/agent/external-search/" + route,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}
it("runner authentication fails before any database operation", async () => {
  const f = sqliteD1();
  try {
    mocked.bindings.mockReturnValue({
      db: f.db,
      environment: "preview",
      externalSearch: { transport: "d1-relay", gatewayToken: token },
    });
    const prepare = vi.spyOn(f.db, "prepare");
    const r = await relayClaimPost(
      request(
        "claim",
        { runnerId: crypto.randomUUID(), waitMs: 0 },
        "wrong-key",
      ),
    );
    expect(r.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
    expect(JSON.stringify(await r.json())).not.toContain(token);
  } finally {
    f.close();
  }
});
it("production never enables this Preview transport", async () => {
  mocked.bindings.mockReturnValue({
    environment: "production",
    externalSearch: { transport: "d1-relay", gatewayToken: token },
  });
  const r = await relayClaimPost(
    request("claim", { runnerId: crypto.randomUUID(), waitMs: 0 }),
  );
  expect(r.status).toBe(503);
});
it("authenticated idle polls are empty and malformed results cannot reach storage", async () => {
  const f = sqliteD1();
  try {
    mocked.bindings.mockReturnValue({
      db: f.db,
      environment: "preview",
      externalSearch: { transport: "d1-relay", gatewayToken: token },
    });
    const r = await relayClaimPost(
      request("claim", { runnerId: crypto.randomUUID(), waitMs: 0 }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).data.work).toBeNull();
    const invalid = await relayFinishPost(
      request("finish", {
        id: crypto.randomUUID(),
        runnerId: crypto.randomUUID(),
        result: { provider: "made-up", items: "not-results" },
      }),
    );
    expect(invalid.status).toBe(400);
    expect(
      f.sqlite
        .prepare("SELECT count(*) AS n FROM agent_external_search_jobs")
        .get()?.n,
    ).toBe(0);
  } finally {
    f.close();
  }
});
