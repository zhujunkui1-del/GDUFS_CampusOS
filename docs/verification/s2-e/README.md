# S2-E证据索引

实际地址：https://campusos-preview.zhujunkui1.workers.dev 。结论见[验收报告](../../S2_E_CLOUDFLARE_PREVIEW_ACCEPTANCE.md)。JSON时间为UTC，报告日期按北京时间。PNG均为实际Chrome/Edge浏览器截图，未使用生成图。

- `preflight.json`：已认证账户匹配/Free套餐/原3 Worker与2 D1/发布前额度；没有账号邮箱或认证材料。订阅API403，套餐由已登录控制台核实。
- `resource-isolation.json`、`deployment.json`：实际Worker/DB绑定、5项secret_text名称、workers.dev、Deployment/Version ID、其他资源保持、无自定义域名；DNS复读权限不足未扩权。
- `migration-parser-probe.json`：真实远程只读EXPLAIN最小对照，未创建探针触发器。裸CASE失败、括号成功；未用其他换行变体推断因果。`migrations.json`为4迁移实际执行字节哈希、34业务表/11触发器与空库/外键证明。
- `shared-state.json`：真实D1/公开HTTP的所有权、版本、过期、外键与会话；只修改新建自有测试路线，未清库。
- `model-capabilities/`：真实3请求诊断，非业务Mock；回执值和Key未归档。
- `live/`：最终真实模型矩阵，A–G、图书馆、详情、受控公开坐标/拒绝/取消、重复ID。共23轮；手机视口/模拟位置不是实机。`metrics.json`只汇总最终保存矩阵，包含重复调试的实际费用另看`model-budget.json`余额变化，缺usage不当零费用。
- `live-before-optimization.json`：最初真实CPU失败的脱敏记录，不作为成功验收。原始trace/测试Cookie仅在Git忽略的test-results/.map-tools，不发布。
- `invocations-before.json`、`invocations.json`、`invocations-final.json`、`performance-summary.json`：Cloudflare实际Tail，只保存数值和UUID脱敏路径；不存头/正文/异常文本/SQL。窗口条件不同，不是控制变量并发基准；CPU仍高于Free10ms，未证明稳定容量。
- `cloud-analytics.json`：最近成功GraphQL快照。`final-usage.json`/`preview-d1-usage.json`是分析接口预算限流，不能当作应用/D1余额用尽，也不编造未取得的最新用量。
- `regression/`、`screenshots/`、`resize/`：实际公网Workers/五Skill和地图/UI。Mock故障仅在隔离浏览器拦截，不是生产Provider。`worker-update-recovery.json`记录真实版本更新后恢复。
- `performance/`：4组三模式实际指针操作rAF/ready时间，另4组资产/ETag/304/无高德/模型哈希。不是手机实机FPS或云端内存。
- `security-integrity.json`：实际模型/本地及预览签名/OAuth等已知秘密全文扫描、冻结数据与模型哈希。`public-exposure.json`/`public-bundle-audit.json`检查私密文件/调试端点和客户端SQL。`dependency-audit.json`明确生产0、开发链5high。
- `local-only/shared-workers.json`：本地双workerd回归，绝不当作真实云端或跨地域证据。

复验环境：`E2E_BASE_URL=https://campusos-preview.zhujunkui1.workers.dev`，`PLAYWRIGHT_CHANNEL=chrome`/`msedge`；按报告设置E2E_*_CAPTURE_DIR至本目录。真实模型另须显式`E2E_LIVE_AGENT=1`/`E2E_CLOUD_ACCEPTANCE=1`并检查`preview-budget.mjs`，不得自动扩大原1元授权。受控状态测试须显式Cloudflare账户，`preview-state.mjs`仅允许已核对的专用预览URL/配置，含自有测试路线过期/版本元数据更新。
