// A browser that grants location must actually be routed from where it is.
//
// The reported failure was: tap 「带我去图书馆」, allow the permission, and still
// get "请授权定位或输入起点". The grant was fine; the server described the
// device as a place named "device_location", so resolveOrigin rejected it.
// These cases pin the contract: the device origin is a device origin, and a
// granted location produces a route.
import { expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { MockModelProvider } from "../fixtures/mock-model";
import { AssistantStore } from "@/lib/server/assistant/store";
import { CampusMapService } from "@/lib/server/maps/campus-map-service";
import { MemoryRouteSnapshotStore } from "@/lib/server/maps/route-store";
const runtime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  resolve: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: runtime.env }),
}));
vi.mock("@/lib/server/models/runtime", () => ({
  defaultModelRuntime: () => ({ resolve: runtime.resolve }),
}));
import { chatResponse } from "@/lib/server/assistant/chat";

const library = "osm-way-307250998";
const snapshot = {
  source: "platform" as const,
  provider: "stepfun" as const,
  model: "isolated",
  policyVersion: "isolated",
  testedAt: "2026-10-28T00:00:00Z",
  capabilities: {
    toolCalling: true,
    jsonObject: true,
    strictJsonSchema: false,
  },
};

function parseEvents(body: string) {
  return body
    .split("\n\n")
    .flatMap((frame) => {
      const raw = frame.split("\n").find((line) => line.startsWith("data:"));
      return raw
        ? [
            JSON.parse(raw.slice(5)) as {
              type: string;
              payload: Record<string, unknown>;
            },
          ]
        : [];
    })
    .filter(Boolean);
}

it("plans from an authorized device location, not a place named device_location", async () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const service = new CampusMapService(
    new MemoryRouteSnapshotStore(() => now),
    () => now,
  );
  const route = await service.plan(
    {
      start: { type: "device_location" },
      endPlaceId: library,
      mode: "walking",
    },
    {
      requestId: "device-origin",
      sessionId: "fixture",
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
      map: {
        requiresDeviceOrigin: true,
        authorizedLocation: {
          coordinate: [113.3915, 23.0645],
          accuracyMeters: 18,
          capturedAt: now - 1000,
          expiresAt: now + 29000,
          consent: "browser_geolocation",
        },
      },
    },
  );
  expect(route.start.name).toBe("我的位置");
  expect(route.start.source).toBe("authorized_device_location");
  expect(route.distanceMeters).toBeGreaterThan(0);
});

it("offers the model a device start after a granted location, and answers the route", async () => {
  const f = sqliteD1();
  runtime.env = {
    DB: f.db,
    APP_ENV: "preview",
    AGENT_VALIDATION_UNLIMITED: "true",
    AGENT_SIGNING_SECRET:
      "isolated-test-signing-key-at-least-thirty-two-characters",
  };
  const store = new AssistantStore(f.db, undefined, true);
  const identity = await store.identity(new Request("https://fixture.invalid"));
  const challenge = await store.locationChallenge(identity);
  const client = new MockModelProvider([
    {
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function" as const,
          function: {
            name: "plan_route",
            arguments: JSON.stringify({
              start: { type: "device_location" },
              endPlaceId: library,
              mode: "walking",
            }),
          },
        },
      ],
      finishReason: "tool_calls" as const,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    },
    {
      content: "已经为你规划好路线。",
      finishReason: "stop" as const,
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    },
  ]);
  runtime.resolve.mockResolvedValue({ client, snapshot });
  try {
    const response = await chatResponse(
      new Request("https://campus.invalid/api/agent/chat", {
        method: "POST",
        headers: {
          Origin: "https://campus.invalid",
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "带我去图书馆",
          clientRequestId: crypto.randomUUID(),
          locationGrant: {
            challenge,
            coordinate: [113.3915, 23.0645],
            accuracyMeters: 18,
            capturedAt: Date.now(),
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const events = parseEvents(await response.text());
    const offered = JSON.stringify(client.requests[0]?.tools ?? []);
    expect(offered).toContain('"const":"device_location"');
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
    const plan = events.find(
      (event) =>
        event.type === "tool.finished" && event.payload?.name === "plan_route",
    );
    expect(plan?.payload.ok).toBe(true);
  } finally {
    f.close();
  }
});
