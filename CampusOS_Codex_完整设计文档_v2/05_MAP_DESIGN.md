# 05｜大学城校区地图与空间交互设计

## 1. 唯一空间范围

**广东外语外贸大学大学城校区完整校园：教学区 + 生活区 + 两者之间的真实步行连接区域。** 不开发白云山校区地图。默认全校区总览必须同时覆盖两区；“教学区/生活区”只是视角快捷切换，不是不同地图。

用户提供的研究材料：

- `assets/source_maps/user_supplied_2d.png`：用户认为其标注基本准确、较清晰，**但体育设施和宿舍逐栋信息不足**。
- `assets/source_maps/user_supplied_aerial.png`：用户认为其建筑排列清楚，**但缺少场馆和宿舍楼栋名称，也不是可编辑的 3D 模型**。

两图只作核验与设计资料；网站底图、可再分发纹理/瓦片许可需单独确认。

## 2. 数据收集策略

**第一技术候选：高德 JavaScript API 2.0**：地图底图、2D/3D 倾斜视角、可能的建筑楼块、自定义覆盖物与搜索。百度地图作为 SDK/POI 对比，MapLibre + 授权 GIS 数据作为自主地图备选。

强制使用 `MapAdapter`：统一 `setView`, `setPitch`, `focusPlace`, `showPlaces`, `renderRoute`, `setLayerVisibility`, `pickPlace`, `destroy`；业务/Agent 不依赖具体 SDK。

- 官方 SDK 在线提供瓦片和支持的地图服务，不主动抓取其内部建筑模型、街景瓦片或整库 POI 自建数据库。
- 自有地点表的数据以校方资料、负责人批准、可合法长期保存的来源为基线；高德/百度结果可用于合法的在线查询与人工核对，遵循其数据许可。
- 对小红书、公众号、网友发布的地图**必须负责人审批与许可确认**，才可转正式地图素材。
- 对坐标系建立单一内部标准（如 WGS84），接入高德/百度时按其坐标约定（例如 GCJ-02/BD-09）做明确转换；转换函数须可单元测试。

## 3. 空间分区

- `teaching`：教学楼、图书馆、实验楼、行政与文化建筑、体育馆及室外球场。
- `living`：宿舍片区、**逐栋宿舍编号**、食堂、快递点、打印/超市等生活设施。
- `connection`：校门、道路、**南校地下人行隧道**及相关入口/出口、跨区通道。

地图绝不能只画一部分；地图第一版如果某些楼栋未核实，应有可用底图但不乱标编号，后台保留待核验状态。

## 4. 地点类别与标签

`building / dormitory / teaching / library / canteen / sports_hall / swimming / track / football / basketball / volleyball / tennis / entrance / service / transport / event_venue`。

支持父子实体层级：`zone → district/cluster → building → entrances → services`。例如生活区 → 宿舍片区 → Cxx 栋（**编号经核验**）→ 步行入口。

### 随缩放展开

- 全校区：教学区、生活区、主要公共建筑、隧道、主要食堂。
- 中等缩放：教学楼字母区域、宿舍片区、足球/田径/泳池/体育馆等。
- 近景：宿舍逐栋编号、露天球场类型、快递/打印服务点、可导航入口。
- 更近：已确认的建筑出入口和专门设施，不展示未经核实的室内线路。

标签避让、合并（cluster）、选中置顶与点击高亮；任何默认地图上不显示名称的设施，可通过用户批准的独立 `CampusLabelsLayer` 完善。

## 5. 体育设施特别规则

足球场/田径跑道/网球场/排球场/篮球场/游泳场/体育馆要分开核对并标记。露天场地可用平面几何和运动场图标，体育馆/泳馆用建筑体块与地点卡。体育部的历史场馆清单仅能作为**候选与查漏**，不能未经核实作为 2026 当前数量和位置。

## 6. 路网与南校隧道

建议图模型：

```ts
type PathNode = {id:string;coord:[number,number];floor?:number;entranceOf?:string};
type PathEdge = {
  id:string;from:string;to:string;lengthMeters:number;
  mode:'pedestrian';level:'ground'|'underground'|'elevated';
  accessible?:boolean;verified:boolean;sourceId:string;
};
```

路线使用经核验的可步行道路、校门和隧道入口/出口；Dijkstra/A* 算法负责计算，模型只负责理解自然语言约束。隧道被渲染为虚线/地下段并在步骤中说明进入和出隧道。不要以两栋楼中心点直线冒充真实导航。

### 路线验收

- 生活区宿舍入口 → 教学区教学楼，必须通过真实可通行的连接边。
- 若隧道的入口/出口坐标未核对，则不能将该路段标记为已验证并声称可精确导航。
- 入口、封闭道路、建筑新改造等变化必须支持版本更新。
- 建筑入口/行人通道比中心点更适合导航目标。

## 7. 2D / 2.5D / 3D

- **默认 2.5D**：真实地图 + 倾斜视角 + 可用建筑楼块 + CampusOS 独立标注；视觉采用广外蓝白 UI，自然绿地/水域/场地保留地理配色。
- **2D 导航**：俯视、不被建筑遮挡的路线、分级标签；导航时可自动降低 pitch。
- **精细局部 3D**：仅模型来源和合法使用明确时开发；不要求全校高精度建模。可以使用 Three.js/Blender 制作重点建筑并轻量加载。
- 缺乏局部 3D 不应影响地点搜索、导航、Agent 操作。
- 性能目标：PC 尽量 60 FPS、普通手机尽量 30 FPS，必须实测；弱设备可降级为 2D。

