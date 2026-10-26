# Preview 云端搜索、模型优先级与登录修复

## 当前结论

普通联网搜索已迁到 Cloudflare，停止本机 external-search 的 server/runner 后，真实 Agent 能取回并引用图书馆官网页面。首选模型已切换为 Step Plan，现有 DeepSeek 仅在首选明确额度耗尽时接替。Preview 日/小时验证配额已放开。

**小红书原生云端搜索尚未通过验收。** 后台二维码和检测交互已经修复，登录状态可加密保存，但负责人多次确认后仍回到登录页。源站曾对登录状态接口返回 HTTP 471；最终实时用户状态为 guest，原生搜索返回 login_required、0 条。加密文件存在不能证明当前会话有效，不能用普通网页的小红书摘要冒充原生搜索成功。不再要求负责人重复扫码。

## 部署范围与结构

- 只改 Preview，Production、文章、分类、阅读 HTML/CDN、地图和公众号采集架构保持。
- 主 Worker：`campusos-preview`，`EXTERNAL_SEARCH_TRANSPORT=cloud`，私有 Service Binding `CLOUD_SEARCH`。
- 搜索 Worker：`campusos-preview-cloud-search`。入口 Bearer 验证、8 KiB 输入限制、明确只读路由。
- 普通网页：一个 `lite` Container，Node 22，原有 Exa 免 Key 查询实现；空闲 2 分钟休眠。没有购买搜索 Key 或升级套餐。
- 小红书：Cloudflare Browser Run + 单一 ManagedXhs Durable Object，固定当前实例名 `campusos-preview-xhs-v2`。旧实例已关闭后切换，防止旧常驻连接继续执行旧代码。
- 登录状态：私有 R2 `campusos-preview-search-sessions`，AES-256-GCM，随机 IV、固定 AAD；内容哈希不变不重复写。仅保存专用云端 context 的 cookies/localStorage/IndexedDB，**不是完整 Windows 浏览器 profile**，不读取日常浏览器。
- 本机旧实现保留以便维护，当前云端路径不需要本机网关/runner、Docker 或电脑持续开机。普通联网搜索已实际验证这一点；小红书仍受下述登录阻塞影响。

## 本轮具体修复

1. 等待扫码时点“检测登录状态”原先清空二维码及有效期，自动轮询随之停止。现在保留尚未过期的 challenge，成功或需要安全验证时才收起；桌面与模拟手机均有红→绿回归。
2. 原先浏览器默认 60 秒空闲期短于扫码窗口。现在 `keep_alive=240000`，持久记录 Browser session ID，isolate 重启时先重连，失效时才从加密状态恢复。
3. 原先仅看页面初始状态/导航 DOM。现在观察源站实际 `user/me`：明确非游客身份才确认；guest 或 -101 取消确认；HTTP 471 记录安全验证。不使用 Cookie 存在或用户口述代替成功。
4. 识别源站实际出现的 `webapi.rednote.com`，不能仅监听 `edith.xiaohongshu.com`。维护回执只记录状态、HTTP/code 和时间，不记录身份或认证值。
5. 检测本身不再打开额外页面或刷新登录页，避免干扰扫码重定向。只有管理员主动“重新登录”才获取新 challenge。
6. 二维码取原始 PNG 像素，不截取可能受遮罩/裁切影响的 DOM；白底留边。真实 128×128 PNG 已经本地解码核对，二维码本体不提交。
7. 增加管理员专用“连接云端登录”→“打开云端登录页”。复用 Cloudflare Live View，在同一个云端浏览器里由本人处理登录/验证。链接仅短期保存在管理员页面内存，独立 POST、管理员鉴权、CSRF，地址限制 `https://live.browser.run/ui/`，不进入 D1/日志/公共来源。
8. 首选模型偶发无效工具参数可在执行前纠正一次，反馈携带实际 JSON Schema。权限/业务错误、第二次失败和写入工具不自动重试；无效调用不执行。不会通过放松 Skill Schema 来迁就模型。

## 模型与验证额度

Step Plan 服务端白名单端点为 `https://api.stepfun.com/step_plan/v1`，模型 `step-3.5-flash-2603`。密钥按 anykey.md 的供应商分节读取，不使用全文件首个 sk 字符串。密钥仅进入服务端 Secret，未写入 Git。

Step 和既有 DeepSeek 各完成 3 次真实生成/Tool Calling/工具结果续答/流式及 JSON 连接验证。quota-only 切换由确定性单测验证；没有人为耗尽真实余额制造切换。普通限流、认证失败、网络故障和已经开始输出的流不触发后备。模型能力凭证现有 24 小时有效期规则保留。Step 或跨供应商用量不引用 DeepSeek 价表，不把 token 数冒充账单金额。

