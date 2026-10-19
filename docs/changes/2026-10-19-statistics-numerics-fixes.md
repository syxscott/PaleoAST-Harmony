# statistics 模块：置换检验不播种、p 值尾部塌成 0、PERMANOVA 的 SS 与 F 不同口径

## 类型

缺陷修复 / 数值变更

## 问题

`core/analysis/statistics/*` 在 2026-10-19 的全仓审查里被查出 8 条缺陷，
其中两条会让**同一个分析每次运行给出不同结果**，两条会**把 p 值印成精确的 0**。

## 根因

1. **播种是可选的**：`rngSeed?: number` + `if (rngSeed !== undefined) seed(rngSeed)`。
   不传就永不播种，直接消费 `core/math/random` 的全局状态（初值 12345，
   而项目约定是 42）。而控制器**从不传种子** → 置换检验每次点按钮都换一个 p 值。
2. **p 值用 `1 - CDF` 算尾部**：`2*(1-pt(|t|,df))`。CDF 在尾部饱和到 1 之后，
   `1-x` 的精度全部丢失，df=1000、t=9 时真值 1.11e-18 被印成 **0**。
3. **PERMANOVA 的两套口径**：F 用的是「SS_total 取完整 n×n 矩阵、组内用
   (2/n_g)」，而报出的 SS 用的是另一套除数——两者不是同一个比例，
   **报出的 F 无法由报出的 SS 推出**。

## 修复

| 文件 | 旧行为 → 新行为 |
|---|---|
| `statistics.ts` | 6 个含随机过程的函数（`nmds`/`anosim`/`permanova`/`phylogeneticSignal`/`phyloANOVA`/`lda`）签名改为 `rngSeed: number = 42` 并**无条件** `seed(rngSeed)`；`lda` 此前用 `rngShuffle` 却整函数不 seed |
| | p 值尾部改用 `core/math/stats` 新增的数值稳定上尾函数 `ptUpper`/`pFUpper`/`pchisqUpper`/`pnormUpper`（`2*(1-pt())` → `2*ptUpper()` 等） |
| | `permanova` 的 F 与报出的 SS 统一到 **Anderson (2001) / adonis2 口径**：`SS_T=(1/n)·Σ_{i<j}d²`、`SS_W=Σ_g(1/n_g)·Σ_{i<j∈g}d²`、`F=(SS_B/(k-1))/(SS_W/(n-k))` |
| | 退化输入守卫：`tTest`/`mannWhitneyU` 每组至少 2 个观测；`kruskalWallis` 至少 2 组且每组非空；`requireUsableGroups` 要求至少 2 个不同的组 |
| | `minimumSpanningTree`：方阵只有「对称 + 零对角」时才当距离矩阵，否则按坐标处理（2 点 × 2 维的坐标阵此前被读成距离矩阵，总长从 √2 变成 0） |
| | `plainsAnalysis` 的 RV 系数与 `covarianceExplained` 修正：右奇异向量取 `Vt` 的**行**（`Vt.transpose()`）；协方差占比用**奇异值平方**占全谱的份额 |
| `Normality.ts` | AD 统计量改在**对数域**求 `log Φ` 与 `log Φ̄`（旧的 `Math.log(1-cdf)` 在尾部抵消，且 A&S 近似的 1.5e-7 绝对误差在 50 点样本上就是 2%）；临界值改为**按样本量**的 Stephens (1974) 值 `A/(1+4/N−25/N²)`（旧的 `critMap` 是固定表，判定恒用 `critMap[5]=0.752`，与 N 无关） |

## 验证

- 独立验证脚本 `.workbuddy/audit/verify_fixes.mjs`：**28/28 通过**（不复用本模块
  的测试，避免"测试照着 bug 写"）。
- 全量 `node --experimental-transform-types tests/test.mjs`：**582 passed / 0 failed**。
- 新增 `tests/fixStatistics2026.test.ts`。
- 与 scipy 1.15.3 对拍：AD 统计量在测试所用的**同一批** 50 个正态样本上，
  scipy 给 `0.2180047214032399`，本仓给 `0.2180047214032328`（差 1e-13）。
- PERMANOVA 的 6 标本参考集：F = **193.65453684335162**，与 Python 原版
  `stats/permanova.py::_compute_F_statistic` 的公式逐位吻合（原版在
  `tests/cross_validation/test_vs_vegan.py` 里与 `vegan::adonis2` 对拍过）。

## 风险

- **数值变更需重跑旧结果**：PERMANOVA 报出的 SS 从旧口径换到 Anderson (2001) 口径
  （组内项从 `1/(2·n_g)` 改为 `1/n_g`，即 2 倍），F 与置换 p 值**不变**
  （旧代码两个 SS 同乘 2 恰好抵消，详见下文「一处需要纠正的审查结论」）。
- 缺失性状（absent / null / NaN）现在被**剔除**而不是当 NaN 传播：观测递归与
  置换递归必须用同一条缺失规则，否则观测 F 与置换 F 不可比。
- `phylogeneticSignal` 的 K 现在对零方差 / NaN 性状**抛可解释错误**
  （`core/analysis/phylogenetics/vcv.ts` 侧），而不是返回 0 或 1.5 那种噪声数。

### 一处需要纠正的审查结论

原审查报告写「PERMANOVA 的 F 值与 p 值当前是正确的（2 倍在比值里约掉）」——
**这个理由是错的**。旧代码的 `SS_total` 乘了 2、`SS_within` 也乘了 2，**两个项
同比例**所以比值确实抵消（F 一直是对的，193.6545）；但**报出的** SS 用了另一个
除数，于是报出的 F 推不出来。Python 原版的 docstring 正好点名了这个陷阱：
"Because the two terms were scaled by different factors the error did not cancel."
本次按原版公式（并与 vegan::adonis2 一致：其 `SS.wi[i] = sum(D.sq[ix,ix])/(2·n_i)`
求的是**有序**对，等于 `grpSum/n_i`）统一了 F 与 SS。

另一处：原审查说 AD 统计量「实测 0.2180041180920611 vs scipy 0.2778917960195173」——
**那个 0.27789 是测试里一个从别的样本算来的过期期望值**。在测试所用的同一批
样本上 scipy 给 0.2180047214032399，与实现一致（差 1e-13）。已更正该断言。
