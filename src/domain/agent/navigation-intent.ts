import {
  searchCampusPlaces,
  type CampusPlace,
} from "@/features/campus-map/data/campus";
import { normalizePlaceText } from "@/features/campus-map/data/campus-text";
import { requestsDeviceLocation } from "./location-intent";

const normalize = normalizePlaceText;
// 「前往」「走向」「走到」describe the same relation as 「去」「到」「至」.
// Leaving them out sent 「从南苑七栋前往假草场」 to article search instead of
// the map tool, so the same sentence meant different things depending on the
// verb the user happened to pick.
const ROUTE_RE =
  /从.+(?:去|到|至|前往|走向|走到)|(?:去|到|导航|前往|走向|走到|→|->).+|怎么走|怎么去|怎么过去|怎么走到|规划.*路线/;
// 「图书馆可以带包进去吗」 is a library rule question, not a trip: 去 inside
// 进去 is a movement compound, not a destination verb. Stripping the compound
// before the route test keeps 「我想去图书馆」 a route while 「可以带进去吗」
// stays an article question.
const MOVEMENT_COMPOUND = /(?:进|出|上|下|回|过|起|看)去/g;
// A bare verb is not a route: “东西丢了去哪里报失” and “校内兼职去哪找” both
// contain 去 but ask where to go for help, not how to walk somewhere. A route
// needs a real destination, so the named-place check below is what separates
// them — without it seven campus questions were answered by the map tool.
//
// “校园里有校车吗，路线怎么走？” asks about a bus service, not a path: the
// phrase 路线怎么走 is there but no campus place is named, so the map tool
// would search for a destination that does not exist and answer NOT_FOUND.
// The keyword alone therefore no longer qualifies; it only decides between
// asking for a start point and answering an article question once a place
// has been named.
const PAIR_RE = /(?:从)?(.+?)(?:到|去|至|前往|走向|走到|→|->)(.+)/;
const places = searchCampusPlaces("");

export function pendingNavigationMessages(
  messages: readonly {
    role: string;
    text: string;
    cards: readonly { kind: string }[];
  }[],
) {
  // A verified route card completes the earlier navigation request. A later
  // “我的位置” must not silently repeat a route already completed or cleared.
  const completed = messages.findLastIndex(
    (m) => m.role === "assistant" && m.cards.some((c) => c.kind === "route"),
  );
  return messages
    .slice(completed + 1)
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .slice(-3);
}

/**
 * The user turns a correction may refer back to.
 *
 * A finished route does not close the task: 「…→南苑8栋」then「改成南苑7栋」
 * rewrites the trip that was just drawn, so its earlier turns must stay
 * readable even though the route card already completed them.
 */
export function navigationHistory(
  messages: readonly { role: string; text: string }[],
) {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .slice(-8);
}

// Match only names/aliases of real canonical places. Prefer longest mentions,
// so 北苑7栋 does not match 7栋, and 南苑1 does not match 南苑13.
export function matchAt(text: string, pool: readonly CampusPlace[]) {
  const matches = pool
    .flatMap((place) => {
      const names = [place.name, ...(place.aliases || [])];
      if (place.category === "dormitory")
        names.push(place.name.replace(/栋$/, ""));
      return [...new Set(names.map(normalize))].flatMap((name) => {
        const at = text.indexOf(name);
        if (
          at < 0 ||
          (/\d$/.test(name) && /^\d/.test(text.slice(at + name.length)))
        )
          return [];
        if (/^\d+栋$/.test(name) && /[\d苑]$/.test(text.slice(0, at)))
          return [];
        return [{ place, at, end: at + name.length, length: name.length }];
      });
    })
    .sort((a, b) => b.length - a.length);
  const accepted: typeof matches = [];
  for (const match of matches) {
    if (
      accepted.some(
        (other) =>
          match.at < other.end &&
          match.end > other.at &&
          !(
            match.at === other.at &&
            match.end === other.end &&
            match.place.id !== other.place.id
          ),
      )
    )
      continue;
    accepted.push(match);
  }
  return accepted.sort((a, b) => a.at - b.at);
}

function mentions(text: string, pool: readonly CampusPlace[]) {
  return [
    ...new Map(
      matchAt(text, pool).map((m) => [m.place.id, m.place]),
    ).values(),
  ];
}

