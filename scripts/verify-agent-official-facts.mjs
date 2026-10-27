// Explicit real Preview acceptance. Uses a fresh anonymous conversation, never saved user cookies.
import fs from "node:fs/promises";
import { publicEvaluationReceipt } from "./evaluate-redbook.mjs";
if (process.argv[2] !== "--preview")
  throw Error("Use --preview to authorize three live model-backed questions");
const root = "https://campusos-preview.zhujunkui1.workers.dev";
const directory = "docs/verification/agent-official-facts-2026-10-27";
let cookie = "",
  conversationId;
const records = [];
for (const message of [
  "戴建业",
  "广外南校的首席专家有哪些人",
  "戴建业是广外的首席专家吗",
]) {
  const response = await fetch(root + "/api/agent/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: root,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
      clientRequestId: crypto.randomUUID(),
    }),
    signal: AbortSignal.timeout(100000),
  });
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (!response.ok) throw Error("Preview chat HTTP " + response.status);
  const events = (await response.text()).split("\n\n").flatMap((frame) => {
    const data = frame.split("\n").find((line) => line.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5))] : [];
  });
  const end = events.find((e) =>
    ["run.completed", "run.failed"].includes(e.type),
  );
  conversationId = end?.payload.conversationId || conversationId;
  const record = {
    question: message,
    answer: events
      .filter((e) => e.type === "message.delta")
      .map((e) => e.payload.text)
      .join(""),
    tools: events
      .filter((e) => e.type === "tool.started")
      .map((e) => e.payload.name),
    result: end?.payload,
    cards: events
      .filter((e) => e.type === "artifact.ready")
      .flatMap((e) => e.payload.cards || []),
  };
  records.push(record);
  console.log({
    question: message,
    answerChars: record.answer.length,
    tools: record.tools,
    error: end?.payload.error?.code || null,
  });
  if (end?.type !== "run.completed") break;
}
const verdict = {
  allCompleted:
    records.length === 3 &&
    records.every((r) => !r.result?.error && r.answer.trim()),
  personIdentityConfirmed:
    /戴建业/.test(records[2]?.answer || "") &&
    /云山工作室首席专家/.test(records[2]?.answer || "") &&
    /是的|受聘|担任/.test(records[2]?.answer || ""),
  rosterQualified: /尚未|未能|未找到|无法确认|不能确认/.test(
    records[1]?.answer || "",
  ),
  noWrongCampus: records.every(
    (r) =>
      !/白云山校区[（(]南校|仅任职于(?:南校|北校)|受聘于南校|主要在北校/.test(
        r.answer,
      ),
  ),
  noMapRedirectForName: !/教学楼|办公室|某个具体.*地点/.test(
    records[0]?.answer || "",
  ),
  noXhsRequests: records.every(
    (r) =>
      !(r.result?.metrics?.timings?.externalSearch || []).some((e) =>
        e.providers.some((p) => /xiaohongshu|redbook/.test(p.provider)),
      ),
  ),
};
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(".map-tools/agent-fact-debug", { recursive: true });
await fs.writeFile(
  ".map-tools/agent-fact-debug/acceptance-raw.json",
  JSON.stringify(records, null, 2),
);
await fs.writeFile(
  directory + "/acceptance.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      verdict,
      records: publicEvaluationReceipt(records),
    },
    null,
    2,
  ),
);
console.log(verdict);
if (!Object.values(verdict).every(Boolean)) process.exitCode = 2;
