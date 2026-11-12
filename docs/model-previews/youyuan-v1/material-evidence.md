# 友苑材质证据与限制

- 参考：`assets/source_maps/广外地图/友苑.png`、`C:/Users/zhuju/Downloads/友苑卫星图.png`。
- 可直接观察的分区：浅色外墙/阳台、暖红色竖向墙面、蓝灰玻璃、浅灰栏杆与平屋面。
- 色值仅是日光照片下的视觉近似。参考图没有色卡或线性曝光，且卫星图压缩严重，无法可靠反推出 PBR 粗糙度、法线、AO 或反照率纹理。
- 因此没有声称通过参考图恢复真实 PBR，也没有把低置信度提取图写入模型。正式 GLB 使用无贴图 `MeshStandardMaterial`、重复立面几何和不同材质区分；发布器拒绝图片/纹理资源。
- `object-sculpt-spec.json` 以 `qualityPriority: geometry-first-campus-map` 记录这项边界；颜色和粗糙度均为视觉估算。
