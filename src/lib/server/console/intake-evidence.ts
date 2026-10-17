import type { SqlDatabase, Statement } from "../assistant/database";
import { ApiError } from "../errors";
import { parseCampusTime } from "@/lib/ingestion/time";
import type { EventCandidate } from "@/domain/console/ingestion";

export function timeEvidenceStatements(
  db: SqlDatabase,
  event: EventCandidate,
  body: string,
  documentId: string,
  snapshotVersion: number,
  candidateId: string,
  revision: number,
  inputHash: string,
  extractor: string,
): Statement[] {
  for (const field of ["startsAt", "endsAt", "registrationDeadline"] as const)
    if (
      event[field] &&
      !(event.timeEvidence || []).some((e) => e.field === field)
    )
      throw new ApiError("INVALID_ARGUMENT", "精确活动时间缺少原文证据。");
  return (event.timeEvidence || []).map((e) => {
    const parsed = parseCampusTime(e.rawText);
    if (
      body.slice(e.startOffset, e.endOffset) !== e.rawText ||
      parsed.precision !== e.precision ||
      parsed.date !== e.date ||
      parsed.time !== e.time ||
      parsed.iso !== event[e.field]
    )
      throw new ApiError("INVALID_ARGUMENT", "时间证据与当前原文不一致。");
    return db
      .prepare(
        "INSERT INTO extraction_evidence(id,document_id,snapshot_version,candidate_id,field_name,raw_span,confidence,extractor_version,start_offset,end_offset,date_value,time_value,precision,inferred,content_revision,input_hash) VALUES(?,?,?,?,?,?,0.5,?,?,?,?,?,?,0,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        documentId,
        snapshotVersion,
        candidateId,
        e.field,
        e.rawText,
        extractor,
        e.startOffset,
        e.endOffset,
        e.date,
        e.time,
        e.precision,
        revision,
        inputHash,
      );
  });
}
export function discoveryStatement(
  db: SqlDatabase,
  sourceId: string,
  documentId: string,
  url: string,
  finder: "official_web" | "manual",
  entryUrl: string,
  now: string,
) {
  return db
    .prepare(
      "INSERT INTO document_discoveries(id,source_id,document_id,canonical_url,finder,entry_url,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id,canonical_url,finder,entry_url) DO UPDATE SET last_seen_at=excluded.last_seen_at",
    )
    .bind(
      crypto.randomUUID(),
      sourceId,
      documentId,
      url,
      finder,
      entryUrl,
      now,
      now,
    );
}
export function eventCandidateStatements(
  db: SqlDatabase,
  events: EventCandidate[],
  body: string,
  documentId: string,
  version: number,
  revision: number,
  inputHash: string,
): Statement[] {
  return events.flatMap((event, ordinal) => {
    const eventId = crypto.randomUUID(),
      extractor = "explicit-time-v2";
    return [
      db
        .prepare(
          "INSERT INTO event_candidates(id,document_id,snapshot_version,content_revision,input_hash,extractor_version,ordinal,title,organizer,starts_at,ends_at,registration_deadline,registration_url,raw_place_name,campus_scope,audience,change_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          eventId,
          documentId,
          version,
          revision,
          inputHash,
          extractor,
          ordinal,
          event.title,
          event.organizer,
          event.startsAt,
          event.endsAt,
          event.registrationDeadline,
          event.registrationUrl,
          event.rawPlaceName,
          event.campusScope,
          event.audience,
          event.changeStatus,
        ),
      ...timeEvidenceStatements(
        db,
        event,
        body,
        documentId,
        version,
        eventId,
        revision,
        inputHash,
        extractor,
      ),
    ];
  });
}
