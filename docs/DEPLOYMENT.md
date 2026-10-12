# 部署与回滚

目标生产域名：`gdufs.ccwu.cc`，由负责人于 2026-10-12 指定。S0 已具备 OpenNext Workers 本地构建和预览配置；线上账户、实际 D1 ID、域名/DNS 与预算尚未配置。

## 本地 Workers 验证

```powershell
npm run db:migrate:local
npm run build:worker
npm run preview:worker
```

访问 `http://127.0.0.1:8787/map` 和 `/api/health`。配置中的全零 D1 ID 仅为本地占位，不表示存在云数据库。OpenNext 提示 Windows 兼容性有限；本次在 Windows 构建/预览成功，后续若出现可复现平台问题优先使用 WSL/Linux，不据此自动更换架构。

## 配置预览环境

负责人先确认 Cloudflare 账户/费用上限和需要启用的资源。取得账户接入后，由拥有该账户权限的人完成 `npx wrangler login`，或在环境中配置限权 API Token；真实 Token 不放入仓库。

设置 `CLOUDFLARE_ACCOUNT_ID`。创建各环境独立的 D1 数据库后，把真实 UUID 写入 `wrangler.jsonc` 对应 `env.preview` / `env.production`，保留本地占位配置。数据库 ID 是资源标识，不是认证凭据。部署脚本仅在账户变量和该环境数据库 ID 均准备好时运行。

先对空的预览数据库应用迁移：

```powershell
npx wrangler d1 migrations apply campusos-preview --remote --env preview
npm run deploy:preview
```

在预览 URL 验证页面、权限、错误状态与实际依赖后，再安排正式发布。当前 S0 只具备工程 Shell，能力 API 会报告地图/模型/短信等尚未接入。

## 正式域名

确认 `gdufs.ccwu.cc` 所在 DNS zone 的实际管理权和 Cloudflare Custom Domain 的账户条件。`wrangler.jsonc` 只声明目标域名，没有自动修改 DNS。若域名由其他 DNS 平台或另一账户管理，先核对可用接入方式；不要盲目修改已有解析。

使用 HTTPS 部署后，按平台设置高德的域名与安全配置（S1），核对模型/短信限额和私有数据保护。生产 Secret 按环境分别使用 `wrangler secret put <NAME> --env production`；只有本人操作账户时输入秘密值。

## 回滚与数据恢复

- 发布前保存当前 Cloudflare Worker 版本 ID、Git 提交及迁移版本。异常时使用 Cloudflare 版本回滚；运行 `npx wrangler rollback --help` 核对当前 CLI 参数，选择上一个已验证版本并复测健康/权限/业务主流程。
- 应用版本回滚不会回滚 D1 schema/数据。优先使用向前兼容的增量迁移；出现数据问题时按 D1 备份/Time Travel 的实际套餐能力恢复，先在隔离环境核对后处理生产。
- 数据导出/备份放在被 Git 忽略的 `backups/` 或受控存储；私人手机号/会话/学校令牌不得进入仓库或公开对象存储。S4 上线前须实测恢复流程与保留期限。

当前没有生产版本或业务数据，因此未执行线上回滚/恢复。当地运行的成功不能代替公开域名和生产环境验收。