## 8. 地图 UI

桌面端中央地图优先，占主视野；右侧 Agent 侧面板约 360～420px 可关闭，地图区域自适应。地图顶部：全局搜索、全校区/教学区/生活区切换；侧边：2D/2.5D、图层、定位、缩放；建筑点选显示统一详情。

移动端：全屏地图、顶部搜索与区切换、触控友好缩放按钮、底部地点详情/AI 抽屉；不开发独立 App。

统一建筑详情包括：名称、区域、用途、来源、服务/图片（仅真实）、入口与导航、收藏、问 AI、相关通知/活动。

### Map Action 双向协议

Agent 只返回 `FOCUS_PLACE/SHOW_PLACES/SHOW_ROUTE/OPEN_PLACE_DETAILS/SET_LAYER`，前端按校验后 IDs 执行。用户点击地图建筑产生 `selectedPlaceId`，传给下一轮 Agent 作为上下文。

## 9. 实景/室内

- 可提供建筑照片、室内照片、楼层图片和外部 360 全景链接，必须审核来源与许可。
- 取得真实室内楼层图时可做楼层切换/室内导览；没有图就不要生成假楼层图。
- 720 云等第三方全景优先官方原文跳转/符合授权的 iframe；不提取或重新拼接全景瓦片。
- 不承诺真实室内定位，也不保证全部室内开放拍摄。

## 10. 地点和路径数据审查流程

| 状态 | 说明 |
|---|---|
| `discovered` | 来自公开地图/官网/笔记的待核查线索 |
| `owner_review_pending` | 涉及第三方地图素材，等待负责人确认 |
| `license_pending` | 尚未核实公开展示/改编许可 |
| `geography_pending` | 名称或坐标、建筑入口、道路拓扑未实地/可靠资料核对 |
| `approved` | 资料和可使用权均符合上线要求 |
| `rejected` | 不得进入正式地图库 |

地图前端只使用可展示且地理状态满足目标功能的数据，`approved` 与“可用于导航”区分：一张合法照片可以展示，但并不构成精确路径数据。

## 11. 建议目录与测试

```text
src/features/campus-map/
  components/{CampusMap,MapToolbar,MapSearch,ZoneSwitcher,PlaceDetailsPanel,RouteTimeline}
  layers/{CampusLabelsLayer,SportsFacilitiesLayer,DormitoryLayer,RouteLayer,TunnelLayer,EventLayer}
  adapters/{MapAdapter,AMapAdapter}
  interactions/{map-actions,viewport-controller,place-selection}
  data/{coordinates,graph,route-planner}
```

测试：校区全景同时显示教学与生活区、图层增删、体育设施级别、手机低帧率降级、跨区隧道路由、不同坐标系校验、未知 placeId 拦截、素材审核过滤、地图重建销毁无监听泄漏。

## 12. S1 实施约束补充（2026-10-13，负责人反馈）

- 地图仅展示大学城教学区、生活区、连接区域及必要周边，不提供自由漫游广州或全国的入口。由来源边界的基础缓冲与实际屏幕投影确定必要周边，限制拖动与缩放；该缓冲是浏览范围，不是新的校园边界或导航许可。
- 初始定位在地图加载完成、窗口尺寸确定后执行；全校区同时覆盖两区。缩放下限按视口校准（不少于15），上限20，2.5D默认倾斜38°；低内存或无 WebGL 降级 2D。不使用露出灰边的硬掩模；采用原生区域限制、动态最小缩放和视口尺寸变化重校准。桌面总览沿校区长轴横向展开，手机纵向展开，可通过朝北/旋转工具调整。
- 首次进入地图页才加载 SDK；进入其他页面不主动加载，已访问地图的实例保留视角/导航状态。地图外页面隐藏画布，不增加一级导航。
- 负责人提供的 `map.osm` 和 BBBike GeoPackage 均先离线解析、筛选；不把整个导出文件加载到网页。XML 中完整道路和公交关系可能延伸到选区之外，不能直接把文件 extent 当作校园范围。
- 新XML与既有75个地点匹配，坐标未变化；GeoPackage的来源、图层与许可信息已审查，同属OSM数据，不能计为独立现场核验。GeoPackage 为 EPSG:4326，checksum 通过；生产内部 WGS84，经官方服务转换为高德 GCJ-02。
- 新发现 OSM way 864205124 是 `highway=path, tunnel=yes, foot=designated` 候选，未有入口名称和当前通行核验。保留研究几何，不直接启用南校隧道/跨区导航。
- 自有地物可公开署名展示与“可精确导航”分开判定。线上 POI/Walking 不复制为自有数据库；地图动作已实现客户端校验执行，但完整 Agent/Skill 闭环属于后续阶段。
- 区域裁剪是显示与交互限制，不声称 SDK 文件体积或所有底图请求已经减少；性能结果以实际设备测量为准，不以截图或 Mock 测试推断 FPS。
