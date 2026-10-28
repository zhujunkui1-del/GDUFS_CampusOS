/** Model prose is never an alternative execution channel for tool calls. */
export function containsToolProtocol(value: string) {
  const text = value.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return /<\/?(?:tool_call|function(?:=|\b)|parameter(?:=|\b))|"tool_calls"\s*:|\b(?:search_external_campus_info|search_campus_knowledge|search_campus_events|search_places|get_place_details|find_nearby_places|control_map|plan_route)\b/i.test(
    text,
  );
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
export function precedingQuestion(
  messages: readonly { id: string; role: string; text: string }[],
  id: string,
) {
  const at = messages.findIndex((message) => message.id === id);
  for (let i = at - 1; i >= 0; i--)
    if (messages[i].role === "user") return messages[i].text;
  return "";
}
