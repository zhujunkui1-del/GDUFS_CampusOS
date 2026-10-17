# S3-B｜兼容修复、官网采集与审核流水线验收

> 2026-10-17 D-045更新：本文件保留历史验收/研究事实；其中Dify可选接入、未来任务及依赖已正式废弃。当前使用自研Agent + 自研RAG + D1，见 [决策](DECISIONS.md)。

日期：2026-10-17。基线`256651b`；复用S3-A `7d0f9eb`。本轮按负责人新指令先兼容检查，再推进S3-B；未进入S3-C。

**结论：受控、人工启动的官网元数据链路已真实运行。3源、3篇唯一元数据待审、1次304去重，审核批准/公开发布均0。未取得全文许可，未持久化官网正文/图片，不把正文文本非空当完整提取。微信自动采集受robots阻塞，Dify仅完成学校入口只读确认。**

## 1. 兼容性裁决与实际实现

完整分级见[兼容性清单](S3_B_COMPATIBILITY.md)。采集前必须修复的四项均已实施：

| 项目     | 当前行为                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 时间     | 原`published_at`支持原始日期/含时区时刻，未知NULL；`fetched_at`只在首次登记/真实内容重新获取时写，人工编辑/恢复不刷新；新增`source_updated_at`和`updated_at`；304只记检查，不冒充重新获取。日期型后台输入保持date，不补造08:00或23:59 |
| 两种版本 | 保留`console_content_versions(document_id,version)`与原snapshot_json。`version`用于CAS/审批，`content_revision/input_hash`绑定内容输入；批准记录绑定当前修订，审核/发布不改变修订。原文变动或解析输入变化回待审，恢复旧版不恢复旧批准 |
| 公开门禁 | 沿用fresh view、filterPublicContent和outbox；加入当前批准修订、rights_scope、workflow及来源authorization检查。metadata-only可经审核后用于元数据展示，默认RAG/全文用途过滤拒绝；未知许可/分类禁止发布。此轮没有批准真实文章            |
| 分类     | UI/Schema直接读取冻结7/6分类JSON；两种固定投影分别用受控列并保存在版本快照，不用candidate_kind充当主分类。未知NULL。辅助主题独立document_tags，来源/机构/校区/状态不放入tags；当前提供六个受控主题，不增一级分类                      |

旧记录不伪造哈希或许可，不改原审批/来源人工状态；默认修订0/hash NULL/rights unknown，不再凭历史批准自动公开。另有旧应用写入保护：旧版本代码修改已批准新文档却未维护hash时，数据库原子使批准失效并递增内容修订；回滚旧应用不能重新发布这类内容。

## 2. 数据库、权限与回滚

复用45表及原DAO/Console身份/CSRF/命令/CAS/事务审计/版本/outbox；增量至**53业务表**。新增采集政策、任务阶段、出处、获取观察、附件元数据、事件候选、字段证据和辅助主题；没有第二套后台/审核/会话库。

| 迁移 | 作用                                                              | 状态                  |
| ---- | ----------------------------------------------------------------- | --------------------- |
| 0007 | 四时间/内容版本、许可与分类、快照元数据、公开门禁                 | 本地和既有preview通过 |
| 0008 | 原任务扩展、来源采集政策、出处/观察/事件候选/证据、租约与受控命令 | 本地和preview通过     |
| 0009 | 毫秒租约边界、采集政策仅admin、来源authorization单独变更失效      | 本地和preview通过     |
| 0010 | 辅助主题与旧应用写入失效保护                                      | 本地和preview通过     |
| 0011 | 按领取审计时间核算跨日预算，保持全局额度与幂等                    | 本地和preview通过     |

没有DROP TABLE、清空/重建D1、重新导入220来源或回写候选核验状态。仅替换本模块的派生公开视图/命令触发器；测试先于远程执行并核对每份SHA、账户命名空间、既有库名和UUID。首两批迁移前后220来源、0文档/任务和75对话/330消息/192Run保持一致；0011前后3文档/4任务同样保持，外键0错误。[本地空库/有历史升级/失败批次回滚](verification/s3-b/database-tests.json)、[0007–0009预览](verification/s3-b/preview-migration-0007-0009.json)、[0010预览](verification/s3-b/preview-migration-0010.json)、[0011预览](verification/s3-b/preview-migration.json)。

应用回滚保留新增结构与保护；旧客户端仍可写草稿，不能绕过新版本审批元数据。禁止通过恢复旧公开视图、删表/删库来“回滚”。旧快照不改写；后续有危险表重建/丢数风险仍须另行批准。

