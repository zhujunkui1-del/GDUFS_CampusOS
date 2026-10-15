# 部署与回滚

目标生产域名：`gdufs.ccwu.cc`。2026-10-15 S2-D只读确认：负责人Edge和Wrangler已经登录正确账户，域名在该账户且Universal证书Active，但0条DNS、没有CampusOS Worker/专用D1。环境UUID仍全零，云端Secrets/应用HTTPS/预算尚待配置与批准。完整本地验收及截图见 [S2-D报告](S2_D_AGENT_ACCEPTANCE.md)。

## 本地 Workers 验证

```powershell
npm run db:migrate:local
npm run build:worker
npm run preview:worker
```

访问 `http://127.0.0.1:8787/map` 和 `/api/health`。配置中的全零 D1 ID 仅为本地占位，不表示存在云数据库。OpenNext 提示 Windows 兼容性有限；本次在 Windows 构建/预览成功，后续若出现可复现平台问题优先使用 WSL/Linux，不据此自动更换架构。

## 配置预览环境

**以下仅为批准后的执行说明，不是当前发布授权。** 负责人须先明确确认专用预览D1创建/迁移、`campusos-preview` Worker公开发布及模型试用预算。账号已经认证，不必再次登录或导出Cookie/Token。生产建库/迁移、公开正式域名、DNS/HTTPS及付费服务仍需单独明确批准。

设置 `CLOUDFLARE_ACCOUNT_ID`。创建各环境独立的 D1 数据库后，把真实 UUID 写入 `wrangler.jsonc` 对应 `env.preview` / `env.production`，保留本地占位配置。数据库 ID 是资源标识，不是认证凭据。部署脚本仅在账户变量和该环境数据库 ID 均准备好时运行。

先对空的预览数据库应用迁移：

```powershell
npx wrangler d1 migrations apply campusos-preview --remote --env preview
npm run deploy:preview
```

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
