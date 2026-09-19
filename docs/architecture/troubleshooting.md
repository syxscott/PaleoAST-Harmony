# 故障定位指南

**先读这一篇。** 本文按「症状」组织，每条给出调用链和该看的文件，避免每次从 UI 入口名开始静态追溯。

查到原因后：修代码 → 补回归测试 → 在 [`../changes/`](../changes/) 记一条。若这条症状以前没出现过，把新条目补进本文。

---

## 0. 通用排查顺序

```bash
node --experimental-transform-types tests/test.mjs   # 78 个单测
python tools/structure_check.py                      # 括号/重复导出
```

两个检查都绿但问题仍在 → 大概率是 **UI 接线**或**平台相关**，不是算法。按下面的症状表往下查。

---

## 1. 结果不对（最严重）

### 1.1 某个分析结果明显错误 / 与 R 或论文不符

```
症状 → StatisticsController.runXxx() → core/analysis/<模块>/xxx.ts
```

1. 先确认 UI 真的调到了目标函数：`ets/pages/Index.ets` 的 `runDialogAnalysisCore()` 的 `switch (name)`。
   - **历史坑**：`case 'Univariate'` 曾直接 `return runSummary()`，选 t 检验/ANOVA 都跑成描述统计。
2. 再确认参数真的传下去了。对话框的 `onConfirm` payload 字段名必须与 `switch` 里读取的键一致。
   - **历史坑**：Rarefaction 读 `sample_index`，而对话框从不提供该键 → 恒定用第 0 行。
   - **历史坑**：CCA 把同一个矩阵当响应和约束各传一次 → 模型退化。
3. 用受影响的算法族对照本文第 5 节「已知高危函数」。

### 1.2 特征值 / 特征向量 / 载荷 / 排序轴有问题

**全部高级分析都经过 `core/math/linalg.ts` 的 `eigh`。** 它曾有两个独立缺陷：

| 缺陷 | 表现 | 现在的守卫 |
|---|---|---|
| 特征值与特征向量分开排序 | `eigenvalues[k]` 与第 k 列不配对 | 同一 index map 同步重排；单测断言 `A·v = λ·v` |
| Jacobi 旋转角分母符号写反 | 迭代不收敛，返回的「特征值」根本不是特征值 | 分母改为 `T[q,q]−T[p,p]`；不收敛时**抛错** |

排查步骤：
1. 跑 `tests/core.test.ts` 的 `eigh pairs each eigenvalue with its own eigenvector`。
2. 若抛 `Jacobi iteration did not converge` → 矩阵可能非对称，或维度异常。
3. 抛 `eigh: matrix is not symmetric` → 这是**有意的**：LDA 这类广义特征问题必须先对称化为 `Sw^{-1/2}·Sb·Sw^{-1/2}`，不能把 `Sw⁻¹Sb` 直接传进去。

### 1.3 一处算法结果与同族其他分析口径不一致

先查该量在本仓库里是否存在**重复实现**。曾经的实例：
- `Blomberg K` 在 `vcv.ts` 与 `statistics.ts` 各有一份，且两份都错（分子用算术均值、归一化因子用 `tr(V)/n`）。**判定方法不是比对公式，而是它的定义性质 `E[K] = 1` under BM。**
- `CSV` 曾有两套实现 → 统一为 `CSVParser.ts` 的 `splitCSVLine`，`ExcelParser` 复用。

原则：**同一个量只保留一份实现**，其余改为导入。

### 1.4 图表显示的数字合理但图是错的

`PlotCanvas` 只通过 `dataX`/`dataY` 接收数据。检查：

1. `Index.ets` 的 `runAnalysisWithParams()` 是否在本次分析前**清空**了 `plotDataX/Y`。
   - **历史坑**：不清空时新分析沿用上一张图的数据 → 「新标题 + 旧曲线」。
2. 该分支填入的序列是否与 `plotType` 匹配（`scatter` 需要成对的 x/y；`histogram` 只吃 y）。
3. `plotType` 为 `heatmap` / `dendrogram` / `range` / `none` 时必须清屏 —— 这些类型缺专用数据通道。
4. 坐标变换问题一律查 `ets/components/plot/ViewPortHandler.ts`，**不要**在渲染器里另写 `mapX/mapY`。
   - 缩放必须以绘图区中心为轴，且 Canvas 与 SVG 导出必须共用同一个 `ViewPortHandler`。

### 1.5 切换标签后图表对不上

每个标签的图表由 `Index.ets` 的 `captureWidgetPlot(name)` 冻结、`onWidgetChanged` 灌回。若发现某标签显示了别的分析：

1. 确认该分析路径调用了 `captureWidgetPlot`。
2. 确认 `WorkspaceView` 只在 `idx === currentWidget` 时渲染 `PlotCanvas`，其余标签只显示占位文字（不要借用当前标签的序列）。

---

## 2. 界面控件没反应

### 2.1 对话框确认后什么也没发生

```
DialogLayer.ets： activeDialog === 'X' → XxxDialog.onConfirm(this.analysis('X'))
Index.ets      ： analysis(name) → runAnalysisWithParams(name, params)
                 → runDialogAnalysisCore(name, params) 的 switch (name)
```

逐段核对三个名字是否一致。曾经 Univariate 的 `onConfirm` 硬写 `'Summary'`，与 `activeDialog` 不一致。

### 2.2 点按钮后状态栏文字变了，但没有结果

`runDialogAnalysisCore` 的 `switch` 缺少该 `case` → 走到 `default`。检查是否有拼写/空格差异（导航树里的条目名必须与 `case` 完全一致）。

