# 私有 redbook Cloudflare 验证服务

本服务仅供候选路线验证，未绑定当前CampusOS Preview搜索。结果和限制见 ../../docs/verification/redbook-evaluation-2026-10-27/README.md。

固定Node22镜像和redbook0.8.2；禁用安装脚本。镜像白名单只含包锁、服务和生成的探针，不含会话、密钥、浏览器profile或验收文章材料。

从仓库根目录构建部署：

```powershell
node services/xhs-redbook-eval/build.mjs
npx wrangler deploy --config services/xhs-redbook-eval/wrangler.jsonc
npx wrangler secret bulk .map-tools/xhs-provider-eval/cloud-eval-secrets.json --config services/xhs-redbook-eval/wrangler.jsonc
```

需要3个专用Secret：SERVICE_TOKEN（独立随机Bearer）、SESSION_KEY（32字节AES密钥的Base64）、SESSION_OBJECT（固定evaluation前缀的私有R2对象键）。不要复用或改写正式会话对象；本轮专用值留在忽略目录，准备及上传密文属于授权运维操作。

密文格式是12字节IV＋AES-256-GCM密文/tag，AAD为campusos:xhs-provider-evaluation:v1。仅以当前专用授权会话生成快照；R2对象仍私有，不把原始Cookie放入镜像、公开请求或日志。Worker只接受POST /probe（query、platform）及私有POST /restart。

容器单实例、请求串行、1分钟空闲自动休眠。restart调用Container.stop，不删除R2会话；下一探针重新启动并加载密文。无鉴权请求在进入容器/读取会话前拒绝。停止后保留私有服务供复核，不代表已上线给普通用户。

公网请求必须通过 scripts/inspect-redbook-evaluation.mjs；它读取本机忽略目录里的专用测试Secret，公用回执不保存原文长摘录或模型完整原答复。scripts/verify-redbook-agent.mjs复用原Agent和模型服务，当前只用于隔离测试，不能替代正式聊天验收。
