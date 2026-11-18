import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge'});
try {
 const page=await browser.newPage({viewport:{width:1100,height:900}});
 await page.goto((process.env.MAP_TEST_ORIGIN||'https://gdufs.zhiyuapp.site')+'/map?campus=baiyun&verify=label-anchor-'+Date.now());
 await expect(page.getByTestId('baiyun-map')).toHaveAttribute('data-status','ready',{timeout:30000});
 const read=()=>page.locator('.baiyun-map-canvas .campus-marker:not([hidden])').evaluateAll(nodes=>Object.fromEntries(nodes.map(el=>[el.getAttribute('aria-label'),el.getBoundingClientRect().x+el.getBoundingClientRect().width/2])));
 let maxSpread=0,samples=0;
 for(const [from,to] of [[510,230],[300,850],[850,330]]) {
   await page.mouse.move(from,440);await page.mouse.down();
   let before=await read();
   for(let i=1;i<=20;i++){
     await page.mouse.move(from+(to-from)*i/20,440);await page.waitForTimeout(36);
     const after=await read();
     const shifts=Object.entries(after).filter(([id])=>id in before).map(([id,x])=>x-before[id]);
     if(shifts.length>1){samples++;maxSpread=Math.max(maxSpread,Math.max(...shifts)-Math.min(...shifts));}
     before=after;
   }
   await page.mouse.up();await page.waitForTimeout(500);
 }
 console.log({samples,maxSpread});
 if(samples<10||maxSpread>2)process.exitCode=1;
}finally{await browser.close();}

