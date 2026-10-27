# redbook 候选：隔离云端检索与 Agent 引用已验证

**结论：现有 Cloudflare Containers 已能运行这个小红书只读后端，当前没有必要购买国内 VPS。** 本次验证取得真实笔记及正文、容器重启后免再次扫码读取成功，并复用现有 Agent 核心完成真实模型工具调用、原文引用与证据核对。

**范围：这是独立私有验证服务，当前 CampusOS Preview 的搜索绑定与后台登录模块尚未切换。** 不能把本报告解释为普通用户页面已经使用新后端；没有部署 Production、购买服务器或第三方代采 API。

## 真实结果与证据

| 检查 | 结果 | 回执 |
|---|---|---|
| 本人正常授权 | 2026-10-27 12:51，北京时间；源站 user/me 明确非游客 | authenticated/login-confirmed.json |
| 请求参数对照 | 同一会话、同一“广外”关键词：page_size=3 只含has_more，20返回22条目 | authenticated/page-size-ab.json |
| 本机新客户端 | 真实3条笔记、其中2篇正文 | authenticated/local-canteen.json |
| 本机Linux Node22容器 | 同样取得3条、2正文 | authenticated/local-docker-node22.json |
| 独立Cloudflare容器 | 真实3条、2正文，确认与本机使用同一份加密快照 | authenticated/cloud-probe.json |
| 云端容器停止/重新启动 | 不重新扫码，再取3条、2正文 | authenticated/restart.json、cloud-after-restart.json |
| 不同校园关键词 | 南苑宿舍、南校食堂推荐均取得真实笔记和正文 | authenticated/cloud-dormitory.json、cloud-canteen-recommendations.json |
| 鉴权 | 无Bearer请求401，不进入源站 | authenticated/unauthorized.json |
| 真实Agent | Step首选模型3次请求，依次调用内部检索、外部只读Skill，完成2篇真实来源引用 | authenticated/agent-live.json |

这里的22条是搜索响应条目数，不是22次请求；下游最多返回3条，最多读取前2篇正文。实测每次完整探针是 **1次身份校验＋1次搜索＋2次正文＝4次源站HTTP请求**。没有结果缓存、预置笔记、图片下载或自动入库。

本次发现的page_size兼容问题属于新客户端验证参数；不能据此宣称已经找到旧Browser Run登录失效的全部原因。凌晨的-100、访客-104与原浏览器游客状态保留在目录顶层，属于重新授权前的历史，已不代表这次新会话的状态。

## Agent 验收方式与边界

复用现有 AgentOrchestrator、SkillRegistry、ModelRouter/优先级规则，以及 registerExternalSearch。内部知识Skill通过现有Preview `/api/content/search` 读取真实公共检索结果；小红书Skill通过独立云端接口取数据。没有编写第二套生产Agent，也没有虚构内部检索。

最终测试按服务端业务顺序先内部、后外部、再生成答复，不声称模型完全自主规划。它实际引用了两篇正文，提取明确正面原句，注明2025年/2026年，说明当前营业状态需现场确认。引句在相应正文中做精确匹配，引用按平台和真实笔记ID核对；查询参数被模型清理时，来源卡片仍用工具原始URL。

回执中的answerExcerpt是节选，引句作长度截断；原答复哈希、长度与证据匹配元数据保留。完整临时响应及原模型输出只在忽略目录供本机复核，不固化为公开文章语料。验证服务运行时不读取这些验收材料作为搜索结果。

先前失败均保留：第一次未完整收尾；一次上游明确finish_reason=length/1024；一次受客户端固定1024上限拦截。验收新增服务端显式输出上限选项，默认仍1024、允许配置范围1–4096；本次规划阶段1024、最终2048、整轮保留4096硬预算。**线上默认预算未改变，也不能由这个小样本断言所有正式请求必须提高上限。** 正式接线还应复用已有来源编号格式降低输出负担。

## 资源与测量

最终有效Agent样本：3次真实Step请求，prompt 4032、completion 734，共4766个usage token，总运行15155ms；2次真实工具调用、2篇来源引用。内部检索样本读取0/写入0/1查询/0命中，不能当作已有相关内部证据；其他测试内部检索有1032读取、0写入的样本。

云端搜索服务无D1绑定，不新增文章/会话表。R2保存专用会话的独立AES-GCM密文，Secret只在服务端；每请求从同一快照加载。Worker网关/DO取得一个真实CPU样本 **4ms，wall2567ms，HTTP200**，见 authenticated/cloud-cpu-final.json。这不包含Container进程CPU；没有取得完整账单金额、内存峰值或日容量曲线。

没有测试500人负载、24小时稳定性、源站主动撤销会话后的完整管理恢复流程或真实手机。未保证账号永不过期、所有问题都有答案、平台接口永久兼容或完全零成本。没有代理轮换、自动解验证码或发帖/点赞/评论写入。

## 工程文件与复现

- scripts/prepare-redbook-session.mjs：本人在专用Edge正常登录，源站确认后导出必要会话，不扫描日常浏览器。
- scripts/evaluate-redbook.mjs：固定SDK版本、三个只读端点、请求计量、真实笔记ID匹配及最小化交付回执。
- services/xhs-redbook-eval/：独立Worker、单实例lite Node22容器、服务端Secret与R2加密会话。它不是现有Preview的服务绑定。
- scripts/inspect-redbook-evaluation.mjs：私有云端探针、重启和无鉴权测试。
- scripts/verify-redbook-agent.mjs：真实模型/现有Agent核心/真实公共检索及新云端候选的隔离验收。
- 模型客户端只有受控可选输出上限；默认行为保持，已加默认拒绝、显式允许和超上限拒绝单测。

本机依赖固定 `@lucasygu/redbook@0.8.2`，安装与容器构建均禁用安装脚本。服务端只接受鉴权请求，限固定只读操作和主机，不接受任意目标URL、Cookie或模型指令作为公共入参。

```powershell
npm install --prefix .map-tools/xhs-provider-eval --no-save --ignore-scripts --no-audit --no-fund @lucasygu/redbook@0.8.2
node scripts/prepare-redbook-session.mjs
node scripts/evaluate-redbook.mjs
node scripts/inspect-redbook-evaluation.mjs probe
node scripts/verify-redbook-agent.mjs
```

私有云端复跑需要本次评估专用SERVICE_TOKEN、SESSION_KEY和SESSION_OBJECT，以及对应私有R2密文。它们不在Git，不能贴进聊天、命令参数或前端。构建/部署见 services/xhs-redbook-eval/README.md；没有把本机原始profile上传云端。

## 正式接线前的剩余工作

1. 将经过验证的只读Provider适配到现有生产RPC契约，同时保留普通联网搜索；当前Preview仍是旧后端。
2. 后台登录状态必须与新Provider读取同一会话权威源，授权更新、失效提示及Cookie变化维护统一，不能继续混用旧浏览器状态。
3. 验收正式聊天的来源编号渲染、模型预算、正负观点/日期处理；本次CLI不是用户页面公网E2E。
4. 小规模连续运行和真实峰值/排队/缓存测试，之后才判断500人容量。平台实际拒绝时返回明确失败，不补编内容。

来源为公开学生经验，只临时用于问答和引用，不确认学校政策、截止日期或地图坐标，不自动进入官方知识库。源码依据：https://github.com/lucasygu/redbook ，测试版本0.8.2/MIT；第三方接口使用与长期维护条件仍须持续核实。
