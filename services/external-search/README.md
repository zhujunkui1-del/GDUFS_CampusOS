# CampusOS 外部搜索

同一 Agent 的 `search_external_campus_info` 只读 Skill。先查内部文章，再按问题类型补充：官方规则/期限只查 `gdufs.edu.cn` 官方网页；食堂口味查学生经验；宿舍体验组合官方设施与学生笔记；活动仍以雷达及官方通知为准。内部无结果不会一律触发小红书。

## 当前运行方式（2026-10-26更新）

已确认小红书登录，并在Preview Agent中实际返回笔记正文、网页资料及原文链接。使用现有Worker+D1短时任务通道，本机通过HTTPS出站领取/回传，不需要入站Tunnel或新增搜索Key。未购买服务、未升级套餐、未部署Production。当前Preview为9c6f6660-df6d-40e6-97ee-f47100b884ee。

**两种外部搜索均依赖本机、Docker和以下两个程序持续运行。** 启动Docker Desktop后，在项目根目录先执行`node services/external-search/setup.mjs init`。然后在两个终端分别运行：

```powershell
node services/external-search/server.mjs
```

```powershell
node services/external-search/runner.mjs
```

登录状态查看：`node services/external-search/setup.mjs status`。需要重新登录时执行`node services/external-search/setup.mjs login`并扫描runtime/login-qr.png。当前机器与Preview已配置对应令牌；换机器需管理员同步令牌，不要上传Cookie、config.json或upstream.env。没有设置Windows开机自动启动。

外部Skill预算30秒，本机网关27秒、出站等待28.5秒。仅前两篇正文并行读取；只读Skill以外的工具仍为15秒、整轮90秒。已取得的公开正文可在本机内存缓存2分钟、最多32项，保留原始retrievedAt；标题/空结果不缓存。不请求全量评论或下发评论，不下载图片。

0050只新增短时传输表和索引，不写文章库或检索索引。完成/取消后按主键删除，遗留请求按过期索引分批清理。空闲领取按2秒查有界索引，仍有少量rows_read，0 rows_written；不能再把整体外部链路称为零D1读写。原有人工下架、公开复核、分类及地图不改。

真实成功、连续重测失败和成本边界见[最新验收](../../docs/verification/external-search/xhs-logged-in/README.md)。第三方服务仍可能超时/不可用；未把一次通过宣称为全部冷请求稳定。下方保留旧直连阶段的说明，以本节为当前状态。

## 旧直连阶段：通用网页

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

以下为保留的HTTP直连方案；当前出站方式不需要Tunnel URL。若将来采用直连，需将**18071只读网关**通过HTTPS暴露，设置服务端EXTERNAL_SEARCH_GATEWAY_URL/TOKEN。不要直接暴露18060，或把upstreamToken/登录Cookie交给Worker。

旧阶段曾未登录、QUIC超时/HTTP2握手EOF。本轮已登录并使用出站通道接通；原生站内结果标platform，公开网页结果标public_web，不混淆。未部署入站Tunnel。

## 数据与边界

外部结果带原文链接、来源等级、发布时间（可未知）、摘录类型和检索方式。官方网页不自动等于现行规则；小红书不作为政策、金额、活动真实状态或截止日期的最终依据。外部文章不进入公开文章库/检索索引。有限结果经过短时D1传输表，随现有会话保存引用；传输和会话均有实际D1用量。

参考：[xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)、[Agent-Reach](https://github.com/Panniantong/Agent-Reach)、[Exa MCP](https://exa.ai/docs/get-started/exa-mcp)。未安装整套Agent-Reach，也未改变现有采集器。
