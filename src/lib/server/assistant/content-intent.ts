import type { StoredMessage } from "@/domain/agent/assistant-contracts";
import { externalPolicy } from "../external-search/policy";
import { requestTimeWindow } from "./time-window";
import { dialogueReply } from "./dialogue";
export type ContentTool = "search_campus_knowledge" | "search_campus_events";
/** Routing only; relevance, classification and dates still come from real tools. */
export function contentIntent(
  message: string,
  history: StoredMessage[] = [],
  now = Date.now(),
) {
  const reply = dialogueReply(message);
  const isSearchFollowup = (text: string) =>
    /^(?:请|再|帮我)?\s*(?:调用|用|去|通过|到)?\s*(?:小红书|外部搜索|互联网|网上)(?:来|帮我)?(?:搜|搜索|查|查找|找)(?:一下|一遍|看看)?[。！？!？\s]*$/.test(
      text.trim(),
    );
  const followup =
    isSearchFollowup(message) ||
    (/^(那|那么|还|具体|需要|要|申请|报名).{0,25}(材料|条件|流程|截止|费用|在哪里|时间|怎么样|口味|体验|属于|南校|北校|吗)/.test(
      message,
    ) &&
      message.length < 50);
  const previous = followup
    ? [...history]
        .reverse()
        .find(
          (m) =>
            m.role === "user" &&
            !isSearchFollowup(m.text) &&
            !dialogueReply(m.text) &&
            !/^(?:正经点|别演了|少说废话|可爱一点|恢复刚才的说话方式)[。！!\s]*$/.test(
              m.text,
            ),
        )?.text
    : undefined;
  const query = (previous ? previous + "；追问：" : "") + message;
  const knowledge =
    /规则|规定|制度|政策|办法|流程|指南|手续|借书|借阅|续借|选课|申请条件|评定条件|资格|材料|怎么办|怎么[办理借]|如何[办理借]|奖学金.*(?:条件|有哪些)|(?:有哪些|什么).*奖学金|需要满足/.test(
      query,
    );
  const events =
    requestTimeWindow(query, now) !== undefined ||
    /趣事|校园新闻|校园动态|校园分享|有趣的事情/.test(query) ||
    /讲座|讲坛|竞赛|比赛|招聘|宣讲|停水|停电|闭馆|通知|公告|活动|书展|展览|项目申报|课题申报|奖助申请|名单公示|报名|截止|近期|最近|今天|这周|本周|下周|下个月|现在.*(?:申请|奖学金)|(?:还能|正在|开放).*(?:申请|报名)|申请.*(?:开放|机会)/.test(
      query,
    );
  const map = /(?:地图|定位|路线|导航|在哪里|告诉我.*哪里)/.test(message);
  const tools: ContentTool[] = [];
  if (knowledge) tools.push("search_campus_knowledge");
  if (events) tools.push("search_campus_events");
  if (
    !reply &&
    !tools.length &&
    (externalPolicy(query).active ||
      /只用内部|只查内部|仅用内部|仅查内部/.test(query))
  )
    tools.push("search_campus_knowledge");
  return {
    active: !reply && tools.length > 0,
    tools: reply ? [] : tools,
    query: query.slice(-300),
    map,
    timeWindow: requestTimeWindow(query, now),
    dialogueReply: reply,
  };
}
