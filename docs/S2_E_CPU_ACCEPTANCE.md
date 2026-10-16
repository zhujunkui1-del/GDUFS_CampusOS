# S2-E Workers Free CPU 专项验收

日期：2026-10-16。代码基线：`a3ab24b`。**结论：完成诊断、两轮最小优化及功能回归，但 Free 10ms CPU 门槛未通过。不能据此正式开放学生规模 AI 试用。**

预览：[CampusOS](https://campusos-preview.zhujunkui1.workers.dev/map)。本轮只更新既有 `campusos-preview`，没有新 Worker/D1、数据库迁移、Secret 更新、生产域名/DNS或套餐操作。

## 1. 实际版本与测量方法

| 阶段   | 实际部署版本                         | 改动                                                           |
| ------ | ------------------------------------ | -------------------------------------------------------------- |
| 优化前 | f98aadf8-8581-49ca-befb-d9c13d38f90e | 已完成多会话的原版本                                           |
| 第一轮 | 2719e1ad-ac75-474a-86e9-6a9e3c3a2bdd | 固定 Schema 复用、健康接口直达、去相邻重复租约读、请求内图索引 |
| 最终   | 0c8cb22a-85d0-4b64-8e17-fac4063b875a | 另加载离线公开建筑道路候选索引                                 |

最终 Deployment ID：`85aa9810-10b5-4a75-af32-8f7c8590b7f9`。安全构建产物 15092.80KiB，gzip 2462.92KiB；平台启动校验 90ms，**不是用户请求冷启动耗时**。账户 UI 明确显示 Free，`usage_model=standard` 本身不用于判断套餐。

采用三个互相区分的证据来源：

1. **真实 Cloudflare 调用**：`wrangler tail --config wrangler.jsonc --env preview --format json`，只保存路径、时间、CPU、Wall Time、状态和异常数量，不保存请求头、Cookie、正文、日志或异常原文。CPU/Wall 单位为毫秒；0是平台记录粒度，不表示完全没有CPU消耗。
2. **Worker Metrics / Invocation Status**：官方 GraphQL `workersInvocationsAdaptive`，按 Worker 和 UTC 窗口查询。CPU/Wall 字段是微秒，不能直接当毫秒。D1 行用量单独取官方指标。
3. **函数热点**：官方线上 Profiling API 两次取得可解码 pprof，但只有 root/idle 各类，没有应用函数；另外两次 API 和控制台在真实流量期间提示未找到近期执行。故**没有可用云端函数级归因**。改用官方 V8 Profiler 协议采集本地 workerd，源码行映射定位热点；其采样时间不冒充公网每请求 CPU。

Workers 的同步计时器并非独立 CPU 时钟，`performance.now()` 的纯计算段可为 0；模型和 D1 等待属于 Wall Time。参见官方 [CPU/限额](https://developers.cloudflare.com/workers/platform/limits/)、[Profiling](https://developers.cloudflare.com/workers/observability/profiling-in-production/)、[计时器](https://developers.cloudflare.com/workers/runtime-apis/performance/)。官方也说明 isolate 存在偶发超额弹性，因此“没有 1102”不等于满足 10ms。

证据目录：`docs/verification/s2-e-cpu/`。`profile-observation.json` 保留线上捕获限制；`before/thin/local-profile.json` 为本地函数采样。原始 profiler 文件仅在被忽略的 `.map-tools/cpu/`，公开证据不包含认证资料。

## 2. 可复现基线及真实 CPU 对比

确定性 HTTP 测试每轮依次请求页面、健康、状态、会话及五个真实 Skill，共 6 轮/54 请求，间隔 750ms，不调用模型。真实 Agent 使用现有 Chrome 桌面 A–G 测试，8条用户输入/19次上游模型请求。最终另测 Edge 手机视口和详情。

百分位为实际采集样本的最近秩统计；小样本 P95 可能就是最大值。初期校准还包含拒绝的非法类别请求，保留在原始记录；关键 Agent/路线请求均为实际成功建立的 HTTP 200 链路。Tail 不是完整账单，未收到的记录不补零。

### 全窗口 CPU（P50 / P95，毫秒）

| 请求               | 优化前       | 第一轮       | 最终         |
| ------------------ | ------------ | ------------ | ------------ |
| `/map`             | 6 / 26       | 4 / 19       | 6 / 17       |
| `/api/health`      | 8 / 191      | 0 / 2        | 0 / 1        |
| Agent 状态         | 1 / 4        | 1 / 4        | 1 / 3        |
| 会话恢复           | 2 / 7        | 2 / 8        | 2 / 9        |
| search_places      | 3 / 8        | 2 / 7        | 3 / 6        |
| get_place_details  | 3 / 4        | 2 / 4        | 2 / 4        |
| find_nearby_places | 3 / 5        | 2 / 3        | 2 / 3        |
| plan_route         | 19 / 166     | 19 / 167     | 19 / 29      |
| control_map        | 2 / 4        | 2 / 3        | 2 / 4        |
| 地图动作领取       | 7 / 11       | 4 / 9        | 3 / 13       |
| 地图动作回执       | 3 / 5        | 3 / 3        | 2 / 5        |
| Agent chat         | **68 / 316** | **45 / 356** | **48 / 116** |

窗口调用数分别为 104、89、185；`exceededCpu` 均为 0。**最终 27/27 个 Agent 调用 CPU 超过10ms，最大127ms；6/6个直接路线调用也超过10ms。** 地图页面最大31ms、一次领取动作13ms，亦尚未留足余量。保留早期 S2-E 曾真实发生的 exceededCpu 记录，不将本轮零次错误覆盖历史。

### 同一组 Chrome 桌面任务

| 指标（P50 / P95）     | 优化前        | 第一轮        | 最终          |
| --------------------- | ------------- | ------------- | ------------- |
| CPU，8次              | 68 / 316ms    | 45 / 356ms    | 34 / 65ms     |
| 首字，7次有正文       | 5611 / 6107ms | 5949 / 6598ms | 4806 / 5533ms |
| 完成，8次含预期未找到 | 6140 / 6814ms | 5496 / 7262ms | 4639 / 6056ms |
| D1 调用数             | 21 / 25       | 19 / 22       | 19 / 22       |
| D1 累计 await         | 1453 / 1766ms | 1377 / 1992ms | 466 / 637ms   |
| 动作至实际回执，6次   | 1833 / 1868ms | 1857 / 1892ms | 1607 / 2386ms |

前两轮客户端入口为 HKG，最终为 NRT；不能固定同一 isolate 或冷暖状态。网络/D1等待明显不同，**不把全部 Wall/首字改善归因于 CPU 优化**。动作 P95 本轮没有改善。完整逐场景数值及工具名见 `comparison.json`。

### 官方 Metrics、D1 和模型成本

- 基线官方 Metrics：127请求、93子请求、0运行错误；全类型聚合 CPU P50/P95 4.808/80.827ms。
- 最终官方窗口 09:59:40–10:07:54 UTC：220请求、253子请求、0运行错误；全类型聚合 CPU P50/P95 3.731/51.179ms；D1读31108行、写730行。**聚合值不能替代 chat 分路径值**，窗口也与 Tail 略有不同。
- 预览 D1 对相同模型窗口只读聚合：27个Run，23完成、3个预期 NOT_FOUND、1个 INVALID_ARGUMENT 被拒；67次真实上游请求、97591 Token。已记录 D1 调用482次、读语句364、写语句340；批次/受影响行与语句数量不相同，结束快照也不包含随后 finish 或独立动作接口的全部读写。
- 依服务端既有2026-10-15价格快照估算 USD 0.008497–0.016994。并非供应商独立账单；本轮再次访问价格页超时，未擅自改价或扩大预算。
- 原1元授权累计账户余额下降：开始0.31元、第一轮后0.38元、最终0.43元；最终阶段余额差约0.05元，可能含其他并发使用。没有充值。站点滚动24h为191/200次，未重置或提高额度，停止追加模型探测。
- **未可靠测得**：单个生产 isolate 的完整内存、每个Agent请求的全部内部子请求数、独立模型结算费用、多地域长期P95。记录了应用D1调用和上游次数，不把它们当平台全部子请求。

## 3. 热点与实际改动

| 项目             | 证据与处理                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next/OpenNext    | 状态/会话已走原轻量入口，健康接口仍走完整Next路由；冷调用180/191ms。新增健康原处理函数直达，同样错误/响应和安全头，最终0/1ms。页面仍由原OpenNext静态缓存处理，没有重写页面路由架构。                                                      |
| 公共建筑道路候选 | 本地冷采样集中于 distanceMeters、projectOnPath、closestToBoundary；路线云端P95约166ms。使用原函数离线生成113地点/445候选/74398字节索引，服务端一次严格校验并按原版本加载；每处最多16个，与原选择顺序/8米去重规则一致。最终路线P95为29ms。 |
| 图查找           | 请求内建立节点/边ID索引，替换反复线性查找，不改最短路、隧道约束、可通行规则和坐标计算。单独第一轮未观察到路线稳定收益，不夸大该项效果。                                                                                                   |
| 固定Schema       | API、DAO、Orchestrator中的固定Schema移到模块级；参数/输出/历史/回执仍每次验证。原Skill JSON Schema WeakMap已经存在，继续复用，没有另建Registry。                                                                                          |
| 运行租约/D1      | 原请求存在相邻两次相同 running 查询，期间没有其他异步操作；保留每次上游调用前（含纠正重试）和结束后的活跃所有权/租约检查，去掉相邻重复读。2次上游测试由4次检查降为3次；所有取消/删除约束保持。                                            |
| 私人缓存         | 原 endpointCache 会用设备/自由选点坐标作全局键，本轮仅允许真实公共地点的规范坐标缓存。设备/手动坐标仅在当次计算中使用，不进入公共索引或全局缓存。                                                                                         |
| 工具定义/JSON    | 原参数Schema已冻结复用；每轮仍有预算及供应商请求序列化。对象有长度/数量边界，没有可用云端函数样本证明其为主热点；本轮未缓存私有历史/工具结果，未编写可能绕过预算的新序列化协议。                                                          |
| SSE              | 供应商逐行解析与最终正文流有1MiB/单帧/文本长度边界；规划文字与内部推理仍不展示。去除Orchestrator逐delta新建固定Schema；没有改SSE协议、取消、代次保护或实际地图回执。尚不能给出剩余SSE CPU的可靠百分比。                                   |

公开候选索引不是最终路线缓存。每次路线仍实时计算，生成新ID，检查请求身份、版本、TTL、会话所有权并保存可信记录。没有缓存私有会话、定位、地图动作或写操作。

生成器 `scripts/prepare-route-metadata.mjs` 只读已审核固定快照；`npm run map:route-metadata` 为明确的离线重建命令。普通 Next/OpenNext 构建只检查源文件SHA，不自动更新地图，过期则失败。新增索引与地图/路网版本绑定。239组与 `a3ab24b` 的路线对比，除随机ID外几何、距离、步骤、隧道及模拟设备接入全部完全一致。

## 4. 功能、安全与失败记录

- TypeScript、Lint、233单元/31文件通过；本地35表约束/外键、两个独立workerd的配额/身份/路线/重启恢复通过。
- 真实HTTPS：Chrome桌面A–G通过；Edge手机视口A–G及图书馆查询复测通过，详情测试实际调用get_place_details并显示7层/约21米。五Skill另以真实确定性HTTP执行，不能将Mock聊天当真实模型。
- Edge首轮G发生真实模型无效参数，服务端拒绝，未编造成功动作；原始证据 `final/browser/msedge-mobile-initial-failure.json` 保留。只做一次整组受控复测，没有增加自动重试。模型参数随机失败风险仍在。
- 首次手机详情测试没有重新打开自动收起的AI抽屉，工具调用已通过而正文定位器找不到。修正测试重开同一抽屉后，保留原工具、7层、21米断言，真实API复测通过；没有为测试改变产品行为。
- Chrome、Edge桌面+手机视口常规10spec（含多会话）各79通过/3跳过（原生外框2项、桌面不适用手机1项）；结果见 `test-results/cpu-regression-*.txt`。定位用既有公开坐标夹具；**不是手机实机/GPS验收**。
- OpenNext构建净化及实际预览入口dry-run扫描通过；本地/预览实际模型Key和签名、已提供的高德私密值在源码/构建产物均无命中。
- 原S2-D全代码冻结检查因本轮明确优化 `local-routing.ts` 返回false，保留原结果，不删除原守卫。专项检查独立核验30个固定地图JSON/公开资源SHA不变、239条路线一致、元数据源SHA及原凭据检查全部通过，见 `final/cpu-release-integrity.json`。
- 南苑7栋GLB SHA保持 `54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a`；固定地图s1-2026-10-14.2、路网s1-campus-2026-10-14.2、113地点/547节点/2202边不变。没有新增建筑/Skill/地图供应商。

实际截图：[Chrome路线](verification/s2-e-cpu/final/browser/chrome-desktop-B-route.png)、[Edge手机路线与模式](verification/s2-e-cpu/final/browser/msedge-mobile-D-3d.png)、[Edge真实详情](verification/s2-e-cpu/final/browser/msedge-mobile-verified-details.png)。

## 5. Free未达标原因与后续方案

已消除固定建筑首次候选扫描这一可证实的尖峰，但完整单请求Agent循环仍包含多轮供应商解析、工具验证、共享D1状态以及地图动作/回执生命周期，实测27/27超10ms。路线本身仍约19ms，页面/领取也存在超额样本。最终本地冷采样中planLocalRoute含子调用由87.35ms降到8.68ms，原closestToBoundary热点消失；暖采样仍见planCandidateRoute/distanceMeters，这些本地数值只用于定位，不能代替云端CPU。没有函数级云端样本支撑继续宣称某个小函数修完即可达标，也不声称理论上证明所有优化均不可能。

**当前不能解除Free稳定容量阻塞。** 公共地图可独立使用，AI只宜保留现有受限预览；不宜在同一Free预算下继续叠加RAG索引/检索或正式扩大试用。以下仅比较，均未实施或产生费用：

| 方案                                    | 可能收益                                            | 费用与风险                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 同Worker构建轻量Agent入口、按需加载Next | 进一步减少框架冷路径/共享大包影响；可复用原业务函数 | 继续Free、无新增订阅；已有直达入口说明单纯绕过Next还不足，需本地隔离原型和再次云端CPU验证，不保证<10ms。改造风险中等。                                                        |
| 独立轻量API Worker                      | 隔离Next生命周期、单独分析Agent依赖和CPU            | Free下10ms上限仍在，不能靠拆Worker承诺解决；需要另批新资源、同源代理/身份/Secrets/部署运维，多请求会增加额度与D1开销。风险中高。                                              |
| 将Run分成受限执行阶段                   | 可能把单次CPU分散到多个小请求                       | 可继续Free但提高请求/D1用量，必须可靠处理租约、取消、重复动作和跨阶段恢复；复杂度最高，不作为本轮最小修复。                                                                   |
| 现有Worker升级Paid                      | 配置CPU预算后给当前48–116ms负载留下直接余量         | 官方示例基础订阅$5/月，按量另计；必须负责人另行明确批准，仍保留应用配额和CPU上限。本轮没有升级。参见[官方价格](https://developers.cloudflare.com/workers/platform/pricing/)。 |

建议下一步先决定“坚持Free开展轻量入口原型”或“另批有限Paid预算后验收”。轻量原型也必须用实际CPU判定，不能以拆分架构或没有报错代替验收。

## 6. 复现与后续更新

```powershell
# 只读云端配置/状态核对；账户值由本机可信配置显式提供
$env:CLOUDFLARE_ACCOUNT_ID='<已核对账户>'
$env:CPU_CAPTURE_DIR='test-results/cpu-new'
node tests/integration/cpu-cloud.mjs

# 先开一个终端收集Tail，再运行HTTP和低频浏览器用例
$env:PREVIEW_TAIL_CAPTURE='test-results/cpu-new/invocations.json'
$env:PREVIEW_TAIL_MS='240000'
node tests/integration/preview-tail.mjs
node tests/integration/cpu-requests.mjs
node tests/integration/cpu-summary.mjs test-results/cpu-new --assert-free
# 本轮该断言退出1是如实记录CPU未达标，不能改成“0错误即通过”。

node scripts/prepare-route-metadata.mjs --check
node tests/integration/cpu-route-equivalence.mjs
node tests/integration/cpu-release-integrity.mjs
```

真实模型用例先执行 `preview-budget.mjs`，检查站点额度；只在明确授权且余额/能力有效时设置 `E2E_LIVE_AGENT=1`。模型记录有24小时有效期，过期应重新受控验证，不能改时间伪造有效。

后续继续用 `npm run deploy:preview` 明确部署隔离环境；构建强制元数据源校验、凭据净化和最终bundle扫描。若应用回滚到f98版本，D1仍兼容0005，无需数据库回滚，但会恢复原CPU高峰。本轮没有执行回滚、迁移、数据库重建或清空。生产发布仍需额外批准。
