# Index.ets 的纯逻辑搬进 viewmodels/ 层，外加悬浮工具栏主题切换漏通知平台

## 类型

重构 / 缺陷修复 / 工程

## 问题

两件事。

**一、`pages/Index.ets` 是一个 1400 行的单文件组件。** 里面既有 dispatch switch、对话框接线、绘图选择，也有若干条**纯规则**——不依赖 ArkUI、不依赖组件状态、输入确定则输出确定。这些规则原本是 `@Component struct` 里的 private 方法，而 ArkUI 层在 Node 测试台里**根本无法执行**：单测覆盖 `core/**` 和 `ets/` 下的纯 `.ts` 模块，struct 的 private 方法两头不沾。所以这些规则**一条单测都没有**：

| 规则 | 原位置 | 原状态 |
|---|---|---|
| 地层对比的两个剖面 | `stratCorrSections()` | 无单测 |
| 系统发育的 tip→分组映射 | `phyloGroups()` | 无单测 |
| 对话框样本行下标的夹取 | `sampleIndex()` | 无单测 |
| 分组不可用时的拒绝 | `requireGroups()` | 无单测 |
| 可复现脚本的抬头与步骤 | `buildAnalysisScript()` | 无单测 |

**二、主题切换有两条路径，只有���条是通的。** `handleAction()` 里 `case 'theme'` 翻转了 `this.darkMode` 并写进 `AppStorage`，但**没有通知平台**：

```ts
case 'theme':
  this.darkMode = !this.darkMode;
  AppStorage.setOrCreate('darkMode', this.darkMode);
  break;
```

而 `RibbonBar.ets` 的开关调了 `applyColorMode(ctx, isOn)`，所以 `$r('app.color.x')` 资源会跟着变。结果是：悬浮工具栏切主题时，Canvas 与 SVG 导出会变色（它们直接读 token 表），而页面上的 UI 属性**停在浅色**——一半变一半不变。

## 根因

**一：** 分层缺失。参照项目（`harmony-bird` 的 `viewmodels/GameViewModel.ets`、`stock-tracker` 的 `viewmodel/ListViewModel.ets` + `model/ChartModels.ets`）都是 `pages/ + components/ + viewmodels/ + model/` 四层；本项目把本该属于 viewmodels 的规则留在了 pages 里。

**二：** `ThemeController.ets` 是 2026-10-20 的配色 token 化那轮加的，`RibbonBar` 接上了，`Index.ets` 的 `handleAction` 漏了——新文件加进来时只接了一个调用点。

## 修复

### 新增 `entry/src/main/ets/viewmodels/`（4 个纯 TS 模块，无任何 ArkUI / @kit / @ohos 导入）

| 文件 | 导出 | 承接的页面方法 |
|---|---|---|
| `stratSections.ts` | `StratSection`、`buildStratSections(data)` | `stratCorrSections()` |
| `specimenGroups.ts` | `GroupLookup`、`phyloGroupMap(labels, getGroup)`、`usableGroupCodes(groups)` | `phyloGroups()`、`requireGroups()` |
| `dialogParams.ts` | `clampSampleIndex(raw, nRows)` | `sampleIndex()` |
| `analysisScript.ts` | `AnalysisStep`、`ScriptDataInfo`、`analysisScriptHeader(...)`、`analysisStepJson(...)` | `buildAnalysisScript()` |

页面侧保留同名 private 方法作为**薄适配层**（读组件状态 → 调纯函数），调用点一行未动：

```ts
private stratCorrSections(): StratSection[] {
  const dm = this.stateMgr?.dataMatrix;
  return buildStratSections(dm ? dm.data : null);
}
```

**逐位等价**：所有被搬走的表达式是原样复制，输出的字符完全一致。`analysisScriptHeader` 的时间戳由页面传入（`new Date().toISOString()`），所以纯函数本身没有非确定性输入。

### 没搬的：`evictableWidget()`

**留在原地。** `tests/fixEts2026.test.ts` 把这条规则钉成了 `Index.ets` 的**源码事实**：

```ts
const add = method(src, 'private addWidget(', 'private exportPlot(');
expect(add.includes("w !== 'spreadsheet'")).toBe(true);
```

搬走它会让这条已有回归测试变红，而那个测试文件不在本次改动范围内。宁可少搬一个，也不改别人��测试。

### 没搬的：`buildAnalysisScript()` 的「拼接」部分

`header.join('\n')` 与 `'[' + steps.join(',\n') + ']' : '[]'` 留在页面里：`tests/etsSyntax.test.ts` 钉死了这两个分隔符字面量（当年正是这里的裸换行让整个页面编译不过）。搬走的是**抬头内容**与**步骤 JSON**，即脚本「说了什么」；「怎么拼」仍在页面。

### 主题修复

