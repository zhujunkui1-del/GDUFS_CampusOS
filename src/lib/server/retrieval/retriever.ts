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
import {
  participationQuery,
  activityNounQuery,
  activityTitleTier,
} from "@/lib/retrieval/query-focus";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";
import { isOfficialCampusUrl } from "../external-search/policy";
import { evidenceWindow } from "@/lib/retrieval/evidence-window";
import type { SemanticRetriever } from "./vector";
import {
  articleTitleKey,
  articleTitleSql,
} from "@/lib/retrieval/article-title";

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
  can_read_body: number;
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
 CASE WHEN m.document_id IS NOT NULL THEN 'manual' WHEN a.document_id IS NOT NULL THEN 'automatic' ELSE 'legacy' END AS classification_origin,a.analysis_json,r.text_hash,r.text_length,r.evidence_type,
 (r.evidence_type<>'metadata' AND d.rights_scope IN(${allowed}) AND NOT EXISTS(
 SELECT 1 FROM knowledge_sources sp LEFT JOIN source_collection_policies p ON p.source_id=sp.id WHERE sp.id=d.source_id
 AND ((sp.manual_policy_version>0 AND (sp.manual_rights_scope NOT IN(${allowed}) OR sp.manual_policy_expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))
 OR (sp.manual_policy_version=0 AND p.source_id IS NOT NULL AND (p.rights_scope NOT IN(${allowed}) OR p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))) AS can_read_body
 FROM selected CROSS JOIN knowledge_documents d ON d.id=selected.id JOIN knowledge_sources s ON s.id=d.source_id
 JOIN article_search_documents r ON r.document_id=d.id AND r.content_revision=d.content_revision AND r.input_hash=d.input_hash AND r.index_version=? AND r.status='ready'
 LEFT JOIN document_article_analysis a ON a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash
 LEFT JOIN document_classification_overrides m ON m.document_id=d.id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
 ) SELECT v.* FROM permitted v WHERE EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=v.id AND p.version=v.version)`,
    [...ids, RETRIEVAL_INDEX_VERSION],
  );
  // The bounded MATERIALIZED boundary keeps the UNION view out of the source
  // permission expression (D1 depth=100), with one atomic authority snapshot.
  return result.results.map((row) =>
    row.can_read_body
      ? row
      : {
          ...row,
          evidence_type: "metadata" as const,
          analysis_json: null,
          body_status: "not_provided",
          rights_scope: "metadata_only",
        },
  );
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
    // Exact-title lookup: "找到《…》这篇文章" should find the document by its
    // title instead of hoping a long FTS query outranks everything else.
    let titleChunks: ChunkRow[] = [];
    let titleIds: Set<string> | undefined;
    const sourceFilterSql =
      (q.sourceId ? " AND d.source_id=?" : "") +
      (q.sourceTypes?.length
        ? ` AND EXISTS(SELECT 1 FROM knowledge_sources sf WHERE sf.id=d.source_id AND sf.channel_type IN(${q.sourceTypes.map(() => "?").join(",")}))`
        : "");
    const sourceFilterArgs = [
      ...(q.sourceId ? [q.sourceId] : []),
      ...(q.sourceTypes || []),
    ];
    const titleProbe =
      q.title ||
      (q.sort === "relevance" &&
      q.query.length >= 8 &&
      !/最近|近期|最新|怎么|如何|什么|哪些|吗|呢/.test(q.query)
        ? q.query
        : undefined);
    if (titleProbe) {
      const docs = await read<{
        id: string;
        title: string;
        published_at: string | null;
      }>(
        `SELECT d.id,d.title,d.published_at FROM knowledge_documents d
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
 AND (instr(d.title, ?) > 0 OR instr(${articleTitleSql("d.title")}, ?) > 0)
 ${sourceFilterSql}
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
 ORDER BY (d.publication_status='published') DESC,length(d.title) ASC,d.id LIMIT 16`,
        [titleProbe, articleTitleKey(titleProbe), ...sourceFilterArgs],
      );
      const ids = docs.results.map((r) => r.id);
      if (ids.length) titleIds = new Set(ids);
      // An explicit title is a constraint, not permission to accept arbitrary
      // FTS results when that title was not found. Broader reads are separate.
      if (!ids.length && q.title) return empty();
      if (ids.length) {
        const chunks = await read<ChunkRow>(
          `SELECT document_id,id,text,start_offset,end_offset,text_basis,content_revision,input_hash,0 AS score FROM (
 SELECT k.*,ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY CASE WHEN text_basis='title' THEN 1 ELSE 0 END,start_offset) AS rn
 FROM knowledge_chunks k WHERE k.document_id IN(${ids.map(() => "?").join(",")}) AND k.index_version=?
 ) WHERE rn<=6 ORDER BY document_id,start_offset LIMIT 96`,
          [...ids, RETRIEVAL_INDEX_VERSION],
        );
        titleChunks = chunks.results;
        metrics.recallLanes.push({
          name: "title_exact",
          limit: 16,
          candidates: titleChunks.length,
        });
      }
    }
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
    if (q.publishedCursor) {
      conditions.push("(d.published_at<? OR (d.published_at=? AND d.id>?))");
      params.push(
        q.publishedCursor.at,
        q.publishedCursor.at,
        q.publishedCursor.id,
      );
    }
    // The planner is not the only caller: a literal "最近 + 分类" query must
    // read the category itself even when a model omitted the sort hint.
    const sortMode =
      q.sort === "published_desc" || /最近|近期|最新/.test(q.query)
        ? "published_desc"
        : q.sort;
    // Category phrases are not subjects. Remove them as whole phrases before
    // tokenizing; otherwise Chinese bigrams like 赛活/动情 become hard filters
    // that discard every real article.
    // Score on the subject, not on the sentence the question was asked in.
    // "校历在哪看得到" is a phrase no article contains, so counting it scored
    // nothing and left every candidate tied on the same two points; the
    // document that actually is the calendar then lost to whichever neighbour
    // happened to say "管理办法" in its title.
    const scoringTerms = [
      ...plan.modifiers.map((m) => m.original),
      ...plan.topics.map((t) => t.alternatives[0]),
    ].filter((t): t is string => !!t && t.length >= 2);
    const terms = scoringTerms.length ? scoringTerms : keywords(q.query);
    const categoryPhrases =
      /竞赛活动情况|竞赛|比赛|大赛|讲座|讲坛|论坛|学术沙龙|沙龙|文体活动|文体|文化|体育|通知|公告|资讯|新闻|预告|情况|信息|方面|内容|介绍|了解|告诉|问题|东西|相关|广外|校园|大学|最新|近期|最近|有什么|哪些|吗|的/g;
    const genericBigrams = new Set(
      Array.from(
        {
          length:
            "竞赛活动情况讲座比赛大赛文体文化体育通知公告资讯新闻预告信息方面内容介绍了解告诉问题东西相关广外校园大学最新近期最近有什么哪些"
              .length - 1,
        },
        (_, i) =>
          "竞赛活动情况讲座比赛大赛文体文化体育通知公告资讯新闻预告信息方面内容介绍了解告诉问题东西相关广外校园大学最新近期最近有什么哪些".slice(
            i,
            i + 2,
          ),
      ),
    );
    const subjectSource =
      q.sort === "published_desc" || /最近|近期|最新/.test(q.query)
        ? q.query.replace(categoryPhrases, " ")
        : q.query;
    const subjectTerms =
      q.sort === "published_desc" || /最近|近期|最新/.test(q.query)
        ? [
            ...new Set(
              keywords(subjectSource)
                .map((t) => t.replace(/(?:相关|类)$/, ""))
                .filter(
                  (t) =>
                    t.length >= 2 &&
                    !genericBigrams.has(t) &&
                    !/^(?:竞赛|比赛|大赛|讲座|讲坛|论坛|沙龙|活动|文体|文化|体育|通知|公告|资讯|新闻|预告|情况|信息|方面|内容|介绍|了解|告诉|问题|东西|相关|广外|校园|大学|最新|近期|最近|什么|哪些|有|吗|的)$/.test(
                      t,
                    ),
                )
                .flatMap((t) =>
                  t === "计算机"
                    ? [t, "人工智能", "AI", "程序设计", "软件", "算法"]
                    : [t],
                ),
            ),
          ]
        : [];
    const matchesSubject = (text: string) => {
      const lower = text.toLowerCase();
      return (
        !subjectTerms.length ||
        subjectTerms.some((t) => lower.includes(t.toLowerCase()))
      );
    };
    // "最近 + 雷达分类" must read the tag itself, newest publication first.
    // FTS relevance would happily return a March event whose body happens to
    // match "竞赛" better than yesterday's notice, which is not what the user
    // asked for.
    let recentChunks: ChunkRow[] = [];
    const cursorSql = q.publishedCursor
      ? " AND (d.published_at<? OR (d.published_at=? AND d.id>?))"
      : "";
    const cursorArgs = q.publishedCursor
      ? [q.publishedCursor.at, q.publishedCursor.at, q.publishedCursor.id]
      : [];
    const cultureTopic =
      sortMode === "published_desc" &&
      !q.category &&
      /文体|文化|体育/.test(q.query);
    if (cultureTopic) {
      const docs = await read<{
        id: string;
        title: string;
        published_at: string | null;
        radar_category: string | null;
      }>(
        `SELECT d.id,d.title,d.published_at,d.radar_category FROM knowledge_documents d
 JOIN console_public_documents p ON p.id=d.id AND p.version=d.version
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
 AND d.published_at IS NOT NULL
 AND (d.radar_category='culture_sports'
   OR d.title LIKE '%书展%' OR d.title LIKE '%展览%' OR d.title LIKE '%专题展%'
   OR d.title LIKE '%文献展%' OR d.title LIKE '%画展%' OR d.title LIKE '%艺术%'
   OR d.title LIKE '%文艺%' OR d.title LIKE '%歌唱%' OR d.title LIKE '%歌手%'
   OR d.title LIKE '%秋之声%' OR d.title LIKE '%演出%' OR d.title LIKE '%晚会%'
   OR d.title LIKE '%音乐会%' OR d.title LIKE '%舞蹈%' OR d.title LIKE '%运动会%'
   OR d.title LIKE '%校运会%')
