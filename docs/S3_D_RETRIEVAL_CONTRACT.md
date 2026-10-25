# S3-D 统一公开文章检索契约

## 数据与身份

复用 `knowledge_documents`、`knowledge_chunks`、`document_origins`、现有分类覆盖与公开视图。`article_search_documents`、`article_chunk_fts` 只是派生索引，不建立另一套文章或发布状态。0049 已在 Preview 应用；备份方式为迁移前读取的 D1 Time Travel bookmark，未执行恢复。

索引绑定 documentId、contentRevision、inputHash、indexVersion。片段保存清洗文本及 UTF-16 偏移，`text_basis=normalized_text`；只有标题时为 `title`。原 reading HTML、图片 CDN、来源、发布回执不变。公众号的业务版本未必具有 Console 快照，因此派生片段不伪造 snapshot_version；返回当前真实文档业务版本。片段规则为 900 字符、重叠 90、单文档最多 160 段。

两字符中文编码词项、英文词项、受控同义词扩展、FTS5/BM25 与用途特征加权共同排序。这是关键词检索，不宣称已实现向量语义检索。知识、雷达、校园资讯和混合用途均可检索，原主栏目不会因此改变，原七/六类业务标识与 tags 不变。

## 检索与权限

`KnowledgeRetriever.retrieve(query, PUBLIC_RETRIEVAL_SCOPE, limit?, signal?)` 由 `D1KeywordRetriever` 实现。支持关键词、来源渠道/ID、业务类、文章发布日期、数量过滤；事件 Skill 的活动/报名日期另用已有结构化索引，不以发布日期替代。

FTS 最多 96 个片段候选、32 个文档候选；底层最多 6 项，业务 Skills 最多 4 项、默认 3 项，单片段最多 780 字符。日期预选最多 80 个文档，避免超过 D1 的绑定参数上限；达到上限会提示缩小范围。查询不读取完整 HTML，不触发索引重建，不调用模型分类。

权限查询先用有界 `MATERIALIZED` CTE 按主键取得当前修订、来源正文许可、人工分类覆盖、墓碑状态，再关联原 `console_public_documents` 做公开复核。这个边界避免将复杂公开 UNION 与来源许可拼成超过 D1 depth=100 的表达式，也避免 `id IN` 展开整个公开集合。同一 SQL 快照完成两项检查。回答输出前再次复核文档版本及当前公开资格；地图动作发布前也复核引用。

私有、已撤回、人工下架、墓碑、来源正文许可失效、内容版本不符均不能作为正文证据。metadata_only 只返回标题元数据；片段用途按既有许可范围处理。文章按规范原文 URL 或足够长正文的精确哈希去重，保留其他已公开来源；活动跨文章去重仅在名称、精确举办时刻、原文地点同时相同时执行，不按 documentId 合并所有场次。

## 增量维护

官网/手动导入复用 `prepareContentWrite → analysisStatements`，公众号沿现有事务接入派生索引，未更换本地采集系统。正文或相关元数据修订后更新受影响文档；相同修订、哈希、版本不重写。删除片段联动删除 FTS 行；内容或用途许可改变时标记索引 stale。公开资格不复制进索引，日期门禁、白名单、来源停用及人工下架始终由当前公开视图决定，因此不需要周期性重写所有文章。

历史维护：`node scripts/retrieval-preview.mjs backfill --limit 25 [--after ID]`。只处理缺失或过期索引，按 ID 游标恢复；SQL 守卫再次核对修订。只针对固定 Preview 数据库；脚本不输出凭据或 HTML。公共请求没有维护入口。

## Skills 与展示

- `search_campus_knowledge`：返回真实片段、来源、现行/历史/失效/未知、可核验的条件/材料/步骤。未知有效性不等于永久有效。
- `search_campus_events`：覆盖原七类，返回活动、机会或公告、实际举办时间、报名窗口、其他截止日期及证据。报名状态为 open / not_started / closed / not_required / unknown / capacity_unknown；只有未来截止而无开始不证明开放，日期精度不补 23:59，额满即止不保证余位。
- `GET /api/content/search?purpose=knowledge|events&query=...`：同一只读业务实现，沿用公开限流。

两个 Skills 注册到原 SkillRegistry 与 Orchestrator，复用现有 DeepSeek、会话、额度、Tool Calling 和五项地图 Skills。混合问题分别查询两类；追问使用服务端会话主题重新检索。模型只消费本轮可核验证据，来源卡片显示实际标题、名称、发布日期、原文链接及证据；原页面布局、校园资讯名称、“报”标记与阅读 HTML 保留。

地图只匹配原文明示大学城/南校区且能唯一匹配的现有建筑 ID。建筑级匹配不声称已核验室内房间；白云山、校外、歧义和未知地点不生成目标动作。用户明确起点与文章来源终点分别核对。地图是否成功取决于浏览器实际执行回执。

## 验收入口

实际数据、失败尝试、读写/CPU、真实模型和浏览器证据见 [验收记录](verification/s3-d/README.md)。本契约不等于所有能力已经通过验收，以该记录逐项结论为准。
