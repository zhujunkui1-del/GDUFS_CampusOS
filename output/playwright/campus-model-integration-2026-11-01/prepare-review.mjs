import { readFile, writeFile } from 'node:fs/promises';
const root='D:/tlydcg/Codex_work/广外AI应用大赛';
const catalog=JSON.parse(await readFile(root+'/src/features/campus-map/data/building-model-catalog.json','utf8'));
const campus=JSON.parse(await readFile(root+'/src/features/campus-map/data/campus.json','utf8'));
const rows=catalog.entries.filter(e=>e.pickable).map(e=>({key:e.key,id:e.placeId,name:campus.places.find(p=>p.id===e.placeId).name}));
const south7=campus.places.find(p=>p.id==='osm-way-312536955');
rows.push({key:'legacy-s7',id:south7.id,name:south7.name});
for(let i=0;i<rows.length;i+=7){
 const selected=rows.slice(i,i+7);
 const code=`async (page) => {
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const map=page.getByTestId('campus-map');
 const state=()=>map.evaluate(el=>({...el.dataset}));
 const ready=()=>page.waitForFunction(()=>{const d=document.querySelector('[data-testid=campus-map]').dataset;return d.status==='ready'&&d.cameraMoving==='false'&&(!d.campusModelPending||d.campusModelPending==='0');},null,{timeout:25000});
 const mode=async(text)=>{for(let j=0;j<3&&(await page.getByTestId('map-mode-trigger').innerText())!==text;j++)await page.getByTestId('map-mode-trigger').click();await page.waitForTimeout(700);await ready();};
 const focus=async(row)=>{const close=page.getByRole('button',{name:'关闭地点详情'});if(await close.count()){await close.click();await page.locator('.place-details-frame').waitFor({state:'detached'});}const prior=Number(await map.getAttribute('data-camera-animation-count'));const s=page.getByLabel('搜索校园地点');await s.fill('');await s.fill(row.name);await page.locator('.place-result').filter({hasText:row.name}).first().click();await page.waitForFunction(prior=>{const d=document.querySelector('[data-testid=campus-map]').dataset;return Number(d.cameraAnimationCount)>prior&&d.cameraMoving==='false';},prior,{timeout:25000});await ready();};
 const results=[];
 for(const row of ${JSON.stringify(selected)}){
   const result={...row,modes:[]};
   for(const display of ['2.5D','3D']){
     await mode(display); await focus(row);
     await page.waitForFunction(({key,display,id})=>{const d=document.querySelector('[data-testid=campus-map]').dataset;return (d.campusModelSelected===id||key==='legacy-s7')&&(key==='legacy-s7'?(display==='3D'?d.modelState==='ready':d.modelVolume==='visible'):(JSON.parse(d.campusModelKeys||'[]').includes(key+':'+(display==='3D'?'3d':'2.5d'))&&d.campusModelPending==='0'));},{key:row.key,display,id:row.id},{timeout:25000});
     await page.waitForFunction(key=>{const d=document.querySelector('[data-testid=campus-map]').dataset;const b=JSON.parse((key==='legacy-s7'?d.modelExtent:d.campusSelectedModelExtent)||'null');return b&&d.cameraMoving==='false'&&b[0]>=-1&&b[1]>=-1&&b[2]<=innerWidth+1&&b[3]<=innerHeight+1;},row.key,{timeout:25000});
     const d=await state();
     const extent=JSON.parse(row.key==='legacy-s7'?d.modelExtent:d.campusSelectedModelExtent);
     const viewport=page.viewportSize();
     if(extent[0]<-1||extent[1]<-1||extent[2]>viewport.width+1||extent[3]>viewport.height+1)throw Error('Model outside viewport: '+row.key+' '+display+' '+extent);
     if(JSON.parse(d.campusModelFailed||'[]').length)throw Error('Asset failed '+d.campusModelFailed);
     result.modes.push({display,zoom:d.zoom,extent,keys:JSON.parse(d.campusModelKeys),details:d.campusModelDetails,drawCalls:d.campusModelDrawCalls,triangles:d.campusModelTriangles,selected:d.campusModelSelected,legacyAssetSha:d.modelAssetSha});
     if(display==='3D')await page.screenshot({path:row.key+'-3d.png'});
   }
   results.push(result);
 }
 await ready();const before=await state();await page.waitForTimeout(700);const after=await state();
 return {results,errors,idleFrames:[before.campusModelFrames,after.campusModelFrames],actualPhone:false};
}`;
 await writeFile(new URL('./batch-'+(i/7)+'.code.txt',import.meta.url),code);
}
console.log(rows);
