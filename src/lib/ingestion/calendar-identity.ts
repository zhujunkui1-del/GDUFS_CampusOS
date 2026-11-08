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
  // Generic names require an organiser; a full title plus a full street
  // address is enough on its own. The same notice often reaches us twice,
  // once from a college page and once from the WeChat mirror, and the
  // "关于举办…的通知" wrapper is stripped before the length check.
  const mergeable =
    !!a.startsAt?.date &&
    !!a.placeRaw &&
    (!!a.organizer ||
      (title.length >= 12 &&
        a.placeRaw.length >= 12 &&
        /大学|校区/.test(a.placeRaw) &&
        /路|号|楼|中心|馆|会议室/.test(a.placeRaw)));
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