迁移SHA按UTF-8、LF和一个末尾换行规范化，避免Windows/Git换行转换误报。最终只整理了这些新迁移的换行，未重放已应用DDL；云端预算guard与源码规范化SQL逐字核对通过（deployedGuardMatchesSource=true）。

所有新增管理读写沿用服务端身份/最小角色、Origin/CSRF、no-store、D1会话撤销与事务guard。采集政策仅admin批准；游客无读写权，operator不能冒充管理员改变政策。任务租约哈希绑定真实admin+随机票据，fence/来源版本/政策版本/有效期在提交批次中重验。客户端/模型不能自报verified或绕过权限。原Student Agent、地图、导航、多会话/配额没有改动。

## 3. Connector与受控执行

`src/lib/ingestion/{profiles,connector,safe-fetch}.ts`提供5站独立规则、发现/获取/解析/归一化/验证/检查点/报告职责。完整学校核验见[官网研究](research/s3-b/official-source-audit.md)。5站各robots/主页/栏目/详情一次，总20次只读研究；主页/栏目/详情200，robots404。404不是全文授权。正式入库只逐一启用学工、后勤和图书馆的精确栏目，另外2站保留候选。

执行器为[ingest-web.mjs](../scripts/ingest-web.mjs)，默认dry-run无网络；显式`--run`才操作。HTML与正文处理在本地Node执行，Worker API只处理有限、已验证的元数据/结果，不把批量HTML、LLM或Python塞进HTTP/Cron/waitUntil。本轮无Cron/队列、没有全天候自动更新。

- 每站/每执行器请求间隔至少10秒；精确HTTPS host+栏目/详情路径、无任意URL、无重定向、DNS公共地址校验和连接IP固定。对Cloudflare使用负责人提供的本机代理仅限当前命令；官网请求使用独立直连Agent保持IP固定，不改系统设置。
- 响应上限512KiB、正文50000字符、DNS10秒/请求15秒超时、MIME/编码检查；脚本/隐藏区/控件去除，正文容器内附件只取元数据，不下载图片/附件，不执行脚本。表格嵌套正文清洗有独立测试，不按全页首日期猜发布日期。
- 每任务1–2篇、最多3个已发现的列表页；优先未见URL，不被置顶旧文阻挡，`--revalidate`专门检查已知URL。分页仅跟随已验证的同站链接，未验证栏目不猜页码。
- D1原`ingestion_jobs`增加checkpoint、phase、control_state、120秒租约/fence、source/policy版本；单站不能同时持有两份租约；暂停/取消撤销租约，迟到提交失败。Worker重启不持有任务状态，执行器跨进程从D1恢复。
- 每步领取预留最多2次网络预算，站点全局20次/UTC日、10任务/日，网络预留按命令审计的领取时间统计，旧任务跨午夜恢复也计入当天；含崩溃不返还预留；这是保守额度，不是实际HTTP数。错误最多3次，退避后人工恢复；403/429/robots/重定向等暂停，不绕过；不无限自动重试。
- commit将命令/旧文档CAS检查、文章/快照、出处/观察、证据、统计、检查点和审计放同一个D1 batch。传输重试用同一commandId不重复写入或计数；其他身份不能复用命令。失败不清空旧文，不覆盖并发人工编辑。
- 同URL+相同输入/304不新建文档或提取；同URL变更保留稳定文档ID并产生待审新修订。跨URL同指纹只保留可追溯“可能重复”关系，不按相同标题自动合并年份/机构或继承批准。

实际正文只在本地内存中核对结构；当前三个政策为metadata_only。服务器拒收这些政策下的正文、摘要、活动提取和chunks。来源政策24小时到期，须重新核验；不自动放宽额度或重新启用人工暂停来源。

## 4. 提取、审核与发布边界

本轮使用**确定性规则，0模型生成调用**。按原文标题做可回看的候选分类/辅助主题；未知分类不默认公告，摘要留空而不假称AI摘要。时间/原文链接/机构有实际证据；HTTP Last-Modified只用于缓存，source_updated_at仍NULL。原文包含的个人名单、电话号码等不因页面公开而持久化。

对明确获得正文许可的输入，代码/隔离测试支持清洗文本、最多3个事件候选和3个知识片段/3附件/4主题的受控提交；事件名称/主办方/显式时间/截止/原始地点/受众/取消改期分别类型化，证据绑定文档快照与内容修订，未知NULL，核验状态始终pending。一文多活动、版本变化、知识片段与原文偏移一致性已测试；当前真实官网没有获此全文用途许可，未将这一分支记为真实正文/AI验收。

