import { chromium, expect } from '@playwright/test';
const base='https://gdufs.zhiyuapp.site',id='wx-99e92fdd9954a33c51df1498a543c4047a587a9d';
const read=async route=>(await(await fetch(base+route)).json()).data;
const q=encodeURIComponent('从择校到上岸');
const [radar,knowledge,article,day,rooms]=await Promise.all([
read('/api/public/content?surface=radar&q='+q),read('/api/public/content?surface=knowledge&q='+q),read('/api/public/article?id='+id),read('/api/public/activities?after=2026-11-22&before=2026-11-22&day=2026-11-22&all=1'),read('/api/public/activities?after=2026-11-07&before=2026-11-07&day=2026-11-07&all=1')]);
expect(radar.items.find(x=>x.id===id)?.radarCategory).toBe('education_career');expect(knowledge.items.some(x=>x.id===id)).toBe(false);
expect(article.readingHtml).toContain('#广外 #朋辈成长营');expect(article.readingHtml).not.toContain('wx_topic_link');
const final=day.items.find(x=>x.sources.some(s=>s.documentId==='wx-a9fde65bf4a18d6db8ae515dd006727ad9ac2c36'));
expect(final.activity.startsAt.at).toBe('2026-11-22T14:30:00+08:00');expect(final.mapPlace.campus).toBe('baiyun');
expect(rooms.items.find(x=>x.activity.placeRaw==='C308')?.mapPlace?.name).toBe('教学楼C栋');
console.log('Public APIs verified: radar, knowledge, hashtags, final, C308');
const b=await chromium.launch({channel:'msedge'});
try {
 const p=await b.newPage();
 for(const [surface,search,title] of [['radar','从择校到上岸',/从择校到上岸/],['knowledge','联合培养',/./]]){
  await p.goto(base+'/'+surface+'?q='+encodeURIComponent(search)+'&verify='+Date.now());
  const cards=p.getByRole('button',{name:/打开文章详情/}).filter({hasText:title});
  await cards.first().click({timeout:25000});
  await expect(p.locator('.public-article-dialog-toolbar').getByRole('button',{name:'添加待办',exact:true})).toBeVisible();
 }
 console.log('Both article toolbars verified');
} finally {await b.close();}
