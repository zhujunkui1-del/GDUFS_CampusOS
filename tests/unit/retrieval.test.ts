import {it,expect} from 'vitest';
import {dateGateFixture,command} from '../fixtures/date-gate';
import {ensureRetrievalIndex} from '@/lib/server/retrieval/indexer';
import {D1KeywordRetriever} from '@/lib/server/retrieval/retriever';
import {PUBLIC_RETRIEVAL_SCOPE} from '@/domain/retrieval/contracts';
import {ftsExpression,lexicalTokens} from '@/lib/retrieval/terms';
async function article(f:Awaited<ReturnType<typeof dateGateFixture>>,body:string){
 f.sqlite.prepare(`INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES('retrieval',?,'真实片段测试','https://example.invalid/retrieval',?,'plain','complete','fixture-body','2026-10-25','all','campus_announcements','2026-10-24',1,?,'licensed_full_text','guide','campus_life')`).run(f.source.id,body,'c'.repeat(64));
 await f.store.publishCollectedWebArticle('retrieval');
 f.sqlite.exec("DELETE FROM knowledge_chunks WHERE document_id='retrieval'; DELETE FROM article_search_documents WHERE document_id='retrieval'");
}

it('encodes Chinese bigrams and keeps arbitrary query syntax out of MATCH',()=>{
 expect(lexicalTokens('图书馆借阅')).toHaveLength(4);
 expect(ftsExpression('" OR * 借书')).not.toContain('*');
});
it('searches actual body chunks, uses authoritative gates, preserves HTML, and an unchanged index writes nothing',async()=>{
 const f=await dateGateFixture();try{
  // A source article can remain unclassified; search never rewrites placement.
  await article(f,'图书馆借阅规则：读者可凭校园卡借书。续借请登录读者系统。');
  const before=f.snapshot();
  expect((await ensureRetrievalIndex(f.db,'retrieval')).changed).toBe(true);
  expect(f.snapshot()).toBe(before);
  const writes=f.sqlite.prepare('SELECT total_changes() AS n').get()!.n;
  expect((await ensureRetrievalIndex(f.db,'retrieval')).changed).toBe(false);
  expect(f.sqlite.prepare('SELECT total_changes() AS n').get()!.n).toBe(writes);
  const retriever=new D1KeywordRetriever(f.db);
  const r=await retriever.retrieve({query:'广外图书馆怎么借书'},PUBLIC_RETRIEVAL_SCOPE);
  expect(r.hits[0]).toMatchObject({documentId:'retrieval',bodyAvailable:true,evidenceBasis:'normalized_text'});
  expect(r.hits[0].contentSnippet).toContain('校园卡');
  expect(r.metrics.usageAvailable).toBe(false); // node:sqlite is not metered D1.
  expect(await retriever.revalidate(r.hits)).toBe(true);
  const d=await f.store.document('retrieval');await f.store.publish(d.id,{...command(d.version),note:'下架测试'},true);
  expect(await retriever.revalidate(r.hits)).toBe(false);
  expect((await retriever.retrieve({query:'图书馆借书'},PUBLIC_RETRIEVAL_SCOPE)).hits).toEqual([]);
 }finally{f.close();}
});
it('a stale version or expired source permission cannot leak body evidence',async()=>{
 const f=await dateGateFixture();try{
  await article(f,'就业手续办理指南：提交就业协议书。');
  await ensureRetrievalIndex(f.db,'retrieval');
  const r=new D1KeywordRetriever(f.db);
  expect((await r.retrieve({query:'就业协议'},PUBLIC_RETRIEVAL_SCOPE)).hits).toHaveLength(1);
  f.sqlite.prepare("UPDATE knowledge_documents SET publication_status='draft',input_hash=? WHERE id='retrieval'").run('b'.repeat(64));
  expect((await r.retrieve({query:'就业协议'},PUBLIC_RETRIEVAL_SCOPE)).hits).toEqual([]);
 }finally{f.close();}
});
