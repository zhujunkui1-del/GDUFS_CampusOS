import assert from 'node:assert/strict';
const base='https://gdufs.zhiyuapp.site';
for(const [id,message] of [['定位','白云山校区第二教学楼在哪里？请在地图定位。'],['路线','从白云山校区图书馆到第二教学楼怎么走？请显示步行路线。']]){
 const s=await fetch(base+'/api/agent/session');
 const cookies=new Map(s.headers.getSetCookie().map(line=>{const a=line.split(';')[0], i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)];}));
 const send=(path,body)=>fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const r=await send('/api/agent/chat',{message,mapContext:{campus:'baiyun'}});
 for(const line of r.headers.getSetCookie()){const a=line.split(';')[0],i=a.indexOf('=');cookies.set(a.slice(0,i),a.slice(i+1));}
 let buf='',packet,answer='',claimResult;
 for await(const chunk of r.body.pipeThrough(new TextDecoderStream())){
  buf+=chunk;const lines=buf.split('\n');buf=lines.pop();
  for(const l of lines){
   if(!l.startsWith('data:'))continue;
   const e=JSON.parse(l.slice(5));
   if(e.type==='message.delta')answer+=e.payload.text;
   if(e.type==='run.failed')throw Error(JSON.stringify(e.payload.error));
   if(e.payload.packet){
    packet=e.payload.packet;
    const c=await send('/api/agent/actions/'+packet.id+'/claim',{conversationId:e.payload.conversationId,tickets:(e.payload.routes||[]).map(x=>x.ticket).filter(Boolean)});
    claimResult=await c.json();
    assert.equal(c.status,200,JSON.stringify(claimResult));
    assert(claimResult.data.actions.every(a=>a.campus==='baiyun'));
    if(id==='路线')assert(claimResult.data.routes[0]?.solidPath?.coordinates.length>2);
   }
  }
 }
 assert(packet);console.log(JSON.stringify({id,answer,actions:claimResult.data.actions,distance:claimResult.data.routes[0]?.distanceMeters}));
}
