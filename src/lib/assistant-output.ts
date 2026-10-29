const TOOL_NAMES =
  "search_external_campus_info|search_campus_knowledge|search_campus_events|search_places|get_place_details|find_nearby_places|control_map|plan_route";

/**
 * Model prose is never an alternative execution channel for tool calls.
 * A bare tool name in normal prose is harmless; only call syntax or protocol
 * tags are leakage.
 */
export function containsToolProtocol(value: string) {
  const text = value.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return new RegExp(
    `<\\/?(?:tool_call|function(?:=|\\b)|parameter(?:=|\\b))|"tool_calls"\\s*:|\\b(?:${TOOL_NAMES})\\s*\\(`,
    "i",
  ).test(text);
}

/**
 * Removes text-mode tool-call leakage from an already-classified answer.
 * Used only as a last structural repair before falling back to an excerpt.
 */
export function stripToolProtocol(value: string) {
  return value
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<function[^>]*>[\s\S]*?<\/function>/gi, "")
    .replace(/<\/?(?:tool_call|function|parameter)[^>]*>/gi, "")
    .replace(
      new RegExp(
        `\\b(?:${TOOL_NAMES})\\s*\\([\\s\\S]*?\\)(?=\\s|$)`,
        "gi",
      ),
      "",
    )
    .replace(/"tool_calls"\s*:\s*\[[\s\S]*?\]/gi, "")
    .replace(/([，,。；;])\s*([，,。；;])/g, "$1")
    .trim();
}
export function asksForSearchPermission(text: string) {
  return /(?:要不要|是否需要|需要我|要我).{0,24}(?:搜索|搜一下|搜一搜|查一下|帮你查|帮你搜)|现在帮你搜/.test(
    text,
  );
}
/** Remove self-deprecating process talk: users need the gap, not a failure report. */
export function stripSelfDeprecation(text: string) {
  const advice = /考研|保研|推免|研究生/.test(text)
    ? "，建议以研究生院和研究生招生官网最新通知为准。"
    : "，建议以官方最新通知为准。";
  return text
    .replace(
      /[，,；;]?\s*(?:但|不过)?(?:本轮|本次)?(?:未|没有|没能|尚未)(?:检索到|取得|获取到|找到|查到)[^。！？；;]*(?:完整|原文|政策文件|文件|资料)[^。！？；;]*[。；;]?/g,
      advice,
    )
    .replace(
      /[，,；;]?\s*(?:但|不过)?(?:本轮|本次|现有|公开|当前)?资料(?:中)?(?:未|没有|没能|尚未)[^。！？；;]*(?:覆盖|涉及|包含|收录|提供|取得|检索到)[^。！？；;]*[。；;]?/g,
      advice,
    )
    .replace(/[，,；;]?\s*需要说明：[^。！？]*(?:暂无法确认|无法确认|无法核实)[^。！？]*[。！？]?/g, "")
    .replace(/[，,；;]?\s*[^。！？]*(?:发布方|作者|来源)[^。！？]*(?:没有明确写出|未明确写出|未写明|未显示|没写明)[^。！？]*[。！？]?/g, "")
    .replace(/该信息时效性待核实[，,；;]?/g, "")
    .replace(/[，,；;]?\s*[^。！？]*(?:发布方|作者)[^。！？]*(?:未显示|未明确|未写明|无法确认)[^。！？]*[。！？]?/g, "")
    .replace(/[，,；;]?\s*[^。！？]*(?:来源|正文|页面)[^。！？]*(?:未显示|未明确|未写明)[^。！？]*(?:发布方|作者|我校)[^。！？]*[。！？]?/g, "")
    .replace(/(?:本轮|本次)资料中唯一/g, "公开资料中唯一")
    .replace(/(?:本轮|本次)资料中/g, "公开资料中")
    .replace(
      /[，,；;]?\s*(?:但)?(?:本轮|本次)(?:未|没有|没能|尚未)[^。！？；;]*(?:检索到|取得|获取到|找到|查到)[^。！？；;]*[。；;]?/g,
      advice,
    )
    .replace(/^[，,]\s*/, "")
    .replace(/^\s*\d+\.\s*[，,]?\s*(?=建议以)/gm, "")
    .replace(/[，,]\s*[，,]/g, "，")
    .trim();
}
export function assistantDisplayText(text: string) {
  if (containsToolProtocol(text))
    return "这条回复未能生成有效答案，请重新提问。";
  return text
    .replace(/[；;]\s*。/g, "。")
    .replace(/。{2,}/g, "。")
    .replace(/[ \t]+\n/g, "\n");
}
/** Only real source URLs may be cited; the model must copy them verbatim. */
export function citedUrls(text: string) {
  return [...text.matchAll(/https?:\/\/[^\s）)】\]]+/g)].map((match) =>
    match[0].replace(/[.,，。；;]+$/, ""),
  );
}
export function unsupportedUrls(text: string, allowed: Iterable<string>) {
  const known = new Set(allowed);
  return citedUrls(text).filter((url) => !known.has(url));
}
/** A map action may only be reported after a real browser receipt. */
export function claimsMapAction(text: string) {
  return /已(?:经)?(?:帮你)?(?:标出|标记|定位|放大|在地图上显示|显示在地图)/.test(
    text,
  );
}
export function precedingQuestion(
  messages: readonly { id: string; role: string; text: string }[],
  id: string,
) {
  const at = messages.findIndex((message) => message.id === id);
  for (let i = at - 1; i >= 0; i--)
    if (messages[i].role === "user") return messages[i].text;
  return "";
}
