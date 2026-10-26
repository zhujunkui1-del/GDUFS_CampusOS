# redbook 候选后端实测：尚未通过搜索验收

负责人授权验证“现有 Cloudflare 容器优先评估新后端，必要时再考虑国内 VPS”的思路。本轮固定测试 `@lucasygu/redbook@0.8.2`，没有安装其他两个候选、购买服务器、替换现有 Agent/搜索后端或部署 Production。

## 真实结果

| 检查 | 环境与会话 | 实际结果 |
|---|---|---|
| SDK 导入 | Windows Node 24.19.0 | 成功 |
| SDK 导入及源站请求 | 本机 Docker，Linux Node 22.23.4 | 成功运行；身份接口 HTTP200/code=-100 |
| 身份校验 | 本机专用 Edge 保存的会话，HTTP 客户端 | -100，未确认登录 |
| 正常网页对照 | 原专用 Edge 完整 profile，正常打开网页 | 身份接口先 -100，后 guest=true；可见登录二维码 |
| 云端已有快照 | 大陆后端 | -100 |
| 云端已有快照 | 全球后端 | code=0/success=true，但 guest=true |
| 访客公开搜索 | 全球后端、源站有效访客会话 | 搜索接口 HTTP200/code=-104/success=false，0条 |
| 当前旧云端浏览器状态 | 现有私有状态接口 | unknown；不能据此断言已登录或已退出 |

**结论：Node/Linux 运行兼容性有真实证据，关键词搜索、正文、新客户端的重启恢复、Cloudflare 中实际运行以及 Agent 使用新后端均未通过验收。** 当前未建立“有效身份且有搜索权限”的前提，因此没有采购 VPS 的依据，也不能承诺换 VPS 能解决。

`-104` 出现在访客查询中，不是对负责人登录后账号权限的判定。浏览器 Cookie 文件存在及其未来过期时间不能证明源站仍接受登录。

## 复现脚本

`scripts/evaluate-redbook.mjs`：固定版本库、仅身份/搜索/笔记详情三个读操作；只发往所选平台的固定 HTTPS API 主机，禁止任意端点及写入方法，最多8次HTTP请求、单次15秒。源返回验证/权限错误时不改账号、网络或身份尝试规避。请求计数区分身份、搜索、正文；不打印请求头、Cookie、身份ID、验证UUID和原始响应体。

退出码 **0** 需要实际搜索结果及至少一篇正文；**2** 表示尚未完成，具体原因看 JSON。`smoke-negative.json` 是实际运行得到的 -100/退出码2。没有用保留的旧笔记填充结果。

从仓库根目录安装隔离依赖并运行：

```powershell
npm install --prefix .map-tools/xhs-provider-eval --no-save --ignore-scripts --no-audit --no-fund @lucasygu/redbook@0.8.2
node scripts/prepare-redbook-session.mjs
node scripts/evaluate-redbook.mjs
```

准备脚本只打开 `services/external-search/runtime/xiaohongshu-browser-profile`，不扫描日常 Chrome/Edge。由本人正常登录；仅在源站 user/me 明确返回非游客身份后导出必要 Cookie 至忽略目录。脚本区分大陆与全球后端，等待窗口有20分钟上限；会话不得贴进聊天或加入Git。

有意验证访客公开权限时才使用：

```powershell
node scripts/evaluate-redbook.mjs .map-tools/xhs-provider-eval/local-session.json rednote '广外 南校 一饭' --public-guest-search
```

平台参数须与该会话所属域名一致。本轮访客实测使用了云端已保存的全球会话，原文证据在 `public-guest-search-rednote.json`；身份请求1次、搜索请求1次、正文0次。浏览器自身后台请求不属于这项 HTTP 客户端计数。

## 证据与测试

- `local-docker-node22.json`：本机 Linux 容器的真实请求；**不是 Cloudflare 部署回执**。
- `local-windows-before.json`、`normal-browser-control.json`：Windows SDK 与正常浏览器对照。
- `local-cloud-cookie-{xhs,rednote}.json`：同一云端快照按域名分别验证，不混用会话。
- `public-guest-search-rednote.json`：真实搜索权限拒绝。
- `current-cloud-browser-status.json`：旧后端读取，不改其部署。
- 5项单元测试覆盖访客默认不搜索、未知身份不误报退出、显式访客搜索仍尊重权限拒绝、写入端点阻断，以及真实传输计数。夹具仅在 tests，不冒充源站文章。
- typecheck、目标 ESLint、单元和本地生产构建通过。构建先发现了新增测试的 JS 数组类型推断错误，已修复；本轮没有修改页面或运行一次假的公网内容验收。
- 本轮0次模型调用，未测试500人容量，也未新增D1数据或迁移。Cloudflare只读取现有私有会话快照及状态，未部署新容器后端。

## 断点

已请求负责人在本机专用窗口恢复一次有效登录。完成后先用同一专用会话验证3个真实校园关键词、正文、关闭/重开，再进入隔离 Cloudflare Container 对照与现有 Skill 的模型调用。任何阶段返回验证或权限拒绝，保留失败结果，不记为可用。国内 VPS 仍是待验证选择，不是已经证实的解决办法。

源码依据：[redbook](https://github.com/lucasygu/redbook)，本轮实际 npm 包0.8.2，MIT。安装脚本禁用；没有调用其日常浏览器自动读取、发帖、评论和点赞功能。原始认证快照只在忽略目录，本文证据无认证值。

本轮登录等待窗口最终超时，未收到源站非游客认证；已关闭测试浏览器，不保留后台监听。后续可在负责人准备好时运行准备脚本，不需要复用过期二维码。