Console继续审批/退回/拒绝、发布/撤回、历史恢复与审计，新增时间/版本、正式分类/主题、许可和候选证据查看。只在本地隔离夹具验证正向发布；真实3篇均留待人工。`campus_events`和D1 `campus_places`仍0，不写伪地点、不放宽FK；大学城引用投影、公开雷达/日历及检索留S3-C/S3-D。

## 5. 真实官网 → preview D1

Worker：`campusos-preview`；D1：同名既有库。HTTPS：[CampusOS预览](https://campusos-preview.zhujunkui1.workers.dev/admin)。实际版本`21a72753-f951-4b91-9549-1390a2c7e49f`，压缩2505.00KiB，部署启动校验95ms（不是请求CPU）。无生产资源/DNS/套餐/Secrets变更。

| 指标                               |        真实云端结果 |
| ---------------------------------- | ------------------: |
| 登记来源总数 / 本轮启用并核验      |             220 / 3 |
| 其余候选、未启用                   |                 217 |
| 唯一元数据文档 / 待审              |               3 / 3 |
| 真实任务完成 / 失败                |               4 / 0 |
| 重复（真实304）                    |                   1 |
| 文本非空的内存解析样本             | 3（不是全文完整率） |
| 持久化第三方正文 / 图片 / 附件文件 |           0 / 0 / 0 |
| 审核批准 / 公开发布                |               0 / 0 |
| 已发布地图事件 / 检索片段          |               0 / 0 |
| 模型生成 / Dify API调用            |               0 / 0 |

4个列表步骤各上限记录10个链接，合计40次发现记录，含重复列表，**不是40篇入库文章**。首次3篇实际详情来自学工、后勤、图书馆；图书馆置顶文章原日期为2026-06-30，获取日期为2026-10-17，没有改成当天发布。其他两篇原日期2026-10-16（学工保留真实时分秒）。

学工任务先`--steps 1`停止在fetch检查点，再由新进程`--job`继续完成，期间没有依赖Worker内存。后勤`--revalidate`真实304，文档/快照数量不增、获取时间不冒充更新。预留16网络名额；各过程HTTP计数分开，首次学工分两进程各2请求，其余三个运行各3请求，合计13次正式执行请求；不包含前述20次研究和微信robots探测。

证据：[检查点](verification/s3-b/cloud-student-affairs-checkpoint.json)、[学工恢复](verification/s3-b/cloud-student-affairs.json)、[后勤](verification/s3-b/cloud-logistics.json)、[图书馆](verification/s3-b/cloud-library.json)、[304](verification/s3-b/cloud-logistics-incremental.json)、[最终数据库与版本](verification/s3-b/preview-after.json)。217个未选来源状态SHA前后相同，75对话/330消息/192Run保持，外键0错误；只读核对不读取学生正文/GPS。

## 6. 测试、截图与CPU

最终自动化摘要见[acceptance-results.json](verification/s3-b/acceptance-results.json)。本地与云端、Mock与真实数据分开记录：

- typecheck、lint、283项单元（37文件）、空库/升级/回滚、通用数据库约束、Next生产和OpenNext安全构建通过；1350产物文件实际凭据扫描0命中。新增HTML解析器linkedom 0.18.13仅本地/dev使用（ISC），不引入后台UI框架。
- Chrome原常规矩阵109通过/3跳过，发现2条旧S2-A静态上下文标签断言；改为当前真实面板打开/关闭与无旧标签断言后2项复测通过。文字请求语义由既有会话测试验证，未改地图/Agent代码来满足断言。Edge同一矩阵111通过/3跳过。跳过为原生窗口/移动专用等现有条件，不记为实机通过。
- 最新Workers本地Console两浏览器各4通过：核验/审核/发布/撤回/恢复、正式分类/许可、纯文本XSS、CSRF和退出。旧“空任务”断言改为与真实API返回数量核对，已有真实本地任务不再被误判为空。
- 真实HTTPS Chrome/Edge分别记录管理员登录/恢复/退出/重放、匿名与跨域拒绝、真实待审数据和日期型表单、三模式/S7资源、五项真实地图Skills。没有真实模型调用；原Agent故障/取消/多会话用明确Mock回归，不能称为本轮DeepSeek验收。
- 本地实测先保留了DNS固定回调、VSB form正文清理与秒级时间边界的失败，已修复并恢复同一检查点；本地错误记录未清空。真实cloud 4任务错误0。

实际截图位于[浏览器证据目录](verification/s3-b/browser/)，包括本地隔离夹具与带ingestion-preview前缀的真实云端待审/任务截图；不是生成图。桌面1440×900，手机视口390×844；未测真实Android/iPhone、GPS或后台弱网。

公网Chrome/Edge各8项全部通过，最终本地Console各4项通过。模型resize测试使用了旧默认输出路径，已将本轮20份证据归档到[resize目录](verification/s3-b/resize/)，并恢复S1历史文件原字节；未丢弃负责人改动。最终本地正文清洗另补了嵌套表格去重/裸文本测试；不将先前真实样本的文本长度当全文完整性证明。

### CPU与费用边界

Windows Wrangler Tail进程本轮异常退出，0逐请求样本，保留[失败结果](verification/s3-b/cloud-invocations.json)，不宣称采到单个采集API CPU。改用官方GraphQL只读指标，Schema实测说明CPU/Wall字段单位为微秒。[官方查询协议](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)

04:50–04:53:44UTC采集窗口为整个Worker、按状态聚合，28请求、0统计错误、subrequests=0；CPU P50/P95/P99=**4.031/16.752/31.231ms**，Wall P50/P95=185.918/723.253ms。包含认证/管理等多个API，不是采集API独立样本；D1内部查询数不能由subrequests=0推断。[原始聚合及单位](verification/s3-b/cloud-metrics-collection-window.json)

**P95仍超过Free 10ms目标，短窗零错误不能解除长期容量风险。**没有为此重开地图/Agent架构专项或购买Paid；重处理继续在本地，云端仅手动、小批次，自动定时/长期容量不记通过。内存、逐API CPU/D1读写/多地域未可靠测量时明确未验证，不以客户端API耗时或本地SQL时间替代。

包含后续浏览器回归的扩大窗口04:50–05:06:30UTC为863个success和7个clientDisconnected（非模型异常的页面请求取消），统计errors仍0。success组CPU P50/P95=3.219/14.842ms；这是不同混合负载，不能称作优化前后提升，也不能作为单个采集API达标证据。[扩大窗口](verification/s3-b/cloud-metrics.json)

模型Token/新增模型消费均0，未充值/提额/升级/创建付费产品；不把本账户其他应用用量当本轮可用配额。npm审计5项high仍为原版本的ESLint依赖链，未强制升级；与新解析器无关，详见[依赖对比](verification/s3-b/dependency-audit.json)。

## 7. 微信与学校Dify

[微信独立实验报告](S3_B_WECHAT_POC.md)：3仓库README/许可/最新提交/开放问题和PR已核查，10项离线检查（含3项已知局限复现）；搜索和微信robots阻止相关路径，停止实际文章采集。3工具×3账号的发现率/URL正确率/正文完整率均0/0未测，不能写0%/100%；0篇文章、0发布，无Cookie/风控绕行。BlogDistiller许可及作者授权门槛单列，未正式集成。

负责人随后提供`http://172.17.1.46/`学校比赛Dify，Edge只读确认登录、界面1.17.1与Knowledge/API入口。没有读Key/上传文章/调用模型；CampusOS没有实际Dify适配实现，HTTP校内入口不直接暴露给Cloudflare或通用抓取白名单。后续仍需确认API作用域、学校数据授权/成本、安全传输和云端可达性，**不阻塞本轮采集**。[只读核查](research/s3-b/school-dify-readiness.md)

## 8. 复现与后续门槛

```powershell
node tests/integration/ingestion-upgrade.mjs
node scripts/ingest-web.mjs # dry-run，不发请求
# 管理员凭据由既有忽略文件读取，不放命令行、URL、报告。
node scripts/ingest-web.mjs --run --source GDUFS-SRC-0010 --approve-metadata --steps 1 --base https://campusos-preview.zhujunkui1.workers.dev --report test-results/checkpoint.json
node scripts/ingest-web.mjs --run --source GDUFS-SRC-0010 --job <后台实际任务ID> --base https://campusos-preview.zhujunkui1.workers.dev --report test-results/resumed.json
node scripts/ingest-web.mjs --run --source GDUFS-SRC-0017 --revalidate --base https://campusos-preview.zhujunkui1.workers.dev --report test-results/conditional.json
```

不要重复导入/seed既有220来源，不重置网络/登录/模型额度。需要下一批文章时先核验政策有效期与剩余额度；新命令不自动消费旧模型预算。生产DNS/资源仍需另批，正文/附件许可、微信访问条件、Dify API和持续采集载体/Free容量仍是独立依赖。

本轮完成后停止。S3-C公开雷达、S3-D检索与Dify、S3-E新Agent Skills未实施；正式用户内容发布由负责人逐篇审核决定。
