import { describe, expect, it, vi } from "vitest";
import { PersonalModelClient } from "@/lib/server/models/personal-client";
import type { ModelRequest } from "@/domain/models/contracts";

const request: ModelRequest = {
  messages: [{ role: "user", content: "test" }],
  tools: [],
  maxTokens: 128,
  signal: new AbortController().signal,
};

function sse(events: Array<{ event?: string; data: unknown }>) {
  const text = events
    .map(
      ({ event, data }) =>
        `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
    )
    .join("");
  return new Response(text, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("personal model streaming", () => {
  it("forwards OpenAI-compatible deltas as they arrive", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      sse([
        {
          data: {
            choices: [{ index: 0, delta: { content: "你" }, finish_reason: null }],
          },
        },
        {
          data: {
            choices: [{ index: 0, delta: { content: "好" }, finish_reason: "stop" }],
          },
        },
        { data: "[DONE]" },
      ]),
    );
    const client = new PersonalModelClient(
      {
        provider: "custom",
        baseUrl: "https://api.example.com/v1",
        model: "model-a",
        apiKey: "sk-test",
      },
      transport,
    );
    const chunks: string[] = [];
    const reply = await client.generateWithTools({
      ...request,
      onText: (text) => chunks.push(text),
    });
    expect(chunks).toEqual(["你", "好"]);
    expect(reply.content).toBe("你好");
    expect(reply.finishReason).toBe("stop");
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.stream).toBe(true);
  });

  it("falls back to one chunk when a provider ignores stream=true", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ message: { content: "完整回答" }, finish_reason: "stop" }],
      }),
    );
    const client = new PersonalModelClient(
      {
        provider: "custom",
        baseUrl: "https://api.example.com/v1",
        model: "model-a",
        apiKey: "sk-test",
      },
      transport,
    );
    const chunks: string[] = [];
    const reply = await client.generateWithTools({
      ...request,
      onText: (text) => chunks.push(text),
    });
    expect(chunks).toEqual(["完整回答"]);
    expect(reply.content).toBe("完整回答");
  });

  it("assembles OpenAI-compatible tool calls from streamed fragments", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      sse([
        {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: { name: "search_places", arguments: '{"qu' },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: 'ery":"图书馆"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        },
        { data: "[DONE]" },
      ]),
    );
    const client = new PersonalModelClient(
      {
        provider: "custom",
        baseUrl: "https://api.example.com/v1",
        model: "model-a",
        apiKey: "sk-test",
      },
      transport,
    );
    const reply = await client.generateWithTools({
      ...request,
      onText: () => {},
    });
    expect(reply.finishReason).toBe("tool_calls");
    expect(reply.toolCalls[0]).toMatchObject({
      id: "call-1",
      function: { name: "search_places" },
    });
    expect(JSON.parse(reply.toolCalls[0].function.arguments)).toEqual({
      query: "图书馆",
    });
  });

  it("streams Anthropic text deltas", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      sse([
        {
          event: "message_start",
          data: { type: "message_start", message: { usage: { input_tokens: 4 } } },
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "你好" },
          },
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 2 },
          },
        },
        { event: "message_stop", data: { type: "message_stop" } },
      ]),
    );
    const client = new PersonalModelClient(
      {
        provider: "claude",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-ant",
      },
      transport,
    );
    const chunks: string[] = [];
    const reply = await client.generateWithTools({
      ...request,
      onText: (text) => chunks.push(text),
    });
    expect(chunks).toEqual(["你好"]);
    expect(reply.usage).toMatchObject({ promptTokens: 4, completionTokens: 2 });
  });

  it("streams Gemini text parts", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      sse([
        {
          data: {
            candidates: [
              { content: { parts: [{ text: "你" }] }, finishReason: "STOP" },
            ],
          },
        },
        {
          data: {
            candidates: [
              { content: { parts: [{ text: "好" }] }, finishReason: "STOP" },
            ],
          },
        },
      ]),
    );
    const client = new PersonalModelClient(
      {
        provider: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        apiKey: "test-key",
      },
      transport,
    );
    const chunks: string[] = [];
    const reply = await client.generateWithTools({
      ...request,
      onText: (text) => chunks.push(text),
    });
    expect(chunks).toEqual(["你", "好"]);
    expect(reply.content).toBe("你好");
  });
});
