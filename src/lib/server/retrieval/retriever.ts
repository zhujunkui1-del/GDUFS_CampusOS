import {ArticleAnalysisSchema,type ArticleAnalysis} from '@/domain/console/article-analysis';
import {RETRIEVAL_INDEX_VERSION,RetrievalQuerySchema,RetrievalResultSchema,PUBLIC_RETRIEVAL_SCOPE,type EvidenceHit,type KnowledgeRetriever,type RetrievalQuery,type RetrievalResult} from '@/domain/retrieval/contracts';
import {ftsExpression,keywords} from '@/lib/retrieval/terms';
import type {SqlDatabase} from '../assistant/database';
import {ApiError} from '../errors';

type DocumentRow={id:string;version:number;source_id:string;title:string;url:string;published_at:string|null;body_status:string;rights_scope:string;content_revision:number;input_hash:string;display_name:string;source_type:string;official_status:string;primary_destination:'knowledge'|'radar'|'unknown';radar_category:EvidenceHit['radarCategory'];knowledge_category:EvidenceHit['knowledgeCategory'];classification_origin:string;analysis_json:string|null;text_hash:string;text_length:number;evidence_type:EvidenceHit['evidenceType']};
type ChunkRow={document_id:string;id:string;text:string;start_offset:number;end_offset:number;text_basis:'normalized_text'|'title';content_revision:number;input_hash:string;score:number};
export type VerifiedArticle={hit:EvidenceHit;analysis:ArticleAnalysis|null};

