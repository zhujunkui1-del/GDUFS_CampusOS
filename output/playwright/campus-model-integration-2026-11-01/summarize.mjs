import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=async f=>JSON.parse((await readFile(new URL('./'+f,import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const rows=new Map(),samples=[];
for(const f of ['batch-0.json','batch-1.json','batch-2.json','batch-3.json','recheck-C.json']){
 const r=await read(f);assert.deepEqual(r.errors,[]);assert.equal(r.idleFrames[0],r.idleFrames[1]);
 for(const row of r.results)rows.set(row.key,row);
}
const finish=await read('final-checks-budget.json');
const pavilion=rows.get('pavilion');
pavilion.modes=finish.pavilion.map(d=>({display:d.display,selected:d.campusModelSelected,extent:JSON.parse(d.campusSelectedModelExtent),drawCalls:d.campusModelDrawCalls,triangles:d.campusModelTriangles,keys:JSON.parse(d.campusModelKeys)}));
for(const row of rows.values())for(const mode of row.modes){
 if(row.key!=='legacy-s7')assert.equal(mode.selected,row.id);
 assert(mode.extent[0]>=-1&&mode.extent[1]>=-1&&mode.extent[2]<=1441&&mode.extent[3]<=1001);
 samples.push(mode);
}
assert.equal(rows.size,28);assert.equal(samples.length,56);
const phone=await read('fallback-mobile-final.json'),interaction=await read('interactions.json');
assert.deepEqual(phone.errors,[]);assert.deepEqual(interaction.errors,[]);assert.deepEqual(finish.errors,[]);
assert(phone.fallback.lowKept&&phone.retry.highRestored&&finish.restored);
for(const r of phone.mobile){assert(+r.triangles<=30000);assert(+r.drawCalls<=20);}
assert.equal(phone.idleFrames[0],phone.idleFrames[1]);
const report={date:'2026-11-01',url:'http://127.0.0.1:3026/map',remoteDeployed:false,assetAudit:await read('asset-audit.json'),desktop:{viewport:[1440,1000],buildings:rows.size,modeCases:samples.length,errors:[],maxModelTriangles:Math.max(...samples.map(x=>+x.triangles)),maxModelDrawCalls:Math.max(...samples.map(x=>+x.drawCalls)),overview:{entries:+finish.overview.campusModelCount,triangles:+finish.overview.campusModelTriangles,drawCalls:+finish.overview.campusModelDrawCalls},idleFrames:finish.idleFrames},mobile:{viewport:[390,844],modeCases:phone.mobile.length,maxModelTriangles:Math.max(...phone.mobile.map(x=>+x.triangles)),maxModelDrawCalls:Math.max(...phone.mobile.map(x=>+x.drawCalls)),errors:phone.errors,actualPhone:false,idleFrames:phone.idleFrames},interaction,fallback:phone.fallback,retry:phone.retry,route:finish.route,checks:{unitTests:37,existingE2E:12,changedFileLint:'passed',typecheck:'passed',productionBuild:'passed',wholeRepoLint:{status:'existing failures',errors:69,warnings:2292}},unverified:['Real iPhone/Android GPU/FPS, thermal, weak-network and long-session performance','Surveyed metric dimensions and reference-photo reuse license','Remote deployment and local Workers/D1-dependent services']};
await writeFile(new URL('./verification-summary.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({desktop:report.desktop,mobile:report.mobile,unitTests:37,existingE2E:12}));
