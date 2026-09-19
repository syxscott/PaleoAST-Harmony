# PaleoAST-Harmony 架构

本文档面向新贡献者、人类开发者和 AI 编码助手，回答四个问题：

1. 这个项目是什么？
2. 系统分成哪几层？
3. 一次操作如何穿过这些层？
4. 遇到问题应该继续读哪里？

模块细节、算法与排障入口见 [`architecture/`](architecture/) 下的专题文档。

---

## 1. 项目是什么

`PaleoAST-Harmony` 是 PaleoAST（Python）的 **HarmonyOS NEXT 原生移植**：面向古生物与地层学研究者的统计工具包。

- **技术栈**：ArkTS + ArkUI 声明式 UI + NAPI C++
- **目标设备**：phone / tablet / 2in1
- **SDK**：HarmonyOS 5.0.0(12)
- **许可**：MIT

设计前提：用户会把输出写进论文，因此**静默算错比崩溃更严重**。凡是「看起来合理的错误数字」都按缺陷处理。

---

## 2. 分层与职责边界

| 层 | 路径 | 职责 |
|---|---|---|
| 计算核心 | `entry/src/main/core/analysis/{statistics,ecology,macroevolution,morphometrics,morpho3d,phylogenetics,stratigraphy}` | 全部统计算法，与 UI 完全解耦 |
| 底层数学 | `core/math/{Matrix,linalg,stats,special,random,Bootstrap,LOWESS}` | 线性代数、分布、种子 PRNG |
| 数据层 | `core/models`、`core/parsers` | DataMatrix / StateManager、CSV·xlsx·TPS·NEXUS·Newick 解析 |
| 控制器 | `core/controllers/StatisticsController.ts`（99 个 `run*`）、`DataController.ts` | **唯一 UI 入口层** |
| 报告 | `core/reporting` | Markdown / HTML / LaTeX 表格与文档生成 |
| 原生加速 | `entry/src/main/cpp`（7 个 NAPI 函数） | SVD / 特征值 / 逆 / 距离矩阵 / 聚类 |
| 持久化 | `ets/database/HistoryRepository.ets`、`ets/utils/PreferenceManager.ets` | RDB 分析历史、Preferences 设置 |
| UI | `ets/pages/Index.ets`（主壳）、`ets/components/`（14 个组件）、`components/dialogs/`（35 个对话框）、`ets/components/plot/`（视口与绘制基础设施） | 交互与呈现 |

**明确的边界（不要越过）**

- ArkTS **只做业务编排与调度**，不在 UI 层重新实现统计计算。
- 算法只写在 `core/` 下；`PlotCanvas` 之类的组件不得包含统计逻辑。
- **NAPI 的 ArkTS 侧入口只有 `core/math/NativeMath.ts`**；其他文件不得直接 `import` `.so`。
- 图表的唯一数据通道是 `PlotCanvas` 的 `dataX` / `dataY`；父组件从不调用命令式 setter。
- 坐标变换只由 `ets/components/plot/ViewPortHandler.ts` 提供；渲染器、SVG 导出与命中判定都必须走它。

---

## 3. 三条核心数据流

### 3.1 载入数据

```
FileDropHandler / ImportDialog（用户选文件）
  → Index.loadFile()
  → FilePickerHelper 取沙箱路径 → @ohos.file.fs 读字节
  → core/parsers 解析（CSV / xlsx / TPS / NEXUS / DAT）→ DataMatrix
  → StateManager.setData()（清空全部历史栈与结果缓存）
  → EventBus.emit('data_changed') → Spreadsheet / WorkspaceView 换用新矩阵
```

### 3.2 运行一次分析（最关键的一条）

```
NavigationTree 点击（受 Ribbon 标签过滤）
  → Index.handleAnalysis(name)
  → DialogManager.open(name) → 对应 XxxDialog 收集参数
  → .onConfirm(this.analysis(name))          ← 必须按对话框自己的名字派发
  → Index.runAnalysisWithParams(name, params)
       ├─ recordAnalysis() → 内存脚本历史 + HistoryRepository（RDB，去重 + 滚动保留 100 条）
       ├─ runDialogAnalysisCore(name, params) → StatisticsController.run*()
       │                                         （内部可能走 NativeMath → C++）
       ├─ 清空并重建图表序列（plotDataX/plotDataY/plotTitle/plotType）
       ├─ captureWidgetPlot(name) 冻结本标签的快照
       └─ addWidget(name) 切换标签
  → WorkspaceView → PlotCanvas（dataX/dataY）→ ViewPortHandler 变换 → Canvas
```

**两个容易踩的点**

- 对话框的 `onConfirm` 必须传自己的名字。曾经 Univariate 硬写 `'Summary'`，导致选 t 检验/ANOVA 都跑成描述统计。
- 每次分析前必须清空图表序列。曾经新分析沿用上一张图的数据，于是「新标题 + 旧曲线」。

### 3.3 导出

```
ExportDialog
  ├─ CSV / xlsx  → DataController.exportCSV / toCSV（含按需加引号）
  ├─ Script      → Index.buildAnalysisScript()（由 RDB 历史重建，可跨重启）
  ├─ PNG / SVG   → PlotCanvas.exportPNG / buildSVG（与 Canvas 共用 ViewPortHandler）
  └─ 论文         → core/reporting（TableGenerator / ReportBuilder / compileLaTeX）
```

