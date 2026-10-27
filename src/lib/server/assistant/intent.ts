import type { MapAction } from "@/domain/maps/contracts";
import { ApiError } from "../errors";
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
export function requiresPlaceLookup(message: string) {
  if (/不要|不必|不用|别找/.test(message) || /附近/.test(message)) return false;
  if (/从.+(?:去|到)|路线|怎么走/.test(message)) return false;
  return /找|查找|搜索|在哪里|在哪儿|南苑\d+栋|北苑\d+栋|图书馆|教学楼|实验楼|八角楼|语心桥/.test(
    message,
  );
}
export function isOriginQuestion(text: string) {
  return (
    /起点|从哪里|从哪|授权|定位|告诉我.*(?:位置|地点)/.test(text) &&
    !/\d+\s*(?:米|公里|分钟)|已.{0,8}(?:显示|规划|生成|找到|定位到)/.test(text)
  );
}
