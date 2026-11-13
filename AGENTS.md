# CampusOS 工程规则入口

修改代码前，阅读 `CampusOS_Codex_完整设计文档_v2/AGENTS.md` 与 `CampusOS_Codex_完整设计文档_v2/00_README_项目索引.md`；修改某一业务模块时完整阅读该模块设计。该目录中的 v2 文档是需求基线，长期约束以其中的 `AGENTS.md` 为准。

知识检索、提取和索引以 D1 为唯一事实源，网站沿用自研 Agent + 自研 RAG。D-166（2026-11-14）确定当前不再考虑 Dify，停止推进相关试点与演示；D-045、D-140、D-143 仅保留为历史决定，已有代码、配置与快照本轮不改。适配器与共享 Worker 发布状态见 docs/DECISIONS.md、docs/PROGRESS.md；S3-D 实施及验收见 docs/S3_D_RETRIEVAL_PLAN.md。

实施阶段、验收和优先级参照 `CampusOS_Codex_完整设计文档_v2/09_DEVELOPMENT_PLAN.md`。重大范围、地图供应商、收费或学校系统接入变化须按基线交由负责人确认。

每个里程碑记录实际运行、数据来源、测试和仍缺少的依赖于 `docs/PROGRESS.md`；决策、来源和阻塞分别记录于 `docs/DECISIONS.md`、`docs/DATA_SOURCES.md`、`docs/BLOCKERS.md`。只有真实接口、数据和 UI 已验证的功能才可记为可用。

参考图片保留在文档包内。正式资源只放入 `public/` 中已经通过来源与许可审核的文件；隔离测试夹具保留在 `tests/`。

避免新增无明确需求依据的防御性代码或用户解释性文案；保留 v2 `AGENTS.md` 明确要求的认证、权限、隐私、输入校验、数据完整性和可访问性保护。
