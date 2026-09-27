# 负的置换次数会回答一个没人问的问题:p = -0.5 与 p = 1.0

## 类型
缺陷修复

## 问题

`for (let perm = 0; perm < nPermutations; perm++)` 遇到负数**一次都不执行**,
而 Phipson & Smyth 的 add-one 公式 `(count + 1) / (N + 1)` 于是报出一个
"没做过的检验"的结果:

| 函数 | 修复前传 `-3` | 含义 |
|---|---|---|
| `phylogeneticSignal` | `(0 + 1) / (-3 + 1)` = **-0.5** | **根本不是概率的值** |
| `phyloANOVA` | `nValidPerms` 恒为 0 → 走 `: 1.0` 分支 | **p = 1.0,即"无显著差异"** |

两者都不是报错,而是一个看起来正常的数值。`phyloANOVA` 那个尤其糟:
它以"各组无显著差异"的结论呈现,而实际上一个置换都没跑。

**这条路是通的**:`PhyloSignalDialog` 与 `PhyloAnovaDialog` 是 35 个对话框里
仅有的两个数值输入**完全没有任何校验**的(`parseInt(v) || 999`),
其余五个置换类对话框 —— `AnosimDialog`、`NullModelDialog`、`PermanovaDialog` ——
都已经钳制在 99..9999。

`anosim` / `permanova` 的对话框虽然已钳制,但函数本身仍直接信任入参;
本次一并加界,让这一族无法从其它调用方重新打开。

## 根因

和"成分数只有上界"(`be8b104`)是同一个模式:**钳制只写了单向**。

差别在于这次的漏网点更靠后。成分数漏在 `Math.min` 少一个下界;
置换次数则连钳制都没有 —— 对话框层和模型层同时失守,
所以负数能一路走到 `for` 的上界比较那里。

而 `phyloANOVA` 的 `: 1.0` 兜底把"没跑"和"跑了不显著"这两种完全不同的
状态折叠成了同一个值,这也是它比 `phylogeneticSignal` 更隐蔽的原因。

## 修复

1. 四个 add-one p 值站点在函数开头引入钳制后的局部量,
   循环上界、p 值除数、回显字段三者统一用它:
   `const nPerm = Math.max(1, Math.floor(nPermutations));`
   - `anosim` / `permanova` / `phyloANOVA` 用 `nPerm`
   - `phylogeneticSignal` 用 `nRand`
2. `PhyloAnovaDialog` / `PhyloSignalDialog` 补上
   `Math.max(99, Math.min(9999, parseInt(v) || 999))`,
   与另外三个置换对话框**逐字一致**。

`Math.max(1, ...)` 沿用本模块已有的先例:
`runUnitaryAssociations` 写的是 `Math.max(1, Math.floor(minSectionOccurrence))`。

## 验证

新增 `tests/permutationCount2026.test.ts`,6 条测试。

- 四个函数对 `0` 与负值:回显计数 `>= 1`,且 p 值落在 `[0, 1]`。
- 合法值完全不受影响(钳制只会把值**抬**到 1):
  `199 → 199`、`undefined → 999`,`phyloANOVA` 的 F 统计量不变。
- 两个对话框包含与三个兄弟完全相同的钳制表达式。
- **机械化守卫**:`statistics.ts` 中每个 `(count + 1) / (x + 1)` 的**除数**
  都不得是 `nPermutations` / `nRandomizations` 本身。
  (只匹配除数而非整行 —— 结果对象里仍叫 `nPermutations` 这个字段名,
  匹配整行会误报。这是我的第一版断言的错误,被测试自己抓出来。)

**守卫有效性已验证**:把 `statistics.ts` 与两个对话框换回 `HEAD` 版本重跑,
6 条中 5 条如期失败,失败信息精确指出
`613: divisor nPermutations + 1 | 1152: ... | 1793: divisor nRandomizations + 1`。
恢复后全绿。

门禁:`tests/test.mjs` **238 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。

## 风险

- 下界取 1 而不是 99:模型层只保证"不出现不可能的值"与"至少跑一次",
  99..9999 的统计学下限放在对话框层(与三个兄弟对话框一致)。
  若希望模型层也拒绝统计上无意义的置换数,应统一把下界提到 99。
- 钳制后 `phyloANOVA` 在 `n<=0` 时仍报 `p = 0.5`(跑 1 次置换的结果)。
  与修复前的 `p = 1.0` 相比这是更诚实的答案 —— 1 次置换能得到 0.5 或 1.0,
  而 0 次置换什么都不该报。用户无法从界面走到这里(对话框下限 99)。
- 本轮还核实了三处**不是**缺陷的地方,记录以免下次重查:
  `WaveletDialog` 的 `min_scale`/`max_scale` 无钳制,但 `runWavelet` 内部
  `lo = Math.max(1, ...)`、`hi = Math.max(lo, ...)`,`hi/lo >= 1` 恒成立,
  `jMax` 有界 —— 不可能挂死;
  `BiostratDialog.min_occurrence` 无钳制,但 `runUnitaryAssociations` 内部
  已做 `Math.max(1, Math.floor(...))`;
  `CCADialog.n_components` 无钳制,但 `cca` 的 `nc` 已在 `be8b104` 加了下界。
