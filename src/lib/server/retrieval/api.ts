import {getCloudflareContext} from '@opennextjs/cloudflare';
import {z} from 'zod';
import {withApi} from '../http';
import {ApiError} from '../errors';
import {primaryDatabase,type SqlDatabase} from '../assistant/database';
import {searchContent} from './skills';
export const contentSearch=withApi(async(request)=>{
 const env=getCloudflareContext().env as unknown as Record<string,unknown>;
 if(!env.DB)throw new ApiError('SERVICE_UNAVAILABLE','检索服务暂不可用。');
 const limiter=env.MAP_RATE_LIMITER as {limit(v:{key:string}):Promise<{success:boolean}>}|undefined;
 if(limiter&&!(await limiter.limit({key:'content-search:'+(request.headers.get('CF-Connecting-IP')||'local')})).success)throw new ApiError('RATE_LIMITED','检索请求较多，请稍后重试。');
 const raw:Record<string,unknown>=Object.fromEntries(new URL(request.url).searchParams);
 const purpose=z.enum(['knowledge','events']).parse(raw.purpose||'knowledge');delete raw.purpose;
 if(raw.limit!==undefined)raw.limit=z.coerce.number().int().min(1).max(6).parse(raw.limit);
 if(raw.sourceTypes!==undefined)raw.sourceTypes=String(raw.sourceTypes).split(',');
 return searchContent(primaryDatabase(env.DB as SqlDatabase),purpose,raw as {query:string});
});
