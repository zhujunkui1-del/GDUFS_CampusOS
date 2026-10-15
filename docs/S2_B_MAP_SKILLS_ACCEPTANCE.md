# S2-B｜首批五项地图 Skills 验收

日期：2026-10-15。基线：cc16201。范围为可信服务端地图能力与工具调用；AI聊天界面/卡片/SSE消费留S2-C，建筑批量建模继续暂停。

## 1. 结论

五项Skill全部实现并注册到现有S2-A SkillRegistry，由原ToolExecutor验证执行。真实DeepSeek自主选用五项Skill的三场景测试通过；没有替换Agent、地图供应商、固定地理版本或步行算法。

- 地点数据：既有campus.json（113条），可检索标签沿用searchCampusPlaces的去重规则。
- 路网：既有planLocalRoute / 547节点、2202边，networkVersion=s1-campus-2026-10-14.2；mapVersion=s1-2026-10-14.2。
- 南苑7栋原2.5D参数、第二版GLB均保留，SHA256仍为54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a。
- 数据只从本地版本读取，不因Agent调用下载GIS或调用高德在线底图/路线。

## 2. 五项技能

所有输入/输出为严格Zod对象，输入同时导出JSON Schema；公开权限、无业务写入、不要求登录、版本1.0.0。来源引用指向已使用的OSM资料。工具参数不能传userId、会话ID、GPS坐标、授权标志、任意JS/SQL或输出几何。

| Skill | 输入概要 | 输出/校验 | 超时 | 主要错误码 |
|---|---|---|---|---|
| search_places | query，category?，limit?≤20 | 稳定ID/名称/别名/类别/区域/WGS84/核验；精确、部分、有限单字模糊；候选与歧义标志 | 2s | INVALID_ARGUMENT、NOT_FOUND |
| get_place_details | placeId | 真实详情、来源、核验、父轮廓；只有南苑7栋有已知7层/约21米；其他未知值null/unknown | 2s | INVALID_ARGUMENT、NOT_FOUND |
| find_nearby_places | origin?，category?，radiusMeters?≤2000，limit?≤20 | WGS84大圆几何距离排序，中心来源明确；空结果不扩大半径 | 2s | INVALID_ARGUMENT、LOCATION_REQUIRED、OUT_OF_CAMPUS、NOT_FOUND |
| plan_route | start，endPlaceId，mode=walking，preferences? | 实际路径/地下段/定位接入段/距离/估时/步骤；版本和跨区隧道再次检查 | 8s | INVALID_ARGUMENT、NOT_FOUND、LOCATION_REQUIRED、OUT_OF_CAMPUS、ROUTE_UNAVAILABLE、INSUFFICIENT_DATA |
| control_map | actions[1..8] | 原子验证整个批次，只生成intent_only；地点真实，路线属本会话/未过期/版本一致 | 2s | INVALID_ARGUMENT、NOT_FOUND、ROUTE_UNAVAILABLE |

共用错误还包括FORBIDDEN、TIMEOUT、CANCELLED、UPSTREAM_ERROR。原ToolExecutor的结果大小/权限/输出Schema验证继续生效。

### 地点匹配

复用searchCampusPlaces并补充NFKC、空白和宿舍中文数字规范化。有限模糊匹配只匹配已存在名称/别名，且不改变数字编号；模糊或多候选标ambiguous=true。不存在的“南苑999栋”返回NOT_FOUND。查询“最近的食堂”只返回实际食堂候选并标requiresOriginForNearest，不能将默认搜索顺序伪装成距离排序。

### 起点与定位

origin/start取以下之一：place+placeId、selected_place、device_location。选中地点来自已校验上下文，输出source=selected_map_place。无起点/无定位授权时返回LOCATION_REQUIRED，要求选择起点或授权定位。

模型只引用device_location，不能提交坐标或自行声明授权。定位必须由受控调用方提供当次浏览器授权上下文，限30秒、误差≤100米、校园或既有隧道缓冲范围。授权位置路径在单元测试使用公开宿舍坐标夹具验证，不称真实手机GPS验收。当前普通HTTP工具入口拒绝传入定位授权，浏览器授权与服务端上下文的实际传递由S2-C显式接入；不会提前上传、长期存储用户位置。

