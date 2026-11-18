import { readBuilding, readBuildingCatalog } from "../building-media";
import { readCalendar } from "../calendar/query";
import { buildingPlaces } from "@/features/campus-map/data/building-groups";
import {
  buildingProfileMembers,
  buildingProfileId,
} from "@/features/campus-map/data/building-groups";
import type { SqlDatabase } from "./database";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { normalizeCitations } from "./citations";
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[\s（）()]/g, "")
    .toLowerCase();
export function mentionedBuildingIds(
  query: string,
  selected?: string,
  campus?: "university" | "baiyun",
) {
  const text = normalize(query);
  const ids = [
    ...new Set(
      buildingPlaces
        .filter((place) => !campus || place.campus === campus)
        .filter((place) =>
          [place.name, ...("aliases" in place ? place.aliases || [] : [])].some(
            (name) =>
              normalize(name).length >= 2 && text.includes(normalize(name)),
          ),
        )
        .map((place) => buildingProfileId(place.id)),
    ),
  ];
  if (!ids.length && selected && /这里|这栋|这个建筑|选中/.test(query))
    ids.push(buildingProfileId(selected));
  return ids.slice(0, 4);
}
export async function buildingAssistantProfile(
  db: SqlDatabase,
  id: string,
  activityTrace?: (id: string) => (data: unknown) => void,
) {
  const profile = await readBuilding(db, id);
  const finishActivity = activityTrace?.(id);
  const events = await readCalendar(db, { placeId: id, limit: 20 });
  finishActivity?.({
    placeId: id,
    after: events.after,
    total: events.total,
    items: events.items.map((item) => ({
      title: item.sources[0].title,
      date: item.activity.startsAt?.date,
      place: item.activity.placeRaw,
      calendarUrl: item.calendarUrl,
    })),
    metrics: events.metrics,
  });
  const members = buildingProfileMembers(id);
  const maintained = !!(await db
    .prepare(
      `SELECT 1 AS present FROM building_profiles WHERE place_id IN (${members.map(() => "?").join(",")}) LIMIT 1`,
    )
    .bind(...members.map((member) => member.id))
    .first());
  return {
    ...profile,
    maintained,
    source: "管理员维护的校园建筑资料",
    mapUrl:
      (buildingPlaces.some(
        (place) => place.id === id && place.campus === "baiyun",
      )
        ? "/map?campus=baiyun&place="
        : "/map?place=") + encodeURIComponent(id),
    asOf: events.now,
    activityWindowStart: events.after,
    activityHasMore: events.hasMore,
    activityTotal: events.total,
    activities: events.items.map((item) => ({
      title: item.activity.title,
      startsAt: item.activity.startsAt
        ? { date: item.activity.startsAt.date, at: item.activity.startsAt.at }
        : null,
      endsAt: item.activity.endsAt
        ? { date: item.activity.endsAt.date, at: item.activity.endsAt.at }
        : null,
      place: item.activity.placeRaw,
      historical: item.historical,
      calendarUrl: item.calendarUrl,
      sources: item.sources.map((source) => ({
        documentId: source.documentId,
        title: source.title,
        url: source.originalUrl,
        name: source.source.name,
        publishedAt: source.publishedAt,
        readable: source.bodyAvailable,
      })),
    })),
  };
}

type BuildingActivity = Awaited<
  ReturnType<typeof buildingAssistantProfile>
>["activities"][number];

export function buildingActivityCards(activities: BuildingActivity[]) {
  const cards = new Map<string, Extract<AssistantCard, { kind: "source" }>>();
  for (const activity of activities) {
    const source = activity.sources[0];
    const link = {
      title: activity.title.slice(0, 250),
      href: activity.calendarUrl,
    };
    const existing = cards.get(source.documentId);
    if (existing) {
      const links = existing.calendarLinks!;
      if (links.length < 6 && !links.some((item) => item.href === link.href))
        links.push(link);
      continue;
    }
    cards.set(source.documentId, {
      kind: "source",
      documentId: source.documentId,
      title: source.title.slice(0, 250),
      sourceName: source.name.slice(0, 250),
      originalUrl: source.url,
      publishedAt: source.publishedAt,
      snippet: [activity.title, activity.startsAt?.date, activity.place]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 800),
      evidenceType: "metadata",
      classificationState: "radar",
      validity: "unknown",
      readable: source.readable,
      calendarLinks: [link],
    });
  }
  return [...cards.values()];
}

// Preserve a link for a recognizable event even if the model omitted its citation.
export function citeMentionedBuildingActivities(
  answer: string,
  cards: AssistantCard[],
) {
  const text = normalizeCitations(answer);
  const named = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const answerName = named(text);
  const sources = cards.flatMap((card, index) =>
    card.kind === "source" && card.calendarLinks?.length
      ? [
          {
            number: index + 1,
            names: [
              card.title,
              ...card.calendarLinks.map((event) => event.title),
            ].map(named),
          },
        ]
      : [],
  );
  const missing = sources.filter(
    ({ number, names }) =>
      !text.includes(`[${number}]`) &&
      names.some((title) => {
        if (title.length < 4) return false;
        const length = Math.min(title.length, 8);
        for (let i = 0; i <= title.length - length; i++) {
          const phrase = title.slice(i, i + length);
          if (
            answerName.includes(phrase) &&
            !sources.some(
              (source) =>
                source.number !== number &&
                source.names.some((name) => name.includes(phrase)),
            )
          )
            return true;
        }
        return false;
      }),
  );
  return missing.length
    ? `${text}\n\n活动链接 ${missing.map(({ number }) => `[${number}]`).join(" ")}`
    : text;
}
export async function buildingEvidence(
  db: SqlDatabase,
  query: string,
  selected?: string,
  activityTrace?: (id: string) => (data: unknown) => void,
  campus?: "university" | "baiyun",
) {
  const ids = mentionedBuildingIds(query, selected, campus);
  if (ids.length)
    return (
      await Promise.all(
        ids.map((id) => buildingAssistantProfile(db, id, activityTrace)),
      )
    ).filter((profile) => profile.maintained || profile.activityTotal > 0);
  if (
    !/哪里|哪儿|哪栋|哪个(?:楼|地方|建筑|场馆)|什么(?:地方|楼)|去[哪何]/.test(
      query,
    )
  )
    return [];
  const runs = query.match(/[\p{Script=Han}]{2,}/gu) || [];
  const terms = [
    ...new Set(
      runs.flatMap((run) =>
        [2, 3, 4].flatMap((size) =>
          Array.from({ length: Math.max(0, run.length - size + 1) }, (_, i) =>
            run.slice(i, i + size),
          ),
        ),
      ),
    ),
  ];
  const rows = (await readBuildingCatalog(db)).filter(
    (row) =>
      !campus ||
      buildingPlaces.some(
        (place) => place.id === row.id && place.campus === campus,
      ),
  );
  const weights = new Map(
    terms.map((term) => {
      const frequency = rows.filter((row) =>
        row.description.includes(term),
      ).length;
      return [
        term,
        frequency > 0 && frequency < rows.length / 4
          ? term.length * Math.log((rows.length + 1) / (frequency + 1))
          : 0,
      ];
    }),
  );
  const hits = rows
    .map((row) => ({
      row,
      score: terms.reduce(
        (sum, term) =>
          sum + (row.description.includes(term) ? weights.get(term) || 0 : 0),
        0,
      ),
    }))
    .filter((hit) => hit.score >= 7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return Promise.all(
    hits.map((hit) => buildingAssistantProfile(db, hit.row.id, activityTrace)),
  );
}
