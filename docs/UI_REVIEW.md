# CampusOS UI 修订记录

日期：2026-10-12。负责人明确要求删除常驻顶栏，并改用 Apple-inspired、局部 Liquid Glass 和现代极简风格。本次处理响应式 Web 的布局、字体、材质和交互，不将原生 Apple 组件规范直接套成 Windows/Web 的系统行为。

## 评审结论与方向

产品是供广外学生查询校园地点、路线和校园信息的地图工作台。地图内容是主视野；导航和搜索作为独立浮层；全局助理保持并行使用。当前真实地图/模型尚未接入，空状态只说明实际依赖状态。

原界面的主要问题是：常驻 76px 顶栏占空间；标题 34px/600 偏重，深蓝文字覆盖全界面；同一空状态有多重标题/徽标；抽屉只在松手后改变高度，缺乏过程反馈。新版以字体和层级收敛为主，用局部玻璃形成空间关系。视觉评价为“已改进，可继续随真实地图内容验证”；透明度、对比度和手机触感不以静态截图作全面合格结论。

| Before                                       | After                                                                     | Why                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 独立顶栏显示品牌、校区与游客                 | 删除顶栏；品牌/校区置于搜索上方，账号/游客移入导航                        | 地图拥有整块视野；`layout.md › Visual hierarchy`："Differentiate controls from content." |
| 标题 34px/600，正文与控件均偏蓝              | 地图标题 24px/500；主文字 #1d1d1f，辅助文字 #62666e，蓝色保留于选中/操作  | 对应 `typography.md › Conveying hierarchy`；区分文字层级与操作强调                       |
| 多个状态徽标、大块图标装饰、重复助理标题     | 保留简短真实状态，删除重复徽标/底部声明与第二个助理图标                   | 内容表达够用即可；属于针对本项目的判断                                                   |
| 平面白色栏与硬边界                           | 浮动导航、搜索、底部标签使用半透明填充、18px 静态模糊、边缘高光与柔和阴影 | `materials.md › Liquid Glass`："Use Liquid Glass effects sparingly."                     |
| 整体背景与正文面板同一材质                   | 文字卡片和助理正文使用实白；玻璃仅在功能浮层                              | `materials.md › Liquid Glass`；防止文字透叠造成阅读干扰                                  |
| `grid-template-columns`/`height` 过渡        | 布局只在状态切换时重排；面板移动使用 transform/opacity                    | 避免每帧触发整页布局；代码层面确认，未承诺手机实机 FPS                                   |
| 抽屉松手后跳变                               | Base UI Drawer 连续跟随、速度感知停靠与滑动关闭；半屏/全屏按钮保留        | `sheets.md › Mobile` 的 detents/grabber/替代操作原则                                     |
| 未限制 hover、输入字号 12px、缺 viewport-fit | hover 按输入能力门控；输入最少 16px；动态视口、安全区、文字缩放           | `accessibility.md › Mobility/Vision`；需要真实手机进一步验证                             |
| 手工 Esc/焦点逻辑                            | Base UI 负责非模态焦点/关闭；键盘变化直接切换、退出返回触发按钮           | 地图与导航保持可用，避免全局助理阻塞主任务                                               |

## Token 与字体

| 角色     | 当前蓝白值         | 白底对比度 | 后续暗色候选（未启用） |
| -------- | ------------------ | ---------- | ---------------------- |
| 背景     | #f4f6f9            | —          | #111318                |
| 内容面板 | #ffffff            | —          | #1c1d22                |
| 主文字   | #1d1d1f            | 16.83:1    | #f5f5f7                |
| 辅助文字 | #62666e            | 5.76:1     | #acb0b8                |
| 操作强调 | #1261bb            | 6.08:1     | #74aaf0                |
| 分隔线   | rgba(30,36,48,.07) | 不用于文字 | rgba(255,255,255,.15)  |

对比度按实际 CSS 颜色与 WCAG 相对亮度公式计算。在当前 #f4f6f9 背景上，主文字/辅助文字/蓝色分别为 15.55、5.32、5.62:1；不是从截图猜测，也不代表任意未来地图背景上的对比度。高对比偏好改用实白背景和更深辅助文字，减少透明度偏好取消 backdrop-filter。

Apple 设备优先使用系统字体；Windows 使用 Segoe UI/Segoe UI Variable，中文固定界面文案补充自托管的 Noto Sans SC 可变子集（400–600，58,528 bytes、210 个字符）。正文 400，标题/选中 500；标题/辅助文案分别使用相应行高，不加入展示性大号粗体。动态内容中未包含的字形由系统字体回退；后续真实地点/RAG 内容要继续核验字体统一性。

字体文件与 SIL OFL 1.1 许可一起存于 `public/fonts/`；没有复制 SF Pro/PingFang 系统字体文件。暗色模式按 v2 范围留待后续，不额外新增外观切换功能。

## 动效与验证边界

- 控件按下反馈使用 transform 140ms；偶发面板进出使用 transform/opacity 240/180ms，统一 ease-drawer/ease-out token。高频导航不编排整页入场。
- 拖动过程中由 Base UI 更新位置，不在 React pointermove 内每帧 setState。玻璃模糊不动画化，不做全屏背景模糊或常驻装饰循环。
- 减少动效使用短淡化/直接状态变化；必要的停靠位置保留。键盘触发和 Esc 不播放位移。
- 文字放大后允许内容纵向滚动，搜索/图标/状态不相互覆盖；短横屏沿用手机导航并优先展开完整助理。
- 自动化覆盖 1440×900、390×844、320×740、844×390、200% 文字、高对比与减少动效、指针拖动和 Enter/Esc。实际执行结果记录在 `PROGRESS.md`。
- 软件键盘、Safari 的系统字体/透明度行为、触摸惯性与真实手机 GPU 表现仍需实机核验。桌面浏览器视口测试不替代这些检查。

## 已读取的 HIG 资料

使用 `apple-design-skill` 中 accessibility、layout、typography、color、designing-for-ios、materials、sidebars、tab-bars、sheets、motion，以及 cross-platform 和 liquid-glass 共 12 份针对性资料。引用仅指向实际读取的章节。

主要在线依据：[Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、[Base UI Drawer](https://base-ui.com/react/components/drawer)、[Noto Sans SC 许可](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt)。Web 的玻璃是 CSS 近似实现，不宣称为原生系统 Liquid Glass。

验收截图另发现两项集成细节：`overflow:hidden` 会允许自动聚焦滚动容器，使半屏看起来像全屏，改用 `overflow:clip`；Base UI 的停靠变量注册为不继承，正文容器改用受控停靠比例明确设置可见高度。回归同时断言实际面板位置及输入框位于底部导航之上，避免只检查状态 class。
