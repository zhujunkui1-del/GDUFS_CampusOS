import ast, hashlib, json, pathlib, re, subprocess, time
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from typing import Annotated, List, Dict
from urllib.parse import quote
from urllib.robotparser import RobotFileParser
from unittest.mock import patch
import html as html_lib
import requests
from bs4 import BeautifulSoup
from lxml import html
root=pathlib.Path.cwd()
base=root/'CampusOS_Codex_完整设计文档_v2'
paths={
 'search':base/'weixin_search_mcp-main/weixin_search_mcp/tools/weixin_search.py',
 'blog':base/'wechat-article-exporter-main/wechat-article-exporter-main/backend/app/scrapers/custom_urls.py',
 'rssContent':base/'we-mp-rss-main/we-mp-rss-main/core/article_content.py',
 'rssParser':base/'we-mp-rss-main/we-mp-rss-main/core/wx/model/weread_mp.py',
 'blogLicense':base/'wechat-article-exporter-main/wechat-article-exporter-main/LICENSE',
 'rssLicense':base/'we-mp-rss-main/we-mp-rss-main/LICENSE',
 'searchProject':base/'weixin_search_mcp-main/pyproject.toml',
}
start={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in paths.items()}
out={'checkedAt':datetime.now(timezone.utc).isoformat(),'scope':'Isolated metadata-only policy probes and offline synthetic fixtures; no account login, cookies, model calls, article collection or production data write','policyProbes':[],'localFiles':[],'offlineChecks':[]}
for host, targets in [('weixin.sogou.com',['https://weixin.sogou.com/weixin?type=2&query=CampusOS']),('mp.weixin.qq.com',['https://mp.weixin.qq.com/s/example'])]:
 url=f'https://{host}/robots.txt'
 ts=time.perf_counter()
 result=subprocess.run(['curl.exe','--silent','--show-error','--max-time','15','--max-filesize','32768','--user-agent','CampusOS-S3B-PolicyCheck/1.0','--write-out','\nCAMPUSOS_STATUS:%{http_code}',url],capture_output=True)
 body,_,status=result.stdout.rpartition(b'\nCAMPUSOS_STATUS:')
 text=body.decode('utf-8','replace')
 rp=RobotFileParser();rp.parse(text.splitlines())
 out['policyProbes'].append({'url':url,'httpStatus':int(status or 0),'curlExitCode':result.returncode,'elapsedMs':round((time.perf_counter()-ts)*1000,1),'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'defaultDisallowAll':bool(re.search(r'User-agent:\s*\*\s*\r?\n(?:[^\n]*\n)*?Disallow:\s*/\s*(?:\r?\n|$)',text,re.I)),'targetDecisions':[{'url':t,'allowed':rp.can_fetch('CampusOS-S3B-PolicyCheck',t)} for t in targets],'action':'stop before search/article requests' if any(not rp.can_fetch('CampusOS-S3B-PolicyCheck',t) for t in targets) else 'requires terms review before article request'})
def extract(key,names,env):
 source=paths[key].read_text(encoding='utf-8-sig'); tree=ast.parse(source)
 keep=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
 exec(compile(ast.Module(body=keep,type_ignores=[]),str(paths[key]),'exec'),env)
 return env
checks=out['offlineChecks']
def check(project,name,test,kind='supported'):
 ts=time.perf_counter();ok=bool(test());checks.append({'project':project,'name':name,'kind':kind,'passed':ok,'elapsedMs':round((time.perf_counter()-ts)*1000,3),'fixture':'synthetic, not a real campus article'})
s=extract('search',{'_is_antispider_response','sogou_weixin_search'},{'Annotated':Annotated,'List':List,'Dict':Dict,'requests':requests,'html':html,'quote':quote,'REQUEST_TIMEOUT':15,'get_real_url_from_sogou':lambda _:''})
blocked=SimpleNamespace(status_code=200,url='https://weixin.sogou.com/antispider/',text='<html>anti.min.css</html>')
check('weixin_search_mcp','anti-spider detector',lambda:s['_is_antispider_response'](blocked))
with patch.object(requests,'get',return_value=blocked):
 check('weixin_search_mcp','default search silently returns empty on block',lambda:s['sogou_weixin_search']('synthetic-fixture')==[],kind='limitation reproduced')
 def strict_raises():
  try:s['sogou_weixin_search']('synthetic-fixture',strict=True)
  except RuntimeError:return True
  return False
 check('weixin_search_mcp','strict mode reports block',strict_raises)
fixture='<li id="sogou_vr_11002601_box_0"><a id="sogou_vr_11002601_title_0" href="/link?url=synthetic">Synthetic</a><div class="txt-box"><div class="s-p"><span class="s2"><script>document.write(timeConvert(\'1788797730\'))</script></span></div></div></li>'
with patch.object(requests,'get',return_value=SimpleNamespace(status_code=200,url='https://weixin.sogou.com/weixin',text=fixture)):
 check('weixin_search_mcp','publication time remains executable script text',lambda:'document.write' in s['sogou_weixin_search']('synthetic-fixture')[0]['publish_time'],kind='limitation reproduced')
b=extract('blog',{'dedupe_wechat_title','parse_wechat_page_meta'},{'Dict':Dict,'re':re,'html_lib':html_lib,'BeautifulSoup':BeautifulSoup,'datetime':datetime,'timezone':timezone,'timedelta':timedelta})
check('BlogDistiller','empty metadata remains unknown',lambda:b['parse_wechat_page_meta']('<html></html>')=={})
check('BlogDistiller','metadata date converted to UTC+8',lambda:b['parse_wechat_page_meta']("<meta property='og:title' content='Synthetic'><a id='js_name'>Fixture Account</a><script>var ct='1788797730';</script>").get('publish_time')=='2026-09-08 00:15')
check('BlogDistiller','duplicated title normalized',lambda:b['dedupe_wechat_title']('Fixture Fixture')=='Fixture')
r=extract('rssContent',{'is_usable_article_content'},{})
check('WeRSS','verification shell rejected',lambda:not r['is_usable_article_content']('<p>当前环境异常，完成验证后即可继续访问</p>'))
p=extract('rssParser',{'WereadMPAPIError','extract_mp_content'},{'BeautifulSoup':BeautifulSoup})
check('WeRSS','traditional body extracted with scripts removed',lambda:p['extract_mp_content']('<div id="js_content"><p>Synthetic</p><script>ignore</script></div>')=='<p>Synthetic</p>')
def new_shell_rejected():
 try:p['extract_mp_content']("<script>var content_noencode='synthetic body';</script>")
 except p['WereadMPAPIError'] as e:return e.code=='invalid_content'
 return False
check('WeRSS','JS-only new shell unsupported',new_shell_rejected,kind='limitation reproduced')
for k,pth in paths.items():
 end=hashlib.sha256(pth.read_bytes()).hexdigest()
 out['localFiles'].append({'name':k,'path':pth.relative_to(root).as_posix(),'sha256Before':start[k],'sha256After':end,'unchanged':end==start[k]})
out['articleMetrics']={'targets':['广东外语外贸大学','广外青年','广外图书馆'],'maxPerTarget':10,'searchRequests':0,'articleRequests':0,'discoveredArticles':0,'verifiedPublisherArticles':0,'discoveryRecall':None,'correctUrlRatio':{'numerator':0,'denominator':0,'value':None},'bodyCompletenessRatio':{'numerator':0,'denominator':0,'value':None},'articleErrorRate':None,'reason':'robots default denies search and article paths; no bypass, login or cookies attempted; 0/0 means untested, not zero success rate'}
(root/'docs/verification/s3-b/wechat/local-poc.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'policyProbes':out['policyProbes'],'checksPassed':sum(x['passed'] for x in checks),'checksTotal':len(checks),'originalFilesUnchanged':all(x['unchanged'] for x in out['localFiles']),'articleMetrics':out['articleMetrics']},ensure_ascii=False,indent=2))
