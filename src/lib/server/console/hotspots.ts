import type { SqlDatabase } from "../assistant/database";
import { ConsoleIdSchema, type ConsoleActor } from "@/domain/console/contracts";
import type { CampusHotspotItem } from "@/domain/console/hotspots";
import { consolePermission } from "./auth";
import { ApiError } from "../errors";

export async function hotspotAdministration(
  db: SqlDatabase,
  actor: ConsoleActor,
  method: string,
  id?: string,
) {
  consolePermission(actor, "admin");
  if (method === "GET" && !id) {
    const rows = await db
      .prepare(
        `SELECT d.id,d.source_id,s.display_name AS source_name,d.title,d.published_at
      FROM campus_article_hotspots h JOIN knowledge_documents d ON d.id=h.document_id
      JOIN knowledge_sources s ON s.id=d.source_id ORDER BY h.added_at DESC,d.id`,
      )
      .all<CampusHotspotItem>();
    return { items: rows.results };
  }
  if (!id || !["POST", "DELETE"].includes(method))
    throw new ApiError("NOT_FOUND", "找不到热点操作。");
  const documentId = ConsoleIdSchema.parse(id);
  const adding = method === "POST";
  if (
    adding &&
    !(await db
      .prepare("SELECT id FROM console_public_documents WHERE id=?")
      .bind(documentId)
      .first())
  ) {
    throw new ApiError("INVALID_ARGUMENT", "只有已发布的文章可以添加到热点。");
  }
  await db.batch([
    db
      .prepare(
        adding
          ? "INSERT OR IGNORE INTO campus_article_hotspots (document_id) SELECT id FROM console_public_documents WHERE id=? LIMIT 1"
          : "DELETE FROM campus_article_hotspots WHERE document_id=?",
      )
      .bind(documentId),
    db
      .prepare(
        "INSERT INTO console_audit_logs(id,actor_id,actor_label,action,target_type,target_id) SELECT ?,?,?,?,'document',? WHERE changes()>0",
      )
      .bind(
        crypto.randomUUID(),
        actor.id,
        actor.email,
        adding ? "hotspot.add" : "hotspot.remove",
        documentId,
      ),
  ]);
  return { id: documentId };
}
