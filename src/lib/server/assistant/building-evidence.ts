import { readBuilding, readBuildingCatalog } from "../building-media";
import { readCalendar } from "../calendar/query";
import { campusData } from "@/features/campus-map/data/campus";
import {
  buildingProfileMembers,
  buildingProfileId,
} from "@/features/campus-map/data/building-groups";
import type { SqlDatabase } from "./database";
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[\s（）()]/g, "")
    .toLowerCase();
export function mentionedBuildingIds(query: string, selected?: string) {
  const text = normalize(query);
  const ids = [
    ...new Set(
      campusData.places
        .filter((place) =>
          [place.name, ...(place.aliases || [])].some(
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
export async function buildingAssistantProfile(db: SqlDatabase, id: string) {
  const profile = await readBuilding(db, id),
    events = await readCalendar(db, { placeId: id, limit: 20 });
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
    mapUrl: "/map?place=" + encodeURIComponent(id),
    asOf: events.now,
    activityWindowStart: events.after,
    activityHasMore: events.hasMore,
    activityTotal: events.total,
    activities: events.items.map((item) => ({
      title: item.sources[0].title,
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
        title: source.title,
        url: source.originalUrl,
        name: source.source.name,
      })),
    })),
  };
}
export async function buildingEvidence(
  db: SqlDatabase,
  query: string,
  selected?: string,
) {
  const ids = mentionedBuildingIds(query, selected);
  if (ids.length)
    return (
      await Promise.all(ids.map((id) => buildingAssistantProfile(db, id)))
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
  const rows = await readBuildingCatalog(db);
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
    hits.map((hit) => buildingAssistantProfile(db, hit.row.id)),
  );
}
