import { baiyunPlaces } from "@/features/campus-map/data/baiyun-places";
import type { StoredMessage } from "@/domain/agent/assistant-contracts";
import { externalPolicy } from "../external-search/policy";
import {
  chinaDay,
  dateRangeIn,
  requestTimeWindow,
  stripTimeRange,
} from "./time-window";
import { dialogueReply } from "./dialogue";
import {
  campusFoodQuery,
  participationQuery,
  queryFocus,
} from "@/lib/retrieval/query-focus";
import {
  articleTitle,
  isContentStatement,
  searchKeywords,
  wantsArticle,
  explicitMapCommand,
} from "./intent";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";
import { asksPaymentProcedure } from "@/lib/retrieval/payment-evidence";
import { navigationIntent } from "@/domain/agent/navigation-intent";
import { searchCampusPlaces } from "@/features/campus-map/data/campus";
import { VENUE_GROUPS } from "@/lib/retrieval/aliases";
import { inputGate } from "./input-gate";
import { externalScope } from "../external-search/scope";
import {
  searchControlBusiness,
  stripSearchControls,
} from "@/lib/retrieval/query-controls";
import {
  conversationAct,
  isFeedbackAct,
  type ConversationAct,
} from "./conversation-act";
export type ContentTool = "search_campus_knowledge" | "search_campus_events";
/** Campus facts need evidence; advice may use general knowledge with a clear gap. */
export type AnswerRequirement = "strict" | "advisory" | "open";
const ENTITY_GROUPS = VENUE_GROUPS.map((group) => group.names);
// How to answer is not what to search. A long paragraph that ends with
// 「每条包含标题、发布日期、原文链接」 or 「如果样本不足，请说明不足」 turned
// those instructions into the lexical query, so the search looked for its own
// wording and found nothing.
const OUTPUT_CLAUSE =
  /(?:每条|每篇|每则).{0,8}(?:包含|列出|附上|注明|给出)|(?:如果|若).{0,10}(?:样本不足|不足|没有找到)|请说明|原文链接|但不是所有/;
/**
 * A question with no campus subject at all. The campus gate defaults to campus,
 * so “1+8*9-7等于多少” was being required to retrieve campus knowledge before it
 * could answer. General knowledge (arithmetic, a named technology, a book list,
 * a URL the user pasted) is answered directly; campus questions keep every
 * evidence constraint below.
 */
const GENERAL_TECH =
  /\b(?:Cloudflare|D1|SQLite|OpenAI|Anthropic|DeepSeek|Python|TypeScript|JavaScript|React|Next\.js|Vue|Docker|Kubernetes|Linux|Git|GitHub|Rust|Postgres|PostgreSQL|MySQL|Redis|Kafka|AWS|Azure|API|JSON|HTTP|HTTPS|CSS|HTML|Vercel|Netlify|Supabase)\b/i;
