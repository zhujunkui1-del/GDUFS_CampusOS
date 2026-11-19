import { resolveCampus } from "./campus-resolution";
import {
  navigationHistory,
  navigationIntent,
  pendingNavigationMessages,
} from "@/domain/agent/navigation-intent";
import type {
  AssistantCard,
  StoredMessage,
} from "@/domain/agent/assistant-contracts";
import { CampusMapService } from "../maps/campus-map-service";
import type { SkillContext } from "@/domain/skills/contracts";

type Campus = "university" | "baiyun";
const campuses = ["university", "baiyun"] as const;
const campusName = (campus: Campus) =>
  campus === "baiyun" ? "白云山校区" : "大学城校区";
const direction = /带我去|导航|路线|怎么走|怎么去|如何去|要走多久|从.+到/;
const placeOnly =
  /^(?:(?:大学城|白云山|南校|北校)(?:校区)?)?[\p{Script=Han}\d]+[栋楼馆园厅]$/u;
export function structuredCampusMap(
  question: string,
  history: StoredMessage[],
  scope: Campus | undefined,
  selected: string | undefined,
  context: SkillContext,
) {
  const services = campuses.map((campus) => ({
    campus,
    service: new CampusMapService(undefined, undefined, campus),
    context: {
      ...context,
      campusId:
        campus === "baiyun"
          ? ("gdufs_baiyun" as const)
          : ("gdufs_university_town" as const),
    },
  }));
  const pendingMessages = pendingNavigationMessages(history);
  // A correction rewrites the trip that was just drawn, so it must still see
  // the turns before that route card; only the start-point question is limited
  // to the open task.
  const lookback = navigationHistory(history);
  const pending = [...pendingMessages]
    .reverse()
    .find(
      (q) =>
        direction.test(q) ||
        navigationIntent(q, undefined, false, [], services[0].service.places)
          .routeQuestion,
    );
  const slot =
    !!pending &&
    (placeOnly.test(question.trim()) ||
      /^(?:大学城|白云山|南校|北校)(?:校区)?[。！]?$/.test(question));
  const declared = question.match(
    /^(?:我在|起点是)(.+?)[，,。]\s*(?:请|帮我)?(?:带我去|导航到)(.+)$/,
  );
  const basePhrase = declared ? `从${declared[1]}到${declared[2]}` : question;
  // Earlier user turns are part of the request: 「带我去图书馆」→「南校，南苑8栋」
  // is one trip whose start point arrived a turn later. Reading them here is
  // what stops that reply from being answered as a dormitory question.
  const read = (phrase: string) =>
    services.map((service) => ({
      campus: service.campus,
      service: service.service,
      context: service.context,
      intent: navigationIntent(
        phrase,
        selected,
        false,
        lookback,
        service.service.places,
      ),
    }));
  let parsed = read(basePhrase);
  const carried = parsed.find((entry) =>
    entry.intent.resolvedMessage.startsWith("从"),
  )?.intent.resolvedMessage;
  const phrase = carried && carried !== basePhrase ? carried : basePhrase;
  if (phrase !== basePhrase) parsed = read(phrase);
  // A turn that only fills the missing start of an open trip is a route
  // request even though it never says 导航 by itself. The keyword list is
  // narrower than the intent reader, so 「我要去图书馆」 reached the model
  // branch and was refused with a start-point error instead of the question.
  const routeIntent = parsed.some(
    (entry) =>
      entry.intent.routeQuestion &&
      (entry.intent.needsLocation ||
        entry.intent.originMissing ||
        entry.intent.originIds.length === 1),
  );
  // Follow-ups to a route that was already drawn: asking how long it takes, or
  // whether a second phrasing is a different path, must reuse that route
  // instead of searching articles for the words 「多久」「区别」.
  const lastRoute = [...history]
    .reverse()
    .flatMap((turn) => turn.cards)
    .find((card) => card.kind === "route");
  if (lastRoute && lastRoute.kind === "route") {
    const summary = `从${lastRoute.startName}到${lastRoute.endName}，步行约${Math.round(lastRoute.distanceMeters)}米、约${lastRoute.estimatedMinutes}分钟。`;
    if (
      /^(?:那|那么|大概|大约|大约需要|大概需要)?(?:还)?(?:需要|要)?(?:走|步行)?(?:多久|多长时间|多远|多少米|几分钟)/.test(
        question.trim(),
      )
    )
      return { text: summary, cards: [] };
    if (
      /(?:和|与|跟).{0,6}(?:刚才|之前|上一条).{0,12}(?:路线|路).{0,8}(?:区别|不同|差异|一样)/.test(
        question,
      )
    )
      return {
        text:
          summary +
          "起点和终点都是同一对地点，所以是同一条路线，没有第二条可选路径。",
        cards: [],
      };
  }
  if (direction.test(phrase) || slot || routeIntent) {
    if (/文章|通知|校车|公交|不要.*导航/.test(phrase)) return;
    // 「我在大学城…朋友在白云山…分别规划两条路线」 is two trips inside one
    // corridor, not one cross-campus trip. Answering it with the cross-campus
    // refusal would drop both routes.
    const bothCampuses = /大学城|南校/.test(phrase) && /白云山|北校/.test(phrase);
    if (bothCampuses && /分别|两条|各自|各自校区/.test(phrase)) {
      const pairs = parsed
        .map((entry) => ({
          campus: entry.campus,
          intent: entry.intent,
        }))
        .filter(
          (entry) =>
            entry.intent.originIds.length === 1 &&
            entry.intent.destinations.length === 1,
        );
      if (pairs.length === 2)
        return {
          text: "",
          cards: [],
          routes: pairs.map((p) => ({
            campus: p.campus,
            start: p.intent.originIds[0],
            end: p.intent.destinations[0].id,
          })),
        };
    }
    const pair = phrase.match(/^从(.+?)到(.+)$/);
    if (pair) {
      const hits = (side: string) => {
        const explicit = resolveCampus(side).campus;
        return parsed.filter(
          (s) =>
            (!explicit || s.campus === explicit) &&
            navigationIntent(side, undefined, false, [], s.service.places)
              .namedPlaces.length,
        );
      };
      const left = hits(pair[1]),
        right = hits(pair[2]);
      if (
        left.length === 1 &&
        right.length === 1 &&
        left[0].campus !== right[0].campus
      )
        return {
          text: "两处地点分属不同校区，目前没有跨校区校内步行路线。",
          cards: [],
        };
    }
    const match = parsed.filter(
      (s) =>
        (!scope || s.campus === scope) &&
        s.intent.routeQuestion &&
        s.intent.originIds.length === 1 &&
        s.intent.destinations.length === 1,
    );
    if (match.length === 1 && !/我的位置|当前位置/.test(phrase)) {
      const { campus, intent } = match[0];
      if (/不要穿|别穿|避开建筑/.test(phrase))
        return {
          text: "校园步道路网包含已确认可穿行的教学区域，当前无法核实整条路线都避开建筑。请改用普通步行路线，或在地图选择明确的室外接入点。",
          cards: [],
        };
      return {
        text: "",
        cards: [],
        route: {
          campus,
          start: intent.originIds[0],
          end: intent.destinations[0].id,
        },
      };
    }
    const candidates = parsed.filter(
      (s) => (!scope || s.campus === scope) && s.intent.routeQuestion,
    );
    // A start point with no destination is a real answer, not a missing one:
    // 「我现在在南苑8栋」already told us where to start, so asking for the
    // start again loses the only fact the user gave.
    const originOnly = candidates.find(
      (s) =>
        s.intent.originIds.length === 1 &&
        s.intent.destinations.length === 0 &&
        !s.intent.needsLocation,
    );
    if (originOnly && !candidates.some((s) => s.intent.destinations.length))
      return {
        text: `好的，从${originOnly.intent.namedPlaces[0]?.name ?? "你给的位置"}出发，你要去哪里？`,
        cards: [],
      };
    if ((candidates.length || slot) && !/我的位置|当前位置/.test(phrase))
      return {
        text:
          candidates.length > 1 && !scope
            ? "你要去哪个校区，从哪里出发？"
            : "请告诉我从哪里出发。",
        cards: [],
      };
    return;
  }
  if (
    scope &&
    /(?:换到|换去|改到|到|在|是)(?:白云山|大学城|北校|南校)(?:校区)?(?:了|啦)?[。！]?$/.test(
      question.trim(),
    )
  ) {
    // A campus named while a trip is still open is the answer to the missing
    // campus, not a request to switch the conversation: 「我要去图书馆」→「北校」
    // used to be answered from articles.
    if (pending) return { text: "请告诉我从哪里出发。", cards: [] };
    return { text: "已按" + campusName(scope) + "继续查询。", cards: [] };
  }
  const floorSubject = question
    .trim()
    .match(/^(.{2,30}?)(?:是|有|共)?(?:几层|多少层)[？?。]?$/)?.[1];
  if (floorSubject) {
    const candidates = services
      .filter((s) => !scope || s.campus === scope)
      .flatMap((s) =>
        navigationIntent(
          floorSubject,
          undefined,
          false,
          [],
          s.service.places,
        ).namedPlaces.map((place) => ({ ...s, place })),
      );
    if (candidates.length === 1) {
      const { service, context: skillContext, place, campus } = candidates[0];
      const details = service.details({ placeId: place.id }, skillContext);
      const text =
        details.building.levels === null
          ? campusName(campus) + place.name + "的地图资料未注明楼层数。"
          : "CampusOS 建筑模型资料将" +
            campusName(campus) +
            place.name +
            "标为 " +
            details.building.levels +
            " 层。";
      return {
        text,
        cards: [{ kind: "place" as const, place: details.place }],
      };
    }
  }
  const library =
    /图书馆/.test(question) &&
    /在哪|哪里|位置/.test(question) &&
    !/时间|公告|通知|文章|开门|开放/.test(question);
  const sports =
    /体育馆/.test(question) &&
    /在哪|哪里|位置/.test(question) &&
    !/时间|通知|开放/.test(question);
  const food =
    /食堂|饭堂/.test(question) &&
    /哪些|有什么|在哪/.test(question) &&
    !/最近|图书馆|楼/.test(question);
  const here =
    selected &&
    /^(?:这里|这儿|这里是)(?:什么地方|哪|哪里|哪儿)[？?]?$/.test(question);
  const nearbySubject = question.match(
    /^(.{1,35}?)附近.*(?:吃|食堂|饭堂)/,
  )?.[1];
  const priorRoute =
    nearbySubject === "那"
      ? [...history]
          .reverse()
          .flatMap((turn) => turn.cards)
          .find((card) => card.kind === "route")
      : undefined;
  const origins = nearbySubject
    ? services.flatMap((s) => {
        if (scope && s.campus !== scope) return [];
        if (
          priorRoute &&
          !s.service.places.some((p) => p.name === priorRoute.startName)
        )
          return [];
        const place =
          s.service.places.find((p) =>
            nearbySubject === "这里"
              ? p.id === selected
              : p.name === (priorRoute?.endName ?? ""),
          ) ??
          navigationIntent(
            nearbySubject,
            undefined,
            false,
            [],
            s.service.places,
          ).namedPlaces[0];
        return place
          ? [{ campus: s.campus, id: place.id, name: place.name }]
          : [];
      })
    : [];
  const nearby = origins.length === 1;
  const nearbyOrigin = nearby ? origins[0] : undefined;
  if (!library && !sports && !food && !here && !nearby) return;
  const cards: AssistantCard[] = [];
  const lines = [];
  for (const s of services.filter(
    (s) =>
      (!scope || scope === s.campus) &&
      (!nearbyOrigin || s.campus === nearbyOrigin.campus),
  )) {
    try {
      const entries = here
        ? [s.service.details({ placeId: selected }, s.context).place]
        : nearby
          ? s.service.nearby(
              {
                origin: { type: "place", placeId: nearbyOrigin!.id },
                category: "canteen",
                radiusMeters: 1500,
              },
              s.context,
            ).matches
          : s.service.search(
              {
                query: library ? "图书馆" : sports ? "体育馆" : "食堂",
                limit: 10,
              },
              s.context,
            ).matches;
      lines.push(
        campusName(s.campus) +
          (nearbyOrigin
            ? "（以" + nearbyOrigin.name + "为起点，按直线距离）"
            : "") +
          "：" +
          (entries
            .map((p) =>
              "distanceMeters" in p && typeof p.distanceMeters === "number"
                ? p.name + "约" + Math.round(p.distanceMeters) + "米"
                : p.name,
            )
            .join("、") || "校园地图暂无匹配地点。"),
      );
      for (const p of entries) {
        const { distanceMeters, ...place } = p as typeof p & {
          distanceMeters?: number;
        };
        cards.push({
          kind: "place",
          place,
          ...(distanceMeters === undefined ? {} : { distanceMeters }),
        });
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "NOT_FOUND") throw error;
      lines.push(campusName(s.campus) + "：校园地图暂无匹配地点。");
    }
  }
  return { text: lines.join("\n"), cards };
}
