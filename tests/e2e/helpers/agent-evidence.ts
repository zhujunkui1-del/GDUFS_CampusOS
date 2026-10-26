import type { Page } from "@playwright/test";
export async function installAgentEvidence(page: Page) {
  await page.addInitScript(() => {
    const target = window as Window & { __agentEvidence?: unknown[] };
    target.__agentEvidence = [];
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const started = performance.now();
      const response = await original(...args);
      if (
        String(args[0]).endsWith("/api/agent/chat") &&
        response.ok &&
        response.body
      ) {
        const record = {
          prompt: JSON.parse(String(args[1]?.body || "{}")).message,
          tools: [] as string[],
          actions: [] as unknown[],
          cards: [] as unknown[],
          result: null as unknown,
          response: "",
          responseHeadersMs: Math.round(performance.now() - started),
          firstTextMs: null as number | null,
          completeMs: null as number | null,
        };
        target.__agentEvidence!.push(record);
        const stream = response.body;
        const getReader = stream.getReader.bind(stream);
        Object.defineProperty(stream, "getReader", {
          value: () => {
            const reader = getReader();
            const read = reader.read.bind(reader);
            const decoder = new TextDecoder();
            let text = "";
            reader.read = async () => {
              const part = await read();
              if (!part.done)
                text += decoder.decode(part.value, { stream: true });
              let index: number;
              while ((index = text.indexOf("\n\n")) >= 0) {
                const frame = text.slice(0, index);
                text = text.slice(index + 2);
                const data = frame
                  .split("\n")
                  .find((line) => line.startsWith("data:"));
                if (data) {
                  const event = JSON.parse(data.slice(5));
                  if (event.type === "tool.started")
                    record.tools.push(event.payload.name);
                  if (event.type === "artifact.ready" && event.payload.packet)
                    record.actions.push(...event.payload.packet.actions);
                  if (event.type === "artifact.ready" && event.payload.cards)
                    record.cards = event.payload.cards;
                  if (event.type === "message.delta") {
                    record.firstTextMs ??= Math.round(
                      performance.now() - started,
                    );
                    record.response += event.payload.text;
                  }
                  if (
                    event.type === "run.completed" ||
                    event.type === "run.failed"
                  ) {
                    record.result = event.payload;
                    record.completeMs = Math.round(performance.now() - started);
                  }
                }
              }
              return part;
            };
            return reader;
          },
        });
      }
      return response;
    };
  });
}
export async function readAgentEvidence(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & { __agentEvidence?: unknown[] }).__agentEvidence ||
      [],
  );
}
