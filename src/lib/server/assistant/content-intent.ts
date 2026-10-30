import type { StoredMessage } from "@/domain/agent/assistant-contracts";
import { externalPolicy } from "../external-search/policy";
import { requestTimeWindow } from "./time-window";
import { dialogueReply } from "./dialogue";
import { campusFoodQuery, queryFocus } from "@/lib/retrieval/query-focus";
import { articleTitle, isContentStatement, searchKeywords, wantsArticle } from "./intent";
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
  const isResultFollowup = (text: string) =>
    /^(?:只能|就这|只找到|只搜到|不够|不全|太少|还有(?:别的|其他)?|更多|来源|名单|这两条|这几条)/.test(
      text.trim(),
    );
  const isFollowup = (text: string) =>
    isSearchFollowup(text) ||
    isResultFollowup(text) ||
    (/^(那|那么|还|具体|需要|要|申请|报名|他|她|它|这位|该活动).{0,30}(材料|条件|流程|截止|费用|在哪里|时间|怎么样|口味|体验|属于|南校|北校|学院|吗|呢)/.test(
      text,
    ) &&
      text.length < 60);
  // A bare topic after a lead-in ("了解下王春业老师") is still a keyword lookup.
  // Without this lane it reaches no tool because it is neither an event nor a
  // policy question, even when the radar already has the matching articles.
  const ENTITY_LEAD =
    /^(?:请|帮我|我想|想|要|了解一下|了解下|了解|介绍一下|介绍下|介绍|说说|讲讲|查询|查一下|查下|查查|搜一下|搜下|搜搜|看看|看下|找一下|找找|推荐一下|请问|问一下)\s*/;
  const ENTITY_ROLE =
    /(?:老师|教授|导师|院长|书记|主任|校友|同学|人物|是谁|这个人|的情况|的信息|的资料|相关|介绍|了解)/g;
  const entityTerm = message
    .replace(ENTITY_LEAD, "")
    .replace(ENTITY_ROLE, " ")
    .replace(/[，,。！？?；;：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const bareTopicLookup =
    /^[\u4e00-\u9fa5]{2,4}$/.test(message.trim()) &&
    !/^(?:你好|您好|谢谢|再见|哈哈|呵呵|嗯嗯|好的|可以|不行|是的|不是|什么|怎么|为什么|谁|哪|还有|继续|再找|更多|别的|其他|那|这|哪里|我|你|他|她|它|今天|明天|昨天)/.test(
      message.trim(),
    ) &&
    !/(?:比赛|竞赛|讲座|活动|论坛|大赛|之声|节|展|招聘|宣讲|食堂|图书馆|宿舍|学院|大学|天气|路线|地图|在哪|哪里|怎么走|怎么去|导航|位置)/.test(
      message,
    );
  const entityLookup =
    !reply &&
    !urgent &&
    entityTerm.length >= 2 &&
    entityTerm.length <= 20 &&
    !/(?:在哪|哪里|怎么走|怎么去|导航|位置|路线)/.test(message) &&
    (bareTopicLookup ||
      /老师|教授|导师|院长|书记|主任|校友|同学|是谁|这个人|人物/.test(message)) &&
    !/(?:有哪些|有什么|哪些|几个|几位|举[几\d]+[位个]|名单)/.test(message) &&
    !/你|本鱼|自己|人格/.test(entityTerm);
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
    previousDiscovery
      ? previousDiscovery.text + "；再找更多；"
      : previous
        ? isResultFollowup(message)
          ? previous + "；再查更多；"
          : previous + "；追问：" + message
        : message,
  );
  // A new explicit time constraint wins over a relative date in previous turns.
  const timeWindow =
    requestTimeWindow(message, now) || requestTimeWindow(query, now);
  const knowledge =
    /规则|规定|制度|政策|办法|流程|指南|手续|借书|借阅|续借|选课|申请条件|评定条件|资格|材料|怎么办|怎么[办理借]|如何[办理借]|奖学金.*(?:条件|有哪些)|(?:有哪些|什么).*奖学金|需要满足/.test(
      query,
    );
  const timeMarkerOnly =
    /今天|最近|近期|这周|本周|下周|现在/.test(query) &&
    !/讲座|讲坛|竞赛|比赛|大赛|招聘|宣讲|通知|公告|资讯|新闻|活动|书展|展览|报名|申请|奖学金|之声|歌手|晚会|演出|运动会|辩论|演讲|征文|摄影|评选|开幕式|闭幕式|招新/.test(
      query,
    );
  const events =
    !multiTopic &&
    (!timeMarkerOnly || conversationAct(message) === "campus") &&
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
  // Declarative campus statements should get a natural answer *and* a search,
  // not a hard platform refusal. The search uses the sentence as written first
  // and its keywords second (retry lives in contentReadPlan).
  const contentStatement = !articleLookup && isContentStatement(message);
  // Exact titles often differ by typographic quotes or a suffix added by the
  // site. Keep a short leading fragment as the fallback query so a title with
  // inner quotes can still be recalled by FTS.
  const articleKeywords =
    multiTopic
      ? undefined
      : articleLookup && articleQuery
      ? articleQuery
          .replace(/[《》「」『』“”"']/g, "")
          .replace(/\s+/g, "")
          .slice(0, 4)
      : searchKeywords(message);
  const map =
    !articleLookup &&
    /(?:地图|定位|路线|导航|在哪里|告诉我.*哪里|带我去|带我走|带我过去|导航到|导航去|怎么去|如何去|怎样去|从.+?(?:去|到)|(?:帮我找|找一下|找)(?:图书馆|教学楼|饭堂|食堂|超市|宿舍|校门|体育馆|操场|打印店|快递|校医院))/.test(
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
      contentStatement ||
      entityLookup ||
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
    if (entityLookup) {
      tools.push("search_campus_knowledge", "search_campus_events");
    } else if (articleLookup) tools.push("search_campus_knowledge");
    else if (contentStatement) {
      tools.push("search_campus_knowledge");
      // A time-bounded "what happened this week" request is events content
      // even when it does not name a radar tag.
      if (timeWindow) tools.push("search_campus_events");
    } else {
      if (knowledge) tools.push("search_campus_knowledge");
      if (events) tools.push("search_campus_events");
      if (!tools.length) tools.push("search_campus_knowledge");
    }
  }
  const strictFact =
    articleLookup ||
    knowledge ||
    events ||
    entityLookup ||
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
  // Hard routing rule: questions and imperative requests search by keywords;
  // declarative statements first search the sentence as written, then fall
  // back to its keywords (the retry lives in contentReadPlan).
  const declarativeRequest =
    !/[?？]|(?:吗|呢)\s*$|怎么|如何|哪些|多少|是否|能否|可不可以/.test(
      message.trim(),
    ) &&
    !/^(?:请|帮我|我想|想|要|了解一下|了解下|了解|介绍一下|介绍下|介绍|说说|讲讲|查询|查一下|查下|查查|搜一下|搜下|搜搜|看看|看下|找一下|找找|推荐一下|举|列|给|告诉)/.test(
      message.trim(),
    );
  // Discovery phrasing ("曾经/最近/有什么/大型") dilutes FTS recall; keep the
  // original for the prompt and citations, retrieve with the core topic.
  // A generic "研究生奖学金获奖/名单" question is about the whole list, not a
  // contiguous phrase. Searching the literal phrase returns only pages whose
  // title repeats every qualifier; search the list vocabulary instead.
  const broadListQuery =
    !declarativeRequest &&
    /奖学金|助学金|奖助/.test(query) &&
    /获奖|名单|公示/.test(query) &&
    !/国家奖学金|学业奖学金|励志奖学金|单项奖学金/.test(query)
      ? `${query.match(/20\d{2}/)?.[0] ?? ""} 奖学金 名单`.trim()
      : undefined;
  const campusOverview =
    /(?:几个|哪些|哪几|多少).{0,4}校区|校区.{0,6}(?:几个|哪些|名称|名字|地址|在哪)/.test(
      query,
    );
  const retrievalQuery = multiTopic
    ? "最新 校园 通知"
    : campusOverview
      ? "校区"
    : entityLookup
      ? entityTerm.slice(-300)
      : broadListQuery
      ? broadListQuery
      : articleLookup
        ? articleQuery!.slice(-300)
        : contentStatement
          ? coreQuery.slice(-300)
          : declarativeRequest
        ? coreQuery.slice(-300)
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
    entityLookup,
    articleQuery,
    articleKeywords,
    contentStatement,
    multiTopic,
    discoveryFollowup: !!previousDiscovery,
  };
}
