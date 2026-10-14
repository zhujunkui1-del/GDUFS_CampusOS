# 3D窗口缩放位移与变形修复

2026-10-15。负责人反馈：拖动浏览器边框改变大小后，3D建筑位移、变形，继续拖动地图仍有问题。此修复纳入南苑7栋第二版接图里程碑，2.5D参数和模型资产不变。

## 实际复现

回归脚本tests/e2e/model-resize.spec.ts在实际GL绘制七层实例楼板时读取viewport和drawingBuffer，排除512px阴影通道。不是只检查DOM尺寸、版本字段或是否加载成功。

Chrome桌面1440×900加载模型后，把视口缩为780×520。画布buffer已变为780×520，实际3D绘制viewport仍为1440×900，断言失败；错误截图中模型显著偏移/放大变形。最小复现仅需“加载3D→改变窗口大小”，不必先拖地图。初始探针只观察索引绘制，未采集到非索引楼板；补齐drawArraysInstanced后得到明确的失败信号。

原因是Three.js创建时缓存原画布viewport；MapLibre随后调整共用画布，而Three的缓存没有跟随更新。地图当前投影已适应新窗口，3D却画进旧尺寸的视口，导致模型与地理位置不一致。

## 修正

每次绘制模型前，在resetState后，以gl.drawingBufferWidth/Height同步Three的viewport，并除以Three自身pixelRatio换回其接口接受的逻辑像素。保留原投影矩阵、WGS84锚点、GLB、原MapLibre画布及相机；不调用Three.setSize或setPixelRatio改写地图画布，不添加额外渲染循环。

Three0.186.1本地setViewport源码确认其内部乘pixelRatio后设置GL viewport；新增代码只更新视口，GL状态缓存可跳过相同值。返回绘制流程仍resetState，由MapLibre继续渲染其他图层。

## 实际检查

- Chrome/Edge各桌面及手机视口通过：初始→780×520→拖动地图→390×844，所有实际3D绘制viewport均与当前buffer一致。覆盖DPR1和3；手机DPR3的buffer从1170×2532变为2340×1560再恢复，拖动后保持正确。
- 两款浏览器另行各1项真实窗口检查通过：独立临时配置、viewport:null，通过浏览器窗口接口改变外框1000×800→780×560→1120×850，覆盖实际系统DPR1.5。Edge的buffer/viewport依次1467×1064、1137×704、1647×1139，逐值一致。临时浏览器上下文已关闭，用户原标签页未修改。
- 48单元、类型/Lint、Next/OpenNext构建通过，新Workers3000可用。初次构建因测试Window全局类型缺声明失败，已修正声明；当时无运行服务的测试失败不作功能验收，重建/启动后重跑成功。
- 归档的全量接图回归见S1_NANYUAN7_V2_INTEGRATION_ACCEPTANCE.md；窗口修复后的模型模式/拾取/标签/失败回退/加载退出/焦点专项另行重跑，结果记PROGRESS。没有把截图或浏览器手机视口记为手机实机FPS。

## 证据与复验

修复前后截图/GL尺寸JSON在docs/screenshots/s1/nanyuan7-v2-resize，before为实际失败，after为修正后的普通视口检查，native-chrome/native-msedge为实际窗口检查。

```powershell
$env:E2E_BASE_URL='http://127.0.0.1:3000'
$env:PLAYWRIGHT_CHANNEL='chrome' # Edge使用msedge
npx playwright test tests/e2e/model-resize.spec.ts --workers=1
# 真实浏览器窗口：设置E2E_MODEL_NATIVE=1，选择project=desktop、-g 'native browser'。
```

探针仅在测试上下文中注入，不进入产品；src没有新增诊断日志、帧循环或临时夹具。实际来源和根因另记录SRC-047、D-031。
