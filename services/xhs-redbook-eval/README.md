# 私有 redbook Cloudflare 搜索服务

2026-10-27已接入CampusOS Preview；服务名保留历史eval后缀。当前接线、账号切换、真实聊天和限制见 ../../docs/verification/redbook-switch-2026-10-27/README.md。此前隔离验证见 ../../docs/verification/redbook-evaluation-2026-10-27/README.md。

固定Node22镜像和redbook0.8.2；禁用安装脚本。镜像白名单只含包锁、服务和生成的探针，不含会话、密钥、浏览器profile或验收文章材料。

从仓库根目录构建部署：

```powershell
node services/xhs-redbook-eval/build.mjs
npx wrangler deploy --config services/xhs-redbook-eval/wrangler.jsonc
npx wrangler secret bulk .map-tools/xhs-provider-eval/cloud-eval-secrets.json --config services/xhs-redbook-eval/wrangler.jsonc
```

需要3个专用Secret：SERVICE_TOKEN（独立随机Bearer）、SESSION_KEY（32字节AES密钥的Base64）、SESSION_OBJECT（固定evaluation前缀的私有R2对象键）。不要复用或改写正式会话对象；本轮专用值留在忽略目录，准备及上传密文属于授权运维操作。

密文格式是12字节IV＋AES-256-GCM密文/tag，AAD为campusos:xhs-provider-evaluation:v1。仅以当前专用授权会话生成快照；R2对象仍私有，不把原始Cookie放入镜像、公开请求或日志。鉴权接口：POST /probe（query、platform、可选limit）、/status、/session/import和/restart。导入会话先经源站非游客身份确认，成功才写密文；失败不覆盖原快照。

容器单实例、请求串行、1分钟空闲自动休眠。restart调用Container.stop，不删除R2会话；下一请求重新启动并加载密文。无鉴权请求在进入容器/读取会话前拒绝。普通用户只经既有Agent只读Skill调用，不获得上述服务端凭据。账号失效、安全验证、单实例并发及长期容量仍有边界。

负责人换号使用独立资料目录xiaohongshu-browser-profile-next-account。关闭该窗口后执行`node scripts/prepare-redbook-session.mjs --next-account --capture-only`，再执行`node scripts/sync-redbook-session.mjs --next-account`；只读新目录，不复用主账号。当前后台状态可检测，后台二维码/Live View不是新后端的完整换号流程；新网关已关闭旧主账号Browser Run恢复路径。旧部署版本保留，但不要在未重新明确授权主账号的情况下执行旧后端原生搜索。

诊断脚本 scripts/inspect-redbook-evaluation.mjs 读取忽略目录里的专用Secret；长摘录及完整模型原答复只放临时私有回执，公开回执保留哈希/长度。scripts/verify-redbook-agent.mjs仍是隔离测试；真实前台验收见 tests/e2e/redbook-switch-live.spec.ts，显式设置REDBOOK_SWITCH_LIVE=1及Preview URL。
