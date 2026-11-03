import fs from "node:fs/promises";
const origin = "https://campusos-preview.zhujunkui1.workers.dev";
const session = await fetch(origin + "/api/agent/session");
const cookie = session.headers
  .getSetCookie()
  .map((s) => s.split(";")[0])
  .join("; ");
if (!cookie) throw Error("Fresh guest session required");
const headers = {
  Origin: origin,
  Cookie: cookie,
  "Content-Type": "application/json",
  "X-CampusOS-Conversation-Protocol": "3",
};
const rows = [];
let conversationId;
async function ask(message, smartSearch) {
  const start = performance.now();
  const response = await fetch(origin + "/api/agent/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      smartSearch,
      clientRequestId: crypto.randomUUID(),
      conversationId,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const events = (await response.text()).split("\n\n").flatMap((frame) => {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    return line ? [JSON.parse(line.slice(5))] : [];
  });
  const terminal = events.find((e) =>
    ["run.completed", "run.failed"].includes(e.type),
  );
  conversationId = terminal?.payload.conversationId;
  const row = {
    message,
    smartSearch,
    text: events
      .filter((e) => e.type === "message.delta")
      .map((e) => e.payload.text)
      .join(""),
    tools: events
      .filter((e) => e.type === "tool.finished")
      .map((e) => e.payload),
    cards:
      events
        .filter((e) => e.type === "artifact.ready" && e.payload.cards)
        .at(-1)?.payload.cards || [],
    result: terminal?.payload,
    durationMs: Math.round(performance.now() - start),
  };
  rows.push(row);
  await fs.writeFile(
    "docs/verification/assistant-quality-2026-11-03/search-state-live.json",
    JSON.stringify(rows, null, 2),
  );
  if (!terminal || terminal.type !== "run.completed")
    throw Error("Chat did not complete");
  return row;
}
const internal = await ask(
  "关闭智能搜索后再次查询校园文章：最近有什么竞赛？",
  false,
);
if (
  internal.result.metrics.answerMode !== "radar_list" ||
  internal.cards.length < 3 ||
  internal.tools.some((t) => t.name === "search_external_campus_info")
)
  throw Error("Internal query polluted by search controls");
for (const smartSearch of [true, false, true]) {
  const response = await fetch(
    origin + "/api/agent/conversations/" + conversationId,
    { method: "PATCH", headers, body: JSON.stringify({ smartSearch }) },
  );
  const value = await response.json();
  const read = await fetch(
    origin + "/api/agent/conversations/" + conversationId,
    { headers },
  );
  const restored = await read.json();
  rows.push({
    operation: "preference",
    status: response.status,
    saved: value.data,
    restored: {
      smartSearch: restored.data?.smartSearch,
      smartSearchVersion: restored.data?.smartSearchVersion,
    },
  });
  if (!response.ok || restored.data?.smartSearch !== smartSearch)
    throw Error("Preference was not persisted");
}
const official = await ask("请上网查广外官网最新资料", true);
if (
  official.result.metrics.answerMode !== "radar_list" ||
  official.cards.length < 3 ||
  !official.tools.some((t) => t.name === "search_external_campus_info")
)
  throw Error(
    "Latest official discovery did not use current internal articles and web supplement",
  );
const missing = await ask("找文章《海底小鱼干不存在文档987654321》", false);
if (
  missing.cards.length ||
  !missing.tools.some((t) => t.name === "search_campus_knowledge") ||
  /翻遍|搜遍|已上网/.test(missing.text)
)
  throw Error("Missing article bypassed retrieval or invented a search");
await fs.writeFile(
  "docs/verification/assistant-quality-2026-11-03/search-state-live.json",
  JSON.stringify(rows, null, 2),
);
console.log({
  checks: rows.length,
  preferenceWrites: 3,
  rowsWithFailure: rows.filter((r) => r.result?.error).length,
});
