/**
 * The opening line shown before a conversation has any message.
 *
 * It states what the assistant can do in this deployment (campus radar,
 * campus knowledge, articles, calendar) so readers know what to ask instead of
 * guessing at a search box. It deliberately promises nothing beyond the
 * audited tools: no embedding search, no site-wide crawl.
 */
export const ASSISTANT_WELCOME =
  "嗨，我是广外通里的校园助手。你可以直接问我：最近有什么讲座、比赛或通知，食堂、宿舍、教学楼在哪里，图书馆怎么走，或者让我帮你找一篇校园文章、查一下活动日历。我会先去校园雷达和校园知识里找，再结合原文回答。今天想先从哪件事开始？比如「最近有什么讲座」或「带我去图书馆」。";

/** The two examples quoted inside {@link ASSISTANT_WELCOME}, offered as buttons. */
export const ASSISTANT_WELCOME_EXAMPLES = [
  "最近有什么讲座",
  "带我去图书馆",
] as const;
