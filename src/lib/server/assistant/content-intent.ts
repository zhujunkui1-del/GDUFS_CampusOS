import type { StoredMessage } from "@/domain/agent/assistant-contracts";
export type ContentTool = "search_campus_knowledge" | "search_campus_events";
/** Routing only; relevance, classification and dates still come from real tools. */
export function contentIntent(message: string, history: StoredMessage[] = []) {
  const followup =
    /^(那|那么|还|具体|需要|要|申请|报名).{0,25}(材料|条件|流程|截止|费用|在哪里|时间)/.test(
      message,
    ) && message.length < 50;
  const previous = followup
    ? [...history].reverse().find((m) => m.role === "user")?.text
    : undefined;
  const query = (previous ? previous + "；追问：" : "") + message;
  const knowledge =
    /规则|规定|制度|政策|办法|流程|指南|手续|借书|借阅|续借|选课|申请条件|评定条件|资格|材料|怎么办|怎么[办理借]|如何[办理借]|奖学金.*(?:条件|有哪些)|(?:有哪些|什么).*奖学金|需要满足/.test(
      query,
    );
  const events =
    /讲座|讲坛|竞赛|比赛|招聘|宣讲|停水|停电|闭馆|通知|公告|活动|书展|展览|项目申报|课题申报|奖助申请|名单公示|报名|截止|近期|最近|今天|这周|本周|下周|下个月|现在.*(?:申请|奖学金)|(?:还能|正在|开放).*(?:申请|报名)|申请.*(?:开放|机会)/.test(
      query,
    );
  const map = /(?:地图|定位|路线|导航|在哪里|告诉我.*哪里)/.test(message);
  const tools: ContentTool[] = [];
  if (knowledge) tools.push("search_campus_knowledge");
  if (events) tools.push("search_campus_events");
  return { active: tools.length > 0, tools, query: query.slice(-300), map };
}
