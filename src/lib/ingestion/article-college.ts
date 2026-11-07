// Which school an article belongs to, and what kind of event it is.
//
// This is a projection over text we already store — no new fetching, no
// second taxonomy, no rewriting of the article body. It exists so that a
// question like "还有别的学院的院运会吗" can be answered by grouping rows in
// D1 instead of hoping the right three chunks survive a top-k.
//
// The two dictionaries are deliberately small and explicit:
// * colleges come from the one shared vocabulary in src/lib/retrieval/colleges.ts,
//   so a notice that writes "信息科学与技术学院" and one that writes
//   "信息学院" produce the same value;
// * event kinds are a closed list of the activity nouns campus notices
//   actually use ("运动会", "讲座", "竞赛", ...). Anything else stays null
//   rather than being guessed.
import { COLLEGE_GROUPS, COLLEGE_NAMES } from "@/lib/retrieval/colleges";
import type { ArticleText } from "./article-text";

export type CollegeHit = {
  /** Stable id from COLLEGE_GROUPS ("informatics"), not a display name. */
  id: string;
  /** The spelling that was actually found in the article. */
  name: string;
  /** Where the match sits, so the caller can attach offsets as evidence. */
  field: "title" | "body";
  start: number;
  end: number;
};

const idOf = (name: string) =>
  COLLEGE_GROUPS.find((group) => group.names.includes(name))?.id || "";

function findIn(source: string): { name: string; start: number } | null {
  // COLLEGE_NAMES is longest-first, so the full name wins over its short form.
  for (const name of COLLEGE_NAMES) {
    const at = source.indexOf(name);
    if (at >= 0) return { name, start: at };
  }
  return null;
}

/**
 * The most authoritative college mention we can find.
 *
 * Order matters more than cleverness here. A title names its subject; an
 * organiser field names its host; only then does plain body text count,
 * because a body may list co-organisers from other schools and we would
 * otherwise attribute the notice to whichever one happens to be mentioned
 * first.
 */
export function detectCollege(
  text: ArticleText,
  organizers: (string | null)[],
): CollegeHit | null {
  const title = findIn(text.title);
  if (title)
    return {
      id: idOf(title.name),
      name: title.name,
      field: "title",
      start: title.start,
      end: title.start + title.name.length,
    };
  for (const organizer of organizers) {
    if (!organizer) continue;
    const hit = findIn(organizer);
    if (!hit) continue;
    const at = text.text.indexOf(hit.name);
    if (at >= 0)
      return {
        id: idOf(hit.name),
        name: hit.name,
        field: "body",
        start: at,
        end: at + hit.name.length,
      };
  }
  const body = findIn(text.text);
  if (body)
    return {
      id: idOf(body.name),
      name: body.name,
      field: "body",
      start: body.start,
      end: body.start + body.name.length,
    };
  return null;
}

/**
 * Closed list of activity kinds. Order decides ties ("运动会趣味比赛" is
 * sport first), so put the narrowest nouns before the generic ones.
 */
export const EVENT_KINDS = [
  {
    code: "sports",
    pattern:
      /运动会|院运会|田径|拔河|趣味运动|篮球赛|足球赛|排球赛|羽毛球赛|乒乓球赛/,
  },
  { code: "lecture", pattern: /讲座|报告会|论坛|研讨会|沙龙|宣讲会|分享会/ },
  {
    code: "competition",
    pattern: /竞赛|比赛|大赛|挑战赛|选拔赛|征文|作品征集/,
  },
  { code: "volunteer", pattern: /志愿服务|志愿者|义工|支教/ },
  { code: "recruitment", pattern: /招聘|招新|纳新|双选会|实习/ },
  { code: "training", pattern: /培训|工作坊|训练营|夏令营/ },
  { code: "exhibition", pattern: /展览|书展|展出|演出|晚会/ },
] as const;

export type EventKind = (typeof EVENT_KINDS)[number]["code"];

/** Title first, then body; null when nothing concrete matches. */
export function detectEventType(text: ArticleText): EventKind | null {
  return eventKindOf(text.title) || eventKindOf(text.text);
}

/** One string, one kind. Used by the query side too, so "院运会" and the
 * stored "sports" are never two different vocabularies. */
export function eventKindOf(source: string): EventKind | null {
  for (const kind of EVENT_KINDS)
    if (kind.pattern.test(source)) return kind.code;
  return null;
}
