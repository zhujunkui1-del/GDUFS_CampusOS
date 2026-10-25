import type {ArticleAnalysisInput} from '@/domain/console/article-analysis';
import {RETRIEVAL_INDEX_VERSION} from '@/domain/retrieval/contracts';
import {chunkArticle} from '@/lib/retrieval/chunks';
import type {SqlDatabase} from '../assistant/database';
import {tokenHash} from '../assistant/crypto';

/** Derived text only. All statements run in the article transaction. */
export async function retrievalIndexStatements(db:SqlDatabase,id:string,revision:number,inputHash:string,input:ArticleAnalysisInput,rights:string){
 const built=chunkArticle(input,rights);if(!built)return [];
 const textHash=await tokenHash(built.text),nonce=crypto.randomUUID(),stamp=new Date().toISOString();
 const guard='EXISTS(SELECT 1 FROM article_search_documents r WHERE r.document_id=? AND r.write_nonce=?)';
 const args=[id,nonce];
 return [
  db.prepare(`INSERT INTO article_search_documents(document_id,content_revision,input_hash,index_version,text_hash,text_length,chunk_count,evidence_type,status,indexed_at,write_nonce)
   SELECT ?,?,?,?,?,?,?,?,'ready',?,? FROM knowledge_documents d WHERE d.id=? AND d.content_revision=? AND d.input_hash=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
   ON CONFLICT(document_id) DO UPDATE SET content_revision=excluded.content_revision,input_hash=excluded.input_hash,index_version=excluded.index_version,text_hash=excluded.text_hash,text_length=excluded.text_length,chunk_count=excluded.chunk_count,evidence_type=excluded.evidence_type,status='ready',indexed_at=excluded.indexed_at,write_nonce=excluded.write_nonce
   WHERE article_search_documents.content_revision<>excluded.content_revision OR article_search_documents.input_hash<>excluded.input_hash OR article_search_documents.index_version<>excluded.index_version OR article_search_documents.text_hash<>excluded.text_hash OR article_search_documents.status<>'ready'`)
   .bind(id,revision,inputHash,RETRIEVAL_INDEX_VERSION,textHash,built.text.length,built.chunks.length,built.evidenceType,stamp,nonce,id,revision,inputHash),
  db.prepare(`DELETE FROM knowledge_chunks WHERE document_id=? AND index_version IS NOT NULL AND ${guard}`).bind(id,...args),
  ...built.chunks.flatMap(c=>{
   const chunkId=id+':fts:'+textHash.slice(0,16)+':'+c.ordinal;
   return [db.prepare(`INSERT INTO knowledge_chunks(id,document_id,text,start_offset,end_offset,content_revision,input_hash,index_version,text_basis,ordinal) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`)
    .bind(chunkId,id,c.text,c.start,c.end,revision,inputHash,RETRIEVAL_INDEX_VERSION,built.basis,c.ordinal,...args),
    db.prepare(`INSERT INTO article_chunk_fts(rowid,title_terms,body_terms,facets) SELECT rowid,?,?,? FROM knowledge_chunks WHERE id=? AND ${guard}`)
    .bind(built.titleTerms,c.terms,'',chunkId,...args)];
  })
 ];
}

/** Maintenance/ingestion only; public searches never rebuild an index. */
export async function ensureRetrievalIndex(db:SqlDatabase,id:string){
 const result=await db.prepare(`SELECT d.id,d.title,d.body,d.body_format,d.body_status,d.source_id,d.url,d.published_at,d.rights_scope,d.content_revision,d.input_hash,s.display_name FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
  WHERE d.id=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND d.input_hash IS NOT NULL
  AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text')
  AND NOT EXISTS(SELECT 1 FROM article_search_documents r WHERE r.document_id=d.id AND r.content_revision=d.content_revision AND r.input_hash=d.input_hash AND r.index_version=? AND r.status='ready')`).bind(id,RETRIEVAL_INDEX_VERSION).all<Record<string,string|number|null>>();
 const d=result.results[0];if(!d)return {changed:false,statements:0};
 const statements=await retrievalIndexStatements(db,id,Number(d.content_revision),String(d.input_hash),{
  title:String(d.title),body:String(d.body||''),bodyFormat:d.body_format==='reading_html'?'reading_html':'plain',bodyStatus:d.body_status as 'complete',sourceId:String(d.source_id),sourceName:String(d.display_name),originalUrl:String(d.url),publishedAt:d.published_at?String(d.published_at):null
 },String(d.rights_scope));
 if(statements.length)await db.batch(statements);
 return {changed:statements.length>0,statements:statements.length};
}