/** Point-bound authority checks. No HTML selected or broad public-view expansion. */
export async function currentPublicArticles(db:SqlDatabase,ids:string[],read=<T>(sql:string,args:unknown[])=>db.prepare(sql).bind(...args).all<T>()){
 if(!ids.length)return [];
 const allowed="'excerpt_and_link','licensed_full_text'";
 const result=await read<DocumentRow>(`WITH selected(id) AS(VALUES ${ids.map(()=>'(?)').join(',')})
 SELECT d.id,d.version,d.source_id,d.title,d.url,d.published_at,d.body_status,d.rights_scope,d.content_revision,d.input_hash,s.display_name,s.source_type,s.official_status,
 COALESCE(c.primary_destination,'unknown') AS primary_destination,c.radar_category,c.knowledge_category,COALESCE(c.classification_origin,'unclassified') AS classification_origin,c.analysis_json,r.text_hash,r.text_length,r.evidence_type
 FROM selected CROSS JOIN knowledge_documents d ON d.id=selected.id JOIN knowledge_sources s ON s.id=d.source_id
 JOIN article_search_documents r ON r.document_id=d.id AND r.content_revision=d.content_revision AND r.input_hash=d.input_hash AND r.index_version=? AND r.status='ready'
 LEFT JOIN console_article_classifications c ON c.document_id=d.id
 WHERE EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id AND p.version=d.version)
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)
 AND (r.evidence_type='metadata' OR (d.rights_scope IN(${allowed}) AND NOT EXISTS(
 SELECT 1 FROM knowledge_sources sp LEFT JOIN source_collection_policies p ON p.source_id=sp.id WHERE sp.id=d.source_id
 AND ((sp.manual_policy_version>0 AND (sp.manual_rights_scope NOT IN(${allowed}) OR sp.manual_policy_expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))
 OR (sp.manual_policy_version=0 AND p.source_id IS NOT NULL AND (p.rights_scope NOT IN(${allowed}) OR p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))))`,[...ids,RETRIEVAL_INDEX_VERSION]);
 return result.results;
}
export class D1KeywordRetriever implements KnowledgeRetriever{
 constructor(private db:SqlDatabase){}
 async retrieve(raw:RetrievalQuery,scope:typeof PUBLIC_RETRIEVAL_SCOPE,limit?:number,signal?:AbortSignal):Promise<RetrievalResult>{
  return (await this.search(raw,scope,limit,signal)).result;
 }
 async search(raw:RetrievalQuery,scope=PUBLIC_RETRIEVAL_SCOPE,limit?:number,signal?:AbortSignal){
  if(scope.kind!=='public')throw new ApiError('FORBIDDEN','仅支持公开资料检索。');
  const q=RetrievalQuerySchema.parse({...raw,...(limit!==undefined?{limit}:{})}),started=performance.now();
  const metrics={rowsRead:0,rowsWritten:0,queries:0,durationMs:0,candidateChunks:0,usageAvailable:true};
  const read=async <T>(sql:string,args:unknown[])=>{signal?.throwIfAborted();const r=await this.db.prepare(sql).bind(...args).all<T>();metrics.queries++;metrics.rowsRead+=r.meta?.rows_read||0;metrics.rowsWritten+=r.meta?.rows_written||0;metrics.usageAvailable&&=typeof r.meta?.rows_read==='number';return r;};
  const expression=ftsExpression(q.query),warnings:string[]=[];
  const empty=()=>({result:RetrievalResultSchema.parse({hits:[],metrics:{...metrics,durationMs:Math.round(performance.now()-started)},indexVersion:RETRIEVAL_INDEX_VERSION,method:'fts5_keywords_and_domain_expansion',warnings}),articles:[] as VerifiedArticle[]});
  if(!expression){warnings.push('问题没有可用检索词，请补充具体事项。');return empty();}
  if(q.documentIds&&!q.documentIds.length)return empty();
  const conditions=['article_chunk_fts MATCH ?','k.index_version=?'],params:unknown[]=[expression,RETRIEVAL_INDEX_VERSION];
  if(q.documentIds){conditions.push(`k.document_id IN(${q.documentIds.map(()=>'?').join(',')})`);params.push(...q.documentIds);}
  if(q.sourceId){conditions.push('d.source_id=?');params.push(q.sourceId);}
  if(q.sourceTypes){conditions.push(`s.source_type IN(${q.sourceTypes.map(()=>'?').join(',')})`);params.push(...q.sourceTypes);}
  if(q.publishedAfter){conditions.push("(CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)>=?");params.push(q.publishedAfter);}
  if(q.publishedBefore){conditions.push("(CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)<=?");params.push(q.publishedBefore);}
  // Business filters allow unknown/mixed content through: they never determine eligibility.
  const rows=await read<ChunkRow>(`SELECT k.document_id,k.id,k.text,k.start_offset,k.end_offset,k.text_basis,k.content_revision,k.input_hash,bm25(article_chunk_fts,4.0,1.0,0.0) AS score
   FROM article_chunk_fts JOIN knowledge_chunks k ON k.rowid=article_chunk_fts.rowid JOIN knowledge_documents d ON d.id=k.document_id JOIN knowledge_sources s ON s.id=d.source_id
   WHERE ${conditions.join(' AND ')} ORDER BY score LIMIT 96`,params);
  metrics.candidateChunks=rows.results.length;
  const ids=[...new Set(rows.results.map(c=>c.document_id))].slice(0,32);
  const documents=await currentPublicArticles(this.db,ids,read),terms=keywords(q.query);
  const ranked: {hit:EvidenceHit;analysis:ArticleAnalysis|null;key:string}[]=[];
  for(const d of documents){
   const parsed=d.analysis_json?ArticleAnalysisSchema.safeParse(JSON.parse(d.analysis_json)):null,analysis=parsed?.success?parsed.data:null;
   const choices=rows.results.filter(c=>c.document_id===d.id&&c.input_hash===d.input_hash&&c.content_revision===d.content_revision);
   const count=(s:string)=>terms.reduce((sum,t)=>sum+(s.includes(t)?Math.min(4,t.length/2):0),0);
   choices.sort((a,b)=>(count(b.text)-count(a.text))||a.score-b.score);
   const c=choices[0];if(!c)continue;
   const titleMatch=count(d.title),bodyMatch=c.text_basis==='title'?0:count(c.text);
   const knowledgeEvidence=analysis?.knowledge.conditions.length||analysis?.knowledge.steps.length||analysis?.knowledge.materials.length||/指南|流程|规则|管理办法|规章|办理/.test(d.title);
   const purposeBoost=q.purpose==='knowledge'?(knowledgeEvidence?4:0):(analysis?.activities.length?2:0);
   const categoryMatch=!!q.category&&(d.radar_category===q.category||d.knowledge_category===q.category||analysis?.activities.some(a=>a.category===q.category));
   if(q.category&&!categoryMatch&&d.primary_destination!=='unknown'&&!analysis?.auxiliaryDestinations.includes(q.purpose==='knowledge'?'knowledge':'radar'))continue;
   const score=titleMatch*3+bodyMatch+purposeBoost+(categoryMatch?2:0)-c.score;
   let start=0;
   if(c.text.length>780){const occurrences=terms.map(t=>c.text.indexOf(t)).filter(p=>p>=0);const at=occurrences.length?Math.min(...occurrences):0;start=Math.max(0,Math.min(c.text.length-780,at-120));}
   const snippet=c.text.slice(start,start+780);
   const effectiveUntil=analysis?.knowledge.effectiveUntil;
   const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
   const expired=effectiveUntil?.at?Date.parse(effectiveUntil.at)<Date.now():!!effectiveUntil?.date&&effectiveUntil.date<today;
   const hit:EvidenceHit={documentId:d.id,chunkId:c.id,title:d.title.slice(0,250),sourceId:d.source_id,sourceName:d.display_name.slice(0,250),originalUrl:d.url,publishedAt:d.published_at,contentSnippet:snippet,startOffset:c.start_offset+start,endOffset:c.start_offset+start+snippet.length,evidenceBasis:c.text_basis,evidenceType:d.evidence_type,bodyAvailable:c.text_basis!=='title',bodyPartial:d.body_status==='partial'||d.evidence_type==='excerpt',relevanceScore:Math.round(score*100)/100,rankingReasons:[`标题词组匹配 ${titleMatch}`,`片段词组匹配 ${bodyMatch}`,...(purposeBoost?['正文用途特征加权']:[]),...(categoryMatch?['业务类别匹配']:[])],classificationState:d.primary_destination,radarCategory:d.radar_category,knowledgeCategory:d.knowledge_category,classificationOrigin:d.classification_origin,contentRevision:d.content_revision,inputHash:d.input_hash,documentVersion:d.version,publicAvailable:true,validity:expired?'expired':analysis?.knowledge.validity||'unknown',official:d.official_status==='verified_official',readable:d.rights_scope==='licensed_full_text'&&d.body_status!=='not_provided',linkedSources:[]};
   ranked.push({hit,analysis,key:d.evidence_type!=='metadata'&&d.text_length>=200?d.text_hash:d.url.replace(/#.*$/,'')});
  }
  ranked.sort((a,b)=>b.hit.relevanceScore-a.hit.relevanceScore);
  const unique=new Map<string,typeof ranked[number]>();
  for(const item of ranked){const old=unique.get(item.key);if(old){if(old.hit.linkedSources.length<4)old.hit.linkedSources.push({documentId:item.hit.documentId,sourceName:item.hit.sourceName,url:item.hit.originalUrl});}else unique.set(item.key,item);}
  const articles=[...unique.values()].slice(0,q.limit);
  if(!articles.length)warnings.push('未找到当前公开、版本及来源权限均可核验的相关资料。');
  if(articles.some(a=>!a.hit.bodyAvailable))warnings.push('部分结果仅有元数据，不能据此回答正文中的规则或要求。');
  metrics.durationMs=Math.round(performance.now()-started);
  return {result:RetrievalResultSchema.parse({hits:articles.map(a=>a.hit),metrics,indexVersion:RETRIEVAL_INDEX_VERSION,method:'fts5_keywords_and_domain_expansion',warnings}),articles};
 }
 async revalidate(hits:EvidenceHit[]){
  const current=await currentPublicArticles(this.db,hits.map(h=>h.documentId));
  return hits.every(h=>current.some(d=>d.id===h.documentId&&d.version===h.documentVersion&&d.content_revision===h.contentRevision&&d.input_hash===h.inputHash));
 }
}
