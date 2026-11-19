import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const audit=JSON.parse(fs.readFileSync('output/agent-50-calendar-source-audit.json','utf8'));
const browser=await chromium.launch({channel:'msedge'});
const observed=[];
try{
 for(const id of ['T26','T47']){
  const row=audit.find(x=>x.id===id);
  const item=row.items[0];
  const page=await browser.newPage();
  try{
   await page.goto('https://gdufs.zhiyuapp.site'+item.url,{waitUntil:'domcontentloaded',timeout:35000});
   await expect(page.locator('.public-calendar')).toBeVisible({timeout:15000});
   await expect(page.locator('.public-article-dialog').getByRole('link',{name:'查看原文'})).toBeVisible({timeout:20000});
   const original=await page.locator('.public-article-dialog').getByRole('link',{name:'查看原文'}).getAttribute('href');
   expect(original).toBe(item.source);
   observed.push({id,title:item.title,calendarUrl:item.url,original,verified:true});
  }catch(error){observed.push({id,verified:false,error:String(error).slice(0,500)});}
  finally{await page.close();}
 }
}finally{await browser.close()}
console.log(JSON.stringify(observed));fs.writeFileSync('output/agent-50-public-source-browser.json',JSON.stringify(observed,null,2));
