import { getCloudflareContext } from "@opennextjs/cloudflare";
import { RETRIEVAL_INDEX_VERSION } from "@/domain/retrieval/contracts";
import type { SqlDatabase } from "../assistant/database";

/**
 * Preview-only hybrid retrieval. Vectors are an *additional recall lane*: a
 * vector hit is always re-read from D1 and revalidated against the current
 * public document view before it can reach an answer. No text, score, or
 * source authority is trusted from Vectorize metadata.
 */
export const VECTOR_INDEX_NAME = "campusos-chunks";
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMS = 1024;
export const EMBEDDING_BATCH = 16;

export type AiBinding = {
  run(
    model: string,
    input: { text: string[] },
  ): Promise<{ data?: number[][] } | undefined>;
};
export type VectorizeBinding = {
  upsert(
    vectors: {
      id: string;
      values: number[];
      metadata?: Record<string, string>;
    }[],
  ): Promise<{ mutationId?: string }>;
  query(
    values: number[],
    options: { topK: number; returnMetadata?: "none" | "all"; returnValues?: boolean },
  ): Promise<{
    matches: {
      id: string;
      score: number;
      metadata?: Record<string, string>;
    }[];
  }>;
};
export type VectorBindings = { ai: AiBinding; index: VectorizeBinding };
export type SemanticRetriever = {
  search(
    query: string,
    topK: number,
    signal?: AbortSignal,
  ): Promise<{ id: string; score: number }[]>;
};

function asBindings(env: Record<string, unknown>): VectorBindings | null {
  const ai = env.AI as AiBinding | undefined,
    index = env.VECTOR_INDEX as VectorizeBinding | undefined;
  return ai && index ? { ai, index } : null;
}

export function vectorBindings(
  env: Record<string, unknown> | undefined,
): VectorBindings | null {
  return env ? asBindings(env) : null;
}

/** Reads the request-scoped bindings; returns null in Node/tests. */
export function requestVectorBindings(): VectorBindings | null {
  try {
    return asBindings(
      getCloudflareContext().env as unknown as Record<string, unknown>,
    );
  } catch {
    return null;
  }
}

export function vectorFlag(env: Record<string, unknown> | undefined) {
  return env?.HYBRID_RETRIEVAL === "true";
}

export function backfillFlag(env: Record<string, unknown> | undefined) {
  return env?.VECTOR_BACKFILL === "true";
}

/**
 * Vectorize caps IDs at 64 bytes while D1 chunk IDs are longer. The stable
 * 32-hex digest keeps the mapping deterministic; the original chunk id travels
 * in metadata and is revalidated against D1 before use.
 */
export async function vectorId(chunkId: string) {
  const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(chunkId),
    ),
    bytes = new Uint8Array(digest).slice(0, 16);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function embedTexts(
  ai: AiBinding,
  texts: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  if (!texts.length) return [];
  signal?.throwIfAborted();
  const response = await ai.run(EMBEDDING_MODEL, { text: texts });
  const data = response?.data;
  if (
    !Array.isArray(data) ||
    data.length !== texts.length ||
    data.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMS)
  )
    throw new Error("嵌入返回维度不符合预期。");
  return data;
}

export function createSemanticRetriever(
  bindings: VectorBindings | null,
): SemanticRetriever | undefined {
  if (!bindings) return undefined;
  return {
    async search(query, topK, signal) {
      const values = (await embedTexts(bindings.ai, [query], signal))[0],
        result = await bindings.index.query(values, {
          topK,
          returnMetadata: "all",
          returnValues: false,
        });
      return result.matches
        .filter((m) => Number.isFinite(m.score) && m.score > 0.2)
        .flatMap((m) => {
          const chunkId = m.metadata?.chunkId;
          return chunkId && m.metadata?.indexVersion === RETRIEVAL_INDEX_VERSION
            ? [{ id: chunkId, score: m.score }]
            : [];
        });
    },
  };
}

/**
 * Request-scoped retriever factory: only when the preview flag is on and both
 * bindings exist. Any configuration error degrades to keyword-only retrieval.
 */
