# 数据表:行内联在 LazyForEach 里,滑动一次重建一次 —— 改成 @Reusable 复用组件

## 类型

重构 / 性能 / 工程

## 问题

`entry/src/main/ets/components/Spreadsheet.ets` 有 4 处 `LazyForEach`,其中数据表那一处的
**行是内联写在 item generator 里的**:

```ts
LazyForEach(this.dataSource, (rowIdx: number) => {
  Row() {                       // ← 行号 + 分组徽章 + 每列一个节点
    Text(String(rowIdx + 1))...
    ForEach(this.columnIndices, (_: Object, colIdx: number) => {
      if (this.editingCell === `${rowIdx},${colIdx}`) { TextInput(...) }
      else { Text(...) .gesture(LongPressGesture(...)) }
    })
  }.width('100%').height(22)
}, (rowIdx: number) => rowIdx.toString())
```

内联的 builder **无法被复用**:ArkUI 的组件复用只认「被 `@Reusable` 修饰的独立
`@Component` struct」,装饰器加不到内联 builder 上。于是每滚动一次,整棵行子树
(1 个行号 + 1 个分组徽章 + N 个单元格)都被销毁重建;1000 行 × 20 列的表,
滚一遍就是几千次组件创建。

## 根因

`LazyForEach` 本身是对的(它避免了 DOM 爆炸),但**列表项不是组件**,所以 ArkUI
没有可复用的对象可以缓存。官方《组件复用实践》写得很直接:复用生效的条件是
「自定义组件被 `@Reusable` 装饰器修饰」,而《组件复用实践》同时说明
「`ForEach` 渲染控制语法的全展开属性,不能触发组件复用」——只有 `LazyForEach`
配 `@Reusable` 才有复用。

## 修复

| 文件 | 改动 |
|---|---|
| `ets/components/SpreadsheetRow.ets`(**新增**) | 行抽成独立的 `@Reusable @Component struct SpreadsheetRow` |
| `ets/components/cellAppearance.ts`(**新增**) | 单元格文本与配色的**唯一**实现(纯 TS,可在 Node 里测) |
| `ets/components/Spreadsheet.ets` | `DataRows()` 的 item generator 改为 `SpreadsheetRow({...})`;新增 5 个**稳定的**回调属性;删掉 `getCellDisplay` / `getCellFontColor` / `getCellBg` / `formatCell` |

### 每个状态为什么这么传

复用的真正风险不是编译错误,是**陈旧数据**:被复用的组件**保留创建时拿到的参数**,
构造函数不再执行,`aboutToAppear` 也不再触发。所以:

| 值 | 传法 | 理由 |
|---|---|---|
| `rowIndex` / `selectedRow` / `selectedCol` / `editingCell` / `editValue` / `showGroups` / `groupLabel` / `groupColor` / `darkMode` / `columnIndices` | `@Prop` | 这些会随父组件变化。`@Prop` 由框架在每次更新时把父组件的值拷进来,**复用时同样会更新**;普通成员变量只会在创建时赋值一次,复用后会留着上一行的值(行号、分组、数据全是错的,而且看起来完全正常) |
| `dataMatrix` | `@ObjectLink` | 单元格的值从矩阵里读。`DataMatrix` 是 `@Observed` 的,`@ObjectLink` 直接拿同一份引用,不做深拷贝;官方《组件复用性能优化指导》给的正例就是「可复用组件 + `@ObjectLink`,不写 `aboutToReuse`」 |
| `onSelect` / `onStartEdit` / `onEditValueChange` / `onCommitEdit` / `onLongPress` | **普通函数属性** | 回调不是状态。`@Prop` 是单向绑定(形状不对),而且每次更新都要深拷贝一个函数。父组件传的是**箭头函数属性**(只创建一次、引用恒定),行号当**参数**传而不是闭包捕获——否则复用的行会报告它创建时那一行的行号 |
| 编辑状态(`editingCell` / `editValue`) | 留在父组件,行只读 | 复用组件里如果自己存一份编辑态,复用到另一个格子时编辑器会残留。行只读父组件的 `@Prop editingCell`,编辑器归属唯一 |

`@Prop` 的自动同步是官方文档写明的(《组件复用性能优化指导》:
「避免对 `@Link`/`@ObjectLink`/`@Prop` 等自动更新的状态变量,在 `aboutToReuse`
方法中再进行更新」——不写 `aboutToReuse` 才是正例)。行组件因此**没有
`aboutToReuse`,也没有任何 `@State`**:它自己不存状态,所以不存在残留。