${q.publishedBefore ? " AND d.published_at < ?" : ""}
${cursorSql}
${sourceFilterSql}
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
 ORDER BY d.published_at DESC,d.id ASC LIMIT 80`,
        [
          ...(q.publishedBefore ? [q.publishedBefore] : []),
          ...cursorArgs,
          ...sourceFilterArgs,
        ],
      );
      const ids = docs.results.map((r) => r.id);
      // The culture tag is incomplete in the data: book exhibitions and the
      // autumn singing contest sit under other tags. Include explicit culture
      // titles, but exclude generic activities that merely contain “展”.
      const CULTURE_TITLE =
        /书展|展览|专题展|文献展|画展|艺术|文艺|歌唱|歌手|秋之声|演出|晚会|音乐会|舞蹈|运动会|校运会/;
      const NOT_CULTURE =
        /讲话|座谈|研讨|论坛|讲坛|招聘|志愿者|招募|优惠|明信片|店铺|金融|学术|会议|拓展|培训/;
      const cultureIds = new Set(
        docs.results
          .filter(
            (r) =>
              !NOT_CULTURE.test(r.title) &&
              (r.radar_category === "culture_sports" ||
                CULTURE_TITLE.test(r.title)),
          )
          .map((r) => r.id),
      );
      if (ids.length) {
        const chunks = await read<ChunkRow>(
          `SELECT document_id,id,text,start_offset,end_offset,text_basis,content_revision,input_hash,score FROM (
 SELECT k.document_id,k.id,k.text,k.start_offset,k.end_offset,k.text_basis,k.content_revision,k.input_hash,0 AS score,
   ROW_NUMBER() OVER (PARTITION BY k.document_id ORDER BY k.start_offset) AS rn
 FROM knowledge_chunks k WHERE k.document_id IN(${ids.map(() => "?").join(",")}) AND k.index_version=?
) WHERE rn=1`,
          [...ids, RETRIEVAL_INDEX_VERSION],
        );
        const dateById = new Map(
          docs.results.map((r) => [r.id, r.published_at]),
        );
        const seen = new Set<string>();
        recentChunks = chunks.results
          .filter((c) => {
            if (seen.has(c.document_id)) return false;
            if (!cultureIds.has(c.document_id)) return false;
            seen.add(c.document_id);
            return true;
          })
          .sort(
            (a, b) =>
              (Date.parse(dateById.get(b.document_id) || "") || 0) -
              (Date.parse(dateById.get(a.document_id) || "") || 0),
          );
        metrics.recallLanes.push({
          name: "recent_topic",
          limit: 80,
          candidates: recentChunks.length,
        });
      }
    } else if (sortMode === "published_desc" && q.category) {
      const recentDocs = await read<{
        id: string;
        title: string;
        published_at: string | null;
      }>(
        `SELECT d.id,d.title,d.published_at FROM knowledge_documents d
 JOIN console_public_documents p ON p.id=d.id AND p.version=d.version
 JOIN console_article_classifications c ON c.document_id=d.id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
 AND (c.radar_category=? OR c.knowledge_category=?)
 AND d.published_at IS NOT NULL
