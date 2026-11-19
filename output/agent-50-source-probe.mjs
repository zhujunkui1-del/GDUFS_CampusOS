const origin="https://gdufs.zhiyuapp.site";
const topics={T28:"云山卓越讲坛",T31:"水电费",T32:"电费",T33:"学生证补办",T34:"校园卡挂失",T35:"转专业",T36:"奖学金",T37:"交换项目",T38:"计算机等级考试",T39:"校园网",T40:"教务系统",T43:"新利益法学",T44:"图书馆开放时间",T45:"奖学金"};
import fs from "node:fs";
const results=[];
for(const [id,q] of Object.entries(topics)){
 const lane=['T28','T43','T44','T38'].includes(id)?'radar':'knowledge';
 try{const r=await fetch(origin+'/api/public/content?'+new URLSearchParams({surface:lane,limit:6,q}),{signal:AbortSignal.timeout(9000)});const j=await r.json();results.push({id,q,lane,status:r.status,items:(j.data?.items||[]).map(({id,title,url,publishedAt,readable,source})=>({id,title,url,publishedAt,readable,source:source?.name}))});}catch(e){results.push({id,q,error:e.name});}
}
fs.writeFileSync("output/agent-50-source-candidates.json",JSON.stringify(results,null,2));for(const r of results)console.log(r.id,r.status??r.error,r.items?.length,r.items?.[0]?.title);