export function requestSemanticRetriever(): SemanticRetriever | undefined {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    return vectorFlag(env) ? createSemanticRetriever(asBindings(env)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Embeds a bounded batch of current public chunks. The cron calls this every
 * minute, so Workerd CPU and AI/Vectorize spend stay bounded and a failed batch
 * is retried a few times instead of blocking ingestion.
 */
export async function vectorBackfillBatch(
  db: SqlDatabase,
  bindings: VectorBindings,
  limit = 64,
  signal?: AbortSignal,
) {
  const batchLimit = Math.max(1, Math.min(limit, 128)),
    candidates = await db
      .prepare(
        `SELECT k.id,k.document_id,k.text
   FROM knowledge_chunks k
   JOIN knowledge_documents d ON d.id=k.document_id
   JOIN console_public_documents p ON p.id=d.id AND p.version=d.version
   LEFT JOIN vector_chunk_state v ON v.chunk_id=k.id AND v.index_version=?
   WHERE k.index_version=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
   AND d.rights_scope IN('licensed_full_text','excerpt_and_link') AND d.body_status<>'not_provided'
   AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
   AND (v.chunk_id IS NULL OR (v.status='failed' AND v.attempts<3))
   ORDER BY k.document_id,k.ordinal LIMIT ?`,
      )
      .bind(RETRIEVAL_INDEX_VERSION, RETRIEVAL_INDEX_VERSION, batchLimit)
      .all<{ id: string; document_id: string; text: string }>();
  if (!candidates.results.length)
    return { embedded: 0, failed: 0, remaining: 0, done: true };
  let embedded = 0,
    failed = 0;
  for (let i = 0; i < candidates.results.length; i += EMBEDDING_BATCH) {
    const rows = candidates.results.slice(i, i + EMBEDDING_BATCH),
      stamp = new Date().toISOString();
    try {
      const values = await embedTexts(
          bindings.ai,
          rows.map((r) => r.text.slice(0, 4000)),
          signal,
        ),
        ids = await Promise.all(rows.map((r) => vectorId(r.id))),
        vectors = rows.map((r, n) => ({
          id: ids[n],
          values: values[n],
          metadata: {
            chunkId: r.id,
            documentId: r.document_id,
            indexVersion: RETRIEVAL_INDEX_VERSION,
          },
        }));
      await bindings.index.upsert(vectors);
      await db.batch(
        rows.map((r) =>
          db
            .prepare(
              `INSERT INTO vector_chunk_state(chunk_id,document_id,index_version,model,dims,status,attempts,embedded_at,last_error)
               VALUES(?,?,?,?,?,'ready',0,?,NULL)
               ON CONFLICT(chunk_id) DO UPDATE SET index_version=excluded.index_version,model=excluded.model,dims=excluded.dims,status='ready',attempts=0,embedded_at=excluded.embedded_at,last_error=NULL`,
            )
            .bind(
              r.id,
              r.document_id,
              RETRIEVAL_INDEX_VERSION,
              EMBEDDING_MODEL,
              EMBEDDING_DIMS,
              stamp,
            ),
        ),
      );
      embedded += rows.length;
    } catch (error) {
      failed += rows.length;
      const reason = (
        error instanceof Error ? error.message : "embed_or_upsert_failed"
      ).slice(0, 200);
      await db
        .batch(
          rows.map((r) =>
            db
              .prepare(
                `INSERT INTO vector_chunk_state(chunk_id,document_id,index_version,model,dims,status,attempts,embedded_at,last_error)
                 VALUES(?,?,?,?,?,'failed',1,NULL,?)
                 ON CONFLICT(chunk_id) DO UPDATE SET status='failed',attempts=vector_chunk_state.attempts+1,last_error=excluded.last_error`,
              )
              .bind(
                r.id,
                r.document_id,
                RETRIEVAL_INDEX_VERSION,
                EMBEDDING_MODEL,
                EMBEDDING_DIMS,
                reason,
              ),
          ),
        )
        .catch(() => undefined);
    }
  }
  const remaining = await db
    .prepare(
      `SELECT count(*) AS n FROM knowledge_chunks k
   JOIN knowledge_documents d ON d.id=k.document_id
   JOIN console_public_documents p ON p.id=d.id AND p.version=d.version
   LEFT JOIN vector_chunk_state v ON v.chunk_id=k.id AND v.index_version=?
   WHERE k.index_version=? AND d.rights_scope IN('licensed_full_text','excerpt_and_link') AND d.body_status<>'not_provided'
   AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
   AND (v.chunk_id IS NULL OR (v.status='failed' AND v.attempts<3))`,
    )
    .bind(RETRIEVAL_INDEX_VERSION, RETRIEVAL_INDEX_VERSION)
    .first<{ n: number }>();
  return {
    embedded,
    failed,
    remaining: Number(remaining?.n || 0),
    done: !remaining?.n,
  };
}
