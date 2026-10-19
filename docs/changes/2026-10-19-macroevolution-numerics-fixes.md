# 宏观演化：fitEarlyBurst 永远返回垃圾拟合、fitOU 没做 OU 变换、logRankTest 风险集漏删失

## 类型

缺陷修复 / 数值变更

## 问题

`core/analysis/macroevolution/*` 的 12 条缺陷。其中三条让**核心模型拟合在正常输入下
就返回错误数字**，且不报错。

## 根因

1. `fitEarlyBurst` 的协方差矩阵**对角线恒为 0**：`vcvInfo[i][i].shared =
   tips[i].distanceToAncestor(lca)`，而 `computeLCA(tips[i], tips[i])` 返回自身、
   `distanceToAncestor(self)` = 0。对角线只加 1e-8 抖动，于是 Cholesky 在第 2 个
   主元 `sum <= 0 → return -Infinity` → 负对数似然永远返回哨兵 `1e10`。
2. `fitOU` 的 OU 变换**没有作用到对角线**：`negLogLik` 里 `if (i === j) return V[i][j]`
   把「根到叶枝长」（单位=时间）原样留在对角线上，而非 `(σ²/2α)(1−e^{−2α·shared})`
   （单位=方差）——**两种量纲混在同一个矩阵里**。
3. `logRankTest` 的风险集**只在事件时刻扣减**（`uniqueTimes` 只含事件时刻），
   于是删失观测在它自己的删失时刻没有离开风险集，一直「在险」到下一个事件时刻。

## 修复

| 文件 | 旧行为 → 新行为 |
|---|---|
| `macroevolution.ts` `fitEarlyBurst` | 对角线改用「根到叶枝长」（与 `fitOU`/`buildVCV` 一致），σ² 解析剖出、只搜 r；协方差不合法时**抛错**而不是返回 1e10 哨兵。`EBResult.r0` 更名为 `sigma`（它其实是 √σ²，不是「初始速率」） |
| | `fitOU` 改用整矩阵 `V = σ²·C(α)`，`C_ij = (1−e^{−2α·D_ij})/(2α)`（D = 根到 MRCA，**对称**）；σ²/α/θ 解析剖出、只搜 α |
| | `logRankTest` 的风险集改为「删失/事件在**各自时刻**即移出」，事件时刻表与 `uniqueTimes` 解耦 |
| | `coxPH` 的 logLik 改标准 Cox **偏**对数似然 `Σ_{δ=1}[βx − log S_i]`（旧代码事件行减 `log(riskSum)` 而非 `riskSum`，且删失行也多减了一个）；黑森矩阵是 −I，改为对 **−Hessian** 求逆（旧的直接取逆得到负方差、被 `max(0,·)` 压成 0，标准误全为 0、z=0、p=1）；全删失时抛 `ComputationError`；奇异黑森抛错 |
| | `extinctionCI` 的 z 由 `confidenceLevel` 求出（旧的硬编码 1.96）；`nOccurrences=0` 时上界按 Poisson 限给出（旧的收敛到人为上界 1000） |
| | `fbdLogLikelihood` 新增 `FBDTreeData.childAges`，三个 tip 分支统一按 `p1(t_child)/p1(t_parent)` 条件化，删掉与净速率不符的全局 `−(λ+μ+ψ)·age` 项 |
| | `summarizeSurvival` 的中位数判空用 `!= null`（旧的 `!== undefined` 让 `null.toFixed(2)` 抛 TypeError，恰好发生在「中位数未达到」这一常见情形） |
| | `simulateFBD` 先滤掉化石事件再在前缀上累计（旧的用**过滤后**的索引去切**未过滤**的数组，曲线整体错位）；补上默认种子 42 |
| | `testEquilibrium` 的 z/p 统一按公式算（旧的早退分支直接写死 z=0、p=0） |
| | `evolutionRate` 的 pic/bm 分支 `logLik`/`aic` 改为 `number | null`（旧的返回 0，在模型比较表里会被读成「拟合完美」） |
| | 删除 6 个本地重复实现（`mvnormLogDensity_ou`、4 个 gammainc/lgamma 副本、2 个 chi2CDF），改用 `core/math/stats` 的 `pchisq`/`qchisq`（本地的 `gammainc` 级数截断在 200 项，chi2 分位是坏的） |
| `KaplanMeier.ts` | `events` 改为与 `timesFull` **同序**（旧的 `events` 是输入序、`timesFull` 是排序序，逐位配对全错）；全删失时 7 个数组长度统一为 n |

## 验证

- 新增 `tests/fixMacro2026.test.ts`：**17 例全绿**。
- 关键数字：
  - `fitEarlyBurst`：旧值对三组截然不同的数据**逐位相同**（`r=-2, σ²=0.01,
    logLik=-1e10, AIC=2.0000000004e10`）；现 `{A:1,B:2,C:3}` → `r=4.9004,
    σ²=30.305, logLik=−5.997`，`{A:100,B:1,C:50}` → `r=−1.3517, σ²=2929.68,
    logLik=−16.753`。
  - `fitOU` 尺度等变：性状 ×10 → σ² 比 **100.0000021**（相对误差 2.1e-8），
    θ 比 10.000000003，α 比 1.0000000108。
  - `logRankTest`（含删失观测的 fixture）：χ² **0.16154873 → 0.4285714285714286
    (=3/7)**，p 0.6877 → 0.5127。
  - `coxPH`：logLik **−4.7616 → −3.633690845816824**，AIC 11.523 →
    9.267381691633648；标准误 0 → **0.4540450094180605**，z=−0.32780，p=0.74306。
  - `simulateFBD`（seed 1, ψ=0.8）：diversityCurve **[2,2] → [2,3]**，与从
    `lineages` 重建的曲线逐位一致。
- 独立验证脚本 `.workbuddy/audit/verify_fixes.mjs` 覆盖其中 5 项。

## 风险

- **数值变更需重跑旧结果**：`coxPH` 的 logLik/AIC、拟合类的 α/σ²/r、
  `logRankTest` 的 χ²、`extinctionCI` 的区间、`simulateFBD` 的曲线、
  `kaplanMeier` 的 `events` 顺序。
- `coxPH` 的 Newton–Raphson **仍不报收敛**（迭代 50 次后静默停止）——不在本次
  缺陷清单内；若要按「不收敛必须抛错」处理，需与 UI 的错误呈现一起设计。
- `fitEarlyBurst` 维持「均值固定为 0」（沿用原文档化的无漂移过程），因此 σ² 会
  吸收均值偏移；若要像 OU 一样给自由均值 θ，AIC 的参数个数要由 2 改为 3——属建模
  决策，未擅自改。
- `fbdLogLikelihood` **未与 Python 原版逐值对拍**（本次未获授权读
  `D:/GIthub/PaleoAST`），按 Stadler (2010) / Heath et al. (2014) 的
  「分支比 `p1(t_child)/p1(t_parent)`」自洽推导；接入前建议先与原版对拍。
- 同模块另有一个 `fbdExtinctionProbability`（RK4、初值 E(0)=1−ρ）与本函数内的
  闭式 E(t)（初值 0）**不是同一个函数**——这是另一个独立缺陷，未在本次范围内修。
