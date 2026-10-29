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

/** A request for a specific article, not a place. */
export function wantsArticle(message: string) {
  const text = message.normalize("NFKC");
  return (
    /(?:文章|这篇|原文|报道|新闻稿|全文|标题)/.test(text) ||
    /[《「『“"][^》」』”"]{4,200}[》」』”"]/.test(text)
  );
}
/** Best-effort title extraction; the retriever still has to verify it exists. */
export function articleTitle(message: string) {
  const text = message.trim();
  if (!wantsArticle(text)) return undefined;
  const quoted =
    text.match(/《([^》]{4,300})》/) ||
    text.match(/[「『“"]([^》」』”"]{4,300})[》」』”"]/) ||
    text.match(/[‘']([^’']{4,300})[’']/);
  let title = quoted?.[1];
  if (!title) {
    const match = text.match(
      /(?:帮我找到|找到|查找|搜索|搜一下|查一下|要|给我)\s*[:：]?\s*(.{4,300}?)(?:这篇文章|文章|原文|报道)?[。！？!?]*$/,
    );
    title = match?.[1];
  }
  if (!title) return undefined;
  const cleaned = title
    .replace(/^(?:那篇|这篇|一篇)\s*/, "")
    .replace(/\s*(?:这篇文章|文章|原文|报道)[。！？!?]*$/, "")
    .trim();
  return cleaned.length >= 4 ? cleaned.slice(0, 300) : undefined;
}

export function requiresPlaceLookup(message: string) {
  if (wantsArticle(message)) return false;
  if (/不要|不必|不用|别找/.test(message) || /附近/.test(message)) return false;
  if (/从.+(?:去|到)|路线|怎么走/.test(message)) return false;
  // Canteen order aliases (一饭) and named facilities are real map places; asking
  // "在哪" must resolve them through search_places instead of guessing prose.
  return (
    /找|查找|搜索|在哪里|在哪儿|南苑\d+栋|北苑\d+栋|图书馆|教学楼|实验楼|八角楼|语心桥|[一二三四]饭|饭堂|食堂|超市|又康|便利店|打印店|快递|校医院|门诊部|体育馆|操场|号门|贝岗门|校门|[东南西北]门|[一二三四五六七八九十\d]+栋|[\u4e00-\u9fa5]{1,6}(?:楼|桥|馆|场|园)/.test(
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
