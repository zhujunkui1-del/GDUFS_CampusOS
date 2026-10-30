import type { MapAction } from "@/domain/maps/contracts";
import { ApiError } from "../errors";
import { dialogueReply } from "./dialogue";
export function unmatchedTopicClarification(
  message: string,
  lookup: () => boolean,
) {
  let known = false;
  try {
    known = lookup();
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "NOT_FOUND")) throw error;
  }
  return known ? undefined : `你想了解“${message.trim()}”的哪方面信息？`;
}
export function shouldClarifyBareTopic(
  message: string,
  contentActive: boolean,
  knownPlace: boolean,
  spatialIntent: boolean,
) {
  const text = message.trim();
  return (
    !contentActive &&
    !knownPlace &&
    !spatialIntent &&
    !dialogueReply(text) &&
    /^[\p{Script=Han}·]{2,3}$/u.test(text) &&
    !/^(?:你好[呀啊]?|您好|谢谢你?|好的|再见|这里|那里|这儿|那儿|这个|那个|地图|路线|导航|定位|放大|缩小|旋转|切换|清除|取消|怎么走)$/.test(
      text,
    )
  );
}
// Only complete, affirmative UI commands get a required registered control tool. Negations/questions do not match.
export function explicitMapCommand(message: string): MapAction | null {
  const text = message.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const mode =
    /^(?:请|帮我)?(?:把)?(?:地图)?(?:切换|切|改成|调到|变成)(?:成|为|到)?(3d|2\.5d|2d)(?:模式|视图)?[。.！!]?$/i.exec(
      text,
    )?.[1];
  if (mode === "2d" || mode === "2.5d" || mode === "3d")
    return { type: "SET_VIEW_MODE", mode };
  if (
    /^(?:请|帮我)?(?:清除|清空|取消|删除)(?:刚刚|刚才|这条|当前)?的?路线[。.！!]?$/i.test(
      text,
    )
  )
    return { type: "CLEAR_ROUTE" };
  return null;
}

/**
 * An official-document / article title used as a message. This is deliberately
 * narrower than "contains 活动/讲座": a question like “最近有什么讲座” must
 * stay a discovery query, not become an exact-title lookup.
 */
const TITLE_ENDING =
  /(?:通知|公告|公报|公示|名单|报道|新闻稿|全文|原文|速览|方案|办法|意见|决定|决议|报告|细则|条例)$/;
