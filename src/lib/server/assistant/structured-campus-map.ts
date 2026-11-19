import { resolveCampus } from "./campus-resolution";
import {
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
  const pending = [...pendingNavigationMessages(history)]
    .reverse()
    .find((q) => direction.test(q));
  const slot =
    !!pending &&
    (placeOnly.test(question.trim()) ||
      /^(?:大学城|白云山|南校|北校)(?:校区)?[。！]?$/.test(question));
  const declared = question.match(
    /^(?:我在|起点是)(.+?)[，,。]\s*(?:请|帮我)?(?:带我去|导航到)(.+)$/,
  );
  let phrase = declared ? `从${declared[1]}到${declared[2]}` : question;
  if (slot && placeOnly.test(question.trim())) {
    const end = pending?.match(/(?:带我去|导航到|导航去)([^？?。！]+)/)?.[1];
    if (end) phrase = `从${question.trim()}到${end}`;
  }
  if (direction.test(phrase) || slot) {
    if (/文章|通知|校车|公交|不要.*导航/.test(phrase)) return;
    const parsed = services.map((s) => ({
      ...s,
      intent: navigationIntent(phrase, selected, false, [], s.service.places),
    }));
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
    /^(?:(?:我在|我刚才说错了[，,]?是|是)?(?:白云山|大学城)(?:校区)?)[。！]?$/.test(
      question.trim(),
    )
  )
    return { text: "已按" + campusName(scope) + "继续查询。", cards: [] };
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
