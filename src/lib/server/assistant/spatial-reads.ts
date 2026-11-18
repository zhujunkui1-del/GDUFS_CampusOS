import type {
  AssistantCard,
  StoredMessage,
} from "@/domain/agent/assistant-contracts";
import type { SkillContext } from "@/domain/skills/contracts";
import { CampusMapService } from "@/lib/server/maps/campus-map-service";

export type SpatialReadKind =
  "sports_list" | "canteen_list" | "nearest_canteen" | "nearby_canteens";
export type SpatialReadResult = {
  kind: SpatialReadKind;
  text: string;
  cards: AssistantCard[];
  trace: Record<string, unknown>;
};

export function spatialReadKind(
  question: string,
  history: StoredMessage[],
): SpatialReadKind | undefined {
  if (
    /南校区|大学城校区|南校|大学城|白云山|北校区/.test(question) &&
    /(?:有哪些|有什么)/.test(question) &&
    /体育场地|体育场馆|运动场地|体育设施/.test(question)
  )
    return "sports_list";
  if (
    /南校区|大学城校区|南校|大学城|白云山|北校区/.test(question) &&
    /(?:有哪些|有什么)/.test(question) &&
    !/附近/.test(question) &&
    /食堂|饭堂|餐厅/.test(question)
  )
    return "canteen_list";
  if (/图书馆.*附近.*(?:食堂|饭堂|餐厅)/.test(question))
    return "nearby_canteens";
  if (
    /(?:图书馆.*最近.*(?:食堂|饭堂)|(?:食堂|饭堂).*离图书馆.*最近|(?:离|距离).{0,12}图书馆.{0,8}最近.{0,8}(?:食堂|饭堂))/.test(
      question,
    )
  )
    return "nearest_canteen";
  if (
    /其中/.test(question) &&
    /(?:离|距离).*图书馆.*最近/.test(question) &&
    history.some(
      (message) =>
        message.role === "assistant" &&
        message.cards.some(
          (card) => card.kind === "place" && card.place.category === "canteen",
        ),
    )
  )
    return "nearest_canteen";
}

const zoneLabel = (zone: "teaching" | "living" | "connection") =>
  ({ teaching: "教学区", living: "生活区", connection: "连接道路" })[zone];

export function readSpatialQuery(
  service: CampusMapService,
  question: string,
  history: StoredMessage[],
  context: SkillContext,
): SpatialReadResult | undefined {
  const kind = spatialReadKind(question, history);
  if (!kind) return;
  if (kind === "nearest_canteen" || kind === "nearby_canteens") {
    const library = service.search({ query: "图书馆", limit: 2 }, context);
    if (library.ambiguous || library.matches.length !== 1) return;
    const nearby = service.nearby(
      {
        origin: { type: "place", placeId: library.matches[0].placeId },
        category: "canteen",
        radiusMeters: 2000,
        limit: 20,
      },
      context,
    );
    const last = [...history]
      .reverse()
      .find((message) => message.role === "assistant");
    const previousIds = new Set(
      last?.cards.flatMap((card) =>
        card.kind === "place" && card.place.category === "canteen"
          ? [card.place.placeId]
          : [],
      ) ?? [],
    );
    const candidates = nearby.matches.filter(
      (place) =>
        !question.includes("其中") ||
        !previousIds.size ||
        previousIds.has(place.placeId),
    );
    if (kind === "nearby_canteens" && candidates.length)
      return {
        kind,
        text:
          library.matches[0].name +
          "附近地图收录的食堂包括：" +
          candidates
            .map(
              (place) =>
                place.name +
                "（直线约" +
                Math.round(place.distanceMeters) +
                "米）",
            )
            .join("、") +
          "。",
        cards: candidates.map((place) => ({
          kind: "place",
          place,
          distanceMeters: place.distanceMeters,
        })),
        trace: {
          campus: service.campus,
          origin: library.matches[0].name,
          distanceType: nearby.distanceType,
          matches: candidates.map((place) => place.placeId),
        },
      };
    const winner = candidates[0];
    if (!winner)
      return {
        kind,
        text: "校园地图里没有找到可以比较的食堂地点。",
        cards: [],
        trace: {
          origin: library.matches[0].name,
          matches: [],
          distanceType: nearby.distanceType,
        },
      };
    const card: AssistantCard = {
      kind: "place",
      place: winner,
      distanceMeters: winner.distanceMeters,
    };
    return {
      kind,
      text:
        "从图书馆测得的直线距离最近的是" +
        winner.name +
        "，约" +
        Math.round(winner.distanceMeters) +
        "米，位于" +
        zoneLabel(winner.zone) +
        "。这是地图坐标间的直线距离，不代表步行距离。",
      cards: [card],
      trace: {
        origin: library.matches[0].name,
        matches: nearby.matches.map((place) => ({
          id: place.placeId,
          name: place.name,
          distanceMeters: place.distanceMeters,
        })),
        distanceType: nearby.distanceType,
        scopedByPreviousCards: previousIds.size > 0,
      },
    };
  }
  const result =
    kind === "sports_list"
      ? service.search({ query: "体育场地", limit: 20 }, context)
      : service.search({ query: "食堂", limit: 20 }, context);
  const matches = result.matches;
  if (!matches.length)
    return {
      kind,
      text: "校园地图资料中没有找到对应地点。",
      cards: [],
      trace: { matches: [] },
    };
  const cards: AssistantCard[] = matches.map((place) => ({
    kind: "place",
    place,
  }));
  const label = kind === "sports_list" ? "体育场地" : "食堂";
  return {
    kind,
    text:
      (service.campus === "baiyun" ? "白云山校区" : "南校区") +
      "地图中已收录的" +
      label +
      "有" +
      matches.length +
      "处\n\n" +
      matches
        .map((place) => "- " + place.name + "，位于" + zoneLabel(place.zone))
        .join("\n") +
      "\n\n地点卡片可打开对应地图位置。",
    cards,
    trace: {
      matches: matches.map((place) => ({
        id: place.placeId,
        name: place.name,
        category: place.category,
        zone: place.zone,
      })),
    },
  };
}
