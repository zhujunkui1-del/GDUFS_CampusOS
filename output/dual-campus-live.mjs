import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({channel:'msedge'});
const base='https://gdufs.zhiyuapp.site';
const results=[];
try{
 for(const [id,question,expected] of [
 ['clarify','图书馆在哪里？',/大学城校区还是白云山校区/],
 ['nearby','白云山图书馆附近有哪些食堂？',/直线/],
 ['compare','大学城图书馆和白云山图书馆分别在哪里？',/北校区图书馆/],
 ['cross','从大学城图书馆步行到白云山图书馆',/没有两校区之间/],
 ['mode','把白云山地图切换成3D',/只支持 2D/],
 ['place','白云山校区第二教学楼在哪里？请在地图定位。',/第二教学楼/],
 ['route','从白云山校区图书馆到第二教学楼怎么走？请显示步行路线。',/第二教学楼/],
 ['events','白云山校区这周有什么讲座？',/讲座|活动/],
 ['here','这里有什么活动？',/图书馆|活动/],
 ]){
  const page=await browser.newPage();
  let response,receipt;
  page.on('response',r=>{if(new URL(r.url()).pathname==='/api/agent/chat')response=r;});
  page.on('request',r=>{if(r.url().endsWith('/receipt'))receipt=r.postDataJSON();});
  try{
   await page.goto(base+(id==='clarify'?'/knowledge':id==='here'?'/map?campus=baiyun&place=osm-way-962936641':'/map?verify=dual-campus-'+Date.now()));
   if(id==='here') await expect(page.getByRole('dialog',{name:'北校区图书馆',exact:true})).toBeVisible({timeout:30000});
   await page.getByRole('button',{name:'打开校园助理'}).click();
   const input=page.getByLabel('向校园助理提问');
   await expect(input).toBeEnabled({timeout:20000});
   await input.fill(question);await input.press('Enter');
   await expect.poll(()=>!!response,{timeout:20000}).toBe(true);
   const out=await response.text();
   const events=out.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));
   const answer=events.filter(e=>e.type==='message.delta').map(e=>e.payload.text).join('');
   const cards=events.filter(e=>e.type==='artifact.ready').flatMap(e=>e.payload.cards||[]);
   expect(answer).toMatch(expected);
   if(id==='place'||id==='route'){
    await expect(page.getByTestId('baiyun-map')).toHaveAttribute('data-status','ready',{timeout:15000});
    expect(receipt?.ok).toBe(true);
    if(id==='route')await expect(page.getByTestId('baiyun-map')).not.toHaveAttribute('data-route-points','0');
   }
   if(id==='nearby')expect(cards.some(c=>c.kind==='place'&&c.place?.name==='文采园（一饭）')).toBe(false);
   const record={id,status:'pass',answer:answer.slice(0,1000),cards:cards.map(c=>({kind:c.kind,name:c.place?.name??c.title??c.endName})),receipt};
   results.push(record);console.log(JSON.stringify(record));
  }catch(error){const record={id,status:'fail',error:String(error).slice(0,1000),body:(await page.locator('#campus-assistant').innerText({timeout:1000}).catch(()=>'' )).slice(-650)};results.push(record);console.log(JSON.stringify(record));}
  finally{await page.close();fs.writeFileSync('output/dual-campus-live.json',JSON.stringify(results,null,2));}
 }
} finally {await browser.close();}
if(results.some(r=>r.status==='fail'))process.exitCode=1;
