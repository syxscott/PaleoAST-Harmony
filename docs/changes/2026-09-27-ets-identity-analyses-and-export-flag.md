# ets 层:两个"恒等映射"被当成真分析展示,导出复选框完全无效

## 类型
缺陷修复

## 问题

`ets/`(UI 层)。**3 处缺陷,2 处让界面把"没有做分析"的结果当作分析结果展示。**

| 缺陷 | 修复前的行为 | 现在 |
|---|---|---|
| `TPS Grid` 把加载的表同时当 source 和 target | 薄板样条退化为恒等映射:非仿射权重全 0、弯曲能量恒为 0、"变形网格"就是输入表本身 | 明确报错并说明需要 source + target |
| 快捷 `CCA` 把同一张表同时当物种和环境 | 自约束排序,不含任何生态信息,却以 "CCA" 之名呈现 | 明确报错并说明需要两张表 |
| `ExportDialog` 的 "Include labels" 复选框 | 取消勾选对写出的文件**没有任何影响** | 生效,且两种模式都能被 `parseCSV` 正确读回 |

## 原因

### 1 & 2. 对话框没有收集任何参数,分析本身也拿不到正确输入

`CCADialog.ets` 与 `TPSDialog.ets` 的 Run 按钮都是 `this.onConfirm({})` —— 空的。
于是 `Index.ets` 只能拿当前唯一一张表,写成:

```ts
runTPSAnalyze(data.to2D(), data.to2D())   // source == target
runCCA(data, data)                        // species == environment
```

这两处不是"参数没转发",是**结构上无法做对**。按项目既定原则
(`docs/code-style.md`:静默的错误数字比崩溃更糟),正确做法是响亮失败:
两个入口都抛出说明性错误,告诉用户需要什么。两处派发都在 `try/catch` 内,不会崩 UI。

### 3. 复选框只发布、无人读取

`ExportDialog.doRun()` 发布 `{ format, includeLabels }`,
`Index.ets.exportFile()` 只读 `format`,然后无条件调用
`this.dataCtrl.exportCSV(...)`。而 `toCSV(dm, delimiter)` **根本没有这个开关** ——
表头行与行标签列总是写出。这是本次审查遇到的第四例"收集后丢弃"。

修法是把它补齐而不是删掉复选框:一个"取消勾选后什么也没变"的控件,
对使用者来说等价于一个假开关。`toCSV` 增加 `includeLabels`(默认 `true`,行为不变),
经 `DataController.exportCSV` 转发到 `Index.ets`。

## 修改

1. `core/parsers/CSVParser.ts`:`toCSV(dm, delimiter, includeLabels = true)`。
   `false` 时不写表头行、每条记录从第一个变量开始 —— 可用
   `parseCSV(text, delimiter, false, false)` 读回。
2. `core/controllers/DataController.ts`:`exportCSV` / `exportCSVToFile` 转发该标志。
3. `ets/pages/Index.ets`:
   - `exportFile` 读取 `params['includeLabels']`。
   - `TPS Grid`(对话框路径与快捷路径)改为抛错,说明需要 source + target。
   - 快捷 `CCA` 改为抛错,说明需要物种表 + 环境表两张表。

## 验证

ArkUI 无法在 Node 里执行,因此验证分两部分:**可执行的核心侧契约**
用测试覆盖,**`.ets` 接线事实**用静态断言覆盖。

- 新增 `tests/ets2026.test.ts`,10 条回归测试,测试名一律描述旧行为。
- `toCSV`:默认输出与修改前**逐字节相同**
  (`,Len,Wid'th,Mass` / `"Site A, north",1,2,3` / `SiteB,4,5,6`);
  `includeLabels=false` 输出 `1,2,3` / `4,5,6`,两种模式都能被 `parseCSV` 读回
  (分别用 `hasHeader/hasRowLabels` 的 true/true 与 false/false),标签与数值都无损。
- 静态断言:`Index.ets` 中 `runTPSAnalyze(data.to2D(), data.to2D())`、
  `runCCA(data, data)`、`getGroups() ?? []`、`groups ?? []` 均已不存在;
  `WorkspaceView.ets` 确实接上了 `onGroupChanged` → `setGroups`。
- **机械化守卫**:测试里对全部 35 个 dialog 做正则扫描 ——
  "dialog 发布的参数键" 减去 "Index.ets 实际读取的键" 必须为空。
  这条断言把"收集后丢弃"这一整族缺陷变成了会失败的测试。
  (我自己的第一版扫描脚本正则漏了带引号的键 `'n_points':`,得出"零缺陷"的假象;
  修正后才找出 `includeLabels` —— 工具的可信度必须先验证再用。)
- 门禁:`tests/test.mjs` **203 passed, 0 failed**;`node test/device/run.mjs` 19/19;
  `structure_check.py` 174 文件 0 问题。
- 未跑 DevEco 构建:本次只动 `core/**`、`ets/pages/Index.ets` 与 `tests/**`。

## 其它

- `Spreadsheet` 的 `onDataChanged` / `onSelectionChanged` 同样从未被赋值,
  **本轮仍然不动**:单元格编辑之所以有效,是因为 `Spreadsheet` 拿到的就是同一个
  `DataMatrix` 引用、直接改共享的 `Matrix`;而选区是组件内部状态,下游没有任何消费者。
  这两个钩子既非必需也无害,只是契约上多写了两个没人提供的回调。
  与 `onGroupChanged` 的区别在于:分组存在组件自己的 `@State` 里,没有共享引用兜底,
  所以它是真的断了。
- `CCADialog` / `TPSDialog` 现在抛错,等于这两个对话框在 UI 上是不可用的。
  要真正支持,需要让对话框接收两份配置(例如从文件导入两份 landmark 表)。
  这是新增功能,不在本轮"修 bug"范围内。
- **未审**:`PlotCanvas.ets`(57KB,渲染层)、`Index.ets` 剩余约 1/3、
  `HistoryRepository.ets`、`EntryAbility.ets`、其余 28 个 dialog、
  `components/plot/*`、`utils/*`(AppSettings / Logger / PreferenceManager)。
