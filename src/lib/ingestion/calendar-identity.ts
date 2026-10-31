import type { ArticleAnalysis } from "@/domain/console/article-analysis";
import { tokenHash } from "@/lib/server/assistant/crypto";
type Activity = ArticleAnalysis["activities"][number];
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s“”"'「」·|｜]/g, "");
export async function calendarIdentity(
  a: Activity,
  documentId: string,
  sourceName = "",
) {
  let title = norm(a.title);
  const suffix = "-" + norm(sourceName);
  if (sourceName && title.endsWith(suffix))
    title = title.slice(0, -suffix.length);
  title = title
    .replace(/[-—]广东外语外贸大学.*$/, "")
    .replace(/^关于举办/, "")
    .replace(/的通知$/, "");
  // Generic names require an organiser; a formal title also needs a precise venue and schedule.
  const mergeable =
    !!a.startsAt?.date &&
    !!a.placeRaw &&
    (!!a.organizer ||
      (title.length >= 20 &&
        a.placeRaw.length >= 12 &&
        /大学|校区/.test(a.placeRaw) &&
        /路|号|楼|中心|馆|会议室/.test(a.placeRaw) &&
        !!(
          a.startsAt.at ||
          (a.endsAt?.date && a.endsAt.date !== a.startsAt.date)
        )));
  const material = mergeable
    ? [
        title,
        a.startsAt?.date,
        a.startsAt?.at,
        a.endsAt?.date,
        a.endsAt?.at,
        norm(a.placeRaw!),
        a.organizer ? norm(a.organizer) : null,
        a.calendar?.campus,
      ]
    : [
        documentId,
        title,
        a.startsAt?.date,
        a.startsAt?.at,
        a.endsAt?.date,
        a.endsAt?.at,
        a.placeRaw ? norm(a.placeRaw) : null,
        a.organizer ? norm(a.organizer) : null,
      ];
  return "event-" + (await tokenHash(JSON.stringify(material))).slice(0, 40);
}
