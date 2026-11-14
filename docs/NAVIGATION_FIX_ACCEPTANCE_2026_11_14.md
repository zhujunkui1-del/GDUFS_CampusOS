# 手机方位、服务点导航及2.0.3安装包验收

依据负责人2026-11-14地图批注及D-170，修复运行逻辑并发布到既有网站；固定前端的安装包同步2.0.3，保留旧版。

## 根因与实现

1. BasicMapAdapter的`followLocation`和`setNavigationView`原先丢弃heading参数，导航按钮只改变React图标。新增实际地图旋转，按可靠跟随位置所在路段或规划路线首段计算路线朝上，朝北传0；显式切换方向恢复跟随。没有伪造位置、行走进度或设备罗盘数据。
2. 又康超市、伟腾图文为没有自身轮廓的服务点，点位在既有建筑障碍内部，按点直接接路会被障碍校验拒绝，随后进入高德备用分支。现在复用已有父轮廓、包含该服务点的命名建筑轮廓，或固定路网内未命名建筑的外环（排除内环），按已有建筑周边到达政策接路。同类三饭打印店一并覆盖。没有新造门口、店铺面积、室内通道或道路；源GIS和模型数据完全不变。
3. 公共候选离线重新生成：113地点、468候选；原为445候选。只更新`public-walking-attachments.json`派生索引及来源Hash，设备位置不进入公共缓存。

## 实际验证

- 红灯：服务点单测实际返回null；强制基础Canvas后的手机浏览器测试显示按钮变化但bearing仍0。普通WebGL在定位拒绝下原本可切换，故没有把所有移动设备都归因于同一种渲染问题。
- 修复后类型检查、Lint、完整160文件/1129单测通过。本地新增10项桌面/手机回归，覆盖三个服务点不请求高德，以及WebGL/Canvas真实bearing变化并归北；既有4项定位失败、GPS进度、拖动后方向切换回归通过。
- 最终公开域名10场景：9项首轮通过，1项在`page.goto`时`ERR_CONNECTION_CLOSED`，该项单独复跑通过。不是业务断言失败，也没有通过修改产品重试逻辑掩盖网络错误。
- Android14模拟器/WebView113在离线下规划三处服务点，在WebGL和模拟GL上下文丢失后的Canvas中分别实际旋转至-179.67°与180.33°（期望180.326°，前者等价），都可切回朝北。诊断使用同资源可调试APK，结束后恢复无debuggable的最终APK。虚拟设备运行不是物理手机GNSS或罗盘精度验收。
- Windows冻结前端壳离线普通地图/Canvas、三服务点与实际方向切换通过，普通地图三模式及848米路线通过，JS错误0。macOS只完成构建、签名和DMG读回，未在Mac原生运行。

## 发布与交付

最终共享Preview版本：`6a36e91d-9ea8-4626-a8eb-8284ec21e1d0`。本次修复前基线：`c0e6a305-920e-4c84-801c-98c75ed32acc`；中间轮次`ab6b564c-25f3-4753-aca2-222950180ae4`仅包含命名建筑接入。最终构建及1721生成文件凭据净化通过，源码/公开资源与构建目录逐字节核对。Wrangler发布曾遇连接失败，使用IPv4后完成上传；CLI的Cron阶段仍报fetch failed，已用只读Cloudflare API确认最终版本100%生效、原`* * * * *`计划及其原时间戳不变。未修改DNS、D1、Secret、模型设置或收费资源。

三端统一交付在 `D:/tlydcg/Codex_work/CampusOS_广外通/v2.0.3/`。275资源共45,490,503字节，当前82个活动GLB及院落完整；保持三条线路优先级和2.0.2的桌面Origin修复。Windows/Android成品逐资源Hash和客户端密钥扫描通过，macOS Universal签名、275资源和app.asar读回通过。安装程序SHA见`checksums.sha256`，各平台另有`build-info.json`。

回执在交付目录`verification/`：`desktop-offline.json`、`desktop-canvas.json`、`android-navigation.json`、`macos-readback.json`、`release-audit.json`。源回归测试为`tests/unit/service-routing-regression.test.ts`、`tests/e2e/navigation-direction-regression.spec.ts`及加强后的`tests/e2e/campus-navigation-ui.spec.ts`。
