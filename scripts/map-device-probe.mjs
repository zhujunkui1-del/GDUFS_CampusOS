export const diagnostics = `(() => {
const failures=[];
addEventListener('error',e=>{if(failures.length<8)failures.push(String(e.message||'resource-error').slice(0,240));});
addEventListener('unhandledrejection',e=>{if(failures.length<8)failures.push(String(e.reason?.message||e.reason||'promise-error').slice(0,240));});
const keys=['status','mode','zoom','renderer','renderState','renderProfile','renderCapability','interactiveMs','baseDataState','modelState','modelLod','modelFrameCount','campusModelFrames','campusModelCount','campusModelDetails','campusModelPending','campusModelResidentCount','campusModelBudget','campusModelTriangles','campusModelDrawCalls','contextLosses','modelMovingFrameMs'];
let last='',count=0;
async function report(){const map=document.querySelector('[data-testid="campus-map"]');if(!map||count>50)return;const state=Object.fromEntries(keys.filter(k=>k in map.dataset).map(k=>[k,map.dataset[k]]));state.failures=failures;const signature=JSON.stringify(state);if(signature===last)return;last=signature;count++;const resources=performance.getEntriesByType('resource').filter(r=>/\\/(maps|models|vendor|_next)\\//.test(r.name));await fetch('/__map_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({at:new Date().toISOString(),agent:navigator.userAgent,viewport:[innerWidth,innerHeight,devicePixelRatio],state,resources:resources.map(r=>({path:new URL(r.name).pathname,ms:Math.round(r.duration),bytes:r.transferSize,status:r.responseStatus}))})}).catch(()=>{});}
const timer=setInterval(report,3000);setTimeout(()=>clearInterval(timer),600000);addEventListener('pagehide',()=>clearInterval(timer));report();
})();`;
