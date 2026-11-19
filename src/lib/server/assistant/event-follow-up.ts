import type { StoredMessage } from "@/domain/agent/assistant-contracts";

// 「帮我找一下最近有什么人工智能相关的讲座」→「第一个讲座在哪里举办？」
// The second turn refers to an item the previous answer already listed by
// number. Searching articles for 「第一个」「哪里」 finds an unrelated old
// lecture instead of reading back the list that was just produced.
type ListedEvent = {
  title: string;
  campus: string;
  date: string;
  place: string;
};

const LINE = /^\d+\.\s+(.+?)\s+·\s+(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2})?(?:\s+·\s+(.+))?$/;

function listedEvents(history: StoredMessage[]): ListedEvent[] {
  const answer = [...history]
    .reverse()
    .find((turn) => turn.role === "assistant" && /^\d+\.\s/m.test(turn.text));
  if (!answer) return [];
  return answer.text
    .split("\n")
    .flatMap((line) => {
      const match = LINE.exec(line.trim());
      if (!match) return [];
      // The trailing metadata is 「地点 · 校区 · 报名中」 and the line ends
      // with a citation marker like 「[2]」.
      const parts = (match[3] ?? "")
        .replace(/\[\d+\]$/, "")
        .split(" · ")
        .map((part) => part.trim())
        .filter(Boolean);
      const campus = parts.find((part) =>
        /^(?:大学城校区|白云山校区|线上)$/.test(part),
      );
      const place = parts.filter((part) => part !== campus).join(" ");
      return [
        { title: match[1].replace(/\[\d+\]$/, ""), date: match[2], place, campus: campus ?? "" },
      ];
    })
    .slice(0, 8);
}

const ORDINAL: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
};

function ordinalOf(text: string): number | undefined {
  const raw = /^(\d{1,2})$/.exec(text)?.[1] ?? ORDINAL[text];
  if (raw === undefined) return undefined;
  const index = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(index) ? index : undefined;
}

const CAMPUS_OF: Record<string, string> = {
  大学城: "大学城校区",
  南校: "大学城校区",
  白云山: "白云山校区",
  北校: "白云山校区",
};

export type EventFollowUp = {
  /** The event being talked about, empty when none was listed before. */
  event?: ListedEvent;
  /** Where the user thinks it is, when they named a different campus. */
  campusMismatch?: string;
};

export function eventFollowUp(
  history: StoredMessage[],
  question: string,
): EventFollowUp | undefined {
  const events = listedEvents(history);
  if (!events.length) return undefined;
  const asked = /(?:第|最后)(\d{1,2}|[一二三四五六七八九])(?:个|场|条)?(?:讲座|活动|比赛|场次|安排)/.exec(
    question,
  );
  // An unrelated follow-up («带我去图书馆») must not be answered from the
  // list: only an ordinal reference, a reference to the event itself, or a
  // question about its venue/time continues the list.
  const refers =
    !!asked ||
    /(?:这个|那个|该|刚才的?|上面|前面).{0,4}(?:讲座|活动|比赛)/.test(question) ||
    /(?:讲座|活动|比赛).{0,4}(?:在哪|哪里|什么地方|地点|几点|什么时候|时间|哪天)/.test(
      question,
    ) ||
    /(?:在哪|哪里|什么地方|地点|几点|什么时候|时间|哪天).{0,4}(?:讲座|活动|比赛)/.test(
      question,
    ) ||
    // 「如果地点在南校，我想从南苑8栋过去」 asks about the venue of the
    // listed event, so the campus it names must be checked against that event.
    (/大学城|南校|白云山|北校/.test(question) &&
      /地点|那里|那儿|过去|导航|带我去/.test(question));
  if (!refers) return undefined;
  const index = asked ? ordinalOf(asked[1]) : undefined;
  const event = index !== undefined ? events[index - 1] : events[0];
  if (!event) return undefined;
  const named = /大学城|南校|白云山|北校/.exec(question)?.[0];
  const expected = named ? CAMPUS_OF[named] : undefined;
  return {
    event,
    campusMismatch:
      expected && event.campus && expected !== event.campus ? expected : undefined,
  };
}

/**
 * Answers a follow-up about an already listed event without another search.
 * Returns undefined when the question is not about that list.
 */
export function eventFollowUpReply(
  history: StoredMessage[],
  question: string,
): string | undefined {
  const follow = eventFollowUp(history, question);
  if (!follow?.event) return undefined;
  const { event } = follow;
  const where = event.place
    ? event.place.replace(/^[^\u4e00-\u9fa5]*/, "")
    : event.campus;
  const route = /导航|带我去|怎么走|怎么去|路线/.test(question);
  if (follow.campusMismatch) {
    // The event sits on the other campus; agreeing with 「南校」 would invent a
    // route across campuses that does not exist.
    const venue = event.place || event.campus;
    return `${event.title}在${venue}，不在${follow.campusMismatch}。两个校区之间没有校内步行路线，需要先跨校区出行。`;
  }
  if (route) return undefined;
  if (/在哪|哪里|什么地方|什么地点|地点|举办地/.test(question))
    return where ? `${event.title}在${where}举办。` : `${event.title}的举办地点还没有核实。`;
  if (/几点|什么时候|时间|日期|哪天/.test(question))
    return `${event.title}的举办时间是 ${event.date}。`;
  return undefined;
}
