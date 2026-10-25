# S3-D 实施与验收记录

## D1：统一检索底层

2026-10-25 开始，2026-10-26 续做。开始代码为上一轮未完成实现 `22c2123`；断点是 Preview 公开资格组合 SQL 的 `Expression tree is too large (maximum depth 100)`。已用有界 MATERIALIZED 许可/版本投影及相关主键公开校验修复，保留原门禁；不删除校验来规避错误。

### 实际数据与迁移

Preview 数据库 `campusos-preview` 已应用 0049，FTS5 虚拟表和查询已真实运行。迁移前 Time Travel bookmark 见 [备份回执](backup-bookmark.json)，未执行恢复。当前一轮快照为 **1,780 篇 / 3,776 个片段**，均 ready；主栏目仍为知识 29、雷达 944、校园资讯 807，没有重分类或补发文章。

[主体批次](backfill.json)处理 1,780 篇、其中 1,775 篇新增索引，读取 35,281 行、写入 27,945 行；此前首批 5 篇另读 3,954、写 51（首批输出见当轮工具回执）。两批合计读 39,235、写 27,996，不含迁移 DDL 和其他诊断查询。[完整重跑](repeat-index.json)处理 0 篇、修改 0、写入 **0**，只用一次状态查询读取 3,560 行，未再传输全部 HTML。首次统计公开数量另读 34,862 行，属于一次性验收，不在用户请求路径执行。

### 查询与开销

| 实测查询 | Rows read | Rows written | SQL 查询数 | 证据 |
| --- | ---: | ---: | ---: | --- |
| 图书馆借阅规则，最终原子校验 | 346 | 0 | 2 | library-search-atomic.json |
| 奖学金条件，原先双查询校验 | 1,052 | 0 | 3 | scholarship-search.json |
| 讲座/竞赛，原先双查询校验 | 1,032 | 0 | 3 | events-search.json |

最终图书馆 SQL 总执行时间 15.5935ms；维护 REST 客户端总耗时 2,037ms，包含公网网络，不能当作 Worker CPU。之前错误地直接对公开视图做 IN 过滤时一次校验读 5,499 行；当前按候选主键相关校验，不扫描所有文章 HTML。排名支持 FTS 内部 rank；EXPLAIN 记录保留在 query-plans.json。

真实命中包括图书馆公众号《新生入馆指南》、官网研究生奖学金评选通知，以及主栏目仍为 unknown 的学校《云山学术沙龙414期》。检索不因 unknown 而拒绝，也不将其重新归为雷达。来源与片段见各 JSON，正式使用范围仍由原发布/来源许可决定。

### 本地验证与限制

核心 6 项测试覆盖真实 SQLite FTS/片段、原文不变、重复维护零写、下架与版本即时失效、来源正文权限变化、仅元数据与正文去重；与内容 Skill/计时相关共 16 项已通过。Node SQLite 不能给出 D1 rows_read，测试中明确标记 usageAvailable=false；上述用量均来自远端 D1 metadata。

尚未建立独立人工标注的相关性评估集，不报告虚构 Precision/Recall。当前是有界关键词与受控词表扩展，候选数量和长文段数有限，不能保证任意口语问题的全量召回。原 13 个类别及 tags 保留，栏目文章增减 **0**。

## D2、D3：双 Skills 与真实模型

最终 [Edge 真实会话](browser/live.json) 五轮全部通过，浏览器 149.0.4022.80、1440×900，Playwright 1项通过/51.8秒，页面异常0。前四轮依次为借阅知识、讲座/竞赛、奖学金条件+当前机会、材料追问；分别实际调用 `search_campus_knowledge`、`search_campus_events`，混合与追问都调用了两类，最终有可点击来源卡片。使用现有 DeepSeek 默认服务；没有新建 Agent、向量库、付费服务或购买套餐。

最终五轮模型请求15次、实际工具调用15次，记录总 token 87,795、usageComplete 全部为 true；单轮浏览器耗时5,627—13,489ms。这里记录真实 usage，不将现有代码按2026-10-15旧价表给出的范围估计当成当前账单。首次生成失败的250,000 chargedTokens是原额度系统的保守预留，不是上游真实账单用量。

补充真实只读查询见 [additional-searches.json](additional-searches.json)：《2027届毕业生电子就业协议书签订操作指南》及毕业去向登记指南可检索；unknown的《阅启新学期》正文可作为知识参考，主栏目仍为校园资讯；招聘信息可检索。就业政策+招聘的组合自然语言问答未单独跑模型验收，不能把奖学金场景代替所有跨栏目问题。