const FROM_MARKERS = ["从", "由"];
const TO_MARKERS = ["到", "去", "至", "前往", "走向", "走到"];
const CLAUSE_BREAK = /[，,。；;！!？?\n]/;
// 「第一食堂怎么走」 asks for the path to the place it names first, so the
// manner word counts as the end of the trip even though it trails the name.
const MANNER_AFTER = /怎么走|怎么去|怎么过去|怎么走到|如何走|如何到达|带我去|导航/;
// 「去行政办公楼需要准备哪些信息」 names a place after 去 but asks for
// paperwork, not for a walk there. Treating it as a trip sent an office
// procedure question to the map tool.
const KNOWLEDGE_QUESTION =
  /需要准备|需要什么|准备什么|哪些材料|注意事项|什么流程|怎么办理|如何办理|需要哪些|有什么规定|规定是什么|could be/;
// 「不要调用我的 GPS」「不要查询北校区」 forbid a tool, not the walk. A
// negation only cancels the trip when it sits next to the walk itself, so a
// long paragraph that happens to contain 不要 still plans its route.
const NEGATED_ROUTE =
  /(?:不要|不用|不必|别|取消|不去).{0,4}(?:导航|路线|规划|带我去|走过去|前往)/;
// 「起点改成南苑7栋」「其实我住在南苑7栋」 supersedes the earlier start. Two
// starts in one sentence leave the planner without a valid pair, so it asks
// for a start the user has just given.
const REPLACE_BEFORE =
  /(?:改成|换成|改为|起点|出发地|其实|实际上|应该说)[^，。；]{0,6}$/;

// The preposition nearest in front of a place decides its role. Splitting the
// sentence at its first 到/去 instead put the endpoint at the first building
// after 「带我去」, so 「带我去图书馆，南校，南苑8栋」 made the dormitory the
// destination and every later turn asked for a start point already given.
function roles(question: string, pool: readonly CampusPlace[]) {
  const origins: CampusPlace[] = [];
  const destinations: CampusPlace[] = [];
  // A sentence that enumerates a dozen topics ("食堂、宿舍、图书馆、体育场馆…")
  // names places as subjects, not as stops. Reading them as stops turned the
  // whole notice-list request into a walk to whatever building came first.
  // An explicit 「从…到…」 still plans a route inside a long enumeration.
  const enumerating =
    (question.match(/、/g)?.length ?? 0) >= 3 &&
    !/从[^，。；]{1,12}(?:到|去|至|前往)/.test(question);
  if (enumerating) return { origins, destinations };
  for (const match of matchAt(question, pool)) {
    const before = question.slice(0, match.at);
    const after = question.slice(match.end);
    // 「查询图书馆今天的开放时间」 names the library as the subject of a
    // lookup, not as a stop. Counting it as a start point left two starts in
    // one sentence and the assistant asked for a start point already given.
    const lookup = /(?:查询|查一下|查|了解|确认|查看|看看|问一下)[^，。；]{0,8}$/.test(
      before,
    );
    if (lookup) continue;
    // 「起点改成南苑7栋」 replaces the earlier start instead of adding a
    // second one. Keeping both starts left the planner with no valid pair and
    // it asked for a start point the sentence had just supplied.
    if (REPLACE_BEFORE.test(question.slice(Math.max(0, match.at - 12), match.at))) {
      origins.length = 0;
    }
    const nearest = (markers: readonly string[]) =>
      markers.reduce(
        (best, marker) => Math.max(best, before.lastIndexOf(marker)),
        -1,
      );
    const fromAt = nearest(FROM_MARKERS);
    const toAt = nearest(TO_MARKERS);
    const marker = Math.max(fromAt, toAt);
    // A comma between the marker and the name breaks the relation.
    const broken =
      marker >= 0 && CLAUSE_BREAK.test(before.slice(marker + 1));
    if (!broken && toAt > fromAt) destinations.push(match.place);
    else if (!broken && marker < 0 && MANNER_AFTER.test(after))
      destinations.push(match.place);
    // 「目的地还是图书馆」 repeats the same place; it is not a second start.
    else if (!destinations.some((place) => place.id === match.place.id))
      origins.push(match.place);
  }
  return { origins: unique(origins), destinations: unique(destinations) };
}

function unique(places: CampusPlace[]) {
  return [...new Map(places.map((place) => [place.id, place])).values()];
}

const CORRECTION_WORD =
  /改成|换成|改为|换成起点|起点改|\u4e0d\u5bf9|\u4e0d\u662f\u4e86?|\u9519\u4e86|\u91cd\u65b0\u89c4\u5212/g;