${q.publishedBefore ? " AND d.published_at < ?" : ""}
${cursorSql}
${sourceFilterSql}
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
 ORDER BY d.published_at DESC,d.id ASC LIMIT 80`,
        [
          q.category,
          q.category,
          ...(q.publishedBefore ? [q.publishedBefore] : []),
          ...cursorArgs,
          ...sourceFilterArgs,
        ],
      );
      const recentIds = recentDocs.results.map((r) => r.id);
      if (recentIds.length) {
        const chunks = await read<ChunkRow>(
          `SELECT k.document_id,k.id,k.text,k.start_offset,k.end_offset,k.text_basis,k.content_revision,k.input_hash,0 AS score
 FROM knowledge_chunks k JOIN knowledge_documents d ON d.id=k.document_id
 WHERE k.document_id IN(${recentIds.map(() => "?").join(",")}) AND k.index_version=?
 ORDER BY d.published_at DESC,
   CASE WHEN k.text_basis='title' THEN 1 ELSE 0 END,
   k.start_offset ASC LIMIT 400`,
          [...recentIds, RETRIEVAL_INDEX_VERSION],
        );
        const seen = new Set<string>();
        const titleById = new Map(
            recentDocs.results.map((r) => [r.id, r.title]),
          ),
          dateById = new Map(
            recentDocs.results.map((r) => [r.id, r.published_at]),
          );
        recentChunks = chunks.results.filter((c) => {
          if (seen.has(c.document_id)) return false;
          seen.add(c.document_id);
          return true;
        });
        // A subject-specific query ("计算机") must still see the newest
        // subject-matching articles even when they sit outside the first
        // page of the category sorted only by publication time.
        if (subjectTerms.length)
          recentChunks.sort(
            (a, b) =>
              Number(matchesSubject(titleById.get(b.document_id) || "")) -
                Number(matchesSubject(titleById.get(a.document_id) || "")) ||
              (Date.parse(dateById.get(b.document_id) || "") || 0) -
                (Date.parse(dateById.get(a.document_id) || "") || 0),
          );
        metrics.recallLanes.push({
          name: "recent_category",
          limit: 80,
          candidates: recentChunks.length,
        });
      } else warnings.push("该分类暂无当前公开资料。");
    } else if (sortMode === "published_desc" && !q.title) {
      // "最新的资讯/新闻" has no radar tag: still honor publication order over
      // lexical relevance, otherwise April notices can beat yesterday's news.
      const recentDocs = await read<{
        id: string;
        title: string;
        published_at: string | null;
      }>(
        `SELECT d.id,d.title,d.published_at FROM knowledge_documents d
 JOIN console_public_documents p ON p.id=d.id AND p.version=d.version
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
 AND d.published_at IS NOT NULL