### 行为不变

- 选中行/列的配色:`cellBackground()` 逐条照搬原来的 `getCellBg()`(点击的格子 >
  选中的行 > 选中的列 > 透明);
- 斑马纹:`rowBackground()` 照搬原来的三元式(偶数行透明、奇数行 stripe、选中行 tint);
- 分组色:`groupLabelFor()` / `groupColorFor()` 照搬 `this.rowGroups[rowIdx] ??
  'Ungrouped'` 与 `this.groupColors.get(...) ?? token('bg_muted', dark)`;
- 编辑的进入与提交:父组件的 `startEditing` / `commitEdit` / `cancelEdit` 一个字没改,
  行只是换了调用方式(经回调);
- 长按菜单:`handleCellLongPress` 置 `selectedRow` / `selectedCol` / `showCellMenu`,
  菜单仍然 `bindPopup` 在 Scroll 上;
- 状态栏计数:`selectedRows.size`、`nSamples × nVariables`、复制值提示都没动。

## 验证

- 新增 `tests/spreadsheetReuse2026.test.ts`:**38 例全绿**(需要注册到
  `tests/run.ts` 后随全量一起跑;单独跑见下)。
- 跑过的检查:
  - `node --experimental-transform-types tests/test.mjs` → **606 passed, 0 failed**;
  - `conda run -n dev --no-capture-output python tools/structure_check.py` →
    `checked 188 files, 0 with problems`;
  - `node test/device/run.mjs` → `19 passed, 0 failed (static wiring)`;
  - `node .workbuddy/audit/import_resolve.mjs` → `relative imports checked: 320,
    UNRESOLVED: 0`。
- **测试会咬合**:对实现做了 12 个变异,每一个都被测试抓住(变异 → 首个失败用例):
  | 变异 | 结果 |
  |---|---|
  | 行把 `rowIndex` 放回普通成员 | ✗ `every value the row shows is a @Prop, not a plain member` |
  | 回调加 `@Prop` | ✗ `a callback is a plain function property, never a @Prop` |
  | 行自己用 `@State` 存编辑态 | ✗ `the row keeps no state of its own` |
  | 行又内联回 item generator | ✗ `the row markup is no longer inside the item generator` |
  | 分组徽章丢掉 muted 兜底 | ✗ `the group badge still falls back to the muted colour` |
  | `NA` 写成 `NaN` | ✗ `a missing value is NA` |
  | 父组件丢掉「点击即退出编辑」 | ✗ `clicking a cell still leaves the editor and selects the cell` |
  | 父组件丢掉 `startEditing` / `commitEdit` 调用 | ✗ `the other handlers call the same methods the inline row called` |
  | 行上报固定的行号 | ✗ `the row passes its own row index to the callbacks` |
  | 父组件传死字符串当分组名 | ✗ `the parent passes the CURRENT value of every variable` |
  | 行把 `selectedCol` 放回普通成员 | ✗ `every value the row shows is a @Prop, not a plain member` |
- 套件自带 4 个「已知坏样本」,证明检查器本身不是空转的。

## 风险

- **ArkUI 框架行为无法在 Node 验证**:`@Reusable` 的复用、`@Prop` 在复用时的
  自动同步、`aboutToAppear` 不再触发,这些都只能实机确认。本次按官方文档
  (《组件复用实践》《组件复用性能优化指导》)的写法实现,并把「哪些值必须
  自动同步」全部收敛到 `@Prop` / `@ObjectLink`,但**未在设备上跑过**。
- **行内的 `if (editingCell === ...)` 会在编辑态变化时改变组件树结构**,这是
  ArkUI 复用机制里明确的性能损耗点(《组件复用性能优化指导》建议用 `reuseId`
  区分结构不同的实例)。本次没有拆 `reuseId`:一行里最多只有一格在编辑,按
  「行号 × 编辑列」分组会把复用池切得极碎,得不偿失。行为正确,只是这一处的
  复用收益略低。
- `columnIndices` 用的是 `@Prop`(深拷贝一份列号数组)。列数不多(几十),
  每次更新每个可见行拷贝一次,代价可以忽略;官方文档更推荐 `@Link`,但那要求
  父组件把 `columnIndices` 变成 `@State`,属于超出本次范围的状态管理改动。
- `Spreadsheet` 里的 `getCellDisplay` / `getCellFontColor` / `getCellBg` /
  `formatCell` 已删除,规则移到 `cellAppearance.ts`。如果有别处按名字反射调用
  这些私有方法,会失效(仓库内没有这样的调用,已 grep 确认)。