### 2.3 导航树条目点了没用 / Ribbon 标签点了没用

- 导航树条目名 → `Index.handleAnalysis(name)`。
- Ribbon 标签过滤导航树：`Index.onTabChanged()` → `RIBBON_TAB_SECTIONS` → `NavigationTree.allowedSections`。若某分析在某标签下消失，检查 `RIBBON_TAB_SECTIONS` 是否遗漏了它所属的 section。

### 2.4 快捷键 / 工具栏按钮

`FloatingToolbar.onAction(action)` → `Index.handleAction(action)`。动作名列表在 `handleAction` 的 `switch` 里。

---

## 3. 数据导入问题

### 3.1 xlsx 少了第一行数据 / 表头变成了数字

`core/parsers/ExcelParser.ts`。两个曾经的缺陷：

1. 表头行已由循环起点排除，却又 `data.shift()` 一次 → **丢掉第一条数据行**。
2. 单元格类型属性 `t` 位于 `<c>` 标签上，而解码函数只收到标签**内部**内容 → 类型判断永远返回 `'n'`，**共享字符串被替换为它在字符串表中的下标**。

排查：`tests/core.test.ts` 的 `xlsx import keeps the first data row and resolves cell types`（用合成的最小 xlsx，不依赖外部文件）。

### 3.2 CSV 含引号/逗号时错列

`CSVParser.ts` 的 `splitCSVLine` 是唯一的 RFC 4180 实现；导出走 `toCSV` 的按需加引号。**新增任何 CSV 解析都复用它**，不要另写 split。

### 3.3 换成新数据集后撤销出现旧数据

`core/models/StateManager.ts` 的 `setData` 必须清空 `_u` / `_r` / `_cmdUndo` / `_cmdRedo` 与结果缓存。若出现「撤销把旧矩阵的值写进新矩阵」，就是这个栈没清。

---

## 4. 原生层

### 4.1 `hasNative()` 一直是 false

NAPI 的加载链路有四个必须一致的名字：

| 位置 | 值 |
|---|---|
| `cpp/CMakeLists.txt` 的 target | `paleoast_napi` → `libpaleoast_napi.so` |
| `cpp/native_api.cpp` 的 `nm_modname` | `"paleoast_napi"` |
| `cpp/types/libpaleoast_napi/oh-package.json5` 的 `name` | `"libpaleoast_napi.so"` |
| `entry/oh-package.json5` 的依赖键 | `"libpaleoast_napi.so": "file:./src/main/cpp/types/libpaleoast_napi"` |
| `core/math/NativeMath.ts` 的动态 import | `'libpaleoast_napi.so'` |

**历史坑**：`cpp/types/` 目录与 `entry/oh-package.json5` 的依赖声明曾经完全缺失，导致 `.so` 无法被 ArkTS 解析、`initNative()` 恒为 false。注意单测**发现不了**这个问题 —— 它只断言「非鸿蒙环境返回 false」。

排查：
```bash
node --experimental-transform-types --input-type=module -e "
import {register} from 'node:module'; import {pathToFileURL} from 'node:url';
register(pathToFileURL('./tests/loader.mjs').href, pathToFileURL('./tests/'));
const N = await import('./entry/src/main/core/math/NativeMath.ts');
await N.initNative();
console.log('hasNative', N.hasNative(), 'lastError', N.nativeLastError());
"
```
`lastError === 'Error:NotLoaded'` 表示从未加载；返回 `'Error:Singular'` 之类表示 C++ 报了业务错误。

### 4.2 原生返回 `null`，但不知道原因

调 `nativeLastError()`。错误码定义在 `cpp/core/ErrorHandler.h`：
`Error:DivByZero` / `Error:Domain` / `Error:NotSquare` / `Error:DimMismatch` / `Error:Singular` / `Error:NoConvergence` / `Error:NotSymmetric` / `Error:BadArgument` / `Error:Unknown`。

### 4.3 原生结果与 TS 结果不一致

`matrixSVD` 只返回奇异值、`matrixEigh` 只返回特征值，**不是** `linalg.svd` / `linalg.eigh` 的等价替换。任何「切到原生」的改动都必须先对拍，且补一条对比测试。

---

## 5. 已知高危函数（改动前先读记忆）

改这些之前先看 `.workbuddy/memory/MEMORY.md` 的「已修复的关键坑」：

`core/math/linalg.ts::eigh`、`core/parsers/ExcelParser.ts`、`core/parsers/CSVParser.ts`、
`core/models/StateManager.ts::setData`、`analysis/phylogenetics/vcv.ts::blombergKFromVCV`、
`core/reporting/LatexCompiler.ts::escapeLatex`、`core/analysis/ecology/CoverageRarefaction.ts`。

---

## 6. 测试跑不起来

| 现象 | 原因 |
|---|---|
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | 漏了 `--experimental-transform-types`（`tests/runner.ts` 用了构造器参数属性） |
| `does not provide an export named 'X'` | 某个 barrel 把**纯类型**混进了值导入/导出列表。改成 `import type` / `export type` |
| 直接跑 `tests/run.ts` 失败 | 必须走 `tests/test.mjs`（核心模块用无扩展名相对导入，靠 `tests/loader.mjs` 解析） |
| 新增 `@kit.*` 依赖后测试失败 | 在 `tests/loader.mjs` 的 `SHIMS` 里加一行映射到 `entry/src/main/tests/shims/` |
| 想扫全仓模块图是否可实例化 | 逐模块 `import()`（见 `AGENTS.md`）；类型名误当值导入只有这种方式能一次抓全 |
