/**
 * What the user is doing in this turn, before any retrieval decision.
 * This is a narrow, closed classification of conversational acts. It is not a
 * keyword answer table: the model still writes the reply, and campus facts
 * still require real evidence.
 */
export type ConversationAct =
  "chitchat" | "confusion" | "correction" | "general" | "campus";

/** A campus entity/topic turns a question into a CampusOS content request. */
const CAMPUS_SIGNAL =
  /广外|广东外语外贸大学|学校|校内|校园|大学城|南校|北校|白云山|云山学者|云山青年学者|云山领军|食堂|饭堂|宿舍|南苑|北苑|图书馆|教学楼|实验楼|体育馆|奖学金|教务|辅导员|学院|社团|讲座|比赛|竞赛|报名|通知|公告|选课|考试|课程|就业|招聘|活动|政策|规定|制度|办理|申请|地图|路线|导航|定位/;

/** Pure confusion about the previous answer, never a new search topic. */
const CONFUSION =
  /^(?:(?:啊|哦|嗯|咦|什么|啥|这|那|哈)[\s?？!！。.,，]*)*(?:什么意思|没看懂|看不懂|你在说什么|答非所问|牛头不对马嘴|听不懂|说了个啥)[?？!！。.\s]*$/;

/** Explicit correction of the previous answer. */
const CORRECTION =
  /^(?:不对|错了|不是这个|不是这个意思|不是我问的|你答错了|重新回答|我说的是|你刚才说的不对|没有回答我的问题)[!！。.\s]*$/;

/** Playful, emotional or persona turns that need conversation, not retrieval. */
const CHITCHAT =
  /你是一只|你是只|大肥鱼|小鱼干|鲸鱼|扮演|人设|陪我聊|聊两句|好无聊|好困|好累|好饿|想吃|次饭|摸摸|抱抱|夸夸|晚安|早安|在吗|你是谁|你会什么/;

export function conversationAct(message: string): ConversationAct {
  const text = message.normalize("NFKC").trim();
  // A punctuation-only turn can only be a reaction to the previous answer.
  const bare = text.replace(/[\s?？!！。.,，、~～…]+/g, "");
  if (!bare || CONFUSION.test(text)) return "confusion";
  if (CORRECTION.test(text)) return "correction";
  if (CAMPUS_SIGNAL.test(text)) return "campus";
  if (/^(?:我|本鱼)(?:喜欢|讨厌|觉得|今天.{0,4}(?:开心|难过|累|困))/.test(text))
    return "chitchat";
  if (CHITCHAT.test(text)) return "chitchat";
  return "general";
}

export function isFeedbackAct(act: ConversationAct) {
  return act === "confusion" || act === "correction";
}
