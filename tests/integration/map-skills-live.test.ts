import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import type { ModelClient } from "@/domain/models/contracts";
import type { AgentEvent } from "@/domain/agent/contracts";
import { ModelRouter } from "@/lib/server/models/router";
import { CampusMapService } from "@/lib/server/maps/campus-map-service";
import { createMapAgent } from "@/lib/server/maps/agent";
import { ApiError } from "@/lib/server/errors";
import { RouteOutputSchema } from "@/domain/maps/skill-contracts";

test.skipIf(process.env.MODEL_LIVE_TEST !== "1")(
  "real DeepSeek autonomously selects and executes the five production map Skills",
  async () => {
    const started = performance.now();
    const signal = AbortSignal.timeout(60000);
    let requests = 0;
    const { client, snapshot } = await new ModelRouter({
      apiKey: process.env.MODEL_API_KEY,
      model: process.env.MODEL_NAME,
      baseUrl: process.env.MODEL_BASE_URL,
      capabilityReceipt: process.env.MODEL_CAPABILITIES_JSON,
    }).resolve();
    const selectedCalls = new Map<string, { name: string; input: unknown }>();
    const bounded: ModelClient = {
      generateWithTools: async (request) => {
        if (++requests > 10)
          throw new ApiError(
            "MODEL_TEST_BUDGET_EXCEEDED",
            "受控测试已达到请求预算。",
          );
        const reply = await client.generateWithTools({
          ...request,
          maxTokens: Math.min(request.maxTokens, 512),
          signal: AbortSignal.any([signal, request.signal]),
        });
        for (const call of reply.toolCalls)
          selectedCalls.set(call.id, {
            name: call.function.name,
            input: JSON.parse(call.function.arguments),
          });
        return reply;
      },
      generateStructured: async () => {
        throw new Error("Not required for this tool integration test");
      },
    };
    const evidence: {
      prompt: string;
      result: unknown;
      tools: unknown[];
      response: string;
    }[] = [];
    async function run(prompt: string) {
      const events: AgentEvent[] = [];
      const { orchestrator } = createMapAgent(new CampusMapService(), {
        resolve: async () => ({ client: bounded, snapshot }),
      });
      const result = await orchestrator.run({
        message: prompt,
        context: {
          requestId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          campusId: "gdufs_university_town",
          user: null,
          permissions: [],
          signal,
        },
        onEvent: (event) => events.push(event),
      });
      const tools = events
        .filter((event) => event.type === "tool.finished")
        .map((event) => ({
          ...selectedCalls.get(String(event.payload.toolCallId)),
          result: event.payload.result,
        }));
      evidence.push({
        prompt,
        result,
        tools,
        response: events
          .filter((event) => event.type === "message.delta")
          .map((event) => event.payload.text)
          .join(""),
      });
      return { result, tools };
    }
    const found = await run(
      "帮我找到南苑7栋，查询该楼的真实地点详情，并查询它1000米内的食堂。最后生成定位到该楼的地图操作意图。请简短回答，不要输出坐标数组。",
    );
    expect(found.result.status).toBe("completed");
    expect(found.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "search_places",
        "get_place_details",
        "find_nearby_places",
        "control_map",
      ]),
    );
    const routeRun = await run(
      "从南苑7栋怎么走到图书馆？请按真实步行路网规划，并生成显示该路线的地图操作意图。请简短回答距离和预计时间。",
    );
    expect(routeRun.result.status).toBe("completed");
    const routeTool = routeRun.tools.find((tool) => tool.name === "plan_route");
    expect(routeTool).toBeDefined();
    const route = RouteOutputSchema.parse(
      (routeTool!.result as { data: unknown }).data,
    );
    expect(route.start.placeId).toBe("osm-way-312536955");
    expect(route.end.placeId).toBe("osm-way-307250998");
    expect(route.usesTunnel).toBe(true);
    const action = routeRun.tools.find((tool) => tool.name === "control_map");
    expect(action).toBeDefined();
    expect(JSON.stringify(action!.result)).toContain(route.routeId);
    const missing = await run("帮我找到南苑999栋，并定位过去。");
    expect(missing.result).toMatchObject({
      status: "failed",
      code: "NOT_FOUND",
    });
    expect(missing.tools.some((tool) => tool.name === "control_map")).toBe(
      false,
    );
    const allNames = [
      ...new Set(
        evidence.flatMap((item) =>
          (item.tools as { name: string }[]).map((tool) => tool.name),
        ),
      ),
    ];
    expect(allNames).toEqual(
      expect.arrayContaining([
        "search_places",
        "get_place_details",
        "find_nearby_places",
        "plan_route",
        "control_map",
      ]),
    );
    await mkdir("docs/verification/s2-b", { recursive: true });
    await writeFile(
      "docs/verification/s2-b/deepseek-live.json",
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          realApi: true,
          model: snapshot,
          maxRequests: 10,
          requests,
          maxOutputTokensPerRequest: 512,
          durationMs: Math.round(performance.now() - started),
          forcedToolChoice: false,
          source: "fixed campus data and existing planLocalRoute",
          frontendActionsExecuted: false,
          names: allNames,
          scenarios: evidence,
        },
        null,
        2,
      ) + "\n",
    );
  },
);
