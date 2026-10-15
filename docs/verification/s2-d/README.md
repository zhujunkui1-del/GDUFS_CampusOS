# S2-D 证据索引

日期2026-10-15；完整结论见 [验收报告](../../S2_D_AGENT_ACCEPTANCE.md)。目录内PNG均为实际浏览器截图，不是生成图片。只有公共校园数据；不含真实GPS轨迹、密钥、Cookie或签名票据。

- `live/`：真实DeepSeek业务与定位/取消/恢复/模式测试。A–G的16条终态通过，但其早期时延有提前回执问题，最终延迟统计不使用。
- `runtime/`：构建净化后通过`.dev.vars`运行时绑定的真实模型烟测，Chrome手机视口和Edge桌面。
- `metrics.json`：以上最终保存28轮矩阵的聚合。仅`camera-settled-v2`参与最终延迟；取消缺usage不能当零费用。`runtime-usage.json`为含S2-C/调试/失败的累计开发台账，不是S2-D费用或账单。
- `regression/`：真实确定性Workers Skill输入输出与HTTP墙钟；状态截图不代表模型业务调用。
- `screenshots/`：地图/导航/手机抽屉/清理回归。`*-route-clear-*`使用受控AI历史，路线实际计算；最终抽屉以`*-library-route-sheet.json`和`*-gym-route-sheet.json`及对应PNG为准。普通`*-route-sheet*`与`*-partial.json`保留中间诊断，可能包含修复前遮挡，不作为最终通过证据。
- `resize/`：实际GL viewport与窗口视口变化后拖动；非手机实机。
- `performance/`：每模式1800ms真实拖动/缩放/旋转期间rAF间隔。高刷本机调度不是呈现FPS或手机硬件指标。
- `shared-workers.json`：两个独立workerd共用一个受管D1模拟服务，不是云端多地域。
- `cloud/`：负责人已登录账户的只读核查、裁去私人信息的DNS截图、公共DoH、本地打包dry-run。没有真实云端部署/迁移/DNS变更。
- `security-before-fix.json` / `security-integrity.json`：服务端生成环境曾含本机秘密的无值命中元数据及净化后全文扫描；不是秘密文件副本。
- `dependency-audit.json`：全依赖5high与生产0分开，未修复开发链公告见报告。
- `local-budget.json`：滚动24h站点配额只读快照；没有为测试重置或放宽配额。

复验：`npm run typecheck`、`npm run lint`、`npm test`、`npm run db:verify`；共享状态设置`ASSISTANT_STATE_CAPTURE_DIR=docs/verification/s2-d`后运行`npm run test:assistant:state`。生产包使用`npm run build:worker`并启动本地`wrangler dev`。浏览器设置E2E_BASE_URL/PLAYWRIGHT_CHANNEL与各E2E_CAPTURE目录，具体spec见报告。真实模型必须显式`E2E_LIVE_AGENT=1`且先确认剩余额度，不混入Mock回归。
