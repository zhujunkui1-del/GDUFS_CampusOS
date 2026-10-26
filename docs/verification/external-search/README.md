# 外部搜索实现与真实断点（2026-10-26）

## 后续更新：真实外部检索已接通

负责人扫码后已确认登录。现有Worker+D1出站通道已接入本机网页/小红书服务，不再依赖未接通的入站Tunnel，也未购买搜索Key。已有桌面四问题完整通过及最新版手机视口笔记正文/缓存的真实回执。连续重测仍有第三方超时或工具错误，未宣称全部重测全绿。

最新Preview：9c6f6660-df6d-40e6-97ee-f47100b884ee，0050已应用。当前实现、成功与失败、D1/CPU及启动依赖见[登录后验收](xhs-logged-in/README.md)。下方是接入前的历史断点，不代表当前所有状态。

## 接入前的历史结论

**代码和Provider接口已接入原Agent，公网外部搜索未验收通过，不能称为可用。**

- 内部双栏目RAG保留。文章足够时可直接答；经验、缺少细节或明确联网查询才补外部。规则/奖学金/时限只查广外官方网页，食堂口味查经验，宿舍组合官方设施和学生体验；不因为内部无结果一律查小红书。
- 新增同一Registry的只读 `search_external_campus_info`；原16项规划能力保留，增加获负责人授权的外部搜索扩展。实际注册8个工具，执行器16工具上限不变，没有第二套Agent。
- 本机Exa真实搜索成功，返回图书馆权限表、借阅规则等官方原文链接，见[本地执行证据](local-web.json)。这些是本机Node回执，**不代表Worker成功**；结果标search_excerpt，没有伪装成已取得全文。
- Preview真实DeepSeek已调用内部Skills及外部Skill，但Exa对Worker持续HTTP403，返回0条外部证据。最新完整四问题回执见[browser/live.json](browser/live.json)、[提取摘要](preview-summary.json)。网络不可用时回答未获得资料，未编造搜索成功。此前redirect:error与workerd不兼容已改manual并拒绝3xx；随后403仍真实存在。
- 小红书官方镜像v2.5.5及专用本地只读网关实际运行，登录false；本地鉴权401、非白名单路径404、已认证请求login_required见[local-gateway.json](local-gateway.json)。临时Tunnel QUIC超时/HTTP2握手EOF，未形成可达云端后端；未给Preview写入失效URL。没有真实笔记检索成功回执。

## 实现契约

输入query、gap（no_internal_answer/missing_detail/student_experience/freshness_check）、limit默认3最多4。服务器根据当前问题锁定来源策略，不能靠模型参数把官方问题改成小红书。必须先完成本轮内部检索，每轮外部Skill最多1次；13.5秒整体预算、最多6条结果、每段700字。原模型6轮/12次工具及Token预算保留。

输出status、真实URL/标题/来源/发布日期（可未知）、authority、evidenceKind、searchMode和警告。只标题不冒充正文，公开网页搜索不冒充小红书站内搜索。无关饭店/用户主页不会当广外食堂证据。外部来源卡片沿用现有UI；无真实结果时没有外部卡片，尚未取得公网外部卡片的成功截图。

`EXA_API_KEY`是可选服务端Secret，通过固定Exa地址的x-api-key头发送，不进入模型/查询体/前端。未取得现成搜索Key，未购买服务；DeepSeek模型Key不作搜索Key。Key是否能解决403仍待实际验证。

小红书Provider只调用受保护网关的POST /v1/search；网关仅转发搜索、前两篇详情，不转发发布/评论/点赞/收藏，不下载图片，不复制日常浏览器会话。Cookie留在本机忽略目录。启动与扫码步骤见[服务说明](../../../services/external-search/README.md)。

## 数据和资源

外部模块没有D1 SQL、迁移或索引写入，外部文章不进入公开文章库，仅随既有聊天保存有限引用。原公开资格复验、下架、墓碑、正文许可和地图回执保留。未重新采集入口、重分类、改公众号工具或Production。

最新完整四问题样本：12次真实模型请求、46922个usage token；单轮7087—7831ms。聊天记录中可测语句合计2071 rows_read/48 rows_written，rowUsageComplete=false，且计量快照在收尾前，**不是完整聊天账单**；外部Provider自身0读0写。之前诊断尝试另有调用，不能将这一轮样本当本轮所有诊断总费用。

[云端聚合样本](cloud-metrics.json)为19:40—19:44UTC整个既有Worker的57次请求（含其他页面、Cron）：CPU P50 10.741ms/P95 838.802ms，错误0。不是外部搜索逐接口CPU，未据此宣称容量达标。[tail记录](cloud-invocations.json)CLI异常退出无逐接口样本，如实保留。

## 测试与发布

针对性71项通过（[原始回执](unit.json)）；全仓476项/462通过/14失败，失败名称与387386d保存的基线相同，新增失败0，见[unit-summary.json](unit-summary.json)。原目录16项断言更新为16+本次授权扩展，实际执行器限制不放宽。

类型检查、修改文件ESLint、Next/OpenNext构建通过。最新Preview Worker为c720d29f-9f09-476a-b794-28f2c23583d2。公网外部E2E失败，未把本地成功计为公网成功；内部限定查询的最终浏览器复核另存internal-browser。最初运行数据保留[browser-before-runtime-fix.json](browser-before-runtime-fix.json)。

最终版本Edge限定内部流程1项通过/12秒：真实问题“广外图书馆怎么借书？只用内部文章概述借书操作，不要联网”，实际只调用search_campus_knowledge，来源可点击、页面错误0，见[internal-browser/live.json](internal-browser/live.json)。该运行仅验证内部路径，未执行其余三个外部场景，不是完整外部验收通过。

## 准确续做点

1. 解决搜索服务对Worker的403：等待负责人现成搜索服务凭据/可用后端信息；已有EXA_API_KEY入口，不能保证Key必然解决网络拒绝。不得自动购买套餐。
2. 负责人扫码完成专用小红书登录，并让只读网关有稳定、可连接的HTTPS地址，再配置Preview的GATEWAY_URL/TOKEN。不要暴露18060写接口或上传Cookie。
3. 重跑external-search-live.spec.ts的官方资料、经验、普通互联网四问题验收，实际返回相关原文链接与来源卡片后才记公网可用。另补小红书登录过期、重启和并发的真实成功验证。

当前没有真实外部搜索结果可以产生地图动作；原S3-D地图已完成回执继续以既有验收为准，没有用未核实的外部位置生成坐标。
