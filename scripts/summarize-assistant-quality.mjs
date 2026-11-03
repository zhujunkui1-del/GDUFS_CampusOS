import fs from "node:fs/promises";
const dir="docs/verification/assistant-quality-2026-11-03";
const read=async name=>JSON.parse(await fs.readFile(`${dir}/${name}.json`,"utf8"));
const corpus=await read("public-corpus");
const normalize=s=>s.toLowerCase().replace(/[\s\u00a0“”‘’《》「」＃#|｜]/g,"");
const mean=xs=>xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
function retrieval(result){
  const rows=result.rows.map(row=>{
    const gold=corpus.find(d=>d.id===row.expectedId);
    const fragment=row.kind==="title_prefix" ? gold.title.slice(0,Math.max(8,Math.ceil(gold.title.length*.65))) : gold.title;
    const relevant=h=>normalize(h.title).includes(normalize(fragment));
    return {...row,equivalentMatch:row.hits.some(relevant),precisionTop3:mean(row.hits.slice(0,3).map(h=>+relevant(h))),precisionTop5:mean(row.hits.slice(0,5).map(h=>+relevant(h)))};
  });
  return {n:rows.length,targetIdRecallAt5:mean(rows.map(r=>+r.recalled)),equivalentTitleRecallAt5:mean(rows.map(r=>+r.equivalentMatch)),precisionOfReturnedTop3:mean(rows.filter(r=>r.precisionTop3!==null).map(r=>r.precisionTop3)),precisionOfReturnedTop5:mean(rows.filter(r=>r.precisionTop5!==null).map(r=>r.precisionTop5)),noEquivalentTitleRate:mean(rows.map(r=>+!r.equivalentMatch)),bodyEvidenceCoverage:mean(rows.flatMap(r=>r.hits.map(h=>+h.bodyAvailable))),meanMaintenanceLatencyMs:mean(rows.map(r=>r.latencyMs)),meanD1RowsRead:mean(rows.map(r=>r.rowsRead)),D1RowsWritten:rows.reduce((n,r)=>n+(r.metrics?.rowsWritten||0),0)};
}
function live(rows){
  return {n:rows.length,terminalFailures:rows.filter(r=>r.result?.error).map(r=>({message:r.message,code:r.result.error.code})),meanAnswerMs:mean(rows.map(r=>r.durationMs)),modelRequests:rows.reduce((n,r)=>n+(r.result?.metrics?.requests||0),0),externalTools:rows.flatMap(r=>r.tools).filter(t=>t.name==="search_external_campus_info").length,externalWhenOff:rows.filter(r=>!r.smartSearch).flatMap(r=>r.tools).filter(t=>t.name==="search_external_campus_info").length,observedNativeProviders:rows.flatMap(r=>r.result?.metrics?.timings?.externalSearch||[]).flatMap(r=>r.providers||[]).filter(p=>/xiaohongshu|redbook/i.test(p.provider)),missingCitationsWithSourceCards:rows.filter(r=>r.cards?.length && !/\[(?:来源\s*)?\d+\]/.test(r.text)).map(r=>r.message),groundingVerdicts:rows.flatMap(r=>r.result?.metrics?.groundingResults||[]),meanObservedD1Read:mean(rows.filter(r=>r.result?.metrics?.timings?.database).map(r=>r.result.metrics.timings.database.rowsRead)),workerCPU:null};
}
const output={definitions:{retrieval:"Frozen public corpus: 33 documents, 100 title, prefix and conversational-title queries. No model or Vectorize in this maintenance comparison.",precision:"Share of returned titles that contain the requested literal title/prefix after formatting normalization; not a semantic relevance grade or fact accuracy metric.",live:"Only this evaluator's isolated guest prompts. HTTP success alone is not a correctness grade. Grounding verdicts are model judgements, not independent human grades.",limitations:["No 100-question end-to-end model baseline was captured; 100 is the retrieval comparison size.","Persona naturalness and factual support require review of transcripts; no fabricated aggregate percentage.","D1 maintenance latency includes Cloudflare API round trips; not Worker request latency.","Worker CPU unavailable."]},before:retrieval(await read("baseline-retrieval")),after:retrieval(await read("after-retrieval")),baselineLive:live(await read("baseline-live")),afterLive:live(await read("after-live")),scenarios:live(await read("scenarios-live"))};
await fs.writeFile(`${dir}/summary.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify({before:output.before,after:output.after,live:output.scenarios},null,2));
