# PaleoAST-Harmony

> 🦕 古生物高级统计工具包 — HarmonyOS 原生版本
>
> 基于华为鸿蒙 (HarmonyOS NEXT) ArkTS + ArkUI 声明式框架，为古生物学家和地层学家提供完整的统计分析工具。

## 项目简介

PaleoAST-Harmony 是 [PaleoAST](https://github.com/syxscott/PaleoAST) Python 版的鸿蒙原生移植，覆盖全部核心分析算法、图表引擎和用户界面，专为华为平板和鸿蒙 PC 设计。

## 核心功能

### 统计分析（78 个函数）

| 模块 | 函数数 | 覆盖算法 |
|------|--------|---------|
| **多元统计** | 22 | PCA、PCoA、NMDS (SMACOF)、LDA/CVA、CCA/RDA、ANOSIM、PERMANOVA、SIMPER、层次聚类、MST、PLS、Mann-Whitney U、凸包体积、形态空间差异 |
| **单变量统计** | — | 描述性统计、Shapiro-Wilk 正态性检验、t 检验、单因素 ANOVA、Kruskal-Wallis、Tukey HSD |
| **系统发育比较** | 8 | Fitch 简约、独立对比 (PIC)、Blomberg's K 系统发育信号、系统发育 ANOVA、NJ/UPGMA 建树、启发式搜索、严格/多数规则一致树 |
| **生态分析** | 13 | Shannon/Simpson/Margalef/Pielou 多样性指数、Hurlbert 稀疏化、Baselga Beta 多样性分解、零模型 (C-score)、DTW 动态时间规整、丰度模型拟合、SHE 分析、古环境重建 |
| **地层学** | 18 | CONISS 分带、Markov 转移矩阵、方向统计、灭绝置信区间 (Marshall/Strauss-Sadler)、频谱分析 (DFT)、小波变换 (Morlet CWT)、LOWESS 平滑、ARMA 模型、异常值检测、交叉验证、同位素偏移检测 |
| **宏观演化** | 10 | 存活分析 (Foote 1999)、FBD 模拟 (Stadler 2010)、Cox 比例风险、Log-rank 检验、指数/逻辑斯蒂模型拟合、中性模拟、平衡态检验、FBD 似然函数 |
| **形态测量** | 7 | GPA 普氏对齐、EFA 椭圆傅里叶 (Kuhl & Giardina 1982)、异速生长、演化速率 (随机游走/定向/停滞)、TPS 薄板样条变形、相对扭曲、配置块划分 |
| **3D 形态测量** | 5 | 四元数旋转、3D GPA、3D TPS 变形、半地标滑动、网格法向量/面积计算 |

### 图表引擎（26 种图表）

散点图、折线图、柱状图、直方图、箱线图、热力图、树状图、饼图、玫瑰图、Shepard 图、Scree 图、稀疏化曲线、Q-Q 图、置信椭圆、零模型直方图、系统发育树、PCA 双标图、SIMPER 贡献图、丰度排名图、存活曲线、灭绝 CI 范围图、频谱周期图、小波标度图、CCA 三标图、混淆矩阵、地层柱状图。

### UI 组件

| 组件 | 说明 |
|------|------|
| **Index.ets** | 主页面，含 Ribbon 工具栏 (5 标签)、SideBarContainer 响应式布局、42 个分析处理器 |
| **Spreadsheet.ets** | 数据表格，LazyForEach + IDataSource 虚拟列表、单元格编辑、排序、筛选、组管理 |
| **PlotCanvas.ets** | 交互式图表画布，hover tooltip、zoom/pan、选择、PNG/SVG/PDF/EPS/TIFF 导出 |
| **NavigationTree.ets** | 导航树，9 个分类、30+ 条目、搜索、展开/折叠 |
| **DiagnosticConsole.ets** | 诊断控制台，日志过滤、导出 |
| **FloatingToolbar.ets** | 浮动工具栏，快速操作 |
| **FileDropHandler.ets** | 文件拖放支持 |
| **34 个对话框** | 每个分析有独立参数配置对话框，含描述、校验、Tips |

### 鸿蒙特性

| 特性 | 用途 |
|------|------|
| **NAPI C++** | SVD/特征值/逆矩阵/距离矩阵用 C++ 原生实现，性能提升 10-100x |
| **TaskPool** | @kit.ArkTS 多线程，@Sendable 跨线程数据共享 |
| **LazyForEach** | IDataSource 虚拟列表，避免 1000+ 行 DOM 爆炸 |
| **FilePicker** | @ohos.file.picker 沙箱安全文件导入/导出 |
| **SideBarContainer** | 响应式布局，适配手机(折叠)/平板(展开) |
| **@StorageLink** | 暗色模式偏好持久化 |
| **SwipeGesture** | 全局滑动手势切换标签 |
| **TransitionEffect** | 对话框缩放+淡入过渡 |
| **LoadingProgress** | 分析执行中的加载动画 |
| **@Builder/@Extend/@Styles** | 组件化构建、样式复用 |

## 项目结构

```
PaleoAST-Harmony/
├── entry/src/main/
│   ├── cpp/                          # NAPI C++ 原生层
│   │   ├── CMakeLists.txt            # 构建配置
│   │   ├── native_api.cpp            # NAPI 模块注册
│   │   └── napi/matrix_ops.cpp       # C++ 矩阵运算
│   ├── core/                         # 计算核心 (TypeScript)
│   │   ├── analysis/                 # 分析算法 (78 函数)
│   │   │   ├── statistics/           # 多元统计
│   │   │   ├── ecology/              # 生态分析
│   │   │   ├── macroevolution/       # 宏观演化
│   │   │   ├── morphometrics/        # 形态测量
│   │   │   ├── morpho3d/            # 3D 形态测量
│   │   │   ├── phylogenetics/        # 系统发育
│   │   │   └── stratigraphy/         # 地层学
│   │   ├── math/                     # 数学库 (Matrix/linalg/stats/random/special)
│   │   │   └── NativeMath.ts         # NAPI 包装器 (TS 回退)
│   │   ├── models/                   # 数据模型 (DataMatrix/StateManager/Metadata)
│   │   ├── parsers/                  # 文件解析器 (CSV/TPS/Nexus/Newick/DAT/Excel)
│   │   ├── controllers/              # 控制器 (42 分析处理器)
│   │   ├── config/                   # 配置 (常量/颜色/设计系统/国际化/插补)
│   │   ├── utils/                    # 工具 (异常/验证/事件总线/矩阵操作/变换)
│   │   ├── hpc/                      # 进程池 + 任务调度器
│   │   ├── io/                       # 文件管理器 + FilePicker
│   │   ├── scipy/                    # 距离矩阵 + 层次聚类
│   │   ├── plugins/                  # 插件系统
│   │   ├── state_machine/            # 状态机
│   │   ├── app_infrastructure/       # 异常处理 + 主题管理
│   │   └── reporting/               # 报告生成器
│   ├── chart/                        # 图表引擎 (26 种图表)
│   ├── ets/                          # ArkUI 界面
│   │   ├── pages/                    # 主页面 + 启动页
│   │   ├── components/               # UI 组件 (6 个 + 34 对话框)
│   │   │   └── dialogs/              # 分析对话框
│   │   └── entryability/            # 应用入口
│   └── resources/                    # 资源 (字符串/颜色/页面配置)
├── build-profile.json5               # 构建配置 (含 NAPI)
└── oh-package.json5                  # 包配置
```

## 技术栈

| 层级 | 技术 |
|------|------|
| **UI 框架** | ArkUI 声明式 (HarmonyOS NEXT) |
| **计算语言** | ArkTS (TypeScript) + C++ (NAPI) |
| **数学库** | 自研 Matrix + linalg (SVD/eigh/inv) + C++ 原生加速 |
| **多线程** | TaskPool + @Sendable |
| **文件 I/O** | @ohos.file.picker + @ohos.file.fs |
| **布局** | SideBarContainer + GridRow/GridCol 响应式 |
| **虚拟列表** | LazyForEach + IDataSource |

## 支持的文件格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| CSV | .csv, .tsv, .txt | 逗号/制表符分隔 |
| TPS | .tps | 形态测量地标点 |
| Nexus | .nxs, .nex | 系统发育数据 |
| Newick | .tre, .tree, .newick | 系统发育树 |
| DAT | .dat | 通用数据 |
| Excel | .xlsx, .xls | 电子表格 |

## 开发环境

- **IDE**: DevEco Studio 5.0+
- **SDK**: HarmonyOS NEXT API 12+
- **语言**: ArkTS / C++17
- **构建**: CMake (NAPI) + hvigor (ArkTS)

## 快速开始

1. 用 DevEco Studio 打开 `D:\GIthub\PaleoAST-Harmony`
2. 等待 hvigor 同步依赖
3. 在 `build-profile.json5` 中确认 `externalNativeOptions` 指向 `./src/main/cpp/CMakeLists.txt`
4. 连接华为设备或启动模拟器
5. 点击 Run

> **PC 预览**: NativeMath.ts 自动回退到纯 TypeScript 实现，无需 C++ 编译。

## 从 Python 版迁移

本项目从 [PaleoAST](https://github.com/syxscott/PaleoAST) Python 版完整移植：

| Python 模块 | HarmonyOS 对应 | 说明 |
|------------|----------------|------|
| numpy | math/Matrix.ts + linalg.ts | 自研矩阵库 |
| scipy.stats | math/special.ts | lgamma/betainc/erf/分布函数 |
| scipy.spatial | scipy/DistanceCluster.ts | 距离矩阵 + 聚类 |
| matplotlib | chart/plotters/ | Canvas 2D 图表引擎 |
| PyQt6 | ets/ | ArkUI 声明式 UI |

## 许可证

MIT License

## 作者

PaleoAST Development Team