export function titleLike(message: string) {
  const text = message.normalize("NFKC").trim();
  return (
    /[《「『“"][^》」』”"]{4,300}[》」』”"]/.test(text) ||
    (text.length >= 12 &&
      /[《「『“"][^》」』”"]{1,300}[》」』”"]/.test(text) &&
      /图书馆|大学|学院|讲座|讲坛|课程|论坛|会议|通知|公报|报告/.test(text)) ||
    (text.length >= 12 && TITLE_ENDING.test(text))
  );
}
export function isContentStatement(message: string) {
  const text = message.normalize("NFKC").trim();
  if (/最近|近期|最新|有哪些|有什么|情况|信息|新闻|资讯|动态/.test(text))
    return false;
  if (!text || /[?？]|(?:吗|呢)\s*$/u.test(text)) return false;
  if (/^(?:你|您|本鱼|大肥鱼)|我是|我喜欢|我爱你|谢谢你?|晚安|早安|你好/.test(text))
    return false;
  return (
    text.length >= 6 &&
    /广外|学校|校园|学院|大学|图书馆|老师|教授|院长|学生|通知|公告|公报|讲座|论坛|会议|比赛|竞赛|活动|政策|名单|公示|奖学金|宿舍|食堂|社团|报名|考试|课程/.test(
      text,
    )
  ) ||
    titleLike(text);
}
/** A request for a specific article, not a place. */
export function wantsArticle(message: string) {
  const text = message.normalize("NFKC");
  return (
    /(?:文章|这篇|原文|报道|新闻稿|全文|标题)/.test(text) ||
    /[《「『“"][^》」』”"]{4,200}[》」』”"]/.test(text) ||
    titleLike(text)
  );
}
/** Best-effort title extraction; the retriever still has to verify it exists. */
export function articleTitle(message: string) {
  const text = message.trim();
  if (!wantsArticle(text)) return undefined;
  const book = text.match(/《([^》]{4,300})》/);
  const outer =
    text.match(/[「『“"]([^》」』”"]{4,300})[》」』”"]/) ||
    text.match(/[‘']([^’']{4,300})[’']/);
  let title = book?.[1];
  if (!title && outer) {
    // A title often contains inner quotes (“十五五”). Only treat a quoted
    // fragment as the title when the rest of the message is just a request
    // wrapper; otherwise the whole message is the title.
    const remainder = text
      .replace(outer[0], "")
      .replace(
        /^(?:请|帮我|麻烦|我想|想|要|在校园雷达里|在校园知识库里|在雷达里|在知识库里|查找|查|搜索|搜|找|看看|看下|了解一下|了解)\s*/g,
        "",
      )
      .replace(/(?:这篇文章|这篇报道|文章|原文|报道|新闻稿|全文)[。！？!?]*$/g, "")
      .trim();
    if (remainder.length > 4) title = undefined;
    else title = outer[1];
  }
  if (!title) {
    const cleaned = text
      .replace(
        /^(?:请|帮我|麻烦|我想|想|要|在校园雷达里|在校园知识库里|在雷达里|在知识库里|查找|查|搜索|搜|找|看看|看下|了解一下|了解)\s*/g,
        "",
      )
      .replace(/^(?:有没有|是否有)\s*/g, "")
      .replace(/(?:这篇文章|这篇报道|文章|原文|报道|新闻稿|全文)[。！？!?]*$/g, "")
      .trim();
    title = cleaned;
  }
  const normalized = title
    .replace(/^(?:那篇|这篇|一篇)\s*/, "")
    .trim();
  return normalized.length >= 4 ? normalized.slice(0, 300) : undefined;
}
/** Keywords for the second pass after the exact title misses. */
export function searchKeywords(message: string) {
  const text = message
    .normalize("NFKC")
    .replace(/[《》「」『』“”‘’"']/g, " ")
    .replace(
      /(?:有没有|是否有|请问|帮我|麻烦|我想|想|要|在校园雷达里|在校园知识库里|查找|查一下|查下|查|搜索|搜一下|搜下|搜|找一下|找找|找|看看|看下|了解一下|了解|介绍一下|介绍|关于|这篇文章|这篇报道|文章|原文|报道|新闻稿|全文|一图速览)/g,
      " ",
    )
    .replace(/[，,。！!？?；;：:、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 2 ? text.slice(0, 120) : "";
}

export function requiresPlaceLookup(message: string) {
  if (wantsArticle(message)) return false;
  if (/不要|不必|不用|别找/.test(message) || /附近/.test(message)) return false;
  if (/从.+(?:去|到)|路线|怎么走/.test(message)) return false;
  // A question about the last answer ("只能找到这两条吗", "还有别的来源吗")
  // is content feedback, not a request to locate a place.
  if (
    /只能|就这|这几条|这两条|来源|名单|文章|报道|信息|结果|不够|不全|太少|更多|还有/.test(
      message,
    ) &&
    /[吗呢？?]|只能|不够|不全|太少|更多|还有/.test(message)
  )
    return false;
  // Named facilities are real map places; asking "在哪" must resolve them
  // through search_places. Generic "找/搜" verbs alone are not location intent.
  return (
    /在哪里|在哪儿|南苑\d+栋|北苑\d+栋|图书馆|教学楼|实验楼|八角楼|语心桥|[一二三四]饭|饭堂|食堂|超市|又康|便利店|打印店|快递|校医院|门诊部|体育馆|操场|号门|贝岗门|校门|[东南西北]门|[一二三四五六七八九十\d]+栋|[\u4e00-\u9fa5]{1,6}(?:楼|桥|馆|场|园)/.test(
      message,
    ) || /(?:在|去|到)(?:哪|什么位置)/.test(message)
  );
}
export function isOriginQuestion(text: string) {
  return (
    /起点|从哪里|从哪|授权|定位|告诉我.*(?:位置|地点)/.test(text) &&
    !/\d+\s*(?:米|公里|分钟)|已.{0,8}(?:显示|规划|生成|找到|定位到)/.test(text)
  );
}
