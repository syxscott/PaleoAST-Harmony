# 死代码清单(2026-09-27 审计)

## 怎么重新生成

```bash
node tools/dead_code_audit.mjs          # 按文件汇总
node tools/dead_code_audit.mjs --list   # 逐个符号列出
```

判定标准:一个**已声明的导出**如果在生产代码里没有任何地方**使用**它,就是死的。
脚本对 barrel 透明 —— `index.ts` 里的 `export { X } from './y'` **不算使用**。

这是全仓审查的副产品,用来支撑"删不删"这个决定。
**本轮只统计,未删除任何东西。**

## 数字

| 类别 | 数量 |
|---|---|
| 已声明的值导出(类/函数/const/let/var) | 569 |
| 生产环境从不使用 | **222** |
| 仅被测试引用 | 48 |
| 合计无生产调用方 | **270(47%)** |

另有 19 个**文件**没有任何生产方 import(约 1600 行),与上表部分重叠。

## 为什么这个比例值得认真对待

死代码不只是占地方。本次审查里反复出现的根因是**同一个量有多份实现**,
而死的那份往往就是"没被验证过"的那份。已经找到的实例:

| 重复的量 | 份数 | 活的那份 | 死的副本 |
|---|---|---|---|
| Kabsch/Procrustes 旋转 | 4 | `morphometrics._findRotation`(私有,GPA 用) | `PartialGPA.findRotation`(**算法完全相同**)、`vcv.kabschRotation`(通用 N 维)、`Quaternion.RotationMatrix.procrustes`(3D) |
| `linkage` / `fcluster` | 2 | `statistics`(已修过簇数 bug) | `scipy/DistanceCluster` |
| LaTeX 转义 | 2 份实现 | `LatexCompiler.escapeLatex`(已导出并被共享) | `TableGenerator._escape`(私有副本) |
| add-one p 值格式化 | 2 | `LatexCompiler.formatPValue` | `ReportBuilder._formatPValue` |

注意 `PartialGPA.findRotation` 与 `morphometrics._findRotation` 的
**docstring 措辞不同**(一个写 `cfg @ Rᵀ ≈ consensus`,一个写 `R @ target ≈ reference`,
看起来像相反约定),但**代码公式逐字相同**。读注释会得出错误结论 —— 这本身是文档危害。

## 整文件无生产 importer(约 1600 行)

`ets/components/FileDropHandler.ets`(33)
`ets/components/dialogs/BaseAnalysisDialog.ets`(98,仅结构模板,3 个 dialog 在注释里说明 ArkTS struct 不能继承)

`core/app_infrastructure/{CodeAudit,ExceptionHandler,StartupLoader,ThemeManager}.ts`(458)
`core/hpc/{ProcessPool,TaskScheduler}.ts`(154,仅测试引用 —— 与 `Index.ets` 里"closures capturing `this` 不能跨线程"的注释一致)
`core/plugins/{Base,Decorators,Loader,Registry}.ts`(137)
`core/scipy/DistanceCluster.ts`(134)
`core/state_machine/*`、`core/data/ExampleData.ts`、`core/math/Bootstrap.ts`、
`core/config/index.ts`、`core/analysis/morpho3d/index.ts` 等

## 声明了但没有 UI 入口的功能(不是死代码,但同样"不可达")

- `reporting/{TableGenerator,FigureHandler,MatrixConverter}` 被 barrel 导出、
  有测试,但 `Index.ets.exportReport()` 明确**不用** `TableGenerator`
  (它输出完整的 `table` 环境,嵌进 `addTable` 的 fragment 会产生嵌套浮动体,
  pdflatex 报 "Not in outer par mode")。这三个只有测试在用。
- `Spreadsheet.onDataChanged` / `onSelectionChanged` 从未被赋值。
  单元格编辑之所以有效,是因为 `Spreadsheet` 拿到的就是同一个 `DataMatrix` 引用。

## 删除前必须人工确认

脚本只看得到静态名字,**看不到动态可达性**:路由表、插件注册表、字符串键、
ArkUI 模板里按名字实例化的组件。上面 `ets/components/*` 被整体排除,
正是因为它们在 `build()` 树里按名字出现。