${q.publishedBefore ? " AND d.published_at < ?" : ""}
${cursorSql}
${sourceFilterSql}
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
 ORDER BY d.published_at DESC,d.id ASC LIMIT 80`,
        [
          ...(q.publishedBefore ? [q.publishedBefore] : []),
          ...cursorArgs,
          ...sourceFilterArgs,
        ],
      );
      const ids = recentDocs.results.map((r) => r.id);
      if (ids.length) {
        const chunks = await read<ChunkRow>(
          `SELECT k.document_id,k.id,k.text,k.start_offset,k.end_offset,k.text_basis,k.content_revision,k.input_hash,0 AS score
 FROM knowledge_chunks k JOIN knowledge_documents d ON d.id=k.document_id
 WHERE k.document_id IN(${ids.map(() => "?").join(",")}) AND k.index_version=?
 ORDER BY d.published_at DESC, CASE WHEN k.text_basis='title' THEN 1 ELSE 0 END, k.start_offset ASC LIMIT 400`,
          [...ids, RETRIEVAL_INDEX_VERSION],
        );
        const seen = new Set<string>();
        recentChunks = chunks.results.filter((c) => {
          if (seen.has(c.document_id)) return false;
          seen.add(c.document_id);
          return true;
        });
        metrics.recallLanes.push({
          name: "recent_all",
          limit: 80,
          candidates: recentChunks.length,
        });
      }
    }
    // Business filters allow unknown/mixed content through: they never determine eligibility.
    const candidateLanes: ChunkRow[][] = titleChunks.length
      ? [titleChunks]
      : recentChunks.length
        ? [recentChunks]
        : [];
    if (!titleChunks.length && !recentChunks.length)
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
      !q.title &&
      !titleChunks.length &&
      !q.documentIds?.length &&
      !q.sourceId &&
      !q.sourceTypes?.length &&
      !q.publishedAfter &&
      !q.publishedBefore &&
      !q.publishedCursor &&
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
    const documents = await currentPublicArticles(this.db, ids, read);
    const ranked: {
      hit: EvidenceHit;
      analysis: ArticleAnalysis | null;
      key: string;
      intentTier: number;
      directSubject: boolean;
    }[] = [];
    for (const d of documents) {
      if (titleIds && !titleIds.has(d.id)) continue;
      const parsed = d.analysis_json
          ? ArticleAnalysisSchema.safeParse(JSON.parse(d.analysis_json))
          : null,
        analysis = parsed?.success ? parsed.data : null;
      const choices = rows.results
        .filter(
          (c) =>
            c.document_id === d.id &&
            c.input_hash === d.input_hash &&
            c.content_revision === d.content_revision,
        )
        .map((c) =>
          d.can_read_body
            ? c
            : {
                ...c,
                text: d.title,
                text_basis: "title" as const,
                start_offset: 0,
                end_offset: d.title.length,
              },
        );
      // A binary match made every article that mentions "院运会" once score
      // exactly 6.0, so 22 documents tied and the tie-break fell through to the
      // FTS rank. Repeats keep the signal: a notice that develops the topic
      // outranks a passing mention in an unrelated digest.
      const occurrences = (s: string, term: string) => s.split(term).length - 1;
      const count = (s: string) =>
        terms.reduce(
          (sum, t) =>
            sum + Math.min(4, t.length / 2) * Math.min(4, occurrences(s, t)),
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
      const halves = plan.modifiers.flatMap((m) => {
        const chars = [...m.original];
        return chars.length >= 4
          ? chars
              .filter((_, i) => i % 2 === 0)
              .map((ch) => ch + (chars[chars.indexOf(ch) + 1] ?? ""))
          : [m.original];
      });
      const covering = halves
        .map((half) => {
          const chunk = choices.find((c2) => c2.text.includes(half));
          return chunk ? { ...chunk, half } : null;
        })
        .filter(
          (chunk): chunk is (typeof choices)[number] & { half: string } =>
            !!chunk,
        )
        .filter(
          (chunk, i, all) => all.findIndex((c2) => c2.id === chunk.id) === i,
        )
        .slice(0, 2);
      // A rulebook can answer one question in two places: the curfew sits in
      // one article and the lights-out time in the next, so no single chunk
      // names both. Judge the subject against everything the document offered
      // rather than dropping a document for being organised in paragraphs.
      let relevance = queryRelevance(plan, {
        title: d.title,
        sourceName: d.display_name,
        contentSnippet: c.text,
      });
      if (
        !relevance.relevant &&
        (relevance.reason === "subject_modifier_missing" ||
          relevance.reason === "goal_evidence_missing") &&
        choices.length > 1
      )
        relevance = queryRelevance(plan, {
          title: d.title,
          sourceName: d.display_name,
          contentSnippet: choices
            .map((chunk) => chunk.text)
            .join("\n")
            .slice(0, 20000),
        });
      if (!titleIds && sortMode !== "published_desc" && !relevance.relevant)
        continue;
      if (
        subjectTerms.length &&
        !subjectTerms.some(
          (t) =>
            d.title.toLowerCase().includes(t.toLowerCase()) ||
            c.text.toLowerCase().includes(t.toLowerCase()),
        )
      )
        continue;
      const titleMatch = count(d.title),
        bodyMatch = c.text_basis === "title" ? 0 : count(c.text);
      const knowledgeEvidence =
        analysis?.knowledge.conditions.length ||
        analysis?.knowledge.steps.length ||
        analysis?.knowledge.materials.length ||
        /指南|流程|规则|管理办法|规章|办理|手册|条例|细则|规定|章程/.test(
          d.title,
        );
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
      // A bare activity noun ("院运会") is a question about what exists, not a
      // report of what happened. A recap of an already-held event is real
      // evidence, so it ranks below the notice instead of being dropped.
      const activity = activityNounQuery(q.query);
      const activityTier = activity ? activityTitleTier(d.title) : 0;
      const ageDays = d.published_at
        ? (Date.now() - Date.parse(d.published_at)) / 86400000
        : NaN;
      const freshness =
        Number.isFinite(ageDays) && ageDays >= 0
          ? 3 * Math.exp(-ageDays / 90)
          : 0;
      const opportunityBoost = opportunity
        ? (/获奖|斩获|圆满|落下帷幕|成功举办|喜讯/.test(d.title)
            ? -6
            : /通知|报名|招募|规程|预告/.test(d.title)
              ? 2
              : 0) + freshness
        : 0;
      // A document whose title *is* the subject answers the question; one that
      // merely qualifies as a "管理办法" is background. The title weight has to
      // outrank the generic purpose boost, or "校历" loses to a regulation that
      // happens to mention it.
      // "How do I apply for a deferred exam" is answered by the rulebook, not
      // by a faculty notice that lists when this term's deferred exams happen.
      // Both mention the word; only one states the procedure.
      // A rulebook states the rule once per article; a notice that merely
      // mentions the word repeats it in a table header. Count how often the
      // subject actually appears in the body, so a handbook that spends a
      // chapter on deferred exams outranks an announcement that lists dates.
      const rulebookTitle = /手册|条例|细则|规定|办法|章程|规章/.test(d.title);
      const rulebookBoost =
        ["procedure", "policy", "requirements"].includes(plan.goal) &&
        rulebookTitle
          ? 3 +
            Math.min(
              3,
              plan.modifiers.reduce(
                (n, m) => n + occurrences(c.text, m.original),
                0,
              ),
            )
          : 0;
      // "缓考安排" is a timetable for this term's exams, not the procedure for
      // asking for one. When someone asks how to do something, a title that
      // merely names a schedule should not outrank the rulebook that states
      // the rule.
      const scheduleNotice =
        /安排|通知|名单|公示|通报/.test(d.title) &&
        !/手册|条例|细则|规定|办法|章程|规章/.test(d.title);
      const titleWeight =
        ["procedure", "policy", "requirements"].includes(plan.goal) &&
        scheduleNotice
          ? 0
          : titleMatch * 6;
      const score =
        relevance.score +
        rulebookBoost +
        titleWeight +
        bodyMatch +
        (fusion?.get(c.id) || 0) * 80 +
        purposeBoost +
        (categoryMatch ? 2 : 0) -
        c.score +
        opportunityBoost +
        (activity ? freshness : 0);
      const selectedWindow = windows.get(c.id)!,
        start = selectedWindow.start,
        snippet = covering.length
          ? covering
              .map((chunk) => {
                const at = chunk.text.indexOf(chunk.half);
                return chunk.text.slice(
                  Math.max(0, at - 60),
                  Math.max(0, at) + 300,
                );
              })
              .join("\n\u2026\n")
              .slice(0, 780)
          : selectedWindow.text;
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
        intentTier: activity
          ? activityTier
          : opportunity
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
    // Activity notices tie on lexical score (every one mentions "院运会" once
    // or twice), so the newest actionable notice is the one still open. The
    // date only breaks ties inside the same tier; it never lifts a recap over
    // a notice.
    const activitySort = activityNounQuery(q.query);
    ranked.sort(
      (a, b) =>
        b.intentTier - a.intentTier ||
        b.hit.relevanceScore - a.hit.relevanceScore ||
        (activitySort
          ? (Date.parse(b.hit.publishedAt || "") || 0) -
            (Date.parse(a.hit.publishedAt || "") || 0)
          : 0),
    );
    if (sortMode === "published_desc")
      ranked.sort(
        (a, b) =>
          (Date.parse(b.hit.publishedAt || "") || 0) -
            (Date.parse(a.hit.publishedAt || "") || 0) ||
          a.hit.documentId.localeCompare(b.hit.documentId),
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
          d.evidence_type === h.evidenceType &&
          d.version === h.documentVersion &&
          d.content_revision === h.contentRevision &&
          d.input_hash === h.inputHash,
      ),
    );
  }
}
