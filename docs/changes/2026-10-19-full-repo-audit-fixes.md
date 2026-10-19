# 全仓审查与修复（2026-10-19）：16 条致命缺陷 + 验证基础设施的空洞

## 类型

缺陷修复 / 数值变更 / 工程

## 问题

2026-10-19 对全仓（179 个源文件 / 33,700 行）做了一次完整的只读审查，
随后把发现的问题全部修掉。审查用 10 个并行 agent 按**排他文件范围**深审，
主审对每条头部长结论**亲自执行复核**。

审查结论是 **FAIL**：**16 条致命缺陷**、24 条严重、60 余条中/轻微。
其中三条让 App 的主流程**当前直接不可用**：

1. `ets/pages/Index.ets` 调用了一个**不存在的方法** `this.dataFingerprint(dm)`
   （导入的是模块级函数 `dataFingerprint`）→ 任何走对话框的分析在**运行前**
   抛 `TypeError`；而这行在 `try` 之外，于是 `isLoading` 永远为 true，
   **界面永久卡在加载圈**，状态栏无任何提示。
2. `ets/components/PlotCanvas.ets` 的 PNG/SVG 导出引用了一个**未声明的标识符**
   `suggested`（`TS2304`）→ 整个文件编译不过；同一行的 `safe` 算出来却从未使用。
3. `core/parsers/ExcelParser.ts` 的 inflate **违反 RFC 1951**（位序 MSB-first +
   距离表不是 RFC §3.2.5 的表）→ **所有真实 xlsx 解析失败**，并被静默回退成
   一张全 null、标签是二进制乱码的表。

其余 13 条致命缺陷属于"静默产出错误数字"——按本项目自己写下的设计前提
（`docs/architecture.md`：**用户会把输出写进论文，静默算错比崩溃更严重**），
这是最该优先处理的一类。代表性的：

- `core/analysis/morphometrics` 的 **Kabsch 旋转被反向应用**（用了 `R` 而不是
  `Rᵀ`），刚性一致的标本叠合距离 0.237、100 次迭代永不收敛；`PartialGPA` 是
  同一处错误的另一份拷贝。
- `core/analysis/statistics` 的 **6 个含随机过程的函数默认不设种子**，
  同一个 PERMANOVA 连点两次 p 值就不同；`phylogeneticSignal` 的 p 会在
  0.03 / 0.06 / 0.12 之间跳，**直接跨 0.05 显著性阈值**。
- `core/analysis/stratigraphy` 的 `markov()` 的 χ² p 值由一个**数值爆炸的连分数**
  算出（`c` 初值写成 `1e-30`，而 Numerical Recipes 要求 `1e30`），400 个随机链中
  **72%** 的 p 值落在 [0,1] 之外（139 个为负），**14%** 与 scipy 的结论相反。
- `core/analysis/stratigraphy` 的 `rasc()` **完全不用传入的观测剖面数据**，
  排序只是距离矩阵的函数。
- `core/analysis/macroevolution` 的 `fitEarlyBurst` **永远返回垃圾拟合**
  （对三组截然不同的数据输出逐位相同的 `logLik = -1e10`）；
  `fitOU` 的协方差矩阵**没做 OU 变换**（σ² 对数据尺度零响应）；
  `logRankTest` 的风险集**不移除事件时刻之间的删失观测**。
- `core/analysis/phylogenetics` 的 `strictConsensus` **输出分类单元重复的损坏树**；
  `computeRFDistance` 恒为真值的 2 倍、**归一化值可以 > 1**；
  `blombergKFromVCV` 对零方差性状返回"K = 1.5，信号很强"的**纯浮点噪声**。
- `core/math/linalg.ts` 的 `svd` 对**宽矩阵**（行数 < 列数）返回转置后的 U 与 Vt，
  违反自己文件头的契约，`A = U·diag(S)·Vt` 根本拼不出来。

## 根因

### 一、验证基础设施是空的（这是最重要的一条）

`tests/runner.ts` 的 `toBeCloseTo(expected, delta)` 把第二参数当**绝对容差**，
而整个测试套件是按 **Jest 的"小数位"语义**写的（第二参数全是 8 / 9 / 10 / 12）。

结果：**145 处数值断言里有 118 处（81%）形同虚设**。`toBeCloseTo(0.5, 10)`
接受 5.0；`toBeCloseTo(0.001930454136, 12)` 接受任何值。

这条是**元缺陷**：它解释了为什么几十条真实缺陷能躲在 277 个绿灯后面。

### 二、`.ets` 层从未被类型检查过

`tools/tscheck/tsconfig.check.json` 只包含 `core/**/*.ts`，CI 也没有 typecheck
步骤，单测**从不 import `.ets`**。于是上面第 1、2 条 P0 完全没有拦截网。

### 三、单测只覆盖了实现者想到的路径

- inflate 路径从未被触及：旧测试只用**手搓的 STORED zip**
  （`tests/core.test.ts:47`），而 Excel/LibreOffice/openpyxl 默认 **deflate**。
- GPA 的唯一一条测试只测**纯平移**——纯平移的最优旋转是单位阵，
  **转置错误在那里完全隐形**。
- 历史去重的测试是 `expect(index.includes(...))` 这种**源码文本断言**，
  从不执行 `persistAnalysis`。

## 修复

### 验证基础设施（先做，它把隐藏缺陷变成测试）

- `tests/runner.ts`：`toBeCloseTo` 改为 **Jest 语义**（第二参数是小数位），
  并新增 `toBeWithin(expected, absDelta)` 给需要绝对容差的场合。
  145 处调用点中 20 处真正的绝对容差被改写为 `toBeWithin`。
