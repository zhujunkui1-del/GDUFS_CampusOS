import {
  ArticleAnalysisSchema,
  type ArticleAnalysis,
} from "@/domain/console/article-analysis";
import {
  RETRIEVAL_INDEX_VERSION,
  RetrievalQuerySchema,
  RetrievalResultSchema,
  PUBLIC_RETRIEVAL_SCOPE,
  type EvidenceHit,
  type KnowledgeRetriever,
  type RetrievalQuery,
  type RetrievalResult,
} from "@/domain/retrieval/contracts";
import { ftsRecallLanes, keywords } from "@/lib/retrieval/terms";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import { participationQuery } from "@/lib/retrieval/query-focus";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";
import { isOfficialCampusUrl } from "../external-search/policy";
import { evidenceWindow } from "@/lib/retrieval/evidence-window";
import type { SemanticRetriever } from "./vector";

type DocumentRow = {
  id: string;
  version: number;
  source_id: string;
  title: string;
  url: string;
  published_at: string | null;
  body_status: string;
  rights_scope: string;
  content_revision: number;
  input_hash: string;
  display_name: string;
  source_type: string;
  official_status: string;
  primary_destination: "knowledge" | "radar" | "unknown";
  radar_category: EvidenceHit["radarCategory"];
  knowledge_category: EvidenceHit["knowledgeCategory"];
  classification_origin: string;
  analysis_json: string | null;
  text_hash: string;
  text_length: number;
  evidence_type: EvidenceHit["evidenceType"];
};
type ChunkRow = {
  document_id: string;
  id: string;
  text: string;
  start_offset: number;
  end_offset: number;
  text_basis: "normalized_text" | "title";
  content_revision: number;
  input_hash: string;
  score: number;
};
export type VerifiedArticle = {
  hit: EvidenceHit;
  analysis: ArticleAnalysis | null;
};

