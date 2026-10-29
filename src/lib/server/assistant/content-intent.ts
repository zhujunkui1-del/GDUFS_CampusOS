import type { StoredMessage } from "@/domain/agent/assistant-contracts";
import { externalPolicy } from "../external-search/policy";
import { requestTimeWindow } from "./time-window";
import { dialogueReply } from "./dialogue";
import { campusFoodQuery, queryFocus } from "@/lib/retrieval/query-focus";
import { articleTitle, wantsArticle } from "./intent";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";
import {
  conversationAct,
  isFeedbackAct,
  type ConversationAct,
} from "./conversation-act";
export type ContentTool = "search_campus_knowledge" | "search_campus_events";
/** Campus facts need evidence; advice may use general knowledge with a clear gap. */
export type AnswerRequirement = "strict" | "advisory" | "open";
const ENTITY_GROUPS = [
  ["门诊部", "门诊楼", "门诊室", "校医院"],
  ["一饭", "文采园", "第一饭堂", "第一食堂"],
  ["二饭", "博雅园", "第二饭堂", "第二食堂"],
  ["三饭", "风采园", "第三饭堂", "第三食堂"],
  ["云山学者", "云山青年学者", "云山领军学者"],
];
/** Same entity, different wording: retry with the official alias instead of "no data". */
export function entityQueryVariants(query: string) {
  const variants: string[] = [];
  for (const group of ENTITY_GROUPS) {
    const hit = group.find((term) => query.includes(term));
    if (!hit) continue;
    for (const term of group) {
      if (term === hit) continue;
      const next = query.split(hit).join(term).slice(-300);
      if (next && next !== query && !variants.includes(next))
        variants.push(next);
      if (variants.length >= 2) return variants;
    }
  }
  return variants;
}
/** Routing only; relevance, classification and dates still come from real tools. */
export function contentIntent(
  message: string,
  history: StoredMessage[] = [],
  now = Date.now(),
) {
  const reply = dialogueReply(message);
  const urgent =
    /晕倒|昏迷|急救|火灾|人身(?:危险|威胁)|受到.{0,6}威胁|自伤|轻生|自杀/.test(
      message,
    );
  // "带我去南苑11栋" is a fresh map task, not a follow-up about whatever was
  // discussed in the previous turn. Otherwise stale topics leak into the answer.
  const explicitPlaceRequest =
    /(?:带我去|带我走|带我过去|导航到|导航去|怎么去|如何去|怎样去|从.{1,24}到)/.test(
      message,
    );
  // A long list of unrelated topics is not one radar category. Treating any
  // single keyword ("竞赛") as the whole request produced a competition-only
  // answer to a 687-character campus-wide notice question.
  const multiTopic =
    message.length > 400 ||
    (message.match(/、/g)?.length ?? 0) >= 8;
  const isSearchFollowup = (text: string) =>
    /^(?:请|再|帮我)?\s*(?:调用|用|去|通过|到)?\s*(?:小红书|外部搜索|互联网|网上)(?:来|帮我)?(?:搜|搜索|查|查找|找)(?:一下|一遍|看看)?[。！？!？\s]*$/.test(
      text.trim(),
    );
  const isFollowup = (text: string) =>
    isSearchFollowup(text) ||
    (/^(那|那么|还|具体|需要|要|申请|报名|他|她|它|这位|该活动).{0,30}(材料|条件|流程|截止|费用|在哪里|时间|怎么样|口味|体验|属于|南校|北校|学院|吗|呢)/.test(
      text,
    ) &&
      text.length < 60);
  const topic: string[] = [];
  if (isFollowup(message) && !explicitPlaceRequest)
    for (const turn of [...history].reverse()) {
      if (
        turn.role !== "user" ||
        dialogueReply(turn.text) ||
        /^(?:正经点|别演了|少说废话|可爱一点|恢复刚才的说话方式)[。！!\s]*$/.test(
          turn.text,
        )
      )
        continue;
      topic.unshift(turn.text);
      if (!isFollowup(turn.text) || topic.length === 4) break;
    }
  const previous = topic.join("；追问：");
  // "还有吗/再找几个" is a page-through of the previous recent-category list,
  // not a new search. Reuse the previous discovery query so the radar category
  // and recency intent survive, and ask the retriever for a larger page.
  const discoveryFollowup =
    /^(?:还有|还有吗|还有别的|还有其他的?|再找|继续|后面的|其他|别的|换一批|更多|再多)/.test(
      message.trim(),
    ) && !explicitPlaceRequest;
  const previousDiscovery = discoveryFollowup
    ? [...history].reverse().find(
        (turn) =>
          turn.role === "user" &&
          /最近|近期|最新/.test(turn.text) &&
          /竞赛|比赛|大赛|讲座|讲坛|论坛|沙龙|招聘|宣讲|通知|公告|就业|奖学金|科研/.test(
            turn.text,
          ),
      )
    : undefined;
  const query = campusFoodQuery(
    (previousDiscovery
      ? previousDiscovery.text + "；再找更多；"
      : previous
        ? previous + "；追问："
        : "") + message,
  );
  // A new explicit time constraint wins over a relative date in previous turns.
  const timeWindow =
    requestTimeWindow(message, now) || requestTimeWindow(query, now);
  const knowledge =
    /规则|规定|制度|政策|办法|流程|指南|手续|借书|借阅|续借|选课|申请条件|评定条件|资格|材料|怎么办|怎么[办理借]|如何[办理借]|奖学金.*(?:条件|有哪些)|(?:有哪些|什么).*奖学金|需要满足/.test(
      query,
    );
  const events =
    !multiTopic &&
    (requestTimeWindow(query, now) !== undefined ||
      /趣事|校园新闻|校园动态|校园分享|有趣的事情/.test(query) ||
      /讲座|讲坛|竞赛|比赛|招聘|宣讲|停水|停电|闭馆|通知|公告|资讯|新闻|最新|活动|书展|展览|项目申报|课题申报|奖助申请|名单公示|报名|截止|近期|最近|今天|这周|本周|下周|下个月|现在.*(?:申请|奖学金)|(?:还能|正在|开放).*(?:申请|报名)|申请.*(?:开放|机会)|之声|歌手|歌唱|合唱|晚会|演出|音乐会|艺术节|文化节|校运会|运动会|辩论|演讲|征文|摄影|设计大赛|创新大赛|挑战杯|评选|开幕式|闭幕式|招新/.test(
        query,
      ));
  // "找到这篇文章" is a content lookup, never a map lookup, even though
  // “找到” also appears in place phrasings. The article title is sent to the
  // retriever as a title filter so the exact document can be recovered.
  const articleQuery = articleTitle(message);
  const articleLookup = !!articleQuery || wantsArticle(message);
  const map =
    !articleLookup &&
    /(?:地图|定位|路线|导航|在哪里|告诉我.*哪里|带我去|带我走|带我过去|导航到|导航去|怎么去|如何去|怎样去)/.test(
      message,
    );
  // Radar tags are the product's own business categories. Lock the event search
  // to the category the user actually named instead of relying on FTS words.
  const radarCategory = multiTopic
    ? undefined
    : /比赛|竞赛|大赛|挑战杯|数学建模/.test(query)
      ? "competition"
    : /就业|招聘|宣讲|校招|求职|实习/.test(query)
      ? "education_career"
      : /讲座|讲坛|论坛|沙龙|学术报告/.test(query)
        ? "lecture"
        : /文体|文化|体育|演出|晚会|音乐会|书展|展览|艺术|运动会|校运会|社团|招新/.test(query)
          ? "culture_sports"
        : /奖学金|助学金|奖助|资助/.test(query)
          ? "scholarship_opportunity"
          : /科研|课题|项目申报|论文/.test(query)
            ? "academic_research"
            : /通知|公告|停水|停电|闭馆/.test(query)
              ? "campus_notice"
              : undefined;
  // "最近/近期" on a radar category is a recency request: newest publications
  // in that tag, not the best lexical match. The retriever orders these by
  // published_at DESC; older items only appear when more are requested.
  const recentDiscovery =
    multiTopic ||
    (/最近|近期|最新/.test(query) &&
      (!!radarCategory || /资讯|新闻|动态|消息/.test(query)));
  // Feedback about the previous answer must not become a new search keyword;
  // otherwise campus context from the resolved follow-up query decides the act.
  const messageAct = conversationAct(message);
  const act: ConversationAct = isFeedbackAct(messageAct)
    ? messageAct
    : conversationAct(query);
  const policy = externalPolicy(query);
  const search =
    !map &&
    !reply &&
    !urgent &&
    !isFeedbackAct(act) &&
    (articleLookup ||
      recentDiscovery ||
      knowledge ||
      events ||
      policy.needsOfficialVerification ||
      policy.needsRoster ||
      policy.explicit ||
      /只用内部|只查内部|仅用内部|仅查内部/.test(query) ||
      (act === "campus" && policy.active));
  const tools: ContentTool[] = [];
  if (search) {
    if (articleLookup) tools.push("search_campus_knowledge");
    else {
      if (knowledge) tools.push("search_campus_knowledge");
      if (events) tools.push("search_campus_events");
      if (!tools.length) tools.push("search_campus_knowledge");
    }
  }
  const strictFact =
    knowledge ||
    events ||
    policy.officialOnly ||
    policy.needsOfficialVerification;
  const answerRequirement: AnswerRequirement = strictFact
    ? "strict"
    : /注意|建议|经验|攻略|推荐|怎么(?:准备|选|办|避免)|如何(?:准备|选择|避免)|要不要|该不该|怎么办|技巧|注意事项|合适吗|值得吗/.test(
          query,
        )
      ? "advisory"
      : "open";
  const discovery =
    /有哪些|有什么|举几|举\d|名单|曾经|哪些|谁|几个|几场|几篇|情况|信息|方面|内容/.test(query);
  // “了解下秋之声” asks about 秋之声; the polite lead-in must not become part of
  // the FTS keywords or the exact-name match disappears.
  const RETRIEVAL_LEAD =
    /^(?:请|帮我|我想|想|要|了解一下|了解下|了解|介绍一下|介绍下|介绍|说说|讲讲|查询|查一下|查下|查查|搜一下|搜下|搜搜|看看|看下|找一下|找找|推荐一下)\s*/;
  const coreQuery =
    query
      .replace(RETRIEVAL_LEAD, "")
      .replace(/^广外(?=法学院|学院|大学|校区)/, " ")
      .replace(/广东外语外贸大学/g, " ")
      .replace(/的/g, " ")
      .replace(/[，,。！!？?；;：:]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || query;
  // Discovery phrasing ("曾经/最近/有什么/大型") dilutes FTS recall; keep the
  // original for the prompt and citations, retrieve with the core topic.
  const retrievalQuery = multiTopic
    ? "最新 校园 通知"
    : discovery || recentDiscovery
      ? coreQuery
        .replace(
          /举[几\d]+[个位]?|曾经|最近|近期|大型|重要|有哪些|有什么|有没有|哪些|几个|几场|几篇|可报名|能报名|报名|查询|还有|别的|其他|更多|再找|继续|换一批|后面的|情况|信息|方面|内容|活动|的|时间段|或|与|吗|呢|呀|请|帮我/g,
          " ",
        )
        .replace(/[？?。！!，,；;]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s*的+/, "")
        .replace(/体育(?:比赛|赛事)/g, "体育 比赛")
        .replace(/赛事/g, "比赛")
        .trim()
        .slice(-300) || query.slice(-300)
    : coreQuery.slice(-300);
  return {
    active: search && tools.length > 0,
    tools,
    query: query.slice(-300),
    retrievalQuery,
    attemptedKeywords: [retrievalQuery, ...entityQueryVariants(retrievalQuery)],
    discovery,
    map,
    timeWindow,
    dialogueReply: reply,
    focus: queryFocus(query),
    queryPlan: buildQueryPlan(query, timeWindow),
    act,
    answerRequirement,
    radarCategory,
    recentDiscovery,
    articleLookup,
    articleQuery,
    multiTopic,
    discoveryFollowup: !!previousDiscovery,
  };
}
