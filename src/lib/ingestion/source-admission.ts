// Local batch admission uses full records; Console list rows deliberately omit URLs.
export type DetailedIdentity = {
  id: string;
  url: string;
  publicationStatus: string;
  reviewStatus: string;
};
function detailedIdentity(raw: unknown): DetailedIdentity {
  if (!raw || typeof raw !== "object")
    throw Error("FULL_DOCUMENT_DETAILS_REQUIRED");
  const d = raw as Record<string, unknown>;
  if (
    ["id", "url", "publicationStatus", "reviewStatus"].some(
      (k) => typeof d[k] !== "string",
    )
  )
    throw Error("FULL_DOCUMENT_DETAILS_REQUIRED");
  return {
    id: String(d.id),
    url: String(d.url),
    publicationStatus: String(d.publicationStatus),
    reviewStatus: String(d.reviewStatus),
  };
}
export function planSourceAdmission<T extends { url: string }>(
  selected: T[],
  current: unknown[],
  priorWithdrawnIds: string[],
) {
  if (
    selected.length > 10 ||
    new Set(selected.map((d) => d.url)).size !== selected.length
  )
    throw Error("INVALID_SELECTED_BATCH");
  const details = current.map(detailedIdentity),
    byUrl = new Map(details.map((d) => [d.url, d]));
  const protectedIds = new Set(priorWithdrawnIds);
  const pending: T[] = [],
    existing: DetailedIdentity[] = [],
    skipped: DetailedIdentity[] = [];
  for (const item of selected) {
    const d = byUrl.get(item.url);
    if (!d) pending.push(item);
    else if (
      protectedIds.has(d.id) ||
      d.publicationStatus === "withdrawn" ||
      ["returned", "rejected"].includes(d.reviewStatus)
    )
      skipped.push(d);
    else existing.push(d);
  }
  return { pending, existing, skipped };
}
export function assertBatchPublication(
  id: string,
  admittedIds: string[],
  priorWithdrawnIds: string[],
) {
  if (priorWithdrawnIds.includes(id) || !admittedIds.includes(id))
    throw Error("PUBLICATION_OUTSIDE_APPROVED_BATCH");
}
