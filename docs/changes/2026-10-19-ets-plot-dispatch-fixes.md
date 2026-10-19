# UI 层：兜底绘图挑错字段、箱线图画布与 SVG 不一致、分组跨数据集残留

## 类型

缺陷修复 / 数值变更

## 问题

`entry/src/main/ets/` 的 6 条缺陷，其中一条让 **24 个走对话框的分析画出的是错的图**。

## 根因

1. `Index.ets` 的兜底绘图分支用 `firstNumericSeries()` 挑序列：先查 12 个白名单键
   （**不含** `expectedTaxa`/`power`/`frequencies`/`sampleSizes`），再取
   「`Object.keys` 顺序里第一个长度 >1 的数字数组」——也就是结果对象字面量的
   **第一个数组字段**，与「这个分析该画什么」无关。
2. 三个本来写对了的专属绘图分支（`Index.ets` 的第二个 switch 里的
   Diversity Indices / Rarefaction / Spectral）在**同一个方法的第一个 switch**
   就 `DialogManager.open(...)` 并 `return` 了 → **永远不可达**。
3. 箱线图的画布分支（`PlotCanvas.ets` 的 `drawBoxPlot`）自写 Y 公式、像素算术
   布局、自己的四分位数与须线，与 SVG 导出分支各算各的。
4. `Spreadsheet` 按**行号**继承旧数据集的分组标签。

## 修复

| 文件 | 旧行为 → 新行为 |
|---|---|
| `ets/components/plot/plotSeries.ts`（**新增，纯 TS**） | 集中「一个分析该画什么」的判定：按分析名选响应字段，坐标轴字段黑名单 26 项，判定不出 X 时**清屏**而不是画一条假的 1..n |
| `ets/components/plot/boxGeometry.ts`（**新增，纯 TS**） | 箱线图几何的唯一实现（分位数、箱须、视口变换），画布与 SVG 共用 |
| `ets/components/rowGroups.ts`（**新增，纯 TS**） | 分组数组的对齐与重置 |
| `Index.ets` | 删掉 `firstNumericSeries()`，改调 `selectPlotSeries()`；删掉 3 个被遮蔽的分支，画图规则只留一处；`addWidget` 淘汰最老**分析**标签，`'spreadsheet'` 永不被淘汰；`loadFile` 追加发 `dataset_loaded`；「Stratigraphic Correlation」对话框路径改走 `runStratCorr`（此前走 Pearson，与快捷路径**产出两种不同的分析**）；Phylo ANOVA 传表格的标本分组而非常空对象 `{}`；错误提示不再被 `substring(0,100)` 截断 |
| `PlotCanvas.ets` | `drawBoxPlot` 与 SVG 的 boxplot 分支共用 `computeBoxPrimitives()`；Y 走 `vp.mapY`、X 走 `vp.mapX`（此前自写局部 `mapY`，**绕过 `ViewPortHandler`**——架构文档明令的边界） |
| `Spreadsheet.ets` | 订阅 `dataset_loaded` 后重置分组；`assignGroup` 改为对齐当前行数后整体重写并发布 |
| `dialogs/NullModelDialog.ets` | 补第 3 条 metric 描述（`metricOpts` 3 项 vs `metricDesc` 2 条） |

## 验证

- 新增 `tests/fixEts2026.test.ts`：**42 例全绿**。
- 关键数字：Rarefaction 现在画 `expectedTaxa`（此前画 `sampleSizes` 的直线
  `[1,3,5,7,9]`）；Spectral 画 `power`（此前画 `frequencies` 的直线）；
  Diversity Indices 不再产出假的直线；箱线图 `[1,2,3,4]` 的中位数是 **2.5**
  （此前 3，取的是上中心次序统计量），须线上界 4（此前 100）。
- 抽出的 3 个模块是**纯 TS**，可以在 Node 里直接 import 测试——沿用本项目
  已有先例（`ets/components/plot/*.ts`）。

## 风险

- **ArkUI 框架行为无法在 Node 验证**：ForEach 按 key 复用子组件 → 换数据集时
  `Spreadsheet` 实例存活、`aboutToAppear` 不再执行，因此分组重置必须靠
  `dataset_loaded` 事件驱动；`@ObjectLink` 的同步时序仍未实机验证。
- 若干对话框分析（Wavelet / GPA / Allometry）从「画一条索引直线」变为**不出图**——
  按「先错图后无图」的取舍，可后续在 `selectPlotSeries` 的规格表里补各自的语义 X。
- 待办：`PhyloAnovaDialog` 仍不收集**按 tip 的**分组标签（目前用表格的标本分组顶上）。
- `Phylo Signal` 路径会经过 `core/analysis/phylogenetics/vcv.ts`，零方差 / NaN 性状
  现在会抛可解释错误，UI 以全文提示呈现。
- 箱线图路径**当前不可达**（`Index.ets` 只设过 `none|scatter|line|histogram|bar`，
  从未是 `'boxplot'`），`tests/` 里也**完全没有箱线图测试**——修好它是为了
  「一旦接线就带病上线」的那一天。