### 路线与地图动作

路线仍由原函数执行。服务边界内部适配原RoutePoint的GCJ02类型，输出统一WGS84；测试验证几何累计长度与原算法距离差<1米。保留必经下沉隧道、A—G教学实验连片通行、语心桥、设备虚线接入、建筑周边到达。无障碍资料不足明确拒绝。路线失败不会画替代直线。

支持FOCUS_PLACE、SHOW_PLACE_DETAILS、SHOW_ROUTE、CLEAR_ROUTE、SET_VIEW_MODE；兼容原OPEN_PLACE_DETAILS/SHOW_PLACES/SET_LAYER。只支持实际标签层，未实现events/moments拒绝。意图不等于前端执行成功。

前端控制器复用当前Provider的select/详情/renderRoute/stopNavigation/setMode/setLayer：FOCUS沿原600ms ease-out/遮挡避让；SHOW_PLACE_DETAILS只打开详情、不额外移动镜头；CLEAR_ROUTE走原完整退出清理；模式默认2D且受设备能力约束。不创建新地图实例、不更改镜头或渲染架构。SHOW_ROUTE须先由可信桥接载入真实快照，当前未载入ID会拒绝；服务端快照接收/卡片联动属于S2-C。

## 3. 服务端入口与隔离

- createMapAgent复用原AgentOrchestrator/ModelRouter；四逻辑域保持，生产注册表仅有本轮五项。
- 地图Agent启用stopOnToolError：失败结果已记录后立即run.failed，不能再让模型补出无依据的成功回答。S2-A通用默认行为和六轮/十二工具/超时/Token预算未改变。
- POST /api/map/skills/{name}：无模型调用的确定性接口；正文为{input, selectedPlaceId?}，16KiB/5秒限制，Origin检查、原Workers地图限流及匿名主体限制。未知工具、身份/GPS注入拒绝。
- 匿名会话使用服务端生成的随机句柄，HttpOnly/SameSite=Strict Cookie；不信任客户端userId/sessionId。每主体10分钟最多40次，最多1000个主体。
- 路线快照最多100条/10分钟，按服务端会话隔离，取回时校验map/network版本，返回克隆。当前是isolate内存，跨实例/重启/淘汰后返回不可用并重新规划；没有将GPS、路线或虚假业务种子写入D1。
- /api/agent/status列出五项真实注册能力，stage=S2-B；公开/api/agent/chat与原AI面板仍关闭，待S2-C共享主体/配额和UI接入。

## 4. 验收结果

| 要求 | 证据 |
|---|---|
| 南苑7栋 | 返回osm-way-312536955，真实名称/类别/WGS84 |
| 图书馆 | 返回osm-way-307250998 |
| 附近食堂 | 以南苑7栋为中心，1000米内实际3处；几何距离排序，未声称步行距离 |
| 南苑7栋→图书馆 | 原路网实际848.0326392899915米，约12分钟，地下段1条 |
| 跨区必须经隧道 | 路径与步骤含下沉隧道，crossesZones/usesTunnel均true |
| 教学B→实验C | 原捷径<400米且经过语心桥，不绕南侧道路 |
| 设备起点 | 受控授权公开坐标夹具验证虚线接入，过期/不准/校外/未授权拒绝 |
| 不存在地点 | 南苑999栋返回NOT_FOUND，真实模型运行失败后无control_map调用 |
| 无效ID/参数/未注册工具 | 确定性接口与Mock Agent全部拒绝，未执行SQL/JS |
| 地图动作安全 | 假地点、假路线、跨会话/过期/旧版本、未知模式及自由坐标拒绝，批次原子验证 |
| 原地图与建模 | Chrome/Edge真实本地渲染回归，导航清理/虚线/镜头/抽屉/三模式/模型/GL恢复通过 |

### Mock与工程测试

147单元测试/16文件通过（保留原108项，新增39项）；包括现有真实校园数据计算和隔离Mock负面测试。无路返回使用显式注入的null规划结果验证无虚构替代几何；不是现场道路关闭证据。

