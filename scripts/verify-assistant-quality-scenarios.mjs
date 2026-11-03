import fs from "node:fs/promises";
const origin = "https://campusos-preview.zhujunkui1.workers.dev";
const scenarios = [
  { message: "最近有什么竞赛？" },
  { message: "只能找到这两条吗？", followup: true },
  { message: "还有王春业老师的介绍吗？", followup: true },
  { message: "2026年的秋之声什么时候举行？" },
  { message: "最近有什么讲座？" },
  { message: "了解下广外法学院的比赛" },
  { message: "2026年研究生学业奖学金拟获奖名单公示" },
  { message: "找文章「法通中外，三十启新＃一周一会＃第七周工作速览」" },
  { message: "今天广外有哪些活动？" },
  { message: "下周有什么可以参加的讲座？" },
  { message: "请上网查广外官网最新资料", smartSearch: false },
  { message: "请上网查广外官网最新资料", smartSearch: true },
  { message: "用小红书查广外食堂推荐", smartSearch: true },
  {
    message: "关闭智能搜索后再次查询校园文章：最近有什么竞赛？",
    smartSearch: false,
  },
  { message: "你是谁？" },
  { message: "正经点", followup: true },
  { message: "你是一只大肥鱼吗？", followup: true },
  { message: "恢复刚才的说话方式", followup: true },
  { message: "给你一包小鱼干", followup: true },
  { message: "我要正式回答：考试前应该怎么准备？" },
];
const response = await fetch(origin + "/api/agent/session");
const cookie = response.headers
  .getSetCookie()
  .map((s) => s.split(";")[0])
  .join("; ");
if (!cookie) throw Error("Guest test unavailable");
const rows = [];
let conversationId;
for (const test of scenarios) {
  const started = performance.now();
  const result = await fetch(origin + "/api/agent/chat", {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: test.message,
      smartSearch: test.smartSearch ?? false,
      clientRequestId: crypto.randomUUID(),
      ...(test.followup && conversationId ? { conversationId } : {}),
    }),
    signal: AbortSignal.timeout(120000),
  });
  const events = (await result.text()).split("\n\n").flatMap((frame) => {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    return line ? [JSON.parse(line.slice(5))] : [];
  });
  const terminal = events.find((e) =>
    ["run.completed", "run.failed"].includes(e.type),
  );
  conversationId = terminal?.payload.conversationId;
  const row = {
    ...test,
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
    durationMs: Math.round(performance.now() - started),
  };
  row.searchPermissionPass =
    test.smartSearch ||
    !row.tools.some((t) => t.name === "search_external_campus_info");
  rows.push(row);
  await fs.writeFile(
    "docs/verification/assistant-quality-2026-11-03/scenarios-live.json",
    JSON.stringify(rows, null, 2),
  );
  console.log(
    `${rows.length}/${scenarios.length}: ${terminal?.type}, ${row.durationMs}ms, external=${row.tools.filter((t) => t.name === "search_external_campus_info").length}`,
  );
}
