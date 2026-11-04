// Package the actual map build as a separate, public-map-only test Worker.
// No bindings, cookies, account/AI APIs, scheduled tasks, production routes or D1.
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { diagnostics } from "./map-device-probe.mjs";
const root = ".map-tools/map-stability-isolated";
await mkdir(root + "/assets/_next", { recursive: true });
await cp(".next/static", root + "/assets/_next/static", { recursive: true });
await cp("public", root + "/assets", { recursive: true });
await writeFile(root + "/assets/__map_probe.js", diagnostics);
const html = (await readFile(".next/server/app/map.html", "utf8")).replace(
  "<head>",
  '<head><script src="/__map_probe.js"></script>',
);
await writeFile(root + "/assets/map.html", html);
await writeFile(
  root + "/worker.mjs",
  `export default {async fetch(request,env){
const url=new URL(request.url);
if(url.pathname==='/')return Response.redirect(new URL('/map',url),307);
if(url.pathname==='/api/auth/session'&&request.method==='GET')return Response.json({ok:true,data:{available:false,user:null,mailAvailable:false}},{headers:{'Cache-Control':'no-store'}});
if(url.pathname==='/__map_report'&&request.method==='POST'){
 if(Number(request.headers.get('content-length'))>30000)return new Response(null,{status:413});
 const body=await request.text();if(body.length>30000)return new Response(null,{status:413});
 try{const value=JSON.parse(body);if(!value.state||!Array.isArray(value.resources))throw Error();console.info(JSON.stringify({event:'map-device-result',...value}));return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});}catch{return new Response(null,{status:400});}
}
if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:403});
if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/admin'))return new Response(null,{status:404});
if(url.pathname==='/map')url.pathname='/map.html';
const response=await env.ASSETS.fetch(new Request(url,{method:request.method,headers:request.headers}));
const copy=new Response(response.body,response);copy.headers.set('X-Robots-Tag','noindex');
if(url.pathname==='/map.html'||url.pathname==='/__map_probe.js')copy.headers.set('Cache-Control','no-store');
return copy;
}};`,
);
await writeFile(
  root + "/wrangler.json",
  JSON.stringify(
    {
      name: "campusos-map-compat-20261104",
      main: "worker.mjs",
      account_id: "5328fbf5ef7ef40f7743723c2c192499",
      compatibility_date: "2026-10-12",
      workers_dev: true,
      routes: [{ pattern: "map-test.gdufs.ccwu.cc", custom_domain: true }],
      assets: {
        directory: "assets",
        binding: "ASSETS",
        run_worker_first: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  "Packaged isolated map-only Worker; no existing Worker or database binding is changed.",
);
