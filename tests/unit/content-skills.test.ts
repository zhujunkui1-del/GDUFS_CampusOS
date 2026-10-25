import {it,expect} from 'vitest';
import {analyzeArticle} from '@/lib/ingestion/article-analysis';
import {registrationState} from '@/lib/retrieval/registration-state';
import {contentIntent} from '@/lib/server/assistant/content-intent';
import {articleMapPlace,registerContentSkills} from '@/lib/server/retrieval/skills';
import {SkillRegistry} from '@/lib/server/agent/skill-registry';
import {sqliteD1} from '../fixtures/sqlite-d1';
const now='2026-10-25T12:00:00+08:00';
function activity(body:string){return analyzeArticle({title:'校园讲座报名通知',body,publishedAt:'2026-10-01'}).activities[0];}
it('a future cutoff without a start never proves open registration',()=>{expect(registrationState(activity('报名截止2026年10月30日17:00。'),now)).toBe('unknown');});
it('explicit full window can prove open registration',()=>{expect(registrationState(activity('报名时间：2026年10月1日10:00至2026年10月30日17:00。'),now)).toBe('open');});
it('expired registration is closed; publication is irrelevant',()=>{expect(registrationState(activity('报名截止2026年10月20日17:00。'),now)).toBe('closed');});
it('future start, capacity and no-registration remain separate',()=>{
 expect(registrationState(activity('报名时间：2026年11月1日10:00至2026年11月3日17:00。'),now)).toBe('not_started');
 expect(registrationState(activity('即日起报名，额满即止。'),now)).toBe('capacity_unknown');
 expect(registrationState(activity('无需预约，直接到场。讲座时间2026年11月1日。'),now)).toBe('not_required');
});
it('date precision on the cutoff day does not invent 23:59',()=>{expect(registrationState(activity('报名时间：10月1日至10月25日。'),now)).toBe('unknown');});
it('knowledge, events, mixed and contextual follow-ups route without redefining classification',()=>{
 expect(contentIntent('广外图书馆怎么借书？').tools).toEqual(['search_campus_knowledge']);
 expect(contentIntent('最近有哪些讲座和竞赛？').tools).toEqual(['search_campus_events']);
 expect(contentIntent('奖学金申请需要满足什么条件，现在还有开放申请吗？').tools).toEqual(['search_campus_knowledge','search_campus_events']);
 const follow=contentIntent('那需要准备什么材料？',[{id:'1',role:'user',text:'奖学金申请条件是什么？',cards:[]}]);
 expect(follow.query).toContain('奖学金');
 expect(contentIntent('从南苑7栋去图书馆').active).toBe(false);
});
it('ambiguous/out-of-campus article places cannot invent map entities',()=>{
 expect(articleMapPlace('白云山校区图书馆')).toBeNull();expect(articleMapPlace('图书馆')).toBeNull();
 expect(articleMapPlace('大学城校区图书馆')).toMatchObject({name:'图书馆',precision:'building'});
});
it('both real content Skills register on the existing registry',()=>{
 const f=sqliteD1();try{const registry=registerContentSkills(new SkillRegistry(),f.db);expect(registry.manifest().map(s=>s.name)).toEqual(['search_campus_knowledge','search_campus_events']);}finally{f.close();}
});
