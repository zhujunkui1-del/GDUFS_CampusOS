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

已有真实浏览器成功记录见 [第二次尝试](browser/attempt-2.json) 前四轮：借阅知识、讲座/竞赛、奖学金条件+当前机会、材料追问。分别实际调用 `search_campus_knowledge`、`search_campus_events`，混合与追问都调用了两类，最终有可点击来源卡片。使用现有 DeepSeek 默认服务；没有新建 Agent、向量库、付费服务或购买套餐。

第一次雷达生成超出既有单次输出上限，完整失败记录在 browser/attempt-1.json。随后限制答复长度、精简模型上下文并提供固定来源编号；未增大既有模型额度。各次记录保存真实模型 tokens/工具/延迟，不将失败计作通过。

## D4：地图联动状态

此节在真实浏览器最终回执完成后补充。已使用原文《金秋阅新｜图书馆2026秋季中文新书展活动》及真实图书馆 ID；截至本节写入，已实际执行到 search_campus_events → search_places → plan_route → control_map，但地图回执仍在排查，不能记为通过。

## CPU 与容量边界

[真实 Invocation Trace](retrieval-invocations.json) 中两个 GET `/api/content/search` 样本 HTTP200、异常0：CPU 分别 **377ms、43ms**，Wall **789ms、468ms**。这不是浏览器耗时或 SQL 时间；[Cloudflare 字段说明](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/)将 CPUTimeMs 定义为毫秒。原 Wrangler tail 在 Windows 退出；改用相同现有 Trace WebSocket 后成功取样，尾随会话已删除，未保存原始日志/请求头/密钥。

样本少且包含既有 OpenNext 运行开销，不据此承诺免费套餐容量或长期稳定性。聊天 metrics 的 database.rowUsageComplete=false 表示部分原 first() 调用没有提供用量 metadata，不能将已测行数冒充整个聊天请求完整账单；每个检索 Skill 的 rows_read/rows_written 则为完整的该次查询 metadata。

## 复现

使用固定 Preview。`scripts/retrieval-preview.mjs status/search/explain/backfill` 负责维护与读测；公开 API 及 Skills 使用同一查询底层。`E2E_BASE_URL` 指向 Preview、`E2E_LIVE_AGENT=1` 后运行 content-retrieval-live.spec.ts；`E2E_RETRIEVAL_MAP_ONLY=1` 可单独验证 D4，避免重复模型调用。原 HTML、公众号采集、本地图、人工下架、日期窗口和白名单规则不改变。
