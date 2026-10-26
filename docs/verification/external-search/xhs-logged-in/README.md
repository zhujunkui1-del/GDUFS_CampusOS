# 登录后接入与真实验收｜2026-10-26

## 已实现

负责人扫码后，本机API确认loggedIn=true。原Agent/Registry的search_external_campus_info现可通过已有Preview Worker+D1短时任务，将查询交给本机的网页/小红书服务并取得真实来源。没有新建Agent、购买搜索Key/新服务、改公众号采集或部署Production。

Preview最新版本9c6f6660-df6d-40e6-97ee-f47100b884ee。0050只新增agent_external_search_jobs和两个索引，完成/取消后删除；异常遗留按过期索引分批清理。无文章库/检索索引写入，无重分类、补发、门禁或白名单变更。迁移前状态、Time Travel书签、迁移结果分别在before-migration.json、backup-bookmark.json、migration.txt；未执行整库恢复。

## 浏览器实测

- 桌面四问题曾完整通过：内部借书→不联网；官方权限表→真实广外网页；食堂体验→真实小红书正文与网页；普通JS问题→MDN。11次真实模型请求/42669个usage token，四轮6723/15221/31000/14926ms，页面错误0。版本aea83af5，证据desktop-previous-pass.json、playwright-desktop-pass.txt。
- 最新版9c6f6660手机视口验证通过：真实外部Skill返回小红书正文、原文链接及网页结果；小红书缓存命中，页面错误0。证据../experience-browser/live.json和playwright-mobile-pass.txt。CSS视口390×844、3倍像素截图，不是真实手机硬件。
- 本机真实冷查询14637ms，再请求3ms，cacheHit=true、原始retrievedAt保留；所有尝试在cache-proof.json。
- 连续冷重测仍有小红书超时及免费网页工具失败，可能降级或无法回答；最新桌面重测并非全部通过。失败保留在../browser/live.json、latest-desktop-retest.txt及search-fixed/search-two-notes等。没有以一次成功替代稳定性验收。

acceptance.json汇总真实记录。桌面通过版本与最新手机通过版本分开，未把旧版本结果冒充最新版全部冷查询全绿。

## 真实来源

官方[借阅权限表](https://lib.gdufs.edu.cn/fwzn/fwqykfsj/dzjyqxb.htm)、[借阅规则](https://lib.gdufs.edu.cn/fwzn/fwqykfsj/tsjygz.htm)、[MDN AbortSignal](https://developer.mozilla.org/zh-CN/docs/Web/API/AbortSignal)。笔记包括《广外居然还有四饭！》《广外｜饭堂和周边美食由夯到拉排名！》等，真实URL、发布时间、摘录和来源卡片在回执内。仅标题/图片不冒充已取得详细正文；经验不作校方结论，未知校区或现状不强行确认，不为外部地点生成未经核验的地图动作。

## 实现契约和边界

原query/gap/limit接口保留，先完成内部RAG，再按问题类型补充。一个新增只读Skill复用原Registry/模型，候选最多6个来源、摘录各700字。该Skill放宽为30秒，其他工具15秒、整轮90秒及调用/Token上限保留。小红书查询采用简短校名/校区/主题词，去掉冗长问句；前两篇正文并行读取，避免每次重新打开浏览器探测登录。缓存仅本机内存2分钟/32项，不缓存空结果和仅标题结果。

Runner只出站连接固定Preview；领取/回传先验证独立服务令牌，过期、错误Runner和不同的重复结果被拒绝。Cookie只在本机专用Docker，不进入D1、模型或前端。原文引用不自动成为公开文章，不改变已有人工下架、公开资格复验或原地图权限。

临时表按请求主键和owner_key查找；待领取/清理有专用索引，SQL参数化且数量有界。已取消请求不会再产生无用队列写入，没有全量文章扫描或每秒心跳写入。启动方法见[服务说明](../../../../services/external-search/README.md)。

## 资源、测试和限制

网页探针实际调用侧9读/5写/7条语句（Runner领取/回传另计），见relay-web.json；桌面成功食堂样本两个Provider调用侧42读/10写。空轮询一次实测3读/0写、两条语句，见idle-poll.json；按2秒查索引仍有读取成本。聊天原有first()计量不全，不能将部分metadata冒充完整账单。额外成本汇总见cost-summary.json。

per-api-cpu.json仅保存路由、CPU/Wall/状态/异常计数，Tail已删除，原始日志/头/Cookie未保存。真实聊天样本CPU85—110ms等；包含降级、空闲轮询，不据此保证免费容量或所有请求成功。

针对性84项通过；全仓489项/475通过/14项既有同名失败，新单元失败0。类型检查、修改文件ESLint、Next/OpenNext构建通过，见unit.json、unit-summary.json。公网测试成功与不稳定重测分列。

**两种外部搜索均依赖本机、Docker及两个Node程序持续运行。** 未设置Windows开机自启。第三方超时、登录过期或本机离线时会降级/无可用证据；不会绕过验证码或编造成功。长期在线稳定性、真实手机、平台登录过期/重启实机矩阵和多人容量仍未验收。
