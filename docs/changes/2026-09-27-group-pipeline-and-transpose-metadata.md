# models + UI 接线:分组分析整条链路断开,用户分组永远到不了模型

## 类型
缺陷修复

## 问题

`core/models/`(约 950 行)+ `statistics` 的组校验 + `ets` 的两处接线。
**这是本次全仓审查中对用户影响最大的一处:用户可以在表格里给标本分组,
然后运行 PERMANOVA / ANOSIM / SIMPER / LDA,得到"无显著差异 (p = 1)"——
即使数据被分组完全分开。**

链路断在三处:

| 缺陷 | 实测(修复前) | 正确值 |
|---|---|---|
| `DataMatrix.getGroups()` 对组**名**做 `parseInt` | `["Amniote"×3, "Reptile"×3]` → `[0,0,0,0,0,0]`(两组被压成一组) | `[0,0,0,1,1,1]` |
| 由上一条导致的 PERMANOVA | 对完全分开的数据 **F = 0.000000**、p = 1 | F = 193.6545 |
| `Spreadsheet.onGroupChanged` 从未被赋值 | `rowMeta` 永远为空 → `getGroups()` 返回 `null` → `Index.ets` 传 `[]` | 分组真正进入模型 |
| 四个分析收到 `[]` 后各自静默作答 | `simper` 返回 `overallDissimilarity: 0` 空结果;`permanova` 返回 **F=0, p=1, dfBetween = -1**;`anosim` 返回 R = -1.067, p = 1;`lda` 在深处抛 `eigh:A[0] is not finite: NaN` | 明确报错并说明该做什么 |
| `DataMatrix.transpose()` 覆盖元数据 | `SpecA` 的 `group:"Amniote", color:"#ff0000", weight:2.5` → `{"name":"SpecA","type":"numeric"}`;`SpecC` 的 `excluded:true` 丢失 | 全部保留 |
| `transpose()` 伪造分组 | 每个新行被写入 `group = <旧列名>`(`"Length"`、`"Width"`…) | 不再伪造 |

## 原因

### 1. 组名与组码的类型错配

`RowMeta.group` 是 `string`(表格的分组循环给的是 `Group_A` / `Group_B` / `Ungrouped`),
而 `simper` / `permanova` / `anosim` / `lda` 的形参是 `number[]`。
`getGroups()` 用 `parseInt(gr) || 0` 强行转换 —— 对任何非纯数字组名,`parseInt` 返回
`NaN`,`NaN || 0` 就是 `0`。于是**所有标本都变成第 0 组**。
`getGroups()` 的返回类型本来就是 `number[]`,所以这不是签名错误,是**实现把唯一有意义的
取值方式写坏了**。

### 2. 分组状态在 UI 内部,没有出口

`Spreadsheet` 把组名存在自己的 `@State rowGroups: string[]`,只在
`onGroupChanged(groups)` 这个钩子里对外发布。该钩子的默认值是空函数,
而渲染它的 `WorkspaceView.ets:74` 是
`Spreadsheet({ dataMatrix, darkMode })` —— **一个回调都没传**。
所以 `assignGroup()` / `setGroupForRow()` / `clearGroups()` 改完之后,
`onGroupChanged(...)` 落进空函数,`DataMatrix.rowMeta` 永远是空的。
`Spreadsheet` 初始化时把每行都置为 `'Ungrouped'`,所以即便传了回调,
"没人动过的数据"也会呈现为一个名为 `Ungrouped` 的组 —— 接线时必须把它当"未分组"处理。

### 3. 四个分析对空分组来者不拒

`permanova` 拿到 `groups = []` 时 `k = 0`,于是 `dfBetween = k - 1 = -1`、
`msb = 0`、F = 0,而所有置换的 F 也都是 0,于是 `count = nPermutations`、p = 1。
**一个自由度为 -1 的结果被当成"无显著差异"打印在结果表里。**
`simper` 返回空结果配 `overallDissimilarity: 0`;`anosim` 返回负的 R 与 p = 1;
`lda` 更晚才在特征分解里炸掉,报的是 `eigh:A[0] is not finite: NaN`。
两处派发(`runAnalysisWithParams` / `runQuickAnalysisCore`)都包在 `try/catch` 里,
所以改成抛错是安全的。

### 4. `transpose()` 的元数据搬运是"覆盖"而非"搬运"

