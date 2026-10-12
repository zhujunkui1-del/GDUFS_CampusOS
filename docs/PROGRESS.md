# 开发进度

更新时间：2026-10-12（Asia/Shanghai）

状态：**S0 本地工程基线完成并验证；线上部署及 S1 真实地图数据尚未接入。**

## 范围与批准记录

负责人已确认初始化方案并允许联网/浏览器验证，指定项目域名 `gdufs.ccwu.cc`。需求以 v2 文档包为准：只定位大学城教学区、生活区和经核验的连接道路/隧道；响应式 Web；单总控 Agent、4 领域模块、16 Skill；账号/游客模式；P2 学校接口与社交保持后续阶段。

## S0 已交付

- 本地 Git `main`；根级规则入口指向原 v2 基线。原始地图/视觉附件保留本地，被 Git 忽略，未复制到 `public/`。
- Next.js 16.3.8 + React 19.3.0 + TypeScript 5.9.3；OpenNext 1.20.10 / Wrangler 4.149.0；锁文件、ESLint/Prettier/Vitest/Playwright、环境模板和 local/preview/production 配置。
- 六个页面入口和共享蓝白 UI Shell；桌面侧栏/AI 面板，手机五项导航/半屏及全屏抽屉。跨页面保留面板状态，支持实际拖动、Escape 关闭和焦点恢复；公共页面无需登录。
- `/api/health`、`/api/capabilities`、`/api/me`；统一结果/错误码、服务端 requestId、日志字段白名单、环境配置校验及权限检查原语。未接入认证前所有请求以游客处理；伪造 userId/Cookie 不建立身份。
- MapAdapter/MapAction/SkillDefinition 合约；没有注册真实地图 SDK、路线算法或模型工具。地图与助理显示数据/服务尚未接入，搜索与发送按钮不可触发假结果。
- 3 份 D1 迁移、30 张空业务表；来源许可/核验、私人归属、路径端点、活动校区及路线几何约束。测试坐标仅在内存数据库夹具中存在。
- README、本架构/决策/阻塞/数据来源和部署/回滚说明。缺账户或仍为占位 D1 ID 时，部署脚本在任何构建/上传前拒绝执行。

## 验证证据

| 检查                                     | 结果                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run typecheck`                      | 通过；先生成 Next 路由类型，再执行 TypeScript 严格检查                                  |
| `npm run lint`                           | 通过，无 warning                                                                        |
| `npm run format:check`                   | 通过                                                                                    |
| `npm run test`                           | 6 个单元测试通过，覆盖会话/管理员/本人隔离、异常脱敏和 MapAction 白名单                 |
| `npm run db:verify`                      | 30 张初始表为空；内存 SQLite 的许可、图节点、私人归属、校区、缺失路线几何和外键约束通过 |
| `npm run db:migrate:local`               | 3 份迁移已应用到本地 D1，未操作云数据库                                                 |
| `npm run build` / `npm run build:worker` | Next.js 生产构建和 OpenNext Worker 打包通过                                             |
| Workers `/api/health`、页面/API E2E      | 真请求成功；6 个 E2E 全部通过，桌面 1440×900、手机 390×844，使用本机 Edge Chromium      |
| `npm audit --omit=dev`                   | 0 vulnerabilities；完整审计仍有 5 项开发工具告警，见 BLOCKERS B-014                     |
| 未配置账户时 `npm run deploy:preview`    | 预期拒绝，退出码 1；没有创建云资源或上传                                                |

当前可访问本地 Workers 页面：`http://127.0.0.1:8787/map`。验收截图：[桌面](evidence/s0-desktop.png)、[手机](evidence/s0-mobile.png)。截图来自真实本地页面，仅证明 S0 Shell 状态，不代表地图/Agent 已接入。

## 兼容性与实际限制

Next.js 16.4.0 虽可在 Node 构建/浏览，却在 Workers 因 `preview-props.json` 清单变化返回 500；最终固定 Next.js 16.3.8 + OpenNext 1.20.10 后，真实 Worker 页面/API/E2E 通过。未采用 vinext。升级须重新验证运行时；构建成功本身不能代替页面请求成功。

