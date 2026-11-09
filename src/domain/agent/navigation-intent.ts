import { searchCampusPlaces } from "@/features/campus-map/data/campus";
import { normalizePlaceText } from "@/features/campus-map/data/campus-text";
import { requestsDeviceLocation } from "./location-intent";

const normalize = normalizePlaceText;
// 「前往」「走向」「走到」describe the same relation as 「去」「到」「至」.
// Leaving them out sent 「从南苑七栋前往假草场」 to article search instead of
// the map tool, so the same sentence meant different things depending on the
// verb the user happened to pick.
const ROUTE_RE =
  /从.+(?:去|到|至|前往|走向|走到)|(?:去|到|导航|前往|走向|走到|→|->).+|怎么走|怎么去|怎么过去|怎么走到|规划.*路线/;
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

// Match only names/aliases of real canonical places. Prefer longest mentions,
// so 北苑7栋 does not match 7栋, and 南苑1 does not match 南苑13.
function mentions(text: string) {
  const matches = places
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
  return [
    ...new Map(
      accepted.sort((a, b) => a.at - b.at).map((m) => [m.place.id, m.place]),
    ).values(),
  ];
}

export function navigationIntent(
  message: string,
  selected?: string | null,
  hasLocation = false,
  previousUserMessages: readonly string[] = [],
) {
  let question = normalize(message);
  let resolvedMessage = message;
  const currentPlaces = mentions(question);
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
      const pending = navigationIntent(previous, selected, false);
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
  const namedPlaces = mentions(question);
  const routeQuestion =
    !/不要|不用|不必|别去|不去|取消/.test(question) &&
    ROUTE_RE.test(question.replace(/找到|查到|定位到/g, "找")) &&
    namedPlaces.length > 0;
  const pair = PAIR_RE.exec(question.replace(/找到|查到|定位到/g, "找"));
  const startText = pair?.[1];
  const explicitFrom = /从.+(?:去|到|至|前往|走向|走到)/.test(question);
  const deictic = !!startText && /这里|这儿|此处/.test(startText);
  const startPlaces = startText ? mentions(startText) : [];
  const explicitOrigin =
    explicitFrom ||
    deictic ||
    startPlaces.length > 0 ||
    (!!startText &&
      !/^(?:请|帮我|带我|我想|我要|想要|想|我|导航|怎么|麻烦|请问|帮忙)+$/.test(
        startText,
      ));
  const needsLocation =
    requestsDeviceLocation(message) ||
    (routeQuestion && !explicitOrigin && namedPlaces.length === 1);
  const originIds = needsLocation
    ? hasLocation
      ? ["device_location"]
      : []
    : startPlaces.length
      ? startPlaces.map((p) => p.id)
      : deictic && selected
        ? [selected]
        : [];
  const destinations = namedPlaces.filter(
    (place) => !originIds.includes(place.id),
  );
  const originMissing =
    (needsLocation && !hasLocation) || (routeQuestion && deictic && !selected);
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