转置之后标本变成列、变量变成行。旧代码对每个有元数据的标本执行
`colMeta.set(i, {name, type:'numeric'})` —— 这是**覆盖**,
把 `group` / `color` / `weight` / `excluded` 全部抹掉(而且因为变量现在是行,
原来的 `unit` / `min` / `max` / `mean` / `missingCount` 同样无处可去)。
第二段更糟:它把旧列的**名字**写进新行的 **group** 槽位 ——
列名不是分组,于是每行都"属于 Length 组"。
而 `RowMeta` / `ColumnMeta` 里根本没有对方需要的字段,所以两边都没有落点。

## 修改

1. **`models/DataMatrix.ts`**
   - `getGroups()`:按首次出现顺序把组**名**映射为整数码;
     组为空、或为表格默认的 `"Ungrouped"`(大小写不敏感)视为未分组;
     只要有任一标本未分组,或不同组少于 2 个,返回 `null`。
   - 新增 `getGroupNames()` 与 `setGroups(groups: string[])`。
   - `transpose()`:改为**无损搬运**,且不再伪造分组。
2. **`models/ColumnMetadata.ts`**:`ColumnMeta` 增加可选的
   `group` / `color` / `weight` / `excluded`(转置后标本成为列,需要落点)。
3. **`models/RowMetadata.ts`**:`RowMeta` 增加可选的 `type`;
   `RowMetadata` 增加 `unset(i)` 供清除分组使用。
4. **`analysis/statistics/statistics.ts`**:新增 `requireUsableGroups()`,
   `simper` / `permanova` / `anosim` / `lda` 在组向量为空、长度不匹配、
   或不同组少于 2 个时**明确报错**并说明该做什么。
5. **`ets/components/WorkspaceView.ets`**:把 `onGroupChanged` 接到
   `DataMatrix.setGroups`,闭合分组链路。
6. **`ets/pages/Index.ets`**:8 处 `getGroups() ?? []` 换成 `requireGroups()`,
   在分组不可用时抛出可操作的提示。
7. **`models/StateManager.ts`**:删除无调用点的 `estimateMemory`。

## 验证

- 新增 `tests/models2026.test.ts`,13 条回归测试,测试名一律描述旧行为。
- `getGroups()`:命名分组 `["Amniote"×3, "Reptile"×3]` → `[0,0,0,1,1,1]`。
- 端到端:同一批数据,直接传数字组与经 `getGroups()` 得到的组,
  PERMANOVA 的 F 都是 **193.654537**;修复前经 `getGroups()` 得到的是 **0.000000**。
  ANOSIM R = 1.0,SIMPER overall = 0.7102、1 个组对。
- 拒绝路径:空组 / 长度不符 / 单组,四个分析都给出指明"该做什么"的错误。
- `transpose()`:标本的 group、color、weight、excluded 全部保留;
  旧变量的 `type` 保留到新行;没有任何行被写入伪造的 group。
- 门禁:`tests/test.mjs` **180 passed, 0 failed**;`node test/device/run.mjs` 19/19;
  `structure_check.py` 174 文件 0 问题。
- 未跑 DevEco 构建:本次只动 `core/**`、`ets/**`(两个接线点)与 `tests/**`。

## 其它

- **`Spreadsheet` 的 `onDataChanged` 与 `onSelectionChanged` 也从未被赋值**
  (`WorkspaceView.ets:74` 三个回调全缺)。单元格编辑之所以还能生效,是因为
  `Spreadsheet` 拿到的是同一个 `DataMatrix` 对象引用,编辑直接改的是共享的
  `Matrix` —— 但撤销/重做之外的上层通知同样是断的。本次只修了分组这一条
  (它有独立的 `@State`,没有共享引用兜底),另两个留到 `ets/` 全面审查时处理。
- `Index.ets` 里 `runQuickAnalysisCore` 的 `case 'CCA': return this.statCtrl.runCCA(data, data)`
  把同一份数据同时当作 Y 和 X,这不是 CCA 的用法(应该是物种 × 环境)。
  本轮只做分组链路,未改;已记录待下一轮确认。
- `Index.ets:701` 与 `:738` 的 `'TPS Grid'` 把 `data.to2D()` 同时当作 source 和 target,
  即"把数据变形到自己身上",弯曲能量恒为 0。同样记录,未改。
- 本轮我自己的测试写错过一次:转置断言里把 `t[1][2]` 写成 300,
  实际 `t[i][j] = data[j][i]` 应为 30。是断言错了,不是代码错 —— 先怀疑自己这条依然有效。
- **未审**:`controllers`(33KB)、`utils`(35KB)、以及 `ets/` 剩余部分。
