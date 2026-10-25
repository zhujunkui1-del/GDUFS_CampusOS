# CampusOS 外部搜索

同一 Agent 的 `search_external_campus_info` 只读 Skill。先查内部文章，再按问题类型补充：官方规则/期限只查 `gdufs.edu.cn` 官方网页；食堂口味查学生经验；宿舍体验组合官方设施与学生笔记；活动仍以雷达及官方通知为准。内部无结果不会一律触发小红书。

## 通用网页

Worker 调用 Exa MCP 的 `web_search_exa`，必要时对官方结果调用 `web_fetch_exa`。未购买服务。免 Key 的限流模式在本机实测成功，Preview Worker 实测持续HTTP403，**未通过公网外部检索验收**。可配置服务端Secret `EXA_API_KEY`；不能保证提供Key就能解决所有网络拒绝，仍需重新验收。不得把DeepSeek模型Key当搜索Key。每轮最多一次外部Skill、返回最多6条来源、摘录各700字，整体13.5秒；搜索失败不冒充“没有答案”。`EXTERNAL_WEB_SEARCH_ENABLED=false` 可关闭。

## 小红书本地后端

在仓库根目录运行（需 Node 和 Docker Desktop）：

```powershell
node services/external-search/setup.mjs init
node services/external-search/setup.mjs login
node services/external-search/server.mjs
```

用本人小红书 App 扫描 `runtime/login-qr.png`；`setup.mjs status` 查看真实登录状态。二维码过期重新运行 login。使用独立容器会话，不读取日常浏览器 Cookie，不自动处理验证码。镜像固定到实际拉取的官方 digest，登录会话在本机 runtime/data。该目录已忽略 Git；不要上传日志、会话或 config.json。

本地 MCP 仅监听127.0.0.1:18060。Node网关仅监听127.0.0.1:18071，对外仅允许带独立 Bearer 凭据的 `POST /v1/search`（query、limit），不转发发布、评论、点赞、收藏或任意 MCP 方法。并发最多2，最多读取前两篇笔记正文，其余只标标题元数据。不下载图片、不采集评论。

要供 Preview 调用，需将**18071只读网关**通过正常HTTPS网络暴露，并设置服务端 Secret `EXTERNAL_SEARCH_GATEWAY_URL`、`EXTERNAL_SEARCH_GATEWAY_TOKEN`（来自本机config中的gatewayToken，不能放前端）。不要直接暴露18060，也不要把upstreamToken或登录Cookie交给Worker。临时Tunnel仅供验收，公网长期可用需要稳定地址、常驻进程和可连接的网络。

截至本轮，Docker和本地网关已真实启动，登录状态false；QUIC连接超时、HTTP2握手EOF，临时隧道未连接成功。因此未向Preview配置失效地址，尚未将原生小红书搜索记为公网可用。网关缺失/未登录时可尝试小红书公开网页搜索，标 `public_web`，只接受直接相关的真实笔记URL，不能冒充站内搜索；该备用搜索同样受上述Preview 403阻塞。公开网页覆盖不足时明确无可用证据。

## 数据与边界

外部结果带原文链接、来源等级、发布时间（可未知）、摘录类型和检索方式。官方网页不自动等于现行规则；小红书不作为政策、金额、活动真实状态或截止日期的最终依据。外部文章不进入公开文章库/检索索引，只随现有会话存储有限引用。外部模块本身D1读写0；聊天本身沿用原有额度与会话写入。

参考：[xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)、[Agent-Reach](https://github.com/Panniantong/Agent-Reach)、[Exa MCP](https://exa.ai/docs/get-started/exa-mcp)。未安装整套Agent-Reach，也未改变现有采集器。
