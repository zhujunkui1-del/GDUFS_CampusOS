# CampusOS 工程规则入口

修改代码前，阅读 `CampusOS_Codex_完整设计文档_v2/AGENTS.md` 与 `CampusOS_Codex_完整设计文档_v2/00_README_项目索引.md`；修改某一业务模块时完整阅读该模块设计。该目录中的 v2 文档是需求基线，长期约束以其中的 `AGENTS.md` 为准。

知识检索、提取和索引以 D1 为唯一事实源。D-140 已授权校内 Dify 外部知识库只读试点，仅调用现有 D1 检索，不复制文章库或新增向量索引；D-045 保留为历史决定。适配器与共享 Worker 发布状态见 docs/DECISIONS.md、docs/PROGRESS.md；S3-D 实施及验收见 docs/S3_D_RETRIEVAL_PLAN.md。

实施阶段、验收和优先级参照 `CampusOS_Codex_完整设计文档_v2/09_DEVELOPMENT_PLAN.md`。重大范围、地图供应商、收费或学校系统接入变化须按基线交由负责人确认。

每个里程碑记录实际运行、数据来源、测试和仍缺少的依赖于 `docs/PROGRESS.md`；决策、来源和阻塞分别记录于 `docs/DECISIONS.md`、`docs/DATA_SOURCES.md`、`docs/BLOCKERS.md`。只有真实接口、数据和 UI 已验证的功能才可记为可用。

参考图片保留在文档包内。正式资源只放入 `public/` 中已经通过来源与许可审核的文件；隔离测试夹具保留在 `tests/`。