const BOOK_REQUEST = /推荐.{0,8}(?:书|书籍|书单)|书单|书籍(?:列表|推荐)/;
function arithmeticQuestion(text: string) {
  const stripped = text
    .replace(/^(?:请|帮我|麻烦)?\s*(?:计算|算一下|算算)\s*/, "")
    .replace(/(?:等于|是)?\s*(?:多少|几)\s*[？?。！!\s]*$/, "")
    .replace(/[？?。！!\s]+$/, "")
    .trim();
  return (
    /\d/.test(stripped) &&
    /[+\-*/×÷^]/.test(stripped) &&
    /^[\d\s+\-*/×÷^().%=]+$/.test(stripped)
  );
}
function generalSubjectQuestion(message: string) {
  if (externalScope(message) !== "general") return false;
  return (
    arithmeticQuestion(message) ||
    /https?:\/\/|www\./i.test(message) ||
    GENERAL_TECH.test(message) ||
    BOOK_REQUEST.test(message)
  );
}
function stripOutputClauses(text: string) {
  return text
    .split(/[，,。；;]/)
    .filter((clause) => !OUTPUT_CLAUSE.test(clause))
    .join("，");
}
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
  campus?: "baiyun" | "university",
) {
  message = searchControlBusiness(message);
  const reply = dialogueReply(message);
  const generalSubject = generalSubjectQuestion(message);
  // A safety question is answered from general knowledge first: waiting for
  // campus evidence left “被人跟踪骚扰可以找谁帮忙” with no reply at all,
  // because the corpus has no article on it and the gate refused to speak.
  const urgent =
    /晕倒|昏迷|急救|火灾|着火|起火|火警|人身(?:危险|威胁)|受到.{0,6}威胁|自伤|轻生|自杀|被.{0,4}(?:跟踪|尾随|骚扰|猥亵|偷拍)|尾随|跟踪|骚扰|猥亵|偷拍|性侵|遭遇.{0,4}(?:暴力|殴打)|突发疾病/.test(
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
  //
  // Only a campus question can be a campus-wide browse: a pasted competition
  // brief or a request for three papers is long and full of “、”, but it asks
  // about the world, not about which notices were posted most recently.
  const teachesMaterial = message.length > 800;
  // Pasted material with a short instruction at the end (“帮我列出决赛需要
  // 交付的文件”) is answered from the material itself. Searching the corpus
  // turned it into “最新校园资讯” and buried the answer.
  const materialQuestion =
    message.length > 400 &&
    /(?:列出|总结|概括|提取|整理|归纳|梳理|摘录|翻译)[^。！？]{0,24}$/.test(
      message.trim(),
    );
  const multiTopic =
    !teachesMaterial &&
    !materialQuestion &&
    externalScope(message) !== "general" &&
    (message.length > 400 || (message.match(/、/g)?.length ?? 0) >= 8);
  const isSearchFollowup = (text: string) =>
    /^(?:请|再|帮我)?\s*(?:调用|用|去|通过|到)?\s*(?:小红书|外部搜索|互联网|网上)(?:来|帮我)?(?:搜|搜索|查|查找|找)(?:一下|一遍|看看)?[。！？!？\s]*$/.test(
      text.trim(),
    );
  const isResultFollowup = (text: string) =>
    /^(?:只能(?:找到|搜到)?(?:这)?[两几二三\d]+条(?:吗)?|就这(?:些|几条)?|只找到(?:这)?[两几\d]+条|不够|不全|太少|还有(?:别的|其他|更多)?(?:的|结果|文章|资料)?(?:吗|呢)?|更多|这两条还有别的吗|再找(?:几个|几条)?|继续|换一批)[。！？?！\s]*$/.test(
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
      /老师|教授|导师|院长|书记|主任|校友|同学|是谁|这个人|人物/.test(
        message,
      )) &&
    !/(?:有哪些|有什么|哪些|几个|几位|举[几\d]+[位个]|名单)/.test(message) &&
    !/你|本鱼|自己|人格/.test(entityTerm);
  const topic: string[] = [];
  if (isFollowup(message) && !explicitPlaceRequest && !entityLookup)
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
  const discoveryFollowup = isResultFollowup(message) && !explicitPlaceRequest;
  const previousDiscovery = discoveryFollowup
    ? [...history]
        .reverse()
        .find(
          (turn) =>
            turn.role === "user" &&
            (/最近|近期|最新/.test(turn.text) ||
              requestTimeWindow(turn.text, now) !== undefined) &&
            /竞赛|比赛|大赛|讲座|讲坛|论坛|沙龙|招聘|宣讲|通知|公告|资讯|新闻|活动|就业|奖学金|科研/.test(
              turn.text,
            ),
        )
    : undefined;
  // "换成讲座呢" / "那比赛呢" changes the subject of the previous list but
  // keeps its time box. Treating the whole sentence as a keyword lost both the
  // window and the category, so the follow-up fell back to no evidence.
  const topicSwitch =
    /^(?:那|那么)?\s*(?:换成|换个|改成|改看|再看|看看)\s*(.{2,14}?)(?:呢|吧|啊)?[。！!？?，,\s]*$/
      .exec(message.trim())?.[1]
      ?.trim();
  // The window is inherited from the turn that introduced it, not from the
  // immediately preceding line: "还有吗" carries no date of its own, so looking
  // only at the last message would drop the "最近两周" box on a topic switch.
  const windowTurn = [...history]
    .reverse()
    .find(
      (t) => t.role === "user" && requestTimeWindow(t.text, now) !== undefined,
    );
  const carriedWindow = windowTurn
    ? requestTimeWindow(windowTurn.text, now)
    : undefined;
  const query = campusFoodQuery(
    topicSwitch
      ? `${topicSwitch}${carriedWindow ? `；${windowTurn!.text}` : ""}`
      : previousDiscovery
        ? previousDiscovery.text + "；再找更多；"
        : previous
          ? isResultFollowup(message)
            ? previous + "；再查更多；"
            : buildQueryPlan(message).topics.length
              ? `${/广外/.test(previous) && !/广外/.test(message) ? "广外 " : ""}${message}`
              : previous + "；追问：" + message
          : message,
  );
  // A new explicit time constraint wins over a relative date in previous turns.
  const timeWindow =
    requestTimeWindow(message, now) || requestTimeWindow(query, now);
  const knowledge =
    asksPaymentProcedure(query) ||
    /规则|规定|制度|政策|办法|流程|指南|手续|借书|借阅|续借|选课|申请条件|评定条件|资格|材料|怎么办|怎么[办理借]|如何[办理借]|奖学金.*(?:条件|有哪些)|(?:有哪些|什么).*奖学金|需要满足|奖金|发放|奖励标准|报销|补贴/.test(
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
  const articleQuery = (() => {
    const direct = articleTitle(message);
    if (direct) return direct;
    // "那地点呢？" continues the article the previous turn was about. Without
    // this, the follow-up falls back to a generic campus search and the named
    // article loses its exact-title constraint.
    if (
      message.length <= 24 &&
      /地点|时间|在哪|什么时候|哪天|展期/.test(message)
    )
      for (const turn of [...history].reverse()) {
        if (turn.role !== "user") continue;
        const prior = articleTitle(turn.text);
        if (prior) return prior;
      }
    return undefined;
  })();
  const articleLookup = !!articleQuery || wantsArticle(message);
  // Declarative campus statements should get a natural answer *and* a search,
  // not a hard platform refusal. The search uses the sentence as written first
  // and its keywords second (retry lives in contentReadPlan).
  const contentStatement = !articleLookup && isContentStatement(message);
  // Exact titles often differ by typographic quotes or a suffix added by the
  // site. Keep a short leading fragment as the fallback query so a title with
  // inner quotes can still be recalled by FTS.
  // What the user wants from the named article, with the title and publication
  // metadata removed. "总结下研究生的学费标准" must retrieve the tuition
  // section, not just the article's opening chunk.
  const articleFacet = articleQuery
    ? (() => {
        // The facet is the request line, not the whole pasted page. A message
        // often arrives as "标题\n发布时间：…\n来源：…\n问题"; keeping the
        // metadata and the source name made the retriever search for
        // "研究生招生信息网" and return the wrong chunk. Take the last
        // non-metadata line and strip generic request wording.
        const withoutTitle = query
          .replace(articleQuery, " ")
          .replace(
            /(?:发布时间|发布日期|发表时间|更新时间)\s*[:：]?\s*[0-9/年.\-: ]+/g,
            " ",
          );
        const lines = withoutTitle
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const facet = lines.length ? lines[lines.length - 1] : withoutTitle;
        return facet
          .replace(
            /帮我|请|麻烦|告诉我|说说|讲一下|介绍一下|解释一下|说明一下|总结一下|总结下|总结|整理一下|整理|概括|归纳|梳理|生成|写|做|来|一份|一个|文章摘要|摘要|全文|这篇文章的?内容|通知中(?:的)?|文章中(?:的)?|文中|其中|提及的|提到的|里的|中的|找出|告诉我|一下|是什么|有什么|有哪些|怎么|如何|吗|呢|？|\?/g,
            " ",
          )
          .replace(/[，,。；;：:、]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      })()
    : "";
  const articleKeywords = multiTopic
    ? undefined
    : articleLookup && articleQuery
      ? articleQuery
          .replace(/[《》「」『』“”"']/g, "")
          .replace(/\s+/g, "")
          .slice(0, 120)
      : searchKeywords(message);
  // A facility question ("校内有哪些快递点", "收快递除了驿站还有别的点吗") is a
  // place lookup, not a knowledge lookup: the campus map knows every courier
  // counter, printer and supermarket, while the article corpus has almost
  // nothing. Only an existence/list/location question qualifies; asking about
  // opening hours or fees stays a knowledge question. The service word must
  // also resolve to a real place — 「打印照片」 is not a print shop, and
  // sending it to the map made the tool fail and the turn answer nothing.
  const serviceKeyword =
    /(快递|驿站|打印|图文|超市|便利店|充值点|水电充值)/.exec(message)?.[1];
  const facilityListing =
    !multiTopic &&
    /(?:有哪些|有没有|哪个|哪几|哪些|在哪|位置|除了|还有别的|还有没有)|(?:有|有没有).{0,12}(?:地方|店|点)/.test(
      message,
    ) &&
    !!serviceKeyword &&
    searchCampusPlaces(serviceKeyword).length > 0 &&
    !/(?:几点|时间|收费|多少钱|费用|怎么办理|怎么申请|怎么挂失)/.test(message);
  const nav = navigationIntent(
    message,
    undefined,
    false,
    [],
    campus === "baiyun" ? baiyunPlaces : undefined,
  );
  // 「最近」 means "newest" in a notice question and "closest" in a distance
  // question. Only the second sense is a map question: 「最近一条图书馆开放
  // 时间调整通知」 was sent to the map and answered with a place card.
  const proximity =
    /最近/.test(message) &&
    !/最近[一二三四五六七八九十\d]*(?:条|篇|个|份|次|期|则)/.test(message);
  // A named place plus “活动/讲座/比赛” asks what is happening there, not how
  // to get there. “最近的食堂” is still a distance question and stays on the map.
  const eventQuestion =
    events &&
    /讲座|讲坛|论坛|沙龙|活动|竞赛|比赛|大赛|挑战杯|晚会|演出|音乐会|招新|校运会|运动会|通知|公告|报名|截止|申请/.test(
      message,
    );
  const map =
    !generalSubject &&
    !materialQuestion &&
    !articleLookup &&
    (facilityListing ||
      // “学术交流中心最近两周有什么活动” names a place but asks for events.
      // Sending it to the map answered with a place card and no events at all.
      (!multiTopic &&
        !eventQuestion &&
        (nav.namedPlaces.length > 0 ||
          /食堂|饭堂|体育场地|运动场地|体育设施/.test(message) ||
          (history.at(-1)?.cards.some((card) => card.kind === "place") &&
            /其中|哪个/.test(message))) &&
        (proximity || /距离|多远|有哪些|分别在哪里|其中.*近/.test(message))) ||
      nav.routeQuestion ||
      explicitMapCommand(message) !== null ||
      /^(?:这里|那里|这栋|那栋)[。？?]*$/.test(message) ||
      // “假草场在哪” is a place question, but only when the sentence names a
      // real place. A bare “在哪” used to send “校历在哪看得到” and “期末考试
      // 安排在哪里公布” to the map, where search_places failed and the whole
      // turn ended with NOT_FOUND.
      (nav.namedPlaces.length > 0 &&
        /在哪|哪里|哪儿|告诉我.*哪里|位置|怎么去/.test(message)) ||
      // The same word without a place is a question about the service, not a
      // path: 「校园里有校车吗，路线怎么走？」 asks where the bus runs, and
      // sending it to the map made search_places answer NOT_FOUND.
      (nav.namedPlaces.length > 0 &&
        /(?:地图|定位|路线|导航|带我去|带我走|带我过去|导航到|导航去|怎么走|怎么过去|怎么走到|如何去|怎样去|前往|走向|走到|从.+?(?:去|到|至|前往)|(?:帮我找|找一下|找)(?:图书馆|教学楼|饭堂|食堂|超市|宿舍|校门|体育馆|操场|打印店|快递|校医院))/.test(
          message,
        )));
  // Radar tags are the product's own business categories. Lock the event search
  // to the category the user actually named instead of relying on FTS words.
  const categoryOf = (text: string) =>
    /讲座|讲坛|论坛|沙龙|学术报告/.test(text)
      ? "lecture"
      : /比赛|竞赛|大赛|挑战杯|数学建模/.test(text)
        ? "competition"
        : /就业|招聘|宣讲|校招|求职|实习/.test(text)
          ? "education_career"
          : /文体|文化|体育|演出|晚会|音乐会|书展|展览|艺术|运动会|校运会|社团|招新/.test(
                text,
              )
            ? "culture_sports"
            : /奖学金|助学金|奖助|资助/.test(text)
              ? "scholarship_opportunity"
              : /科研|课题|项目申报|论文/.test(text)
                ? "academic_research"
                : /通知|公告|停水|停电|闭馆/.test(text)
                  ? "campus_notice"
                  : undefined;
  // 「人工智能或科研竞赛相关的通知」 spans two subjects joined by 或. Locking
  // one category dropped the AI lectures, and requiring both subjects found
  // nothing, so an explicit alternation keeps the whole search open.
  const alternatives = query
    .split(/或者|以及|或/)
    .filter((part) => part.trim());
  const alternation =
    alternatives.length > 1 &&
    new Set(alternatives.map((part) => categoryOf(part) ?? "")).size > 1;
  const radarCategory =
    multiTopic ||
    alternation ||
    (/讲座|论坛/.test(query) && /竞赛|比赛|大赛/.test(query))
      ? undefined
      : categoryOf(query);
  // "最近/近期" on a radar category is a recency request: newest publications
  // in that tag, not the best lexical match. The retriever orders these by
  // published_at DESC; older items only appear when more are requested.
  const eventBrowsing =
    /讲座|讲坛|论坛|沙龙/.test(query) &&
    /有什么|有哪些|什么时候|何时|哪天|哪些|吗|？|\?/.test(query);
  const recentDiscovery =
    multiTopic ||
    // A time-boxed browse ("最近两周有什么讲座") is an event-date query, not
    // "newest articles in this category". Letting the recency lane win hid the
    // whole window and produced a publication list instead of upcoming events.
    (!eventBrowsing &&
      !participationQuery(query) &&
      timeWindow?.role !== "event" &&
      /最近|近期|最新/.test(query) &&
      (!!radarCategory || /资讯|新闻|动态|消息|资料|文章/.test(query)));
  // Feedback about the previous answer must not become a new search keyword;
  // otherwise campus context from the resolved follow-up query decides the act.
  const messageAct = conversationAct(message);
  const act: ConversationAct = isFeedbackAct(messageAct)
    ? messageAct
    : conversationAct(query);
  const policy = externalPolicy(query);
  const search =
    !generalSubject &&
    !materialQuestion &&
    inputGate(message, history) === "campus" &&
    !map &&
    !reply &&
    !urgent &&
    !isFeedbackAct(act) &&
    (articleLookup ||
      multiTopic ||
      contentStatement ||
      entityLookup ||
      recentDiscovery ||
      knowledge ||
      events ||
      policy.needsOfficialVerification ||
      policy.needsRoster ||
      policy.explicit ||
      /只用内部|只查内部|仅用内部|仅查内部/.test(query) ||
      (act === "campus" && policy.active) ||
      // A campus question is worth searching even when it ends in “？” and
      // matches none of the curated keywords. “期末考试安排在哪里公布？” was
      // the one campus question that produced no tool call at all. A sentence
      // that names a real campus place stays a map/place question instead.
      (act === "campus" &&
        !nav.namedPlaces.length &&
        /[？?]|吗|呢|怎么|如何|哪|什么|多少|几/.test(query)) ||
      act === "general");
  const tools: ContentTool[] = [];
  if (search) {
    if (entityLookup) {
      tools.push("search_campus_knowledge", "search_campus_events");
    } else if (articleLookup) {
      tools.push("search_campus_knowledge");
      // An exhibition/lecture/competition article lives in the activity index
      // even when its page is also a knowledge document. Search both so an
      // exact title is not reported as missing just because it is an event.
      if (
        /展览|展演|展出|作品展|艺术展|摄影展|影像展|书画展|设计展|讲座|讲坛|论坛|会议|比赛|竞赛|大赛|活动|演出|音乐会|招新/.test(
          message,
        )
      )
        tools.push("search_campus_events");
    } else if (events && !knowledge) {
      tools.push("search_campus_events");
      // A recruitment notice can exist without a calendar row. Search the
      // campus corpus as well so an empty calendar is not the final answer.
      if (/报名|招募|其他/.test(message))
        tools.push("search_campus_knowledge");
    } else if (contentStatement) {
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
  // A request for a method or an opinion ("宿舍太潮湿有什么办法", "大一该怎么
  // 安排时间") is answered from general knowledge first, then the campus
  // specifics that still need checking. Requiring evidence for the whole
  // sentence turned every practical question into a refusal, because the
  // campus corpus has no article titled after the user's problem.
  const advice =
    /帮我安排|学习计划|行程计划|(?:有什么|有啥|哪些|什么).{0,8}(?:办法|方法|建议|技巧|注意)|怎么(?:安排|准备|选|避免|缓解|解决|处理|改善|调节|应对|除|防)|怎么办|要不要|该不该|值不值得|合适吗|推荐(?:一下|点)|注意些什么/.test(
      query,
    );
  // “怎么安排时间” is advice, but “选课系统什么时候开放，没抢到课怎么办” also
  // asks a dated fact. Asking for a specific date, place, fee or rule keeps the
  // answer strict so the fact cannot be invented.
  const factualAsk =
    /(?:什么时候|几点|几号|多少|多少钱|哪[个里天]|条件|要求|流程|手续|规定|标准|时间表|截止)/.test(
      query,
    );
  const answerRequirement: AnswerRequirement =
    // A safety question is answered from general knowledge: the campus corpus
    // cannot hold the answer to "someone is following me", and a strict gate
    // would refuse to say anything at all.
    /保证|一定|必定/.test(query) && /获奖|获胜|录取|通过|成功/.test(query)
      ? "advisory"
      : urgent
        ? "open"
        : articleLookup ||
            entityLookup ||
            policy.officialOnly ||
            policy.needsOfficialVerification
          ? "strict"
          : advice && !factualAsk
            ? "advisory"
            : strictFact
              ? "strict"
              : search
                ? "strict"
                : "open";
  const discovery =
    /有哪些|有什么|举几|举\d|名单|曾经|哪些|谁|几个|几场|几篇|情况|信息|方面|内容/.test(
      query,
    );
  // “了解下秋之声” asks about 秋之声; the polite lead-in must not become part of
  // the FTS keywords or the exact-name match disappears.
  const RETRIEVAL_LEAD =
    /^(?:请|帮我|我想|想|要|了解一下|了解下|了解|介绍一下|介绍下|介绍|说说|讲讲|查询|查一下|查下|查查|搜一下|搜下|搜搜|看看|看下|找一下|找找|推荐一下)\s*/;
  const coreQuery =
    stripTimeRange(stripSearchControls(stripOutputClauses(query)))
      .replace(/(?:帮我)?区分哪些.*$/, "")
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
  let retrievalQuery = multiTopic
    ? "最新 校园 通知"
    : campusOverview
      ? "校区"
      : entityLookup
        ? entityTerm.slice(-300)
        : broadListQuery
          ? broadListQuery
          : articleLookup
            ? (articleFacet || articleQuery!).slice(-300)
            : contentStatement
              ? coreQuery.slice(-300)
              : declarativeRequest
                ? coreQuery.slice(-300)
                : discovery || recentDiscovery
                  ? coreQuery
                      .replace(
                        /举[几\d]+[个位]?|曾经|最近|近期|大型|重要|值得关注|筛选|找一些|一些|排除已经?过期|已过期|过期|发布|有哪些|有什么|有没有|哪些|几个|几场|几篇|可报名|能报名|报名|查询|还有|别的|其他|更多|再找|继续|换一批|后面的|情况|信息|方面|内容|活动|广东外语外贸大学|校园|学校|的|时间段|或|与|吗|呢|呀|请|帮我/g,
                        " ",
                      )
                      .replace(/[，,、；;]/g, " ")
                      .replace(/[？?。！!，,；;]/g, " ")
                      .replace(/\s+/g, " ")
                      .replace(/^\s*的+/, "")
                      .replace(/体育(?:比赛|赛事)/g, "体育 比赛")
                      .replace(/赛事/g, "比赛")
                      .trim()
                      .slice(-300) || query.slice(-300)
                  : coreQuery.slice(-300);
  // A multi-topic browse already has its own query ("最新 校园 通知"); stripping
  // the recency words from it would drop the only part that says "newest".
  if (recentDiscovery && !articleLookup && !multiTopic) {
    const core = stripSearchControls(retrievalQuery)
      .replace(/官网|官方(?:网站|网页)?|最新|资料|文章/g, " ")
      .trim();
    retrievalQuery = core.replace(/广东外语外贸大学|广外|学校|校园|\s/g, "")
      ? core
      : "校园资讯";
  }
  if (/讲座|论坛/.test(query) && /竞赛|比赛|大赛/.test(query))
    retrievalQuery = retrievalQuery
      .replace(/讲座|论坛|竞赛|比赛|大赛|相关/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // “最近两周有什么可以参加的活动” is a time-boxed browse, not a keyword
  // search. Once the time words and the verbs are gone nothing is left to
  // filter on, and the event index must be read by date instead of requiring
  // every article to contain the phrase “可以去参加”.
  if (timeWindow && !articleLookup && !recentDiscovery) {
    const subject = stripTimeRange(retrievalQuery)
      .replace(
        /重要|按时间顺序|按时间排序|列出来|列出|分别|帮我|有哪些|有什么/g,
        " ",
      )
      .replace(
        /可以去|能够去|能去|可以|能够|想|参加|参与|报名|活动|事情|校园|学校|的/g,
        " ",
      )
      // Campus words are already carried as structured constraints. Leaving
      // them in the lexical query makes calendar relevance reject valid
      // events whose article names a building but not the campus nickname.
      .replace(
        /广东外语外贸大学|广外|大学城校区|大学城|南校区|南校|白云山校区|白云校区|白云山|白云|北校区|北校/g,
        " ",
      )
      .replace(/[\s，,。！!？?；;]/g, "")
      .trim();
    retrievalQuery = subject || "活动";
  }
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
    materialQuestion,
    discoveryFollowup: !!previousDiscovery,
    // A relative browse ("最近两周") may fall back to the nearest upcoming
    // events; a written date range ("11月1日到11月5日") is a hard filter.
    explicitDateRange: dateRangeIn(message, chinaDay(now)!) !== null,
  };
}
