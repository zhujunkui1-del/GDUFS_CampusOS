import type { ArticleAnalysis } from "@/domain/console/article-analysis";
import { tokenHash } from "@/lib/server/assistant/crypto";
type Activity = ArticleAnalysis["activities"][number];
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s“”"'「」·|｜]/g, "");
export async function calendarIdentity(a: Activity, documentId: string) {
  const title = norm(a.title)
    .replace(/[-—]广东外语外贸大学.*$/, "")
    .replace(/^关于举办/, "")
    .replace(/的通知$/, "");
  // Unknown organiser/venue cannot distinguish two colleges' identically named events.
  const mergeable = !!a.startsAt?.date && !!a.placeRaw && !!a.organizer;
  const material = mergeable
    ? [
        title,
        a.startsAt?.date,
        a.startsAt?.at,
        a.endsAt?.date,
        a.endsAt?.at,
        norm(a.placeRaw!),
        norm(a.organizer!),
        a.calendar?.campus,
      ]
    : [documentId, a.key];
  return "event-" + (await tokenHash(JSON.stringify(material))).slice(0, 40);
}
