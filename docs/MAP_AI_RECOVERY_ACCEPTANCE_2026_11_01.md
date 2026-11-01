# 2026-11-01 地图持续定位、AI恢复及账号入口验收

本轮开始于7122cc5，工作区干净。没有重置/覆盖既有修改；只发布campusos-preview，正式域名gdufs.ccwu.cc实际绑定同一Worker。本轮不处理小红书、Console认证及新账号功能。

## 修复及运行契约

1. AI失效原因：Preview原配置MODEL_PRIORITY=deepseek；ModelRouter能力记录24小时硬过期令两入口MODEL_TEST_REQUIRED。现在Step优先、明确额度耗尽后DeepSeek备用；受控平台配置按指纹/策略失效，不按一天计时强制下线。没有伪造通过回执、开放任意端点或改变BYOK所有权/期限规则。
2. 使用原verifyDefaultModel分别真实运行Step、DeepSeek生成、诊断Tool Calling、结果回传、流及JSON Schema校验；各3上游请求，每请求最多256输出Token，时间8,923/2,557ms。真实回执见verification/cloud-search/下两个model.json；密钥/指纹不公开。
3. 地图不再因fix超过30秒清除位置；后台不主动暂停native watch。未更新fix的前台窗口每15秒检查并请求高精度新位置，恢复可见/pageshow自动重建watch并刷新，关闭清理watch/定时器/罗盘。时间戳保持设备值、迟到旧fix不能覆盖新fix；过旧fix不推进导航，AI当前位置仍使用原新鲜授权机制。
4. 定位箭头为无描边蓝三角，在SVG白边蓝圆点下方，未知方向仅圆点；光圈半径继续是实际accuracy的1/4。未更改原校园范围、坐标转换、路线数据和模式切换镜头。
5. 手机抽屉不自动恢复搜索输入框焦点；账号头像读取同一AccountProvider（同“我的”蓝色首字头像），游客图标不变。登录页移除游客链接，注册/找回中心位于内容行1/3、2/3；注册页只保留去登录。游客公共功能未受限。

## 测试与真实数据

- 全量Vitest：122文件，847/847，59.45秒。配置修改、缺凭据、未来测试时间、能力不全、超过24小时但配置未改、额度备用、普通错误不切换、部分流不拼接备用等通过。
- TypeScript、改动文件ESLint、Prettier、git diff --check及OpenNext/Worker构建通过。
- 本地Edge：10通过/2跳过（桌面不适用的手机项），33秒；位置/方向为受控设备夹具。最初未设置项目已有TEMP路径导致Windows workerd启动失败，按原workaround恢复后完成，不归为产品通过。
- Workers Preview Edge：10项地图/账号界面通过；两次真实AI测试最终2/2通过，57.7秒。首次新增AI测试误读SSE的顶层model字段（实际为metrics.model），产生2个断言失败；修正断言后核对原公开metrics，最终无模型失败或摘录降级。
- 正式域名Chrome：13通过/3跳过，约1.5分钟（Playwright原输出）；覆盖桌面/手机、定位静止刷新/前后台/开关、三模式无建筑拉近、紧凑面板、手机标签焦点、头像UI同步、链接位置，以及临时自有测试账号两域名真实登录/头像/退出。不修改负责人账号，不发邮件。
- 最终部署8dee8bdb-84c9-4362-bf96-3900fbaed670新增迟到旧fix检查后，Edge桌面/手机地图6/6，34秒；类型/改动Lint及构建再通过。两个入口7页资源清单仍一致、AI均Step ready。前述真实AI回执在同一最终模型/账号代码上取得，最终发布仅增加定位时间戳顺序检查。
- AI真实问题：`广外图书馆借阅规则是什么？请查校园知识并提供原文来源。` 实际执行search_campus_knowledge及必要官方外查search_external_campus_info，Step返回有据答案和可点击来源《新生入馆指南｜2026级广外人，图书馆通关手册请收好》：https://mp.weixin.qq.com/s/Z8GsLRQptG8Pa3lQFbpTEw。前端展开来源并核对链接；不是HTTP 200替代回答验收。
- Preview Edge桌面/手机：answerMode=model，modelFailureCode=null，实际Step模型，各2模型请求，6,875/6,667总Token，客户端完成23,659/24,085ms。D1已观测rowsRead 58,847/58,852、rowsWritten各15；rowUsageComplete=false，不能当整轮完整账单。
- 正式域名Chrome桌面/手机：answerMode=model，modelFailureCode=null，Step各4模型请求，总Token 18,765/16,317，完成38,314/40,169ms；已观测D1 rowsRead 58,857/58,862、rowsWritten各15，同样非完整计量。
- 两域名7个页面静态资源清单一致，普通账号/雷达/知识/日历公开采样相同，AI均ready且首选Step；脱敏JSON和截图在verification/map-ai-recovery-2026-11-01/。

## 限制与回退

未取得真实手机GNSS/罗盘的现场长时间轨迹；浏览器被系统冻结/结束时网页不能保证后台执行，保持最近真实fix并在恢复时重新采集，不伪造持续更新。手机键盘以触摸事件与真实DOM焦点验证，不能代替各手机输入法实机验收。

模型两入口已恢复，但既有单轮仍有约24–40秒延迟及不完整D1行计量，本轮没有宣称完成吞吐/检索成本优化。Worker CPU未采集，不填估计值。普通请求失败与未获得结果仍由原错误处理返回；本次样本不证明所有问法、来源和供应商永久可用。正式域名Console配置接口仍503（Workers为200），本轮未改独立管理员认证。

部署版本与最终回归结果记录于PROGRESS。回退用本轮修复提交的git revert，再执行原deploy:preview；无D1迁移、无需业务数据回滚。新能力回执与原配置兼容，不必回退秘密；旧代码会恢复24小时停用及旧定位问题。不要使用Production部署或后台回退按钮。