```ts
case 'theme': {
  this.darkMode = !this.darkMode;
  AppStorage.setOrCreate(DARK_MODE_KEY, this.darkMode);
  const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
  applyColorMode(ctx, this.darkMode);
  break;
}
```

与 `RibbonBar.ets` 同一套写法，共用 `theme/ThemeController.ets` 里已有的 `applyColorMode` 与 `DARK_MODE_KEY`，不另写一份。`AppStorage.setOrCreate('darkMode', …)` 的字面量也换成了 `DARK_MODE_KEY`（值相同）。

## 验证

### 新增测试：`tests/viewmodels2026.test.ts`（39 个用例，**尚未注册到 `tests/run.ts`**）

单跑方式（不走 `tests/test.mjs`）：

```bash
node --experimental-transform-types --experimental-loader ./tests/loader.mjs \
  -e "import('./tests/viewmodels2026.test.ts').then(() => import('./tests/runner.ts')).then(r => r.runAll()).then(ok => process.exit(ok?0:1))"
```

结果：**39 passed, 0 failed, 39 total**。

用例按旧行为命名，例如：

- `a table with two columns measures the second column twice`
- `a one-column table makes the first section read past the end of the row`
- `a tip whose group is "Ungrouped" is not a group`
- `a missing grouping refuses instead of analysing nothing`
- `a fractional index is floored, not rounded`
- `fix: the floating toolbar theme switch changed the app but not the platform`

### 逐位等价验证（差分测试）

把 **HEAD 版的原实现逐字抄成参考函数**，与新 viewmodel 在同一批输入上对拍：

- 地层剖面：10 种矩阵形状（含 0 行、1 列、2 列等边界）× 2
- 系统发育分组：6 组标签/分组组合
- 样本下标：10 个 raw（0 / 1 / 3.7 / -1 / -0.5 / NaN / undefined / 1e9 …）× 5 种行数
- 分组码：null / undefined / [] / [0,1] / [0,0,1]（值与抛出的错误消息都比）
- 脚本抬头：3 种数据状态 × 3 种步数
- 脚本步骤：4 段历史

结果：**differential cases compared: 90, mismatches: 0**。

### 咬合验证（变异测试）

对 viewmodel 与页面做了 6 处**真实坏输入**变异，确认测试会红，随后逐个还原：

| 变异 | 变红的用例（实际输出） |
|---|---|
| `clampSampleIndex` 去掉 `Math.floor` | `a fractional index is floored, not rounded`（expected 2, got 2.9） |
| `clampSampleIndex` 去掉上界 `Math.min` | `an index past the last row becomes the last row`（expected 4, got 99）、`a table with one row can only be row 0`、`a table with no rows can only be row 0` |
| `phyloGroupMap` 去掉 `'ungrouped'` 过滤 | `a tip whose group is "Ungrouped" is not a group`（expected ["A"], got ["A","B"]） |
| `buildStratSections` 的 `safe()` 去掉 `[0]` 兜底 | `a table with no rows turns an empty column into [0]`（expected [0], got []） |
| `analysisScriptHeader` 把 `stepCount` 写死成 0 | `the header names the data, the step count and the generation time`（expected // Steps: 2, got // Steps: 0） |
| 页面里删掉 `applyColorMode(ctx, this.darkMode)` | `the theme action tells the platform which colour mode to use`（expected true, got false） |

每处变异后单测摘要都是 `38 passed, 1 failed, 39 total`（去掉上界那处是 `36 passed, 3 failed`），还原后回到 `39 passed, 0 failed`。

### 既有门禁

| 命令 | 结果 |
|---|---|
| `node --experimental-transform-types tests/test.mjs` | 606 passed, 0 failed（见下） |
| `conda run -n dev --no-capture-output python tools/structure_check.py` | `== checked 188 files, 0 with problems ==` |
| `node test/device/run.mjs` | `19 passed, 0 failed, 19 total (static wiring)` |
| `node .workbuddy/audit/import_resolve.mjs` | `relative imports checked: 320` / `UNRESOLVED: 0` |

## 风险

- **行为漂移**：搬动本身有风险。缓解办法是把被搬走的表达式**原样复制**，不趁机「改进」——包括 `col(1)` 在单列表上越界读出 `undefined` 这种怪行为也照旧保留，并写成测试钉住。
- **未覆盖**：`buildAnalysisScript()` 的拼接部分仍未进单测（被 `tests/etsSyntax.test.ts` 的字面量钉在页面里）。
- **`evictableWidget()` 仍未进单测**（被 `tests/fixEts2026.test.ts` 的源码事实钉在页面里）。这两条要进单测，需要**改别人的测试文件**去指向新位置，属于另一次改动。
- **数值影响**：无。分析结果不变，`core/**` 一行未动。
- **需要重跑旧结果吗**：不需要。
- 主题修复需要真机验证：切换后 `$r('app.color.x')` 是否真的变暗。`applyColorMode` 内部已 try/catch，失败只 `console.warn`，不会把应用带崩。