// 「继续刚才的导航」「重新规划一下」 refer back to the task without naming it.
const REASK =
  /继续(?:刚才)?(?:的)?(?:导航|路线)|重新规划|接着(?:刚才)?(?:的)?(?:导航|路线)|按刚才|还是去/;

/**
 * The destination and start point of a task still open from earlier turns.
 *
 * Only user turns the user really wrote are read, so model prose can never
 * invent a destination. A later correction replaces the start point; the
 * destination is kept unless the user clearly names a new one.
 */
function carriedTask(
  previousUserMessages: readonly string[],
  pool: readonly CampusPlace[],
) {
  let destination: CampusPlace | undefined;
  let origin: CampusPlace | undefined;
  let lastPlace: CampusPlace | undefined;
  for (const message of previousUserMessages) {
    const text = normalize(message);
    const own = roles(text, pool);
    if (own.destinations.length === 1) destination = own.destinations[0];
    if (own.origins.length === 1 && own.origins[0] !== destination)
      origin = own.origins[0];
    const named = mentions(text, pool);
    if (named.length) lastPlace = named[named.length - 1];
  }
  return { destination, origin, lastPlace };
}

/**
 * True when the whole turn is nothing but place names and a campus word.
 *
 * Such a turn is an answer to a question the assistant already asked
 * (“从哪里出发?”), so it must not be searched as an article topic.
 */
function placeOnly(text: string, pool: readonly CampusPlace[]) {
  const found = matchAt(text, pool);
  if (!found.length) return false;
  let rest = text;
  for (const match of found)
    rest = rest.replace(text.slice(match.at, match.end), " ");
  rest = rest.replace(CORRECTION_WORD, "").replace(
    /大学城校区|白云山校区|大学城校区?|白云山|校区|本部|[南北]校区?/g,
    "",
  );
  return /^[\s，。,.、；;·\-—~～]*$/.test(rest);
}

