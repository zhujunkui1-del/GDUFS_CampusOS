import {z} from 'zod';
import {ContentSearchResultSchema,KnowledgeSearchInputSchema,EventSearchInputSchema,type ContentSearchResult} from '@/domain/retrieval/skills';
import type {ArticleTimePoint} from '@/domain/console/article-analysis';
import {PUBLIC_RETRIEVAL_SCOPE} from '@/domain/retrieval/contracts';
import {registrationState,registrationWindowState,timePast} from '@/lib/retrieval/registration-state';
import {activityStatus} from '@/lib/ingestion/article-times';
import {searchCampusPlaces} from '@/features/campus-map/data/campus';
import type {SqlDatabase} from '../assistant/database';
import {D1KeywordRetriever} from './retriever';
import {SkillRegistry} from '../agent/skill-registry';
import {ApiError} from '../errors';

const time=(t:ArticleTimePoint|null)=>t?{raw:t.raw,date:t.date,at:t.at,timezone:t.timezone,precision:t.precision,resolution:t.resolution,inferred:t.inferred,inferenceBasis:t.inferenceBasis,evidence:t.evidence.text.slice(0,240)}:null;
/** Only a unique, explicit University Town building can feed the existing map. */
export function articleMapPlace(raw:string|null){
 if(!raw||!/大学城|南校区/.test(raw)||/白云|北校区|校外|线上/.test(raw))return null;
 const normalized=raw.replace(/广东外语外贸大学|广外|大学城校区|大学城|南校区|[（()）]/g,'').trim();
 const matches=searchCampusPlaces('').filter(p=>[p.name,...(p.aliases||[])].some(n=>n.length>=3&&normalized.includes(n)));
 const unique=[...new Map(matches.map(p=>[p.id,p])).values()];
 return unique.length===1?{placeId:unique[0].id,name:unique[0].name,precision:'building' as const}:null;
}
export async function searchContent(db:SqlDatabase,purpose:'knowledge'|'events',raw:z.input<typeof EventSearchInputSchema>,now=new Date().toISOString(),signal?:AbortSignal):Promise<ContentSearchResult>{
 const q=purpose==='events'?EventSearchInputSchema.parse(raw):KnowledgeSearchInputSchema.parse(raw);
 const event=purpose==='events'?EventSearchInputSchema.parse(raw):null;
 if(event?.after&&event.before&&event.after>event.before)throw new ApiError('INVALID_ARGUMENT','开始日期不能晚于结束日期。');
 let documentIds:string[]|undefined;
 let filterMetrics={rowsRead:0,rowsWritten:0,queries:0,usageAvailable:true};
 if(event&&(event.after||event.before)){
  const alias=event.timeRole==='event'?'a.starts_day':'a.ends_day',conditions=[alias+' IS NOT NULL'],args:unknown[]=[];
  if(event.after){conditions.push(alias+'>=?');args.push(event.after);}
  if(event.before){conditions.push(alias+'<=?');args.push(event.before);}
  const from=event.timeRole==='event'?'article_activity_index':'article_registration_windows';
  const r=await db.prepare(`SELECT DISTINCT a.document_id FROM ${from} a JOIN document_article_analysis x ON x.document_id=a.document_id JOIN knowledge_documents d ON d.id=a.document_id AND d.content_revision=x.content_revision AND d.input_hash=x.input_hash WHERE ${conditions.join(' AND ')} ORDER BY ${alias},a.document_id LIMIT 120`).bind(...args).all<{document_id:string}>();
  documentIds=r.results.map(d=>d.document_id);filterMetrics={rowsRead:r.meta?.rows_read||0,rowsWritten:r.meta?.rows_written||0,queries:1,usageAvailable:typeof r.meta?.rows_read==='number'};
 }
 const {after:_after,before:_before,timeRole:_role,registrationState:_reg,...base}=event||{...q,after:undefined,before:undefined,timeRole:undefined,registrationState:undefined};
 void _after;void _before;void _role;void _reg;
 const search=await new D1KeywordRetriever(db).search({...base,purpose,limit:q.limit,...(documentIds?{documentIds}:{})},PUBLIC_RETRIEVAL_SCOPE,undefined,signal);
 const result:ContentSearchResult={...search.result,purpose,query:q.query,now,timeZone:'Asia/Shanghai',activities:[],knowledge:[]};
 result.metrics.rowsRead+=filterMetrics.rowsRead;result.metrics.rowsWritten+=filterMetrics.rowsWritten;result.metrics.queries+=filterMetrics.queries;result.metrics.usageAvailable&&=filterMetrics.usageAvailable;
 const groups=new Set<string>();
 for(const {hit,analysis} of search.articles){
  // An absent/metadata body cannot establish policy conditions or activity facts.
  if(!analysis||!hit.bodyAvailable)continue;
  const k=analysis.knowledge;
  result.knowledge.push({documentId:hit.documentId,validity:hit.validity,effectiveFrom:time(k.effectiveFrom),effectiveUntil:time(k.effectiveUntil),conditions:k.conditions.slice(0,3).map(e=>e.text.slice(0,300)),materials:k.materials.slice(0,3).map(e=>e.text.slice(0,300)),steps:k.steps.slice(0,3).map(e=>e.text.slice(0,300))});
  for(const a of analysis.activities.slice(0,3)){
   if(event?.category&&a.category!==event.category)continue;
   if(event?.after||event?.before){const days=event.timeRole==='event'?[a.startsAt?.date]:a.registrationWindows.map(w=>w.end?.date);if(!days.some(day=>day&&(!event.after||day>=event.after)&&(!event.before||day<=event.before)))continue;}
   const current={...a,status:activityStatus(a,now)},state=registrationState(current,now);
   if(event?.registrationState&&state!==event.registrationState)continue;
   // Only exact start + explicit location can deduplicate sessions across articles.
   const group=a.startsAt?.at&&a.placeRaw?`${a.title}|${a.startsAt.at}|${a.placeRaw}`:hit.documentId+'/'+a.key;
   if(groups.has(group))continue;groups.add(group);
   result.activities.push({eventId:group,documentId:hit.documentId,activityKey:a.key,name:a.title.slice(0,250),kind:a.kind,category:a.category,startsAt:time(a.startsAt),endsAt:time(a.endsAt),placeRaw:a.placeRaw?.slice(0,300)||null,organizer:a.organizer?.slice(0,300)||null,eventStatus:current.status,historical:timePast(a.endsAt,now)||timePast(a.startsAt,now),registrationRequirement:a.registrationStatus==='required'?'required':a.registrationStatus==='not_required'?'not_required':'unknown',registrationState:state,registrationWindows:a.registrationWindows.slice(0,3).map(w=>({roundLabel:w.roundLabel,start:time(w.start),end:time(w.end),deadlineSemantics:w.deadlineSemantics,capacityLimited:w.capacityLimited,state:registrationWindowState(w,now),evidence:w.evidence.slice(0,2).map(e=>e.text.slice(0,240))})),otherDeadlines:a.otherDeadlines.slice(0,3).map(d=>({role:d.role,time:time(d.time)!})),registrationUrl:a.registrationUrl,evidence:a.evidence.slice(0,3).map(e=>e.text.slice(0,240)),mapPlace:articleMapPlace(a.placeRaw)});
  }
 }
 if(event&&(event.registrationState||event.after||event.before)){
  const ids=new Set(result.activities.map(a=>a.documentId));result.hits=result.hits.filter(h=>ids.has(h.documentId));result.knowledge=result.knowledge.filter(k=>ids.has(k.documentId));
 }
 return ContentSearchResultSchema.parse(result);
}
export function registerContentSkills(registry:SkillRegistry,db:SqlDatabase){
 const define=<T extends z.ZodType>(name:string,purpose:'knowledge'|'events',schema:T,description:string)=>({
  name,description,inputSchema:schema,outputSchema:ContentSearchResultSchema,version:'1.0.0',auth:'public' as const,sideEffect:'none' as const,requiresConfirmation:false,timeoutMs:12000,
  execute:async(input:z.output<T>,context:{signal?:AbortSignal})=>{const data=await searchContent(db,purpose,input as z.input<typeof EventSearchInputSchema>,new Date().toISOString(),context.signal);return{ok:true as const,data,sources:data.hits.map(h=>({title:h.title.slice(0,200),url:h.originalUrl,...(h.publishedAt?{publishedAt:h.publishedAt}:{})})),warnings:data.warnings};}
 });
 registry.register('knowledge-domain',define('search_campus_knowledge','knowledge',KnowledgeSearchInputSchema,'查询广外真实政策、办事流程、图书馆借阅、选课、奖助条件及就业指南。检索网站/公众号及校园资讯正文，返回证据与来源。只依据正文证据作答；元数据不能冒充全文，validity=unknown不能说是现行永久政策。追问请带上原问题主题。'));
 registry.register('events-domain',define('search_campus_events','events',EventSearchInputSchema,'查询真实讲座、文体、竞赛、招聘就业、科研申报、奖助机会与临时公告，包含未明确分类的校园资讯。时间过滤after/before使用实际活动或报名日期(timeRole)，不是发布日期。报标记不代表可报名；只有registrationState=open可称明确开放；unknown/额满即止均不能保证可报名。返回证据与原文。'));
 return registry;
}
