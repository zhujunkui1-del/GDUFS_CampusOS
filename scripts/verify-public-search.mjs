import fs from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {build} from "esbuild";
import {pathToFileURL} from "node:url";
import {previewCloudflareJson} from "./preview-network.mjs";
const auth=execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js","auth","token","--json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
const token=JSON.parse(auth.slice(auth.indexOf("{"))).token;
const endpoint="https://api.cloudflare.com/client/v4/accounts/5328fbf5ef7ef40f7743723c2c192499/d1/database/18299abc-b38b-4494-8d12-8ab4d482c304/query";
const db={prepare(sql){if(!/^\s*(SELECT|WITH)/.test(sql))throw Error("Read-only");let params=[];const s={bind(...p){params=p;return s;},async all(){const [r]=await previewCloudflareJson(endpoint,token,{sql,params});return r;},async first(){return (await s.all()).results[0]||null;}};return s;}};
await build({stdin:{contents:"export {readPublicContent} from './src/lib/server/console/public-content';",resolveDir:process.cwd(),loader:"ts"},outfile:".map-tools/assistant-quality/public-search.mjs",bundle:true,platform:"node",format:"esm",packages:"external",logLevel:"silent"});
const {readPublicContent}=await import(pathToFileURL(process.cwd()+"/.map-tools/assistant-quality/public-search.mjs").href);
const rows=[];
for(const query of [{q:"资讯 _ 校园卡补办"},{q:"党的二十届五中全会公报一图速览"},{q:"图书馆",surface:"radar"},{q:"指南",source:"图书馆",surface:"knowledge"}]){
 const result=await readPublicContent(db,query);
 rows.push({query,total:result.total,items:result.items.map(({id,title})=>({id,title}))});
}
await fs.writeFile("docs/verification/assistant-quality-2026-11-03/public-search-live-d1.json",JSON.stringify(rows,null,2));
console.log(rows.map(r=>({query:r.query,returned:r.items.length,total:r.total})));
