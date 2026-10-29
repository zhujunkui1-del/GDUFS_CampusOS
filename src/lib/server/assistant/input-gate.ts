/**
 * Every turn is classified before any retrieval. Categories 2–4 must never
 * reach a search tool.
 */
export type InputGate =
  "campus" | "greeting" | "off_topic" | "blocked" | "vague";

const CAMPUS_SIGNAL =
  /学校|校园|广外|广东外语外贸大学|大学城|南校|北校|白云山|云山学者|云山青年学者|云山领军|食堂|饭堂|一饭|二饭|三饭|宿舍|南苑|北苑|图书馆|教学楼|实验楼|体育馆|操场|门诊部|门诊楼|门诊室|校医院|超市|又康|便利店|打印店|快递|奖学金|教务|辅导员|学院|社团|讲座|比赛|竞赛|报名|通知|公告|选课|考试|课程|就业|招聘|活动|政策|规定|制度|办理|申请|地图|路线|导航|定位|校车|校历|校规|校史|号门|贝岗门|校门|大门|东门|南门|西门|北门|[一二三四五六七八九十\d]+栋|[\u4e00-\u9fa5]{1,6}(?:楼|桥|馆|场|园)|排球|篮球|足球|羽毛球|网球|乒乓球|打球/;

const BLOCKED =
  /操你妈|草你妈|你妈死|你妈似|傻逼|煞笔|婊子|卖淫|嫖娼|约炮|裸聊|色情|毒品|冰毒|摇头丸|赌博|代考|代写论文|办假证|买枪|炸药/;

const GREETING =
  /^(?:你好|您好|hi|hello|在吗|早上好|中午好|晚上好|早安|晚安)[!！。.,，\s]*$/i;

const MEANINGLESS = /^[\d\s\p{P}\p{S}]+$/u;
// In a campus app, a bare short phrase is usually a place, event, article or
// topic the keyword list has not learned yet (e.g. “秋之声”). Refusing it as
// off-topic is worse than letting the campus retrieval check. Question-like
// and non-campus wording is still caught by the explicit rules above.
const BARE_CAMPUS_TOPIC =
  /^(?:(?:了解|介绍|说说|讲讲|查|搜|看)(?:一下|下)?)?[\u4e00-\u9fa5]{2,10}$/;
const FOOD = /好吃|吃什么|吃啥|美食|干饭/;
// Bare foreign landmarks are still clearly outside this campus product.
const OFF_TOPIC_GEO = /巴黎|埃菲尔|纽约|东京|伦敦|首尔|悉尼|火星|月球/;
const WEATHER = /天气|气温|下雨|降雨|空气质量|几度/;
const OTHER_CITY =
  /北京|上海|天津|重庆|南京|武汉|西安|成都|杭州|苏州|深圳|珠海|佛山|东莞|香港|澳门/;

export function inputGate(
  message: string,
  history: { role: "user" | "assistant"; text: string }[] = [],
): InputGate {
  const text = message.normalize("NFKC").trim();
  if (BLOCKED.test(text)) return "blocked";
  if (GREETING.test(text)) return "greeting";
  if (!text) return "vague";
  if (CAMPUS_SIGNAL.test(text)) return "campus";
  // A question about a topic the user just named (e.g. "秋之声" then
  // "2026年的秋之声什么时候举行") is still that campus topic. The keyword
  // list cannot know every event and club name, so carry the user's own noun.
  const priorTopic = history
    .slice(-6)
    .reverse()
    .find(
      (turn) =>
        turn.role === "user" &&
        turn.text.trim().length >= 2 &&
        turn.text.trim().length <= 10 &&
        BARE_CAMPUS_TOPIC.test(turn.text.trim()),
    );
  if (priorTopic && text.includes(priorTopic.text.trim())) return "campus";
  // A distant city's weather/news is unrelated even if the previous turn was
  // about campus, so this check precedes the short-follow-up context rule.
  if (OTHER_CITY.test(text) || WEATHER.test(text)) return "off_topic";
  // Any short "where is X" question in this product is a campus place lookup,
  // even when X is a gate, courier point or room the keyword list did not know.
  if (
    /(?:在哪|在哪里|怎么走|什么位置|位置在哪)/.test(text) &&
    text.length <= 20
  )
    return "campus";
  // Campus dining is the only dining context in this product; a distant city's
  // food question is still unrelated.
  if (FOOD.test(text)) return "campus";
  if (OFF_TOPIC_GEO.test(text)) return "off_topic";
  if (BARE_CAMPUS_TOPIC.test(text)) return "campus";
  // A short follow-up after a campus turn keeps the campus context, so an alias
  // such as “门诊部” or “一饭” is not mistaken for an unrelated question.
  const campusContext = history
    .slice(-6)
    .some((turn) => turn.role === "user" && CAMPUS_SIGNAL.test(turn.text));
  if (campusContext && text.length <= 18) return "campus";
  if (MEANINGLESS.test(text)) return "vague";
  return "off_topic";
}

export function inputGateReply(gate: Exclude<InputGate, "campus">) {
  if (gate === "greeting") return "你好，有什么校园问题需要帮忙？";
  if (gate === "blocked")
    return "这个问题我没办法帮你，有校园相关的问题可以继续问我。";
  if (gate === "vague") return "本鱼没太看明白，你是想问校园里的哪件事？";
  return "本鱼只负责广外校园相关的问题，这个帮不上忙；有校园里的问题可以继续问我。🐟";
}