OpenNext 提示 Windows 兼容性有限。本次最终组合在 Windows 实测成功，不据此承诺其他版本/生产环境。Playwright Chromium 下载因网络超时失败，使用已安装的 Edge 完成测试；没有验证 iOS/Safari 或手机实机 FPS。

`gdufs.ccwu.cc` 已登记到项目 URL/production 配置。本机 A/AAAA 查询只返回 SOA，HTTPS 请求未成功；Cloudflare 账户、真实资源 ID 和 DNS zone 接入还未配置。没有公开 HTTPS 站点完成声明。

## 阶段状态与下一步

| 阶段                     | 状态                     | 尚需资源                                                             |
| ------------------------ | ------------------------ | -------------------------------------------------------------------- |
| S0 工程基线              | 本地完成；线上部署待依赖 | Cloudflare 账户、真实 D1 ID、DNS/HTTPS 与预算配置                    |
| S1 真实校园地图          | 未开始                   | 高德 JS Key/安全密钥；获准的大学城地点、入口、步行路网和南校隧道资料 |
| S2 Agent/Skill/MapAction | 未开始                   | S1 数据；真实 Tool Calling 模型及凭据/预算                           |
| S3 RAG/CampusRadar       | 未开始                   | 官网白名单/采集规则、真实文档、Embedding 配置                        |
| S4 手机账号              | 未开始                   | 短信供应商、获批模板/签名、预算/隐私决定                             |
| S5/S6 P1                 | 未开始                   | 真实路径、本人确认的课表/任务、授权实景素材                          |
| S7 P2                    | 未开始                   | 学校正式 API/SSO 授权、社交运营/审核和隐私决策                       |

收到 S1 所需数据和高德配置后，优先完成真实地点搜索 → 路线 → Agent Skill → MapAction → 地图呈现闭环。没有真实依赖时继续记录缺项，不输出假的路线、活动、模型调用或绑定成功。

## UI 修订验收（2026-10-12，负责人明确要求）

- 删除常驻顶层栏；品牌、CampusOS 与校区放入搜索/导航，游客和账号移入侧栏底部。六个页面、公共游客入口和全局助理继续使用原来的业务边界。
- 采用蓝白 Apple-inspired 极简层级：24px/500 地图标题、常规正文、灰黑文字、局部半透明导航/搜索/底部标签、实白内容面板；删除重复状态徽标、第二个助理图标和底部重复声明。
- Windows 中文固定文案使用自托管 Noto Sans SC 可变子集（OFL），Apple 设备使用系统字体；更新安全区/动态视口、16px 输入和 hover 能力门控。
- Base UI 1.9.0 非模态 Drawer 实现连续拖动、停靠、滑动关闭与焦点管理；键盘操作直接切换，减少动效/高对比提供降级。短横屏保留手机导航并使用完整助理。
- 验证通过：format:check、typecheck、lint、6 项单元测试、Next 生产构建、OpenNext Worker 打包；8 项浏览器测试在本地开发服务与最终 Workers 预览均通过。包含普通桌面/手机、320px 窄屏、844×390 横屏、200% 文字、减少动效/高对比、拖动过程中跟随、Enter/Esc 与跨页面状态。运行依赖审计仍为 0 vulnerabilities。
- 设计规范已同步到 v2 的 06/11 文档，取舍和实际边界见 `UI_REVIEW.md`；新增字体/组件/图标来源已记入 `DATA_SOURCES.md`。
- 当前预览仍为 `http://127.0.0.1:8787`。新验收截图：[桌面](evidence/ui-apple-desktop.png)、[手机](evidence/ui-apple-mobile.png)。旧 S0 截图作为历史记录保留。
- 没有据此宣称真实手机触感、Safari 系统材质、软件键盘或 GPU FPS 已验证；也没有接入假地图/地点/活动/模型回答。
