# 2026-10-25 可逆文章日期门禁

负责人要求门禁只影响前台展示，后台保留全文；日期调早时相应文章无审核自动恢复，白名单不受门禁影响。该决定替代旧 D-059 的门禁永久清理行为。

## 实现

- 确认日期只更新全局门禁与展示计数版本。公开列表、正文和检索统一通过 `console_public_documents` 的当前日期窗口判断，生效不依赖浏览器完成所有批次。
- 分批处理名单、登记上下架结果和索引失效记录，每批最多 25 篇。不再写清理墓碑，不删除正文、摘要、历史载荷、片段或标签，也不改文章版本、修订、批准信息和发布回执。
- 日期调早时原已发布文章重新进入公开窗口，自动恢复；无需重新采集、重新审核或逐篇更新。管理员主动下架、来源停用等既有决定继续有效。
- 当天按北京时间保留。文章白名单、主来源白名单和关联出处来源白名单均豁免日期窗口。白名单变化会立即刷新分组计数，不等 30 秒缓存。
- 新预览区分“下架”和“恢复”数量。旧永久清理记录仍按历史事实显示；旧预览不能继续执行永久清理。0044 的数据库守卫同时阻止旧浏览器/旧 Worker 提交日期门禁的清空批次。
- 此次未替负责人选择新的线上门禁日期，现有 `2026-01-01` 保持。

## 验证

单元命令：`npx vitest run tests/unit/date-gate-visibility.test.ts tests/unit/console-v2-sync.test.ts tests/unit/console-v2-automation.test.ts tests/unit/public-feed.test.ts tests/unit/two-state-publication.test.ts tests/unit/collector-add-update-only.test.ts tests/unit/ingestion-queries.test.ts tests/unit/official-publication-date.test.ts`，共 49 项通过。

新回归覆盖正文/全部文档行/历史快照/修订载荷逐字不变、后台文章仍在、前台隐藏及恢复、无人工审核、白名单加入/移除后立即生效、按来源及关联出处豁免、北京时间边界、人工下架保持、旧清空请求被拒绝、外键完整性。修复前测试确实复现正文被清空和计数缓存不及时更新。

按钮流程命令：`node tests/integration/date-gate-visibility-ui.mjs`。实际 DateGateWorkspace 组件 + 实际 ConsoleSyncStore/API 分发 + 隔离 SQLite，使用 headless Edge，无模拟 API 响应。选择 7/1、预览并确认后，4 月文章隐藏、2 月白名单文章仍公开；改回 1/1 并确认后，4 月文章自动恢复。两次全量文章/快照/载荷序列化结果均与操作前完全相同，浏览器错误 0，人工审核命令 0。

上述上下架操作只作用于隔离测试数据，未在 Preview 更改门禁、创建测试文章或进行真实下架。证据见 [UI 回执](ui-verification.json) 及四张 preview/complete 截图。

迁移 `0044_reversible_date_gate.sql` 已成功应用 Preview，最终代码版本 `0a8ac5d1-79ae-4373-b3e5-c12c3f32d055`。类型检查、修改文件 ESLint、完整 Next/OpenNext 构建、Wrangler dry-run 均通过。

线上只读复核：日期仍为 `2026-01-01`、设置版本仍为 14；两个视图及旧清空阻断触发器均存在。后台 1,756 篇，实际前台雷达 1,718 + 知识 38 = 1,756；健康和正文 API 均 HTTP 200，已修正日期的正文仍为 2,067 字符。本次复核数据库读取 2,082 行、写入 0 行。见 [部署回执](preview-rollout.json) 和 [前台 API](public-api.json)。

历史上已经被旧逻辑清空的载荷不会被数据库结构迁移伪造恢复；新的门禁操作保留当前实际内容。旧永久清理记录与墓碑保留历史事实。
