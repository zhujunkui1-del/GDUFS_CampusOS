// Uses a fresh, isolated guest. Captures only this script's public test prompts.
import fs from "node:fs/promises";
const phase = process.argv[2] || "baseline";
if (!["baseline", "after"].includes(phase))
  throw Error("Use baseline or after");
const origin = "https://campusos-preview.zhujunkui1.workers.dev";
const cases = [
  "你好，你是一只大肥鱼吗？",
  "今天好累，陪我聊聊天",
  "了解下王春业老师",
  "秋之声",
  "看看广外最近的竞赛活动情况",
  "学院组织三下乡需要填申请表吗？",
  "党的二十届五中全会公报一图速览",
  "广外学子在2025年全运会有什么贡献？",
];
const directory = "docs/verification/assistant-quality-2026-11-03";
await fs.mkdir(directory, { recursive: true });
const session = await fetch(origin + "/api/agent/session");
const cookie = session.headers
  .getSetCookie()
  .map((s) => s.split(";")[0])
  .join("; ");
if (!session.ok || !cookie) throw Error("Isolated guest session unavailable");
let rows = [];
try {
  rows = JSON.parse(
    await fs.readFile(directory + `/${phase}-live.json`, "utf8"),
  );
} catch {
  /* fresh run */
}
for (const message of cases) {
  if (rows.some((row) => row.message === message)) continue;
  const start = performance.now();
  const response = await fetch(origin + "/api/agent/chat", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      "X-CampusOS-Conversation-Protocol": "2",
    },
    body: JSON.stringify({
      message,
      clientRequestId: crypto.randomUUID(),
      ...(phase === "after" ? { smartSearch: false } : {}),
    }),
    signal: AbortSignal.timeout(120000),
  });
  const raw = await response.text();
  const events = raw
    .split("\n\n")
    .map((frame) => frame.split("\n").find((l) => l.startsWith("data:")))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(5)));
  const row = {
    message,
    status: response.status,
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
    result: events.find((e) => ["run.completed", "run.failed"].includes(e.type))
      ?.payload,
    durationMs: Math.round(performance.now() - start),
  };
  rows.push(row);
  await fs.writeFile(
    directory + `/${phase}-live.json`,
    JSON.stringify(rows, null, 2),
  );
  console.log(
    `${phase} ${rows.length}/${cases.length}: HTTP ${row.status}, tools ${row.tools.length}, ${row.durationMs}ms`,
  );
}
