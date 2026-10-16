# 部署与回滚

目标生产域名：`gdufs.ccwu.cc`（尚未批准发布）。2026-10-16已获授权并完成独立预览：https://campusos-preview.zhujunkui1.workers.dev 。env.preview绑定专用D1，5项Secret已配置并在云端验证；生产UUID仍占位，正式域名/DNS/生产库未动。完整结果与Free CPU限制见 [S2-E报告](S2_E_CLOUDFLARE_PREVIEW_ACCEPTANCE.md)。S2-D只读记录是此前状态。

## 本地 Workers 验证

```powershell
npm run db:migrate:local
npm run build:worker
npm run preview:worker
```

访问 `http://127.0.0.1:8787/map` 和 `/api/health`。配置中的全零 D1 ID 仅为本地占位，不表示存在云数据库。OpenNext 提示 Windows 兼容性有限；本次在 Windows 构建/预览成功，后续若出现可复现平台问题优先使用 WSL/Linux，不据此自动更换架构。

## 配置预览环境

负责人2026-10-16已经明确批准且本轮已执行专用预览D1创建/迁移、`campusos-preview` workers.dev发布和运行时Secret配置。现有认证可用，不需导出Cookie/Token。只允许后续同一预览的非破坏性更新；生产建库/迁移、正式域名/DNS/HTTPS及套餐升级仍需额外明确批准。

设置 `CLOUDFLARE_ACCOUNT_ID`。创建各环境独立的 D1 数据库后，把真实 UUID 写入 `wrangler.jsonc` 对应 `env.preview` / `env.production`，保留本地占位配置。数据库 ID 是资源标识，不是认证凭据。部署脚本仅在账户变量和该环境数据库 ID 均准备好时运行。

先对空的预览数据库应用迁移：

```powershell
npx wrangler d1 migrations apply campusos-preview --remote --env preview
npm run deploy:preview
```

管理员shell须明确设置已核对的`CLOUDFLARE_ACCOUNT_ID`。脚本检查预览名称、专用DB、main、自引用和无正式Routes，并显式传入配置/env；不要在tail等命令同时传入Worker位置名称和env，否则某些命令会追加第二个-preview。当前预览入口`preview-worker.ts`复用原API处理函数和OpenNext请求ALS；页面使用原ASSETS只读缓存，无R2/KV/DO。升级OpenNext后必须回归该入口，不把其内部生成模块视作永久兼容保证。

预览build包装器还dry-run编译最终入口、扫描实际Worker bundle后才允许部署；不可绕过。迁移前列出目标名/UUID/账户和待执行列表，只执行新增非破坏性迁移，不能为测试删除重建库。0004为云端CASE分句增加的括号不改规则，既有已应用本地库不重跑。

配置该环境的运行时Secret：`MODEL_API_KEY`、`MODEL_NAME`、`MODEL_BASE_URL`、`MODEL_CAPABILITIES_JSON`、独立`AGENT_SIGNING_SECRET`。能力记录须按实际管理员Key/模型验证，24小时有效；禁止把秘密写入wrangler vars或Git。使用`npm run build:worker`/部署脚本的构建净化步骤，不能绕过后直接发布OpenNext的本机`.env`默认值。云端只配置运行时Secret；本地用忽略的`.dev.vars`。

在预览URL验证真实Agent、五地图Skill、流式与回执、D1恢复/所有权/限额、模型故障时地图独立、固定OSM/GLB资源及HTTPS定位。云端不同地区客户端实测与本地双workerd分开记录。Free CPU10ms/50子请求需实际预览测量，尤其慢客户端回执轮询；本地构建/dry-run不代表套餐运行达标。现有学生登录/SMS及个人Skill未上线，不能以测试夹具冒充。

## 正式域名

已确认目标zone在指定账户，当前没有应用解析。`wrangler.jsonc`只声明目标，不构成DNS变更授权。预览和实机验收后，另请负责人批准正式Worker/D1、域名绑定和DNS/HTTPS变更；保存原配置和回滚点。控制台已有证书不等于网站已经可访问。

继续使用固定本地OSM/校园路网，不恢复高德在线底图。核对模型额度与私有数据保护。生产Secret按环境分别使用`wrangler secret put <NAME> --env production`或控制台受控输入，禁止把值放到命令参数/聊天/仓库。正式开放前确定24h模型能力刷新、取消预算恢复、入口限流及未修复开发链依赖的处理方式。

## 回滚与数据恢复

- 发布前保存当前 Cloudflare Worker 版本 ID、Git 提交及迁移版本。异常时使用 Cloudflare 版本回滚；运行 `npx wrangler rollback --help` 核对当前 CLI 参数，选择上一个已验证版本并复测健康/权限/业务主流程。
- 应用版本回滚不会回滚 D1 schema/数据。优先使用向前兼容的增量迁移；出现数据问题时按 D1 备份/Time Travel 的实际套餐能力恢复，先在隔离环境核对后处理生产。
- 数据导出/备份放在被 Git 忽略的 `backups/` 或受控存储；私人手机号/会话/学校令牌不得进入仓库或公开对象存储。S4 上线前须实测恢复流程与保留期限。

当前没有生产版本或业务数据，因此未执行线上回滚/恢复。当地运行的成功不能代替公开域名和生产环境验收。

## 公开几何元数据与Free CPU（2026-10-16）

服务端公开道路候选由现有固定地图与原算法离线生成。修改已审阅地理数据或相关几何实现后，显式运行 `npm run map:route-metadata`，再运行差分路线测试；普通构建只校验来源SHA，过期立即失败，不自动更新地图。生成物在src/lib/server/maps/public-walking-attachments.json，不含用户位置/会话/路线票据。

本轮最后预览版本0c8cb22a-85d0-4b64-8e17-fac4063b875a，无迁移/Secret或生产变更。两轮优化后Agent仍超Free10ms，不能凭0次1102宣称生产稳定；后续方案、真实指标、CPU断言与回滚限制见S2_E_CPU_ACCEPTANCE.md。不要擅自提高套餐或使用其他项目资源。
