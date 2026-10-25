# 校行政办公楼与八角楼 · 首版2.5D / 3D

2026-10-25。负责人提供行政楼4层楼高、八角楼1层楼高的体量依据。本稿为独立视觉评审，尚未接入正式地图。

## 查看与文件

在项目根目录运行：

```powershell
node scripts/serve-administration-complex-preview.mjs
```

打开 <http://127.0.0.1:3018>。顶部可选择整体、办公楼、八角楼，分别切换2.5D/3D及整体/正面/侧面/俯视。旋转、缩放和调整窗口均可使用。服务只监听本机，按需加载选中单体，不提供原参考图片。

| 对象         | 2.5D文件                                                                       | 3D文件                                                                      | 3D三角面 / 模型调用 |
| ------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------: |
| 整体         | [administration-complex-2.5d.glb](administration-complex-2.5d.glb)，44,672字节 | [administration-complex-3d.glb](administration-complex-3d.glb)，145,696字节 |           6,820 / 7 |
| 校行政办公楼 | [administration-2.5d.glb](administration-2.5d.glb)，38,532字节                 | [administration-3d.glb](administration-3d.glb)，137,248字节                 |           6,400 / 7 |
| 八角楼       | [bajiaolou-2.5d.glb](bajiaolou-2.5d.glb)，9,112字节                            | [bajiaolou-3d.glb](bajiaolou-3d.glb)，17,664字节                            |             420 / 5 |

六个资产均为零图片纹理；整体/办公楼3D使用6个材质，八角楼3D使用4个材质。三种2.5D均为2个材质/2次模型调用，对应434/370/64三角面。整体按材质合并与实例化后，调用少于两个单体分别加载的总和。

源文件为[scripts/build-administration-complex-model.mjs](../../../scripts/build-administration-complex-model.mjs)与`design.json`；重新生成执行`node scripts/build-administration-complex-model.mjs`。`manifest.json`记录六文件SHA、复杂度、绑定、原轮廓与锚点；`administration-complex-2.5d.geojson`为分部高度/源边界评审参数，屋顶实际形态见GLB/生成器。应用普通构建不自动生成或发布模型。

## 父子轮廓和坐标

- 行政楼为固定地图`s1-2026-10-14.2`的`osm-way-307437432`；八角楼为`owner-bajiaolou`，其`parentId`仍是行政楼。八角楼轮廓精确使用父环第9–16号共8个原顶点，没有另猜坐标。
- 父环拆为主楼、连接段、低弧形附楼、入口门廊及八角楼五个源分部。分部面积之和与父环误差小于0.0001平方米。八角楼从行政楼单体中完全排除，整体只调用一次八角楼建模；没有在该位置叠加四层父楼体。
- 门廊/低附楼/连接段的内部切分结合照片，局部切点是显示近似，不能作为实测分栋事实。原父/子GIS、名称、标签坐标、导航障碍和通行数据未修改。
- **六个GLB统一使用行政楼原点WGS84`[113.3944163,23.065009699999997]`，局部东/上/南米制。** 八角楼单体仍保留其在该原点下的相对位置。后续接图须使用清单的`origin`，不能再把该文件直接平移到子标签坐标，否则会重复偏移。

## 外观与近似边界

- 负责人4层/1层为外部体量依据，未制作或核验室内平面。行政楼显示四组楼层/窗带，八角楼显示一层玻璃立面和八角坡顶。
- 行政主体楼层边界0.55/4.05/7.55/11.05/14.55米，主坡顶屋檐14.75米/峰18.1米，角塔最高18.5米；八角楼屋檐4.15米/峰7.1米。低连接段4.1米、弧形低附楼4.4米以及门廊两层屋顶等均为视觉估算，未实测。
- 保留灰色坡屋顶、红白廊道、方柱/窗带、角部小塔、入口叠檐与拱形门廊，八角楼独立保留八边形屋顶/浅色柱/玻璃分格。屋脊拼接、门廊、低连接屋面、窗格及立面开间为照片概括；不逐瓦、逐砖或制作精细室内。
- 原外轮廓的庭院凹口保留；西侧照片中可见的屋面连接以简化屋顶与细柱表达，没有补造封闭地面院墙或修改导航可通行性。建筑周边景观、湖岸和植被不作为本模型几何。
- 四张行政楼图、一张八角楼图留在原文档包；Downloads的俯视图原像素存文档包`assets/model_references/administration-complex-v1/校行政办公楼和八角楼俯视.png`。六图SHA见design.json；文件名数字无建筑意义。原发布链接、年份和图片公开再利用许可仍待补，原图不进入`public/`、预览图片端点或GLB纹理。

## 实际浏览器记录

Edge149.0.4022.80桌面1440×1000/DPR1检查三种对象/两种模式和相应视角，手机视口390×844及短窗口950×540检查切换、旋转、缩放和调整窗口。无页面错误，静止350ms无额外帧。含预览地面时，整体3D稳态8次绘制/6822三角面，八角楼单体6次/422三角面；阴影更新帧另有开销。手机视口运行于桌面GPU，不等于手机实机FPS或校园整页容量验证。

- [整体3D](screenshots/edge-complex-3d-overall.png)、[入口门廊](screenshots/edge-complex-3d-front.png)、[整体俯视](screenshots/edge-complex-3d-roof.png)
- [办公楼3D](screenshots/edge-administration-3d-overall.png)、[八角楼3D](screenshots/edge-pavilion-3d-overall.png)
- [整体2.5D](screenshots/edge-complex-2.5d-overall.png)、[八角楼2.5D](screenshots/edge-pavilion-2.5d-overall.png)
- [手机整体](screenshots/edge-mobile-complex-3d.png)、[手机八角楼](screenshots/edge-mobile-pavilion-3d.png)、[浏览器回执](screenshots/edge-review.json)

`asset-checks.json`记录原父/子轮廓、面积/八顶点、单次八角楼/共享锚点及既有五组模型哈希核对；`quality-checks.json`记录编译与检查结果。正式地图、标签、步行导航、AI及旧模型资产保持；接图和本稿视觉/近似高度验收留待后续，其他批量与真实手机性能门槛继续保留。
