# 我的收藏验收（2026-11-03）

## 范围

- 校园雷达、校园知识、活动日历三个入口收藏同一篇文章。
- 我的收藏页：来源筛选、收藏时间倒序、分页、打开原文、取消、失效保留。
- 未登录引导、账号隔离、刷新持久、桌面/手机布局。

## 设计

- 文章身份统一 `knowledge_documents.id`；`user_article_favorites` 唯一 `(user_id, article_id)`。
- `console_public_documents` 决定 `available`；`reading_html + licensed_full_text` 决定 `readable`。
- 失效文章不删除收藏关系，列表保留但不可打开。
- 写接口要求 S4 会话、Origin 校验、用户归属和限流；DELETE 不读取 body。

## 自动化

- `tests/unit/article-favorites.test.ts`：6/6。
- `tests/unit/personal-model-settings.test.ts`：24/24（DELETE 空 body 回归）。
- 全量（排除本轮前既有的未提交 `assistant-quality-regressions.test.ts`）：891/891。
- `tsc`、eslint、`npm run build`：通过。
- `tests/e2e/favorites-preview.spec.ts`（S4_LIVE=1）：桌面流程通过；移动游客布局通过。

## 真实 Preview

- 部署 `a4ae2f71-2e75-4157-85db-7acb11c8790c`，迁移 0062 已应用。
- 雷达收藏 → 我的收藏出现一条 → 来源筛选 → 打开弹窗 → 取消 → 列表为空。
- 390×844 与 320px：`scrollWidth - innerWidth <= 1`。
- 刷新后收藏保留；账号 B 看不到账号 A 的收藏。

## 已知限制

- 收藏状态批量接口在页面初次挂载时可能先出现一次 500，随后重试成功；不影响按钮与列表最终状态，但服务端错误日志仍需单独清理。
- 收藏列表只保留最近 20 条分页，未提供搜索/批量管理。
- Preview 与正式域名共用 Worker/D1；本轮未单独部署 Production。
