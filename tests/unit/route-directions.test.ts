import { expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ApiError } from "@/lib/server/errors";
import { MockModelProvider } from "../fixtures/mock-model";
import { CampusMapService } from "@/lib/server/maps/campus-map-service";
import { MemoryRouteSnapshotStore } from "@/lib/server/maps/route-store";
import { routeDirectionsText } from "@/lib/server/maps/route-directions";
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

const dorm = "osm-way-312536955",
  library = "osm-way-307250998";

async function plannedRoute() {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const service = new CampusMapService(
    new MemoryRouteSnapshotStore(() => now),
    () => now,
  );
  return service.plan(
    {
      start: { type: "place", placeId: dorm },
      endPlaceId: library,
      mode: "walking",
    },
    {
      requestId: "route-directions",
      sessionId: "fixture",
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
    },
  );
}

it("renders only the steps the planner returned", async () => {
  const route = await plannedRoute();
  const text = routeDirectionsText(route);
  expect(text).toContain(`从${route.start.name}到${route.end.name}`);
  expect(text).toContain(`${Math.round(route.distanceMeters)} 米`);
  expect(text).toContain(`${route.estimatedMinutes} 分钟`);
  for (const step of route.steps) expect(text).toContain(step.instruction);
  expect(text).toContain("下沉隧道");
  expect(text.split("\n").filter((line) => /^\d+\. /.test(line))).toHaveLength(
    route.steps.length,
  );
});

it("answers with words when the model cannot finish a route that was already parsed", async () => {
  const f = sqliteD1();
  runtime.env = {
    DB: f.db,
    APP_ENV: "preview",
    AGENT_VALIDATION_UNLIMITED: "true",
    AGENT_SIGNING_SECRET:
      "isolated-test-signing-key-at-least-thirty-two-characters",
  };
  const client = new MockModelProvider([
    new ApiError("MODEL_TIMEOUT", "模型回复超时，请重试。", true),
  ]);
  runtime.resolve.mockResolvedValue({
    client,
    snapshot: {
      source: "platform",
      provider: "stepfun",
      model: "isolated",
      policyVersion: "isolated",
      testedAt: "2026-10-28T00:00:00Z",
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    },
  });
  try {
    const response = await chatResponse(
      new Request("https://campus.invalid/api/agent/chat", {
        method: "POST",
        headers: {
          Origin: "https://campus.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "从南苑7栋到图书馆",
          clientRequestId: crypto.randomUUID(),
        }),
      }),
    );
    expect(response.status).toBe(200);
    const events = (await response.text()).split("\n\n").flatMap((frame) => {
      const raw = frame.split("\n").find((line) => line.startsWith("data:"));
      return raw ? [JSON.parse(raw.slice(5))] : [];
    });
    const terminal = events.find((event) => event.type === "run.completed");
    expect(terminal?.payload.metrics).toMatchObject({
      answerMode: "route_directions",
      modelFailureCode: "MODEL_TIMEOUT",
    });
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
    const text = events
      .filter((event) => event.type === "message.delta")
      .map((event) => String(event.payload.text))
      .join("");
    expect(text).toContain("先用文字给你指路");
    expect(text).toContain("下沉隧道");
  } finally {
    f.close();
  }
});
