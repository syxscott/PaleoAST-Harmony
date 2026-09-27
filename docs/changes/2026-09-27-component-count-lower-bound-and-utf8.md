# 成分数只有上界:负数/0 产出"看起来正常但尺寸不对"的结果;4 个源文件不是合法 UTF-8

## 类型
缺陷修复

## 问题

两处,一处让分析静默出错,一处让工具链读不懂源码。

### 1. 五个分析入口只钳制了成分数的上界

`pca` / `pcoa` / `lda` / `cca` / `plsIntegration` 都是这个写法:

```ts
const nc = Math.min(nComponents ?? maxComp, maxComp);   // 没有下界
```

负数原样穿过。随后 `nc` 的四个使用点对"负数"的理解**互不一致**:

| 使用点 | 负数的含义 |
|---|---|
| `while (len < nc)` | 不执行 |
| `arr.slice(0, nc)` | **JS 负索引**:返回"除末尾 \|nc\| 个之外"的元素 |
| `Matrix.sliceCols(0, nc)` | 矩阵语义,与上不同 |
| `Matrix.zeros(k, nc)` | 退化的宽度 |

所以结果不是报错,而是一张**尺寸是别的值**的图。

**而且这条路是通的**:`LDADialog` 是 35 个对话框里唯一数值输入完全没有校验的
(`this.n_components = parseInt(v) || 2`,`-3` 原样进入),其余全部有钳制
(PCADialog、NMDS、EFADialog、Rarefaction、Extinction、Anosim、Permanova …)。

实测修复前的行为:

| 调用 | 修复前 |
|---|---|
| `pca(data, 0)` | `scores 24x0` —— **零列** |
| `pcoa(D, 0)` | `coordinates 24x0` |
| `lda(data, groups, 0)` | `scores 24x0` |
| `plsIntegration(A, B, -5)` | **抛 `Invalid typed array length: -40`** |

注意 `0` 也中招:`??` 只判 null/undefined,`0` 会原样通过。

同仓库另外三处(`Eigenshape.ts:49`、`morphometrics.ts:1183`、
`statistics.ts:2605`)写的是正确的 `Math.max(1, Math.min(...))`。
本次让另外五处与之对齐,而不是另立一套约定。

### 2. 四个源文件不是合法 UTF-8

| 文件 | 状态 |
|---|---|
| `hpc/ProcessPool.ts` | 纯 GBK(2 处方括号) |
| `parsers/BinaryCache.ts` | 纯 GBK(1 处) |
| `state_machine/Base.ts` | 纯 GBK(1 处) |
| `app_infrastructure/ExceptionHandler.ts` | **混合**:表头 1 处 GBK,下方 2 处破折号 + 11 个制表线已是正确 UTF-8 |

GBK 的破折号是 `0xA1 0xAA`。TypeScript 与 DevEco 都按 UTF-8 读源码,
这是编译期解码错误,也是编辑器里的乱码。

**为什么门禁没发现**:`tools/structure_check.py` 读文件用的是
`open(path, encoding='utf-8', errors='ignore')` —— **坏字节被静默丢弃**。
括号配平、重复导出全部照常通过。

混合编码那个尤其说明了为什么不能整体转码:整体 GBK 解码在 `0x80` 处失败,
必须逐字节替换那一个坏对,同时保住已经正确的 UTF-8 部分。

## 根因

两处的共同点是**一个"应该被发现的问题"被工具链选项吞掉了**:

- `errors='ignore'` 让非法字节消失,所以"文件能不能解码"这个检查从来不存在;
- 钳制只写了上界,因为五个函数是分别写的,没有共享的规范化入口;
  第三个写对了(加了 `Math.max(1, ...)`)的函数既没被参考,也没有检查去比对。

## 修复

1. 五个成分数入口加 `Math.max(1, ...)`(与同文件已有的三处一致)。
2. `LDADialog` 的 `n_components` 加 `Math.max(1, ...)`,与另外 34 个对话框一致。
3. 三个纯 GBK 文件整体转码为 UTF-8;`ExceptionHandler.ts` 逐字节替换那一个
   `\xA1\xAA` → `\xE2\x80\x94`。
4. `structure_check.py`:新增 `check_encoding()`,并把读取改为 `errors='strict'`。
   编码不合法或含 U+FFFD 的文件直接报问题并给出字节偏移与十六进制上下文。

所有写入都带断言:转码后必须能按 UTF-8 解码、无 U+FFFD、
**除破折号外字节逐一相同**、行尾(CRLF/LF)保持不变。

## 验证

新增 `tests/componentCount2026.test.ts`,9 条测试。

- `pca` / `pcoa` / `lda` 对 `0` 与三个负值一律返回 1 列;
  合法值不受影响(`pca(data,4)` 仍是 4 列,`pca(data,999)` 仍被 `maxComp` 截到 8 列)。
- `plsIntegration(A, B, -5)` 返回结果且 `pValue` 非 NaN。
- 机械扫描:全 `core/` 内任何 `Math.min(nComponents` 行都必须含 `Math.max(1`,
  5 处全过。
- `structure_check.py` 不再出现旧的 `errors='ignore'` 读取行(断言的是**代码行**,
  不是字符串 —— 新 docstring 必须提到它才能解释历史)。
- 全仓 `entry/src` + `tests` + `tools` 源文件解码后不含 U+FFFD
  (Node 的 utf-8 解码器把坏字节替换成 U+FFFD 而不抛错,所以扫 U+FFFD 等价)。
- 四个文件各自:不再含 `\xA1\xAA`,且确实含真正的 `U+2014`。

**守卫有效性已验证**:把上述 8 个文件换回 `HEAD` 版本重跑,9 条测试全部如期失败,
失败信息正是上表那些证据(`scores 24x0`、`Invalid typed array length: -40`、
四个非 UTF-8 文件路径)。恢复后全绿。

门禁:`tests/test.mjs` **232 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。

## 风险

- 负数/0 之前**没有**产生过正确结果,所以不存在需要重跑的既有结果;
  但如果有人把 `pca(data, 0)` 的零列结果当成有效输出引用过,那是错的。
- `Math.max(1, ...)` 把 0 和负数都抬到 1。选择"抬到 1"而不是"报错"是为了
  与仓库里已有的三处保持一致;若更希望响亮失败,应统一改三处已正确的实现。
- 四个 GBK 文件里三个是死代码(`ProcessPool`、`Base`、`ExceptionHandler`),
  只有 `BinaryCache.ts` 在 `parsers/index.ts` 的引用链上 —— 但修编码对死代码同样必要,
  因为它随时可能被接回去。
- 仍有 4 个对话框发布未钳制的数值:`BiostratDialog.min_occurrence`、
  `CCADialog.n_components`、`PhyloAnovaDialog.n_permutations`、
  `PhyloSignalDialog.n_randomizations`。它们不影响本次修的成分数入口
  (`cca` 的 `nc` 已加下界;置换次数为负只会让 `for` 循环跑 0 次,产生退化 p 值而非崩溃),
  **本轮未改**,留作下一步。