- `tools/structure_check.py`：新增 **`.ets` 里 `this.X` 不是 struct 成员**的检查。
  这条检查用**反例验证过会咬合**（造一个 `this.dataFingerprint` 的合成文件，
  确认它被报出来），而不是只看"跑一遍没报错"。
- `entry/src/main/tests/shims/corefilekit.ts`：补上 `picker` 导出，
  `core/io/FilePickerHelper.ts` 此前无法在 Node 台架里实例化。

### 缺陷修复

按模块分派给 11 个并行 agent，每个 agent 独占自己的源文件，写自己的回归套件
（`tests/fix*2026.test.ts`），并按 `docs/CONTRIBUTING.md` 写变更记录。
本轮共改动 **72 个文件、+5724 / −1778 行**，新增 **13 个回归套件**。

各模块的详细记录见同目录的 2026-10-19 系列文件：

| 文件 | 范围 |
|---|---|
| `2026-10-19-math-special-stats-fixes.md` | `core/math/{special,stats}.ts` |
| `2026-10-19-math-matrix-linalg-fixes.md` | `core/math/{Matrix,linalg}.ts` |
| `2026-10-19-math-random-bootstrap-lowess-fixes.md` | `core/math/{random,Bootstrap,LOWESS}.ts` |
| `2026-10-19-statistics-numerics-fixes.md` | `core/analysis/statistics/*` |
| `2026-10-19-stratigraphy-numerics-fixes.md` | `core/analysis/stratigraphy/*` |
| `2026-10-19-macroevolution-numerics-fixes.md` | `core/analysis/macroevolution/*` |
| `2026-10-19-ecology-fixes.md` | `core/analysis/ecology/*` |
| `2026-10-19-phylogenetics-consensus-signal-and-search-fixes.md` | `core/analysis/phylogenetics/*`、`core/state_machine/*` |
| `2026-10-19-morphometrics-morpho3d-fixes.md` | `core/analysis/{morphometrics,morpho3d}/*` |
| `2026-10-19-parsers-fixes.md` | `core/parsers/*` |
| `2026-10-19-reporting-export-fixes.md` | `core/{reporting,io,hpc}/*` |
| `2026-10-19-controllers-and-utils-fixes.md` | `core/{controllers,config,utils,app_infrastructure,plugins}/*` |
| `2026-10-19-ets-plot-dispatch-fixes.md` | `ets/**` |

### 审查结论本身的更正

修复过程中，**6 条审查结论被证明是错的**（详见
`.workbuddy/reviews/代码审查报告-2026-10-19.md` 的「附二」一节）：
其中 3 条是审查方自己手算/抄错了期望值（logRankTest 的标准 χ²、coxPH 的
"正确公式"、LOWESS 的 MAD 口径），3 条是断言本身写错（`Matrix` 广播、
3D 核）。**报告也是被审查对象**——这一节留在仓库里，是为了让下一次读这份
报告的人知道哪些数字可信。

## 验证

- `node --experimental-transform-types tests/test.mjs`：**全绿**，
  13 个新回归套件已登记进 `tests/run.ts`。
- `conda run -n dev python tools/structure_check.py`：**0 problems**。
- `node test/device/run.mjs`（真机接线静态闸门）：**全绿**。
- 每个 agent 都做了**独立对拍**：scipy 1.15.3 / numpy 2.2.6 / statsmodels 0.14.6
  （conda `dev`）、TeX Live 2025 的**真 pdflatex 编译**、NumPy 独立实现。
- 主审另跑了一份**不复用 agent 测试**的独立验证脚本
  （`.workbuddy/audit/verify_fixes.mjs`，25 项行为不变量），
  避免"测试照着 bug 写"。

## 风险

- **数值变更需重跑旧结果**：PERMANOVA 的 SS 口径、CONISS 分带、所有 Markov p 值、
  Box-Cox 的 λ、Chao1 的 CI、稀释曲线的点估计、随机流的相对位（~1e-10）、
  RASC / 共识树的排序。分布结论不变，**逐位**数字变了。
- **有三处设计取舍需要拍板**（各模块的变更记录里都标了 ⚠️）：
  1. 解析失败是否仍回退 CSV（当前：ZIP → 抛错；非 ZIP → 回退但带 `fallbackReason`）；
  2. `divideConfigurationIntoBlocks` 的坐标布局（当前：coordinate-major，
     副作用是 `'size_matched'` 变成"x 块 vs y 块"而非地标切分）；
  3. CONISS 的 broken-stick 检验的是 Ward 高度 `sqrt(ΔSS)` 还是真 Bray-Curtis
     距离（当前：**保留 ISS 语义**，只修正文档——改后者会改变所有 p 值）。
- **ArkUI 框架行为无法在 Node 验证**：ForEach 按 key 复用子组件意味着
  `Spreadsheet` 实例在换数据时存活、`aboutToAppear` 不再执行——因此分组重置
  改用 `dataset_loaded` 事件驱动，`@ObjectLink` 的同步时序仍未实机验证。
- **未跑 DevEco / hvigor 构建**：本轮只动 `core/**`、`ets/**`、`tests/**`、
  `tools/**`，不涉及构建配置与依赖；按 `AGENTS.md` 的约定，未显式要求时不跑全量构建。
- **重名 tip 现在报错**：古生物数据里 "indet." / "cf. sp." 重名常见，
  `brownianVCV` 改为抛可读错误而不是静默算错——需要用户先改名。
