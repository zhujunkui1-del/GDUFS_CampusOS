import http from 'node:http';
import {Readable} from 'node:stream';
const live='https://gdufs.zhiyuapp.site', local='http://127.0.0.1:3026';
const jar=new Map();
const server=http.createServer(async(req,res)=>{
 const agent=req.url.startsWith('/api/agent/');
 const origin=agent?live:local;
 try {
  const headers=new Headers();
  for(const [key,value] of Object.entries(req.headers)) if(typeof value==='string'&&!['host','connection','accept-encoding','content-length'].includes(key)) headers.set(key,value);
  if(agent){headers.set('origin',live);headers.set('cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));}
  const response=await fetch(origin+req.url,{headers,method:req.method,redirect:'manual',...(req.method==='GET'||req.method==='HEAD'?{}:{body:Readable.toWeb(req),duplex:'half'})});
  for(const [k,v] of response.headers)if(!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(k))res.setHeader(k,v);
  const cookies=response.headers.getSetCookie(); if(agent)for(const line of cookies){const a=line.split(';')[0],i=a.indexOf('=');jar.set(a.slice(0,i),a.slice(i+1));}if(cookies.length)res.setHeader('set-cookie',cookies);
  res.writeHead(response.status);res.flushHeaders();
  if(response.body)Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);else res.end();
 }catch(e){res.writeHead(502);res.end(String(e));}
});
server.listen(3027,'127.0.0.1',()=>console.log('verification bridge listening'));