typecheck、lint、Next.js生产构建、OpenNext Workers打包及本地Wrangler预览通过。Chrome148.0.7778.97与Edge149.0.4022.80各31通过/1跳过；1440×900桌面与390×844手机视口，跳过桌面不适用的手机抽屉项。非手机实机。原生窗口调整、全量浏览器矩阵及外网部署未冒充本轮专项结果。

首轮Lint发现未使用导入，已移除；一个新增负面断言误认为北苑1栋到楼内服务点无路径，实际原周边策略可返回路线，未为迎合断言改算法，改用明确的无路注入测试后通过。

### 独立真实DeepSeek测试

npm run skills:verify:live独立于默认单测，不使用Mock，不强制tool_choice。通过原ModelRouter能力门槛与服务端凭据，最多10请求/每请求512输出Token/60秒总预算/无自动重试。

实际9次模型请求、25428ms，三场景：

1. 找南苑7栋、详情、附近食堂、定位意图：search_places→get_place_details→find_nearby_places→control_map，全部真实执行成功。
2. 南苑7栋到图书馆：两个search_places→plan_route→control_map，848米/约12分钟/经隧道，模型沿用真实routeId。
3. 不存在的南苑999栋：search_places返回NOT_FOUND，总控结束，未生成地图动作。

完整脱敏工具输入/输出与模型回复：[deepseek-live.json](verification/s2-b/deepseek-live.json)。上游内部推理、Key和Cookie均不记录。当前生成文字还含过程叙述、来源/实现词语；S2-C应以工具状态/结构卡片编排并继续收敛最终中文文案，不能把本轮原始模型回复当成已验收产品UI。地图意图没有被自动渲染，未声称完整聊天界面已可用。

公开构建资源与本轮JSON证据共30个JS/HTML/JSON/map文件按交付密钥完整值扫描，未发现密钥；固定data/public目录无变更。原凭据继续仅服务端忽略文件保存。

## 5. 实际输入/输出示例

摘录自真实Workers预览；完整五项输入/输出见[inputs-and-outputs.json](verification/s2-b/inputs-and-outputs.json)，四个浏览器/视口HTTP记录和截图也在verification/s2-b。示例routeId是当时真实生成值，过期后须重新规划。

```json
{"skill":"search_places","input":{"query":"南苑7栋"}}
```

结果包含placeId=osm-way-312536955、name=南苑7栋、category=dormitory、zone=living、crs=WGS84。

```json
{"skill":"get_place_details","input":{"placeId":"osm-way-312536955"}}
{"skill":"find_nearby_places","input":{"origin":{"type":"place","placeId":"osm-way-312536955"},"category":"canteen","radiusMeters":1000}}
{"skill":"plan_route","input":{"start":{"type":"place","placeId":"osm-way-312536955"},"endPlaceId":"osm-way-307250998","mode":"walking"}}
```

详情返回7层/约21米与来源；附近为风采园、博雅园、文采园（实际几何距离约159/296/345米）；路线返回WGS84 LineString、距离848.0326392899915、预计秒数678.4261114319932、estimatedMinutes=12，以及地下段/步骤/版本/有效期。

control_map的actions使用前一步返回的routeId，可同时包含FOCUS_PLACE、SHOW_PLACE_DETAILS、SHOW_ROUTE、SET_VIEW_MODE(3d)、CLEAR_ROUTE；成功输出execution=intent_only，明确不声称已经移动或清除了用户地图。

## 6. 进入S2-C的条件

**具备进入S2-C的服务端能力与真实工具闭环条件。** 公开聊天启用前，S2-C须完成：

1. 共享匿名会话/所有权存储、跨实例路线快照与共享额度，并验证取消/重试不产生过期动作。
2. 浏览器授权定位的显式最小传递与30秒失效；当前无授权时继续要求起点，不能自动上传位置。
3. 复用原全局面板消费SSE，卡片与已验证MapAction桥接，将真实路线快照载入现有地图后再SHOW_ROUTE。
4. 中文精简文案、工具状态和终端错误、前端执行回执；合理保留会话/地图状态，复验抽屉避让与退出清理。
5. 重新验证自然语言四场景、真实API故障降级与两端浏览器。云端Secret/HTTPS部署及真实手机硬件仍需单独验收。

完整BYOK、RAG、个人/学校服务和批量建模未在本阶段扩展。
