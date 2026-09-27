# 我上个提交引入的回归:没分组的数据跑不了任何快捷分析;跑不了的分析被报成"completed"

## 类型
缺陷修复

## 问题

两处,都在 `Index.ets` 的快捷分析链路。第一处是**本轮前一次提交 `e48a7cd` 引入的回归**。

### 1. `requireGroups()` 被提到函数顶部,所有快捷分析都要求分组

`e48a7cd` 把 `getGroups() ?? []` 改成会抛错的 `requireGroups()`。
方向是对的 —— `?? []` 会让 PERMANOVA 在虚构的空分组上回答"无显著差异"。
但改动放在了 `runQuickAnalysisCore()` 的**函数体开头,在 switch 之前**:

```ts
const data = this.stateMgr.dataMatrix.data;
const groups = this.requireGroups();     // <-- 每次调用都执行
const dm = this.stateMgr.dataMatrix;
switch (name) { ... }
```

而这个 switch 里有 40 多个 case,**只有 4 个真正用到 `groups`**:
LDA、ANOSIM、PERMANOVA、SIMPER。

于是数据没分组时,Summary、Normality、Spectral、Markov、Wavelet、Isotope、
GPA、Allometry… 全部抛 `No usable groups: assign every specimen to a named group`。
用户看到的是一条与所点分析完全无关的错误信息。

`runDialogAnalysisCore()` 里同样的修复是**逐 case 内联**调用的(4 处),
那个写法是对的 —— 只有 `runQuickAnalysisCore()` 提到了顶部。

### 2. 18 个"这个分析需要什么输入"的提示,被下一行覆盖成"completed"

`handleAnalysis()` 的第二个 switch 里有 18 个 case 写着诚实的说明:

```ts
case 'Cox PH': this.statusText = 'Cox PH: needs durations + events + covariates'; break;
```

但它们以 `break;` 结束,于是继续往下走:

```ts
this.statusText = name + ' completed';
this.addWidget(name);
```

**说明被覆盖,还为一次根本没发生的运行打开了工作区标签页。**
`runQuickAnalysisCore()` 对这 18 个名字全部命中 `default: return null`,
所以它们的结果就是一个 `null`。

用户点"Log-rank",界面回他 **"Log-rank completed"**。

同一个 `recordAnalysis(name, {})` 也在 `try` 之前调用,
所以这 18 次没发生的运行同样被写进持久化历史和导出的可复现脚本。

## 根因

两处都是同一个奇式:把一个只应在**67b9个 case 中**u751f效的动作,提到了分支之前或之后。

- `requireGroups()` 写在 `switch` 之前。改开头一个 switch 就是最容易的,而位于开头也容易被误认为"marker"。写法上两个函数不一致正是病法:对话盒路径正确地逐 case 内联,快捷路径提到了顶部。
- 18 个 case 以 `break;` 结尾。换成 `return;` 才能阻止控制流继续下跌,
  而作者看到的是下一行说的 `break`——它看起来完全正常。

真正的根因是**没有机械导演可以找到这类错误**。当前三个门禁都不能看见它:
单测只加载 `core/**`,接线检查只扫描标识符名,结构检查只数括号。
新增的 `etsDispatch` / `etsSyntax` 两个套件补上了这个盲区,
且它们自己先被验证过(对照 TypeScript parser、对照修复前版本)u3002

## 修复

1. `runQuickAnalysisCore`:删掉顶部提升的 `const groups = ...`,
   改为在 4 个真正用它的 case 里内联调用 `this.requireGroups()`
   —— 与 `runDialogAnalysisCore` 的写法一致。
2. 18 个"needs ..." case 由 `break;` 改为 `return;`。
3. `isLoading = false` 从 `try/catch` 之后移入 `finally`。
   同一个 switch 里 `DialogManager.open()` 那三个 case 本来就在 `return`,
   复位语句在 try/catch 之后会被跳过 —— 目前这三个名字从 `handleAnalysis`
   走不到(快捷开关的 `Null Models` 走第一个 switch),属于潜伏问题,
   一并收口。
4. `recordAnalysis` 从运行前移到成功之后:只有真正产出结果的运行
   才进可复现脚本。这与数据指纹那次修复的前提一致 ——
   脚本记录的是"跑过的分析",不是"点过的按钮"。

改动严格限定在 `handleAnalysis` 方法体内。`runAnalysisWithParams`
有一段**逐字节相同**的收尾(`completed` / catch / isLoading),
无范围的 `replace` 会连它一起改掉;脚本里对此有断言。

## 验证

新增 `tests/etsDispatch.test.ts`,6 条测试。

- `requireGroups` 不再出现在 switch 之前;
  内联调用它的 case 恰好是 ANOSIM、LDA、PERMANOVA、SIMPER 四个(名称列表精确比对);
  对话框路径的 4 处内联调用数量不变。
- 18 个"needs / required"说明之后必须跟 `return`,不能跟 `break`;
  实际扫到 18 个(数量写死,少一个就失败)。
- `isLoading = false` 出现在 `finally` 内。
- `recordAnalysis` 的位置满足 `runQuickAnalysisCore` 之后、`'completed'` 之前。

**守卫有效性已验证**:把 `Index.ets` 临时换回 `HEAD` 的版本重跑,
`isLoading` 与 `recordAnalysis` 两条测试如期失败,换回修复版后全绿。

门禁:`tests/test.mjs` **222 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。

## 风险

- 分组相关分析(LDA/ANOSIM/PERMANOVA/SIMPER)在未分组数据上仍会抛错,
  这是**有意**的:让它们对空分组作答才是缺陷。
- `recordAnalysis` 移位后,失败的分析不再进入历史。
  如果有人依赖"历史 = 尝试过的所有分析"这个语义,这是一处行为变更;
  但"历史 = 跑过的分析"才与可复现脚本的用途一致。