0052 已应用，远端迁移列表无待执行项。只有 Preview 的服务端 `AGENT_VALIDATION_UNLIMITED=true` 能跳过原日/小时/累计 token 配额；同一用户一次活动对话、Preview 总并发 16、每轮工具/模型次数、输出预算、超时和权限继续生效。Production 默认 0 保留原配额。未删除历史对话/文章或重建 D1。

## 真实证据与性能

`verification/cloud-search/` 保存脱敏回执。成功联网问答实际调用 `search_campus_knowledge` 和 `search_external_campus_info`，外部 provider 为 `exa_web_cloud`，不是本机 relay。

真实来源包括：

- [图书借阅规则](https://lib.gdufs.edu.cn/fwzn/fwqykfsj/tsjygz.htm)
- [读者借阅权限表](https://lib.gdufs.edu.cn/fwzn/fwqykfsj/dzjyqxb.htm)

一个已成功的真实请求中，外部搜索部分 D1 rows_read / rows_written 为 **0 / 0**；内部 RAG 为 **107 / 0**；整轮采样 **380 / 15**，`rowUsageComplete=false`，因此不是完整账单或所有写入的精确总额。实时采样见 JSON，不能由单次请求推算日额度。

一次 60 秒主 Worker tail 捕获两个 chat 样本 CPU **67 ms / 41 ms**，wall **7932 ms / 8220 ms**；包含一次工具参数失败样本，不是全量成功延迟。云端搜索 Worker 单独 tail 虽接通但未捕获记录，不能声称测得其 CPU。Browser Run、Container、R2 的货币账单未取得，不提供虚构费用。

普通网页免 Key 服务仍可能限流或超时。源站不允许访问时返回真实 unavailable；没有代理轮换、验证码自动处理、改变浏览器身份或绕过风控。

## 测试和限制

- 全仓单元最近一次：524 项，510 通过，14 失败；失败名称与先前 506 项基线的 14 项完全一致，新失败 0。后续目标测试另存运行回执。
- typecheck 与实际 Preview 构建通过。全仓 lint 仍有已有备份脚本 1 条 warning 和公众号回归脚本 3 条 require 错误；新增生成 bundle 已排除，不改其他模块旧问题。
- 桌面/模拟手机 QR 保留与轮询回归通过；真实管理员 Live View 入口通过。真实模型问候和网页搜索已有公网成功回执；模型工具参数的间歇错误与后续重测结果分别保留，不删除失败证据。
- 小红书：原生笔记/正文及登录后重启恢复 **未通过**。重启读取加密状态后仍为游客；当前 0 条不能宣称真实搜索成功。源站 HTTP 471 与 guest 是已观察事实；不能仅凭这些断言其全部内部风控原因。
- 没有验证新地图动作；原有地图/RAG 未因本任务被重写。没有取得长期容量、真正手机及长期登录稳定性回执。

## 文件与后续断点

核心文件：`services/cloud-search/{worker,managed-xhs,server,build}.mjs`、该目录 Dockerfile/config；`external-search/cloud.ts`；`models/{runtime,router,deepseek,priority,verify}.ts`；Assistant store/model-run/http-context、Agent orchestrator；Console API/dashboard-panels/console.css；0052；凭据分节及验证/部署/诊断脚本；对应单元和 E2E。

后续首先定位同一专用云端浏览器登录后返回游客的源站过程，读取有界 sourceEvents；必须以真实笔记 URL、正文和重启后再次搜索成功作为解除条件。暂不继续要求重复扫码，不恢复本机依赖来冒充关机可用，也不购买其他服务来掩盖失败。

Cloudflare 官方 [Live View 说明](https://developers.cloudflare.com/browser-run/features/live-view/)为本次人工接管接口依据；运行代码同时复核已安装的 @cloudflare/playwright 类型契约。

## 凭据处理事件

本轮早期旧解析器曾误选文件内的 DeepSeek 密钥发送到阶跃连接测试，导致 401；已向负责人披露。现已按供应商分节严格分离，正确 Step 密钥验证成功并部署。建议负责人轮换那把 DeepSeek 密钥；本次没有擅自轮换、输出或提交真实密钥。

最后公网复测：补充实际工具Schema后，普通联网问句连续两次通过（测试总时长12.1s/11.1s）。保留此前1次同类失败；两次通过不等同长期稳定性证明。
