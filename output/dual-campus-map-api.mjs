const base='https://gdufs.zhiyuapp.site';
for(const [id,message,mapContext] of [
 ['place','白云山校区第二教学楼在哪里？请在地图定位。',{campus:'baiyun'}],
 ['route','从白云山校区图书馆到第二教学楼怎么走？请显示步行路线。',{campus:'baiyun'}],
 ]){
 try{
 const s=await fetch(base+'/api/agent/session');const cookie=s.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const r=await fetch(base+'/api/agent/chat',{method:'POST',headers:{origin:base,'content-type':'application/json',cookie},body:JSON.stringify({message,mapContext}),signal:AbortSignal.timeout(50000)});
 const lines=(await r.text()).split('\n').filter(x=>x.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));
 const record={id,status:r.status,answer:lines.filter(e=>e.type==='message.delta').map(e=>e.payload.text).join('').slice(0,850),actions:lines.filter(e=>e.type==="artifact.ready").flatMap(e=>e.payload.packet?.actions||[]),errors:lines.filter(e=>e.type==='run.failed').map(e=>e.payload.error),cards:lines.filter(e=>e.type==='artifact.ready').flatMap(e=>e.payload.cards||[]).map(x=>x.place?.name||x.title||x.kind)};
 console.log(JSON.stringify(record));
 }catch(e){console.log(id,String(e));}
}

