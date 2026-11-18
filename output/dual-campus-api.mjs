const base='https://gdufs.zhiyuapp.site';
for(const [id,message,mapContext] of [
 ['nearby','白云山图书馆附近有哪些食堂？'],
 ['compare','大学城图书馆和白云山图书馆分别在哪里？'],
 ['cross','从大学城图书馆步行到白云山图书馆'],
 ['mode','把白云山地图切换成3D'],
 ['here','这里有什么活动？',{campus:'baiyun',selectedPlaceId:'osm-way-962936641'}],
 ['events','白云山校区这周有什么讲座？'],
 ]){
 try{
 const s=await fetch(base+'/api/agent/session');const cookie=s.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const r=await fetch(base+'/api/agent/chat',{method:'POST',headers:{origin:base,'content-type':'application/json',cookie},body:JSON.stringify({message,mapContext}),signal:AbortSignal.timeout(50000)});
 const lines=(await r.text()).split('\n').filter(x=>x.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));
 const record={id,status:r.status,answer:lines.filter(e=>e.type==='message.delta').map(e=>e.payload.text).join('').slice(0,850),errors:lines.filter(e=>e.type==='run.failed').map(e=>e.payload.error),cards:lines.filter(e=>e.type==='artifact.ready').flatMap(e=>e.payload.cards||[]).map(x=>x.place?.name||x.title||x.kind)};
 console.log(JSON.stringify(record));
 }catch(e){console.log(id,String(e));}
}