export function navigationIntent(
  message: string,
  selected?: string | null,
  hasLocation = false,
  previousUserMessages: readonly string[] = [],
  pool: readonly CampusPlace[] = places,
) {
  let question = normalize(message);
  let resolvedMessage = message;
  const currentPlaces = mentions(question, pool);
  const manualOrigin =
    currentPlaces.length === 1 &&
    [
      currentPlaces[0].name,
      ...(currentPlaces[0].aliases || []),
      currentPlaces[0].name.replace(/栋$/, ""),
    ].some((name) => normalize(name) === question);
  // Pending destinations come only from recent user requests, never model prose.
  if (
    (requestsDeviceLocation(message) || manualOrigin) &&
    !/(?:到|去|至|前往|走向|走到|→|->).+/.test(question)
  ) {
    for (const previous of previousUserMessages.slice(-3).reverse()) {
      if (
        requestsDeviceLocation(previous) &&
        !/(?:到|去|至|前往|走向|走到|→|->).+/.test(normalize(previous))
      )
        continue;
      const pending = navigationIntent(previous, selected, false, [], pool);
      if (
        pending.routeQuestion &&
        pending.destinations.length === 1 &&
        (requestsDeviceLocation(message) || pending.needsLocation)
      ) {
        resolvedMessage = `从${requestsDeviceLocation(message) ? "我的位置" : currentPlaces[0].name}到${pending.destinations[0].name}`;
        question = normalize(resolvedMessage);
      }
      break;
    }
  }
  let namedPlaces = mentions(question, pool);
  // A turn that only names places answers a question the assistant already
  // asked. It must fill the missing slot of the earlier task instead of
  // becoming a new topic — 「带我去图书馆」→「南校，南苑8栋」 used to be read as
  // a question about the dormitory and answered from old articles.
  const slotFill = placeOnly(question, pool) && previousUserMessages.length > 0;
  const carried = carriedTask(previousUserMessages, pool);
  const correcting = CORRECTION_WORD.test(question);
  const reasking = REASK.test(question);
  const own = roles(question, pool);
  // A turn that only swaps the start point belongs to the open task too:
  // 「我要去图书馆」→「北校」→「从一教出发」 never names the destination again.
  // It must also talk about moving; 「我想先了解图书馆的借阅规则」 names the
  // library but asks for a rule, not for a new start.
  const originSwitch =
    own.destinations.length === 0 &&
    own.origins.length === 1 &&
    /(?:从|去|到|至|前往|走向|走到|出发|起点)/.test(question);
  let carriedOver = false;
  if (
    (slotFill || correcting || reasking || originSwitch) &&
    !requestsDeviceLocation(question)
  ) {
    const start = own.origins[0] ?? own.destinations[0];
    if (carried.destination) {
      const origin = start ?? carried.origin;
      if (origin) {
        resolvedMessage = `从${origin.name}到${carried.destination.name}`;
        question = normalize(resolvedMessage);
        carriedOver = true;
      }
    }
  }
  // A turn that names only the destination still belongs to the open task when
  // the start point was already given earlier: 「我现在在南苑8栋」→「图书馆怎么走」
  // must not ask where to start again.
  if (
    !carriedOver &&
    own.destinations.length === 1 &&
    own.origins.length === 0 &&
    carried.origin &&
    !requestsDeviceLocation(question)
  ) {
    resolvedMessage = `从${carried.origin.name}到${own.destinations[0].name}`;
    question = normalize(resolvedMessage);
    carriedOver = true;
  }
  // 「我从南苑8栋怎么去那里」 points at the place the last turn named, so the
  // route need not be asked for again.
  const deicticDest = /(?:去|到|至|前往|走向|走到)\s*(?:那里|那儿|那边|此处)/;
  if (
    !carriedOver &&
    deicticDest.test(question) &&
    own.origins.length === 1 &&
    carried.lastPlace &&
    !requestsDeviceLocation(question)
  ) {
    resolvedMessage = `从${own.origins[0].name}到${carried.lastPlace.name}`;
    question = normalize(resolvedMessage);
    carriedOver = true;
  }
  // The carried task names both ends, so the rewritten question is what the
  // downstream role reader must see.
  if (carriedOver) namedPlaces = mentions(question, pool);
  const routeText = question
    .replace(MOVEMENT_COMPOUND, " ")
    .replace(/找到|查到|定位到/g, "找");
  // 「找到」 is a lookup verb, not a trip relation; blank its 「到」 so the role
  // reader does not treat it as a destination marker.
  const roleText = question.replace(
    /找到|查到|定位到/g,
    (match) => match.slice(0, -1) + "\u3000",
  );
  const here = roles(roleText, pool);
  // A route needs a real place standing on one side of the relation. A long
  // paragraph that merely contains 「去」 (「哪些需要去学校官网确认」) is not a
  // trip, and treating it as one dropped every other task in the paragraph.
  // 「去行政办公楼需要准备哪些信息」 is a paperwork question, not a walk. A
  // long paragraph that asks for a route first and paperwork later is still
  // both, so the paperwork words only veto a single-topic sentence.
  const paperwork =
    KNOWLEDGE_QUESTION.test(question) &&
    !/从[^，。；]{1,12}(?:到|去|至|前往)/.test(question);
  const routeQuestion =
    !NEGATED_ROUTE.test(question) &&
    !paperwork &&
    (here.origins.length > 0 || here.destinations.length > 0) &&
    (ROUTE_RE.test(routeText) ||
      slotFill ||
      reasking ||
      correcting ||
      carriedOver) &&
    namedPlaces.length > 0;
  const pair = PAIR_RE.exec(question.replace(/找到|查到|定位到/g, "找"));
  const startText = pair?.[1];
  const explicitFrom = /从.+(?:去|到|至|前往|走向|走到)/.test(question);
  const deictic = !!startText && /这里|这儿|此处/.test(startText);
  const startPlaces = startText ? mentions(startText, pool) : [];
  const explicitOrigin =
    explicitFrom ||
    deictic ||
    startPlaces.length > 0 ||
    here.origins.length > 0 ||
    (!!startText &&
      !/^(?:请|帮我|带我|我想|我要|想要|想|我|导航|怎么|麻烦|请问|帮忙)+$/.test(
        startText,
      ));
  const needsLocation =
    requestsDeviceLocation(message) ||
    (routeQuestion && !explicitOrigin && namedPlaces.length === 1);
  const originIds =
    here.origins.length > 0
      ? here.origins.map((place) => place.id)
      : needsLocation
        ? hasLocation
          ? ["device_location"]
          : []
        : startPlaces.length
          ? startPlaces.map((p) => p.id)
          : deictic && selected
            ? [selected]
            : [];
  const destinations = here.destinations.length
    ? here.destinations
    : namedPlaces.filter((place) => !originIds.includes(place.id));
  const originMissing =
    (needsLocation && !hasLocation) ||
    (routeQuestion && deictic && !selected) ||
    (routeQuestion && explicitOrigin && originIds.length === 0);
  return {
    needsLocation,
    namedPlaces,
    routeQuestion,
    originIds,
    destinations,
    originMissing,
    resolvedMessage,
  };
}
