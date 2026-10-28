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
    .trim();
}
export function asksForSearchPermission(text: string) {
  return /(?:要不要|是否需要|需要我|要我).{0,24}(?:搜索|搜一下|搜一搜|查一下|帮你查|帮你搜)|现在帮你搜/.test(
    text,
  );
}
export function assistantDisplayText(text: string) {
  return containsToolProtocol(text)
    ? "这条回复未能生成有效答案，请重新提问。"
    : text;
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