两个Skills接口及公开查询契约见 [S3_D_RETRIEVAL_CONTRACT.md](../../S3_D_RETRIEVAL_CONTRACT.md)。原13类、专题tags、阅读HTML、校园资讯名称及“报”标记保持；本轮没有新增/改类文章，知识29、雷达944、校园资讯807。

第一次雷达生成超出既有单次输出上限，完整失败记录在 browser/attempt-1.json。随后限制答复长度、精简模型上下文并提供固定来源编号；未增大既有模型额度。各次记录保存真实模型 tokens/工具/延迟，不将失败计作通过。

## D4：地图联动状态

真实地图回执与截图在 D4 独立交付记录中追加。D2/D3代码已经接入原地图Registry与文章建筑匹配，不把接口注册本身当作地图执行验收。

## CPU 与容量边界

[最终真实 Invocation Trace](retrieval-invocations.json) 共10个HTTP200样本、异常0：5个检索GET的CPU **7—222ms**、Wall **383—532ms**；5个真实聊天POST的CPU **53—115ms**、Wall **5,403—13,279ms**。[初始两条](retrieval-invocations-initial.json)还记录过CPU377ms、43ms，不能挑低值冒充稳定性能。这不是浏览器耗时或 SQL 时间；[Cloudflare 字段说明](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/)将 CPUTimeMs 定义为毫秒。原 Wrangler tail 在 Windows 退出；改用相同现有 Trace WebSocket 后成功取样，尾随会话已删除，未保存原始日志/请求头/密钥。

样本少且包含既有 OpenNext 运行开销，不据此承诺免费套餐容量或长期稳定性。聊天 metrics 的 database.rowUsageComplete=false 表示部分原 first() 调用没有提供用量 metadata，不能将已测行数冒充整个聊天请求完整账单；每个检索 Skill 的 rows_read/rows_written 则为完整的该次查询 metadata。

最终 [只读接口样本](final-api.json)：借阅346读、竞赛995读、带实际活动日期的讲座2,055读、明确开放报名筛选1,166读、官网奖学金条件1,076读，均0写。明确开放的实例为《校园公益摄影大赛》：原文报名10月20日—27日，保留日期精度、年份推断标记和依据；未补23:59。`报`标记与这一open判断是独立的。

## 测试与工程状态

- 类型检查、修改文件ESLint、Next/OpenNext完整构建和Preview部署通过。
- 本轮三文件针对性17项通过；全仓453项，439通过、14失败。失败名称与上一轮保存的独立67bc9d4基线报告逐项相同，新增失败0，见 [unit-summary.json](unit-summary.json)。没有将全仓描述为全绿。
- 两个测试夹具适配：多类片段共用knowledge_chunks后，原解析器证据计数按index_version IS NULL统计并另验新增派生段；午夜后的门禁测试按Asia/Shanghai取当天，避免UTC日期导致假失败。没有为过旧用例恢复生产的旧删除/核验流程。
- 初始数据、迁移、边界及D1提交845345d均保留。Preview当前代码不修改Production、模型套餐、采集入口或全量分类。

## 已知限制与后续

关键词排序仍会夹杂相关但非最佳用途的文章（如就业协议查询中招聘文可能排在指南之前）；未宣称排序准确率达标。正文只返回有限片段，附件/图片没有可靠文本时保持未知。没有实时名额来源，capacity_unknown不能保证可报名。事件去重只用精确时间及地点，不冒险合并仅有日期的不同场次。

未执行全套26个场景的每一种公网组合：下架、版本、仅元数据、来源许可和精确正文去重使用隔离SQLite验证，未为测试下架真实文章。下一步应补独立相关性样本、更多政策版本冲突及就业组合问答、真实手机验收和持续资源曲线。当前交付以已记录的真实代表性链路为准。

## 复现

使用固定 Preview。`scripts/retrieval-preview.mjs status/search/explain/backfill` 负责维护与读测；公开 API 及 Skills 使用同一查询底层。`E2E_BASE_URL` 指向 Preview、`E2E_LIVE_AGENT=1` 后运行 content-retrieval-live.spec.ts；`E2E_RETRIEVAL_MAP_ONLY=1` 可单独验证 D4，避免重复模型调用。原 HTML、公众号采集、本地图、人工下架、日期窗口和白名单规则不改变。