/** Point-bound authority checks. No HTML selected or broad public-view expansion. */
export async function currentPublicArticles(
  db: SqlDatabase,
  ids: string[],
  read = <T>(sql: string, args: unknown[]) =>
    db
      .prepare(sql)
      .bind(...args)
      .all<T>(),
) {
  if (!ids.length) return [];
  const allowed = "'excerpt_and_link','licensed_full_text'";
  const result = await read<DocumentRow>(
    `WITH selected(id) AS(VALUES ${ids.map(() => "(?)").join(",")}), permitted AS MATERIALIZED(
 SELECT d.id,d.version,d.source_id,d.title,d.url,d.published_at,d.body_status,d.rights_scope,d.content_revision,d.input_hash,s.display_name,s.source_type,s.official_status,
 CASE WHEN m.document_id IS NOT NULL THEN CASE WHEN m.radar_category IS NOT NULL THEN 'radar' ELSE 'knowledge' END WHEN a.document_id IS NOT NULL THEN a.primary_destination WHEN d.radar_category IS NOT NULL THEN 'radar' WHEN d.knowledge_category IS NOT NULL THEN 'knowledge' ELSE 'unknown' END AS primary_destination,
 CASE WHEN m.document_id IS NOT NULL THEN m.radar_category WHEN a.document_id IS NOT NULL THEN a.radar_category ELSE d.radar_category END AS radar_category,
 CASE WHEN m.document_id IS NOT NULL THEN m.knowledge_category WHEN a.document_id IS NOT NULL THEN a.knowledge_category ELSE d.knowledge_category END AS knowledge_category,
 CASE WHEN m.document_id IS NOT NULL THEN 'manual' WHEN a.document_id IS NOT NULL THEN 'automatic' ELSE 'legacy' END AS classification_origin,a.analysis_json,r.text_hash,r.text_length,r.evidence_type
 FROM selected CROSS JOIN knowledge_documents d ON d.id=selected.id JOIN knowledge_sources s ON s.id=d.source_id
 JOIN article_search_documents r ON r.document_id=d.id AND r.content_revision=d.content_revision AND r.input_hash=d.input_hash AND r.index_version=? AND r.status='ready'
 LEFT JOIN document_article_analysis a ON a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash
 LEFT JOIN document_classification_overrides m ON m.document_id=d.id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
 AND (r.evidence_type='metadata' OR (d.rights_scope IN(${allowed}) AND NOT EXISTS(
 SELECT 1 FROM knowledge_sources sp LEFT JOIN source_collection_policies p ON p.source_id=sp.id WHERE sp.id=d.source_id
 AND ((sp.manual_policy_version>0 AND (sp.manual_rights_scope NOT IN(${allowed}) OR sp.manual_policy_expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))
 OR (sp.manual_policy_version=0 AND p.source_id IS NOT NULL AND (p.rights_scope NOT IN(${allowed}) OR p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))))
 ) SELECT v.* FROM permitted v WHERE EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=v.id AND p.version=v.version)`,
    [...ids, RETRIEVAL_INDEX_VERSION],
  );
  // The bounded MATERIALIZED boundary keeps the UNION view out of the source
  // permission expression (D1 depth=100), with one atomic authority snapshot.
  return result.results;
}
export class D1KeywordRetriever implements KnowledgeRetriever {
  constructor(
    private db: SqlDatabase,
    private semantic?: SemanticRetriever,
  ) {}
  async retrieve(
    raw: RetrievalQuery,
    scope: typeof PUBLIC_RETRIEVAL_SCOPE,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<RetrievalResult> {
    return (await this.search(raw, scope, limit, signal)).result;
  }
  async search(
    raw: RetrievalQuery,
    scope = PUBLIC_RETRIEVAL_SCOPE,
    limit?: number,
    signal?: AbortSignal,
    preferredIds?: string[],
  ) {
    if (scope.kind !== "public")
      throw new ApiError("FORBIDDEN", "仅支持公开资料检索。");
    const q = RetrievalQuerySchema.parse({
        ...raw,
        ...(limit !== undefined ? { limit } : {}),
      }),
      started = performance.now();
    const metrics = {
      rowsRead: 0,
      rowsWritten: 0,
      queries: 0,
      durationMs: 0,
      candidateChunks: 0,
      usageAvailable: true,
      queryPlanVersion: "query-v2" as const,
      recallLanes: [] as { name: string; limit: number; candidates: number }[],
    };
    const read = async <T>(sql: string, args: unknown[]) => {
      signal?.throwIfAborted();
      const r = await this.db
        .prepare(sql)
        .bind(...args)
        .all<T>();
      metrics.queries++;
      metrics.rowsRead += r.meta?.rows_read || 0;
      metrics.rowsWritten += r.meta?.rows_written || 0;
      metrics.usageAvailable &&= typeof r.meta?.rows_read === "number";
      return r;
    };
    const recall = ftsRecallLanes(q.query),
      lanes =
        preferredIds?.length && recall.length
          ? [
              {
                name: "structured_date",
                expression: recall.at(-1)!.expression,
                limit: 48,
                ids: preferredIds,
              },
              {
                name: "lexical_date_completion",
                expression: recall.at(-1)!.expression,
                limit: 48,
                ids: undefined,
              },
            ]
          : recall.map((l) => ({ ...l, ids: undefined })),
      plan = buildQueryPlan(q.query),
      warnings: string[] = [];
    const empty = () => ({
      result: RetrievalResultSchema.parse({
        hits: [],
        metrics: {
          ...metrics,
          durationMs: Math.round(performance.now() - started),
        },
        indexVersion: RETRIEVAL_INDEX_VERSION,
        method: "fts5_keywords_and_domain_expansion",
        warnings,
      }),
      articles: [] as VerifiedArticle[],
    });
    if (!lanes.length) {
      warnings.push("问题没有可用检索词，请补充具体事项。");
      return empty();
    }
    if (q.documentIds && !q.documentIds.length) return empty();
    const conditions = [
        "article_chunk_fts MATCH ?",
        "rank MATCH 'bm25(4.0,1.0,0.0)'",
        "k.index_version=?",
      ],
      params: unknown[] = [RETRIEVAL_INDEX_VERSION];
    if (q.documentIds) {
      conditions.push(
        `k.document_id IN(${q.documentIds.map(() => "?").join(",")})`,
      );
      params.push(...q.documentIds);
    }
    if (q.sourceId) {
      conditions.push("d.source_id=?");
      params.push(q.sourceId);
    }
    if (q.sourceTypes) {
      conditions.push(
        `s.channel_type IN(${q.sourceTypes.map(() => "?").join(",")})`,
      );
      params.push(...q.sourceTypes);
    }
    if (q.publishedAfter) {
      conditions.push(
        "(CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)>=?",
      );
      params.push(q.publishedAfter);
    }
    if (q.publishedBefore) {
      conditions.push(
        "(CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)<=?",
      );
      params.push(q.publishedBefore);
    }
    // Business filters allow unknown/mixed content through: they never determine eligibility.
    const candidateLanes: ChunkRow[][] = [];
    for (const lane of lanes) {
      const local = lane.ids?.length
        ? ` AND k.document_id IN(${lane.ids.map(() => "?").join(",")})`
        : "";
      const found = await read<ChunkRow>(
        `SELECT k.document_id,k.id,k.text,k.start_offset,k.end_offset,k.text_basis,k.content_revision,k.input_hash,rank AS score
   FROM article_chunk_fts JOIN knowledge_chunks k ON k.rowid=article_chunk_fts.rowid JOIN knowledge_documents d ON d.id=k.document_id JOIN knowledge_sources s ON s.id=d.source_id
   WHERE ${conditions.join(" AND ")}${local} ORDER BY rank LIMIT ?`,
        [lane.expression, ...params, ...(lane.ids || []), lane.limit],
      );
      metrics.recallLanes.push({
        name: lane.name,
        limit: lane.limit,
        candidates: found.results.length,
      });
      candidateLanes.push(found.results);
    }
    // Semantic recall is a supplemental lane only for open natural-language
    // queries. Structured/filtered searches keep the deterministic FTS path so
    // a vector candidate cannot bypass date, source or document constraints.
    let semanticLane: ChunkRow[] = [];
    if (
      this.semantic &&
      !q.documentIds?.length &&
      !q.sourceId &&
      !q.sourceTypes?.length &&
      !q.publishedAfter &&
      !q.publishedBefore &&
      !q.category
    ) {
      try {
        const matches = await this.semantic.search(q.query, 24, signal),
          vectorIds = [...new Set(matches.map((m) => m.id))];
        if (vectorIds.length) {
          const found = await read<ChunkRow>(
              `SELECT k.document_id,k.id,k.text,k.start_offset,k.end_offset,k.text_basis,k.content_revision,k.input_hash,0 AS score
   FROM knowledge_chunks k WHERE k.id IN(${vectorIds.map(() => "?").join(",")}) AND k.index_version=?`,
              [...vectorIds, RETRIEVAL_INDEX_VERSION],
            ),
            similarity = new Map(matches.map((m) => [m.id, m.score]));
          semanticLane = found.results.map((c) => ({
            ...c,
            // Ascending score sort: more negative means more similar.
            score: -(similarity.get(c.id) || 0),
          }));
          metrics.recallLanes.push({
            name: "semantic",
            limit: 24,
            candidates: semanticLane.length,
          });
        }
      } catch {
        warnings.push("语义检索本轮不可用，已回退关键词检索。");
      }
    }
    if (semanticLane.length) candidateLanes.push(semanticLane);
    // Interleave document candidates so one recall lane cannot consume all
    // public revalidation slots. Total raw chunks <=96; current IDs <=32.
    const merged: ChunkRow[] = [];
    for (let i = 0; i < 96; i++)
      for (const lane of candidateLanes) if (lane[i]) merged.push(lane[i]);
    const rows = {
      results: [...new Map(merged.map((c) => [c.id, c])).values()],
    };
    const fusion = semanticLane.length ? new Map<string, number>() : null;
    if (fusion)
      for (const lane of candidateLanes)
        lane.forEach((c, rank) =>
          fusion.set(c.id, (fusion.get(c.id) || 0) + 1 / (60 + rank + 1)),
        );
    metrics.candidateChunks = merged.length;
    const ids = [...new Set(merged.map((c) => c.document_id))].slice(0, 32);
    const documents = await currentPublicArticles(this.db, ids, read),
      terms = keywords(q.query);
    const ranked: {
      hit: EvidenceHit;
      analysis: ArticleAnalysis | null;
      key: string;
      intentTier: number;
      directSubject: boolean;
    }[] = [];
    for (const d of documents) {
      const parsed = d.analysis_json
          ? ArticleAnalysisSchema.safeParse(JSON.parse(d.analysis_json))
          : null,
        analysis = parsed?.success ? parsed.data : null;
      const choices = rows.results.filter(
        (c) =>
          c.document_id === d.id &&
          c.input_hash === d.input_hash &&
          c.content_revision === d.content_revision,
      );
      const count = (s: string) =>
        terms.reduce(
          (sum, t) => sum + (s.includes(t) ? Math.min(4, t.length / 2) : 0),
          0,
        );
      const chunkRelevance = (text: string) =>
        queryRelevance(plan, { title: d.title, contentSnippet: text });
      const windows = new Map(
        choices.map((c) => [c.id, evidenceWindow(c.text, q.query, 780)]),
      );
      const relevanceByChunk = new Map(
        choices.map((c) => [c.id, chunkRelevance(c.text)]),
      );
      choices.sort(
        (a, b) =>
          Number(relevanceByChunk.get(b.id)!.relevant) -
            Number(relevanceByChunk.get(a.id)!.relevant) ||
          windows.get(b.id)!.priority - windows.get(a.id)!.priority ||
          (windows.get(a.id)!.priority === 2
            ? a.start_offset - b.start_offset
            : 0) ||
          windows.get(b.id)!.score - windows.get(a.id)!.score ||
          relevanceByChunk.get(b.id)!.score -
            relevanceByChunk.get(a.id)!.score ||
          count(b.text) - count(a.text) ||
          a.score - b.score,
      );
      const c = choices[0];
      if (!c) continue;
      const relevance = queryRelevance(plan, {
        title: d.title,
        sourceName: d.display_name,
        contentSnippet: c.text,
      });
      if (!relevance.relevant) continue;
      const titleMatch = count(d.title),
        bodyMatch = c.text_basis === "title" ? 0 : count(c.text);
      const knowledgeEvidence =
        analysis?.knowledge.conditions.length ||
        analysis?.knowledge.steps.length ||
        analysis?.knowledge.materials.length ||
        /指南|流程|规则|管理办法|规章|办理/.test(d.title);
      const purposeBoost =
        q.purpose === "knowledge"
          ? knowledgeEvidence
            ? 4
            : 0
          : analysis?.activities.length
            ? 2
            : 0;
      const categoryMatch =
        !!q.category &&
        (d.radar_category === q.category ||
          d.knowledge_category === q.category ||
          analysis?.activities.some((a) => a.category === q.category));
      if (
        q.category &&
        !categoryMatch &&
        d.primary_destination !== "unknown" &&
        !analysis?.auxiliaryDestinations.includes(
          q.purpose === "knowledge" ? "knowledge" : "radar",
        )
      )
        continue;
      // Discovering opportunities favours notices over prize reports, but a
      // recent publication never establishes an event/registration date.
      const opportunity = q.purpose === "events" && participationQuery(q.query);
      const ageDays = d.published_at
        ? (Date.now() - Date.parse(d.published_at)) / 86400000
        : NaN;
      const opportunityBoost = opportunity
        ? (/获奖|斩获|圆满|落下帷幕|成功举办|喜讯/.test(d.title)
            ? -6
            : /通知|报名|招募|规程|预告/.test(d.title)
              ? 2
              : 0) +
          (Number.isFinite(ageDays) && ageDays >= 0
            ? 3 * Math.exp(-ageDays / 90)
            : 0)
        : 0;
      const score =
        relevance.score +
        titleMatch * 3 +
        bodyMatch +
        (fusion?.get(c.id) || 0) * 80 +
        purposeBoost +
        (categoryMatch ? 2 : 0) -
        c.score +
        opportunityBoost;
      const selectedWindow = windows.get(c.id)!,
        start = selectedWindow.start,
        snippet = selectedWindow.text;
      const effectiveUntil = analysis?.knowledge.effectiveUntil;
      const today = new Date(Date.now() + 8 * 3600000)
        .toISOString()
        .slice(0, 10);
      const expired = effectiveUntil?.at
        ? Date.parse(effectiveUntil.at) < Date.now()
        : !!effectiveUntil?.date && effectiveUntil.date < today;
      const hit: EvidenceHit = {
        documentId: d.id,
        chunkId: c.id,
        title: d.title.slice(0, 250),
        sourceId: d.source_id,
        sourceName: d.display_name.slice(0, 250),
        originalUrl: d.url,
        publishedAt: d.published_at,
        contentSnippet: snippet,
        startOffset: c.start_offset + start,
        endOffset: c.start_offset + start + snippet.length,
        evidenceBasis: c.text_basis,
        evidenceType: d.evidence_type,
        bodyAvailable: c.text_basis !== "title",
        bodyPartial:
          d.body_status === "partial" || d.evidence_type === "excerpt",
        relevanceScore: Math.round(score * 100) / 100,
        rankingReasons: [
          `标题词组匹配 ${titleMatch}`,
          `片段词组匹配 ${bodyMatch}`,
          "查询主题与限定复核：" + relevance.reason,
          ...(purposeBoost ? ["正文用途特征加权"] : []),
          ...(categoryMatch ? ["业务类别匹配"] : []),
          ...(opportunity
            ? ["参赛发现：通知与时新性优先，非报名开放证明"]
            : []),
        ],
        classificationState: d.primary_destination,
        radarCategory: d.radar_category,
        knowledgeCategory: d.knowledge_category,
        classificationOrigin: d.classification_origin,
        contentRevision: d.content_revision,
        inputHash: d.input_hash,
        documentVersion: d.version,
        publicAvailable: true,
        validity: expired
          ? "expired"
          : analysis?.knowledge.validity || "unknown",
        // Evidence authority is not the old manual source-verification gate.
        // An exact trusted official original URL has the same authority here as
        // in external search; no source governance flag is rewritten.
        official:
          d.official_status === "verified_official" ||
          isOfficialCampusUrl(d.url),
        readable:
          d.rights_scope === "licensed_full_text" &&
          d.body_status !== "not_provided",
        linkedSources: [],
      };
      ranked.push({
        hit,
        analysis,
        intentTier: opportunity
          ? /获奖|斩获|圆满|落下帷幕|成功举办|喜讯|展风采|回顾|庆典|候选人|我们换届/.test(
              d.title,
            )
            ? 0
            : /通知|报名|招募|规程|预告/.test(d.title)
              ? 2
              : 1
          : 0,
        directSubject:
          plan.topics.some((t) =>
            t.alternatives.some((a) =>
              d.title.toLowerCase().includes(a.toLowerCase()),
            ),
          ) ||
          (plan.topics.some((t) => t.id === "borrowing") &&
            /入馆|图书馆/.test(d.title) &&
            /指南|手册|规则/.test(d.title)),
        key:
          d.evidence_type !== "metadata" && d.text_length >= 200
            ? d.text_hash
            : d.url.replace(/#.*$/, ""),
      });
    }
    ranked.sort(
      (a, b) =>
        b.intentTier - a.intentTier ||
        b.hit.relevanceScore - a.hit.relevanceScore,
    );
    const unique = new Map<string, (typeof ranked)[number]>();
    // Once an actual subject-specific guide/policy is available, a neighbouring
    // workflow or recruitment post that merely mentions it must not fill the
    // remaining answer slots. Indirect evidence remains discoverable when no
    // direct guide was retrieved, so an unusual title is not an exclusion gate.
    const preferDirect =
      ["procedure", "policy", "requirements"].includes(plan.goal) &&
      ranked.some((r) => r.directSubject);
    for (const item of ranked.filter((r) => !preferDirect || r.directSubject)) {
      const old = unique.get(item.key);
      if (old) {
        if (old.hit.linkedSources.length < 4)
          old.hit.linkedSources.push({
            documentId: item.hit.documentId,
            sourceName: item.hit.sourceName,
            url: item.hit.originalUrl,
          });
      } else unique.set(item.key, item);
    }
    const articles = [...unique.values()].slice(0, q.limit);
    if (!articles.length)
      warnings.push("未找到当前公开、版本及来源权限均可核验的相关资料。");
    if (articles.some((a) => !a.hit.bodyAvailable))
      warnings.push("部分结果仅有元数据，不能据此回答正文中的规则或要求。");
    metrics.durationMs = Math.round(performance.now() - started);
    return {
      result: RetrievalResultSchema.parse({
        hits: articles.map((a) => a.hit),
        metrics,
        indexVersion: RETRIEVAL_INDEX_VERSION,
        method: "fts5_keywords_and_domain_expansion",
        warnings,
      }),
      articles,
    };
  }
  async revalidate(hits: EvidenceHit[]) {
    const current = await currentPublicArticles(
      this.db,
      hits.map((h) => h.documentId),
    );
    return hits.every((h) =>
      current.some(
        (d) =>
          d.id === h.documentId &&
          d.version === h.documentVersion &&
          d.content_revision === h.contentRevision &&
          d.input_hash === h.inputHash,
      ),
    );
  }
}
