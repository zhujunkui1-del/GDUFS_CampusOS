# 私密反馈验收（2026-11-14）

依据负责人留言区需求及D-167实施，参考 [PKU Know主页](https://pkuknow.cn/) 和用户提供的留言区截图，仅复用交互结构，图标使用项目已有Lucide，界面沿用本站蓝白视觉；未复制第三方图片或代码。

## 功能与边界

- `/map`：搜索框右侧增加 `MessageCirclePlus` 图标，与访问量按钮并列。弹窗只有昵称、留言内容、提交和关闭；昵称空白按匿名存储和展示，无登录要求、计数器、产品字数上限或附加说明。提交成功清空表单，只显示“已提交”。手机搜索框为两枚按钮预留位置，320px无重叠。
- `/admin/feedback`：后台白名单下方增加“反馈”入口，待处理和已归档两个分区均按原提交时间从新到旧显示。待处理每条有“归档”操作，成功刷新分区。归档不删除内容，不公开内容。
- 留言单独存储，不进入知识库、雷达、活动、用户历史或公开资讯视图。不采集IP、邮箱、自动账号关联等附加信息；昵称只使用提交者主动填写的值。
- 留言正文在后台按React纯文本渲染；公开提交只返回布尔确认，不回传昵称、正文、ID或列表。既有 `withApi` 日志仅含请求ID、方法、状态和耗时，没有留言正文。

## 数据库与接口

`0069_private_feedback.sql`：新增 `project_feedback(id,nickname,content,status,submitted_at)`，状态为pending/archived，按状态/提交时间/id建索引。只增表和索引，不变更原有业务数据。

| 接口                                      | 权限                                  | 响应/动作                                  |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `POST /api/public/feedback`               | 游客/登录均可，沿用同源及JSON输入处理 | `{submitted:true}`，no-store               |
| `GET /api/public/feedback`                | 不提供                                | HTTP405，无留言                            |
| `GET /api/admin/v2/feedback`              | 既有Console管理员鉴权                 | pending/archived，原提交时间倒序，no-store |
| `POST /api/admin/v2/feedback/:id/archive` | Console管理员＋既有写入CSRF           | 更新状态，返回 `{archived:true}`           |

未提供普通用户本人读取接口或公开详情接口。新页面加入后台 `generateStaticParams`，保持既有 `dynamicParams=false` 策略。

## 已运行的验证

- TypeScript类型检查通过。Lint修正新面板Effect加载方式后通过，没有禁用规则。全量Vitest以4个worker运行：159文件、1126项通过；新增4项集成测试使用真实SQLite迁移及Console会话，覆盖匿名/昵称/超过800字提交、无内容回传、两分区倒序、归档、匿名/账号Cookie无管理权限、CSRF拒绝、空内容和跨站拒绝。
- 本地真实地图页面通过浏览器查看桌面和320px窄屏的入口及弹窗：表单和按钮完整可见、与搜索框/访问量无碰撞；物理手机键盘和触感未验收。
- 已向账户 `5328fbf5ef7ef40f7743723c2c192499` 的既有 `campusos-preview` D1（`18299abc-b38b-4494-8d12-8ab4d482c304`）应用唯一待执行迁移0069，执行成功。没有改Secret、DNS、模型设置或阿里云。
- 公开域名真实匿名POST成功，只返回submitted字段；公开GET405、未登录管理GET401，均未包含验收留言。使用现有已登录网站账号在真实主页填写昵称留言，显示“已提交”、表单清空且未出现本人留言列表。

## 发布与最终验收

最终发布版本 `c0e6a305-920e-4c84-801c-98c75ed32acc`，反馈功能发布前回滚点 `d1f00ae4-077f-47d2-a8af-43a70b1f44ef`。首轮版本 `d10c3979-c721-487d-844e-7cd6d20cbea4` 验证公开提交后，发现新页面漏入静态路由清单；已补齐 `/admin/feedback` 并重新构建发布，公开页面HTTP200。

使用现有Console登录会话点击后台“反馈”，实际显示两条测试留言：03:35:28登录用户“Codex验收”的留言在前，03:35:16匿名留言在后。依次点击两条的“归档”，分区从待处理2/已归档0变为待处理0/已归档2；刷新页面后仍保留，已归档按原提交时间倒序。只归档本轮明确标记的两条验收留言，未操作其他业务数据。前台提交后的输入框清空，只显示提交确认；刷新主页不包含测试留言正文。

最终Next生产构建含类型检查、Worker dry-run和1721个生成文件凭据净化扫描通过，Lint通过；桌面/窄屏浏览器的实际提交、后台接收、倒序和归档持久化已完成。未在物理手机运行键盘/触摸验收。公开手机弹窗截图存于 `output/playwright/feedback-live-mobile-20261114.png`。

构建沿用原Turbopack/Next、OpenNext及 `scripts/build-worker.mjs --config wrangler.jsonc --env preview`，通过最终Worker dry-run和凭据净化检查。隔离构建目录为 `.tmp/article-original-release-native-20261114`，使用既有实际依赖文件；源码、公开资源和配置逐字节核对，旧生成目录保存在忽略的 `.tmp/feedback-build-backups/`。