---

## 4. 状态与持久化原则

| 机制 | 适用 | 示例 |
|---|---|---|
| `@State` / `@Prop` / `@Link` | 组件内部与父子传递 | 当前标签、图表序列、对话框可见性 |
| `EventBus` | 跨层级瞬时事件 | `data_changed` |
| `AppStorage` | 真正跨模块共享的状态 | `darkMode`、`breakpoint`、`stateMgr`、设置项 |
| `Preferences` | 跨启动的轻量键值 | 见 `ets/utils/AppSettings.ets` |
| RDB | 跨启动的结构化记录 | 分析历史（可查询、可去重、有上限） |

**原则**

- 局部状态不得无理由提升到 AppStorage。
- `EventBus` 只传事件，不作为长期数据仓库。
- 设置项的键与默认值只在 `AppSettings.ets` 声明一次；`PreferenceManager.loadAllToAppStorage()` 在启动时一次性注入，之后组件通过 `@StorageLink` 读取，**不要**在别处直接写这些键。
- `HistoryRepository` 的写入必须 fire-and-forget：持久化失败不得影响分析本身。

---

## 5. 关键架构决策

### 5.1 自研数值底座 + 可选原生加速

`core/math` 是纯 TS 实现，没有第三方数值依赖。原生 C++ 层是**可选的加速路径**，通过 `core/math/NativeMath.ts` 的 null 契约回到 TS 实现。

> ⚠️ **现状**：C++ 函数已实现且有错误码通道，但**分析路径目前不调用它们**（`nativeSVD` 等尚无调用方）。C++ 的 `matrixSVD` 只返回奇异值、`matrixEigh` 只返回特征值，与返回向量/矩阵的 TS 版本不是等价替换。启用前必须先逐一对拍验证。

### 5.2 错误必须可解释

数值失败不得只表现为「空结果」：

- C++ 侧抛 `Paleo::Exception` 并映射为 `"Error:Singular"` 之类的短 token（`cpp/core/ErrorHandler.h`）；
- `NativeMath` 把它归一化为 `null` + `nativeLastError()`，调用方保留单一 null 判断，界面可显示原因。

### 5.3 图表基础设施与图表组件分离

`ets/components/plot/` 承载可测试的纯逻辑（视口变换、刻度、命中判定、格式化），`PlotCanvas` 只做编排与绘制。**新增图表类型时优先改绘制分支，不要往视口逻辑里加特例。**

### 5.4 可复现性

- 所有随机过程使用 `core/math/random` 的种子 PRNG，默认 `rngSeed = 42`。
- 分析历史落到 RDB，使「GUI 操作 ↔ 脚本导出」在重启后仍成立。

---

## 6. 核心目录

```text
entry/src/main/
├── core/                       # 与平台无关的计算与数据层（Node 可测）
│   ├── analysis/               # 196 个导出函数 + 10 个导出类
│   ├── math/                   # Matrix / linalg / stats / random
│   ├── controllers/            # 唯一 UI 入口层
│   ├── models/                 # DataMatrix / StateManager
│   ├── parsers/                # CSV / xlsx / TPS / NEXUS / Newick
│   └── reporting/              # Markdown / HTML / LaTeX
├── cpp/                        # NAPI：native_api.cpp + napi/ + core/ + utils/ + types/
├── ets/
│   ├── pages/                  # Index（主壳）、Splash
│   ├── components/             # 14 个 UI 组件
│   │   ├── dialogs/            # 35 个分析对话框
│   │   └── plot/               # 视口/刻度/命中/格式化（纯 TS，可测）
│   ├── utils/                  # Logger / PreferenceManager / AppSettings
│   ├── database/               # HistoryRepository（RDB）
│   └── entryability/           # 启动、窗口、折叠屏断点
└── resources/                  # base / rawfile

tests/                          # Node 单测（78 个用例）+ 平台垫片
test/device/                    # 真机 E2E（hdc 驱动 + 声明式用例）
tools/                          # structure_check.py、coverage_audit.js
docs/                           # 本目录
```

---

## 7. 专题文档

| 文档 | 什么时候读 |
|---|---|
| [troubleshooting.md](architecture/troubleshooting.md) | **按症状定位调用链。遇到 bug 先读这篇。** |
| [../docs/code-style.md](code-style.md) | 写代码前 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 提交前 |
| [../AGENTS.md](../AGENTS.md) | AI 助手的工作约定 |
| [changes/](changes/) | 每次修复的变更记录 |

---

## 8. 维护约定

按影响范围更新文档，不要一次性大改：

- 改变分层、模块边界或核心数据流 → 更新**本文档**。
- 改变某个子系统的实现细节 → 只更新对应专题文档。
- 新增/修改设置键、EventBus 事件、表结构 → 更新本文档第 4 节。
- 改变调用链或新增常见故障 → 更新 `troubleshooting.md`。
- 修复缺陷 / 改动数值输出 → 在 `docs/changes/` 加一条记录。
