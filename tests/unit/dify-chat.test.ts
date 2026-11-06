import { afterEach, expect, it, vi } from "vitest";
import { citedEvidenceCards } from "@/lib/server/assistant/deep-thinking-evidence";
import { difyChatEvents } from "@/lib/server/assistant/dify-chat";

afterEach(() => vi.unstubAllGlobals());

it("streams only typed Dify chat events and supplies the current evidence context", async () => {
  let request: RequestInit | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      const chunks = [
        'event: ping\n\n',
        'data: {"event":"workflow_started","task_id":"task-1"}\n\n',
        'data: {"event":"message","answer":"答案[1]","conversation_id":"dify-conv-1"}\n\n',
        'data: {"event":"workflow_finished","data":{"status":"succeeded"}}\n\n',
      ];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    }),
  );

  const received = [];
  for await (const event of difyChatEvents({
    apiKey: "test-app-key",
    query: "广外问题",
    evidence: "[1] 校园公开文章摘录",
    user: "campusos-test-user",
    signal: new AbortController().signal,
  }))
    received.push(event);

  const body = JSON.parse(String(request?.body));
  expect(body.inputs).toEqual({});
  expect(body.query).toContain("广外问题");
  expect(body.query).toContain("[[CAMPUSOS_D1_EVIDENCE_BEGIN]]");
  expect(body.query).toContain("校园公开文章摘录");
  expect(received.map((event) => event.event)).toEqual([
    "workflow_started",
    "message",
    "workflow_finished",
  ]);
  expect(received[1]).toMatchObject({ answer: "答案[1]", conversation_id: "dify-conv-1" });
});

it("maps an unpublished Chatflow endpoint response to a safe user error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  await expect(
    (async () => {
      for await (const _event of difyChatEvents({
        apiKey: "test-app-key",
        query: "test",
        evidence: "",
        user: "campusos-test-user",
        signal: new AbortController().signal,
      })) {
        void _event;
      }
    })(),
  ).rejects.toMatchObject({ message: "Dify Chatflow 尚未发布。" });
});

it("does not follow authenticated Dify redirects", async () => {
  let request: RequestInit | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return new Response(null, {
        status: 302,
        headers: { Location: "https://login.example.test/" },
      });
    }),
  );

  await expect(
    (async () => {
      for await (const _event of difyChatEvents({
        apiKey: "test-app-key",
        query: "test",
        evidence: "",
        user: "campusos-test-user",
        signal: new AbortController().signal,
      })) {
        void _event;
      }
    })(),
  ).rejects.toMatchObject({ message: "Dify API 返回了重定向，未继续发送凭据。" });
  expect(request?.redirect).toBe("manual");
});

it("rejects a non-SSE Dify response rather than treating it as an empty answer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response("login page", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );
  await expect(
    (async () => {
      for await (const _event of difyChatEvents({
        apiKey: "test-app-key",
        query: "test",
        evidence: "",
        user: "campusos-test-user",
        signal: new AbortController().signal,
      })) {
        void _event;
      }
    })(),
  ).rejects.toMatchObject({ message: "Dify API 返回了非流式响应（HTTP 200，text/html）。" });
});

it("accepts a valid blocking Chatflow response without retrying the model", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        event: "message",
        answer: "预报名日期为2026年10月9日至12日[1]。",
        conversation_id: "dify-conversation-2",
        metadata: { usage: { total_tokens: 42 } },
      }),
    ),
  );
  const received = [];
  for await (const event of difyChatEvents({
    apiKey: "test-app-key",
    query: "预报名日期是什么？",
    evidence: "[1] 公开文章摘录",
    user: "campusos-test-user",
    signal: new AbortController().signal,
  }))
    received.push(event);

  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({
    event: "message",
    answer: "预报名日期为2026年10月9日至12日[1]。",
    conversation_id: "dify-conversation-2",
    metadata: { usage: { total_tokens: 42 } },
  });
});

it("keeps only D1 cards whose citation numbers appear in the answer", () => {
  const cards = [1, 2, 3].map((index) => ({
    kind: "source" as const,
    documentId: `doc-${index}`,
    title: `文章 ${index}`,
    sourceName: "广外",
    originalUrl: `https://example.edu.cn/${index}`,
    publishedAt: null,
    snippet: "公开文章摘录",
    evidenceType: "full_text" as const,
    classificationState: "knowledge" as const,
    validity: "current" as const,
    readable: true,
  }));

  expect(citedEvidenceCards("依据这条资料回答[2]。", cards)).toEqual([cards[1]]);
  expect(citedEvidenceCards("没有可验证引用", cards)).toEqual([]);
});
