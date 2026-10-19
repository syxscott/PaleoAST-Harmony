# 生态学模块 11 处缺陷:置信水平映射、"期望丰富度"其实是一次随机抽样、AIC 尺度、quorum 定义、物种得分

## 类型

缺陷修复 / 数值变更

涉及 `entry/src/main/core/analysis/ecology/` 下的 `ecology.ts`、`CoverageRarefaction.ts`、`SQS.ts`。
全部缺陷由审查 agent 用真实模块复现过,本轮逐条修复并加回归测试。

## 问题

下面每条都是「旧行为 → 新行为」。
**"修复前"的数字**:第 1、3 条与第 2 条的部分数值由审查 agent 复现给出,其余由本轮自行复现
(本轮另在 `[5,3,3,2,2,1,1,1,1,1]` 上复测了第 2 条:`nIterations = 1` 与 `= 1000` 同样逐位相同,
均为 `[8, 8, 8]`);**"修复后"的数字全部为本轮实测**。

### 1. Chao1 置信区间的置信水平映射是错的(除 0.95 外全错)

样本 `[5,3,3,2,2,1,1,1,1,1]`(chao1 = 16.25):

| 置信水平 | 修复前 | 修复后(正态分位数) |
|---|---|---|
| 0.90 | `[14.6059, 18.0792]` | **`[14.8221, 17.8154]`** |
| 0.95 | `[14.5632, 18.1321]` | 不变 |
| 0.99 | `[14.5300, 18.1736]` | **`[14.0703, 18.7674]`** |

90% 区间被算得**偏宽**(比真实的 90% 还宽),99% 区间被算得**偏窄**。
0.95 "正确"纯属巧合。

### 2. `coverageRarefaction` 的"期望丰富度"其实只是一次随机抽样,`nIterations` 完全无效

- `nIterations = 1` 与 `nIterations = 1000` 的输出**逐位相同**(`[6.5, 39.225]`)。
- 同一数据集换 8 个种子,点估计在 `[17, 21, 16, 20, 18, 16, 18, 17]` 间跳动(精确 Hurlbert 期望 = 17.6589)。
- 单样本时 `expectedRichness = [16]`、`confidenceLower = [16]`、`confidenceUpper = [16]` —— 一个**零宽度的"95% CI"**。

修复后:2000 次重复抽样得 **6.7915**,精确 Hurlbert 期望 **6.7995**(误差 0.008);
单样本 CI 宽度由 **0 → 4**(`[5, 9]`)。

### 3. `fitAbundanceModels` 的 Log-Normal AIC 与其它模型不同尺度

| 数据 | 修复前 Log-Normal AIC | 修复后 |
|---|---|---|
| `[10,8,7,6,5,5,4,4,3,3,2,2,2,1,1,1,1,1]` | 27.39 | **−38.88** |
| `[100,40,20,8,4,2,1,1,1,1,1,1]` | **1.85(第一名)** | 12.89(Log-Series 6.92 重新夺冠) |

第二个数据集里 Log-Normal 的 r² 是四个模型中**最差**的(0.269),却拿了第一名 —— 完全是尺度错误造成的。

### 4. SQS 的两种 method 对 quorum 的定义互不相同

随机法每个个体的权重 = `1/N_i`,全体权重之和 = **事件数**而不是 1;稀释法 `targetN = floor(quorum × totalN)`,quorum 是总个体数的比例。

跨数据集实测(每事件 40 个体,quorum = 0.5):

| 数据集 | 修复前随机法抽样比例 | 修复后 |
|---|---|---|
| A = 1 事件 40 个体 | 0.5 | 0.5 |
| B = 4 事件 160 个体 | **0.125** | **0.5** |

即同一个 quorum 在 B 上只抽了 12.5% —— SQS 曲线的目的正是跨剖面比较,这样不可比。
修复后两种 method 在同一 quorum 下的抽样比例一致(0.5 与 0.5;0.929 与 0.893)。

### 5. `paleoEnvironment` 的 `columnSpeciesAxis` 返回的是位点得分

4×3 矩阵上 `columnSpeciesAxis` 与 `axis1Scores` **逐位相同**:`[-2.828648, 1.963573, 1.770023, -0.864795]`。

### 6. `nullModel` 在 nSpecies×nSites < 10 时零模型完全退化

3×3 矩阵 → 99 次置换后 `uniqueSimulated = 1`、`stdSim = 0`、`ses = 0`、**p = 1**(恒定给出"无显著共现结构")。

### 7. `dtw` 的 Sakoe-Chiba 带用常数 1e10 代替"不可达"

`dtw([1,2,3], [1,2,3,4,5,6], 1).distance = 100000`(无带时为 3.7417)。

### 8. `CoverageRarefaction.rarefaction()` 在 m > N − n_i 时返回 NaN

`rarefaction([8,1,1], 5)`(N = 10,主导种 n_i = 8 ⇒ N − n_i = 2 < m = 5)→ **NaN**。

### 9. `sheAnalysis` 用 −999 与 −Infinity 两种哨兵表示同一个"空样本"

`sheAnalysis([[0,0,0],[1,2,3]])` → `logS = [-Infinity, 1.0986]`、`logH = [-999, 1.0114]`。
同一结果对象里"无数据"有两种编码,下游序列化会拿到 −Infinity(JSON 变 null)。

### 10. SQS 在 nPoints = 1 时产生 NaN 的 quorum 档位

`sqs(A, [0.3,0.95], 1)` → `quorumLevels = [NaN]`,且 `quorumAccum >= NaN` 恒假 → 抽完全部个体,退化为观测丰富度。

### 11. `CoverageRarefaction.ts` 的注释公式与代码不一致

注释写 `f1(f1−1)/(2(f2+1))`,代码是 `f1²/(2f2)`。

## 根因

**1(Chao1 CI)**:`const zLevel = z * Math.sqrt(1 / 0.95 === 1 ? 1 : confidenceLevel / 0.95);`
—— `1/0.95 === 1` 恒为 false,实际生效的是 `z·√(cl/0.95)`。这**不是任何正态分位数的映射**:
0.90 得 z = 1.908(真值 1.645)、0.99 得 z = 2.001(真值 2.576)。0.95 正确只是因为 √1 = 1。

**2(coverageRarefaction)——"注释在撒谎"的典型**:文档与注释明确宣称是 bootstrap
(`@param nIterations bootstrap iterations for CI`、`Point estimates AND confidence intervals
come from the same individual-level bootstrap`),但实现里**每个 (coverage, sample) 只做一次
Fisher-Yates 抽样**,然后 `drawStats` 跨**样本**求均值/分位数。**全文没有 bootstrap 循环**,
`nIterations` 这个参数从头到尾没有被读过。注释描述的是打算做的算法,代码做的是另一件事。

**3(AIC 尺度)**:主分支 `predictedOct = S0·exp(−a·r²)` 是**计数**,却与 `validLnS = ln(hist[r])`
(**对数**)作差求残差,再 `aic = S·ln(ssRes/S) + 4`;而 Geometric / Broken Stick / Log-Series 的
`ssRes` 都在**原始计数尺度**上算。fallback 分支更极端:`lrResult.mse` 是**对数空间**的 MSE,
与其它模型的原始尺度 SSE 直接比大小。

**4(SQS quorum)**:随机法的权重和 = Σᵢ Nᵢ·(1/Nᵢ) = **事件数**;稀释法用 `floor(q·totalN)` 个体。
两者的 quorum 含义不同,且随机法那个含义还随事件数缩放。

**5(物种得分)**:`speciesScoresRaw = Ymat.matmul(eigenvectors.sliceCols(0,1)).col(0)` 与上面
`axis1` 那一行**是同一行代码**。Ystd 是 n×nCols,`Ystd·v₁` 是**位点**得分。

**6(零模型)**:`nSwaps = Math.floor(nSpecies * nSites * 0.1)`,3×3 时 = 0 → 置换循环一次都不执行。

**7(DTW)**:带外格子被写成固定惩罚 `1e10`(**不是** `min(前驱)+cost`),终点格子因此恒为 1e10,
`sqrt(1e10) = 100000`。

**8(rarefaction)**:主导种使 `N − ni − k` 变负,`Math.log(负数)` = NaN。同源实现
`ecology.ts` 里的 `computeRarefaction` 有 `if (N - ni < n) { E += 1; continue; }` 保护,
**两份实现,只有一份带保护**。

**9(SHE)**:`logS` 直接写 `Math.log(S)`,S = 0 时是 −Infinity;`logH`/`logE` 用 −999。

**10(SQS nPoints)**:`qMin + (qMax − qMin) * i / (nPoints − 1)`,nPoints = 1 时除以 0。

## 修复

### 改动文件

| 文件 | 内容 |
|---|---|
| `entry/src/main/core/analysis/ecology/ecology.ts` | 1、3、5、6、7、9;并把 `rarefaction` 加入 barrel 再导出 |
| `entry/src/main/core/analysis/ecology/CoverageRarefaction.ts` | 2、8、11 |
| `entry/src/main/core/analysis/ecology/SQS.ts` | 4、10 |
| `tests/fixEcology2026.test.ts` | 新增,21 条回归测试 |

### 关键决策

**Chao1 CI 改用 `core/math/stats` 已有的 `qnorm`**:`z = qnorm(1 − (1 − cl)/2)`。
只依赖 `qnorm` 这一个既有导出(`core/math/stats.ts` 正被其它 agent 改动),
不再自造近似。`cl ∉ (0,1)` 直接抛 `ComputationError`。

**coverageRarefaction 改成真正的重复抽样**,点估计与区间来自**同一批**重复样本:
- **rarefaction 支路(c ≤ c_obs)**:每次重复从个体的池里**无放回**抽 `m = floor(c·N)` 个体,
  取该子样本的 Hill 数。重复样本的均值收敛到精确的 Hurlbert 期望 `E[S(m)]`,
  2.5% / 97.5% 百分位给出子样本的抽样区间。
- **外推支路(c > c_obs)**:每次重复做一次**有放回** bootstrap(重抽 N 个体),
  用**该重复样本自己的** S_obs / f1 / f2 重算 Chao1 渐近线与观测覆盖度,再套 Chao & Jost (2012) 外推式。
- 汇总:点估计 = 全部重复样本的均值;区间 = 全部重复样本的 2.5% / 97.5% 百分位
  (因此也带上样本间的离散度,不只是样本内误差)。

选"重复抽样"而不是"解析期望"的理由:q = 1、2 的 Hill 数没有解析式,统一用蒙特卡洛
可让三种 q 的语义一致,且点估计与区间出自同一批重复样本,不会互相打架。

**Log-Normal 残差统一到原始计数尺度**:拟合仍然是原算法的对数空间 OLS
(`ln(S_R)` 对 `R²` 回归,`advanced.py fit_log_normal`),**只把残差换到计数尺度**:
`ssRes = Σ_r (hist[r] − S0·exp(−a·r²))²`。fallback 分支(Zipf 形式)同样改成原始尺度的 SSE。

**SQS 随机法权重归一化到总和 1**:`share_i = 1/(N_i · nEvents)`。
quorum 由此统一为"总抽样比例",与稀释法(`floor(q·N)` 个体)语义一致。
另加 `sampledFraction?: number[]` 字段(各 quorum 档位实际抽走的个体比例),
让"两 method 抽样比例是否一致"**可被外部核对** —— 这正是原来无法验证的那一点。
并修掉浮点累积导致的过冲(`80 × 1/160 = 0.49999999999999994 < 0.5` 会多抽 1 个个体):
比较改为 `quorumAccum >= quorum * (1 - 1e-12)`。

**零模型两道守卫**:
- 每行都是常量(全 1 或全 0)→ 任何算法都变不出第二个矩阵 → 抛 `ComputationError`;
- 模拟分数无离散度(`std ≤ 1e-12·max(1,|mean|)`)→ SES 只能是 0/0 或天文数字
  (实测 3×3 对称矩阵给出 **SES = 4.3e13**)→ 抛 `ComputationError`。
另加 `nPermutations < 1` 的入参校验。

**DTW 带外置 `Infinity`**(首行首列同样受限),终点不可达时抛
`ComputationError`,错误信息给出**所需最小 window** `|n1 − n2|`。

**"报错优于猜测"**:以下四处从"返回一个看起来正常的数"改成"明确报错",
按 `docs/CONTRIBUTING.md` §4.2 —— 报错的输入原本都在产出不可用的结论:
`dtw` 带外、`nullModel` 零模型退化、`chao1ConfidenceInterval` 非法置信水平、`sqs` 非法 nPoints。

### 偏离审查建议的一处(古环境物种得分)

审查建议把 `columnSpeciesAxis` 改成 `Ymat.transpose().matmul(eigenvectors.sliceCols(0,1)).col(0)`。
**这个写法在本模块的维度下不成立,照抄会直接抛异常。**

本模块的特征向量取自 `YᵀY`(`eigh_from_matrix(Ymat.transpose().matmul(Ymat))`),
所以 `v₁` 活在**物种空间**、长度 = nSpecies;而 `Yᵀ` 是 nSpecies×nSites。
`Yᵀ`(nSpecies×nSites) × `v₁`(nSpecies×1) 维度不符 → `matmul shape`。
在审查自己的 4×3 复现数据上就会崩。`Yᵀ·v₁` 是**特征向量取自 `Y·Yᵀ`（位点空间）**时的写法。

实际采用 **CA 标准的列主坐标 `v₁·√λ₁`**(`vegan::cca` 的 species scores):
位点得分是 `Y·v₁`,物种得分是 `v₁·√λ₁`,两者是同一条轴上的投影,量纲也一致;
并与位点得分一起翻转(`wasFlipped`),保持符号一致。
现在 `columnSpeciesAxis` 长度 = nSpecies(3)、`axis1Scores` 长度 = nSites(4),
不可能再逐位相同。

## 验证

新增 `tests/fixEcology2026.test.ts`,**21 条**测试,全部通过:

| 组 | 用例 |
|---|---|
| Chao1 CI(4) | `no longer widens the 90% interval and narrows the 99% one` / `widens the interval monotonically with the confidence level` / `scales the interval with the normal quantile, not with a confidence ratio` / `rejects a confidence level outside (0, 1) instead of returning a garbage interval` |
| coverageRarefaction(3) | `no longer returns bit-identical numbers for 1 and 1000 iterations` / `no longer gives a single sample a zero-width 95% CI` / `converges to the exact Hurlbert expectation instead of a single random draw` |
| Log-Normal AIC(2) | `computes the Preston residual against the octave COUNTS, not against their logs` / `no longer wins the model ranking with the worst r² of all models` |
| SQS(3) | `no longer scales the random method's quorum with the number of events` / `consumes the same fraction of the sample in both methods` / `no longer produces a NaN quorum level for a single point` |
| 古环境(2) | `no longer copies axis1Scores into columnSpeciesAxis` / `keeps the species scores on the same axis as the site scores` |
| 零模型(3) | `no longer answers "no structure" (p = 1) for every 3×3 matrix` / `fails loudly when the null distribution has no spread at all` / `rejects a presence matrix whose rows are all constant` |
| DTW(2) | `no longer returns 100000 when the band cannot reach the end cell` / `still returns the real distance when no band is given` |
| rarefaction(1) | `no longer returns NaN when the dominant species cannot be missed` |
| SHE(1) | `encodes an empty sample with one sentinel in all three arrays` |

其中 AIC 那条**在测试里独立重算了一遍**对数空间 OLS 拟合与计数尺度 SSE,
再对拍模块输出的 AIC(误差 < 1e-6),不是拿实现的输出反推期望值。

跑过的检查:

- `node --experimental-transform-types tests/test.mjs` → **290 passed, 5 failed, 295 total**。
  5 条失败全部在 `tests/audit2026.test.ts`(Fitch parsimony、Matrix 广播、Shapiro-Wilk/AD、PLS×2),
  **不属于本次范围**(其它 agent 正在改这些模块);生态学相关用例全绿。
- `conda run -n dev python tools/structure_check.py` → **0 问题**(本次复查时 178 个文件;
  修复前为 175,差值是其它 agent 同时新增的文件)。
- 逐模块动态 `import()` 冒烟(109 个 core 模块)→ 仅 `io/FilePickerHelper.ts` 一处失败,
  原因是 `@kit.CoreFileKit` 垫片缺 `picker` 导出,**与本次改动无关的既有问题**。
  本次动了 barrel(`ecology.ts` 追加导出 `rarefaction`),故按 `AGENTS.md` 跑了这一步。
- 死代码审计(`tools/dead_code_audit.mjs`):ecology 三个文件各 1 个条目
  (IndVal.ts / SQS.ts / ecology.ts,均为既有导出);本次新增的 barrel 导出 `rarefaction`
  没有出现在审计的"生产环境无调用方"与"仅测试使用"两类候选里。

### 哪些旧结果需要重跑

| 分析 | 影响 |
|---|---|
| Chao1 置信区间 | 用了 cl ≠ 0.95 的**全部**结果需重跑 |
| 覆盖度稀释(iNEXT) | **全部**需重跑(点估计与区间原本都错) |
| 丰度模型拟合 | Log-Normal 的 AIC 变了,**模型排序可能变**,需重跑 |
| SQS(随机法) | **多事件数据集**的曲线需重跑(quorum 语义变了);单事件数据集不变 |
| 古环境 | `columnSpeciesAxis` 变了;`axis1Scores`、解释率、相关系数**不变** |
| 零模型 | nSpecies×nSites < 10 的矩阵需重跑(原本恒 p = 1);nSpecies×nSites ≥ 10 的矩阵交换次数前后相同(均 ≥ 1),输出不变 |
| DTW | 只有"带太窄"的那次调用原本返回假距离,现在会报错 |
| `rarefaction` | 只有 m > N − n_max 的调用原本返回 NaN |
| SHE | 只有空样本的编码变了(−Infinity → −999) |

## 风险

1. **Log-Normal AIC 的数值与审查参考不同**。审查给出的参考值是 **−73.32**,本次实现是 **−38.88**
   (数据 A)。原因是**拟合方式不同**:本次保留了原算法(`advanced.py fit_log_normal`)的对数空间
   OLS 拟合,**只把残差换到计数尺度**;而 −73.32 只能来自"在计数尺度上重新拟合"(即改动拟合本身),
   那会偏离原算法。两种做法都消除了约 100 个 AIC 单位的尺度错误,但数值不可直接比较。
   **未决**:哪种才是"原始 Python 版"的行为,需要对照 PaleoAST 的 Python 实现确认。
2. **AIC 横向比较仍不严格可比**。四个模型的**响应变量**不同(Log-Normal 拟合八度计数、
   Geometric / Broken Stick 拟合丰度、Log-Series 拟合丰度频数),样本量也不同;
   而且**参数惩罚不一致**(Geometric 1 个参数却记 +4,Broken Stick 0 个参数却记 +2,
   Log-Normal / Log-Series 2 个参数记 +4)。本次只修了任务点名的 Log-Normal 尺度问题,
   没有动其它模型的惩罚项 —— **这是一个已知遗留的不一致**,若要严格可比需要统一 n 与 2k。
3. **零模型每次置换只换 1 次(`floor(0.1·nSpecies·nSites)`,小矩阵最少 1 次)**,
   对小矩阵仍**欠采样**零空间:3×3 的对称矩阵其全部一次交换邻居 C-score 相同,
   因此现在只能抛错而不是给出 p 值;严格随机化检验需要更多交换步数,
   但那会改变所有既有 `nullModel` 数值,本次未做。**需用户决策**。
4. **SQS 随机法的数值语义变了**:多事件数据集在同一 quorum 下的期望物种数**升高**
   (因为现在抽的是同样比例的个体)。已加 `sampledFraction` 字段,
   可用它核对"同一 quorum 抽走了同样比例";旧曲线不可与新曲线混用。
5. **`rarefaction` 之前未从 barrel 导出**(潜在 API 缺陷)。本次随修复一并导出,
   它目前只有测试在用,生产代码无调用方。
6. **本机无 TypeScript 编译器**(无 `tsc` / `hvigor` / `node_modules`),**未做类型检查**;
   改动均为纯 TS 语法,已通过 node 的类型剥离执行验证。
7. `tests/fixEcology2026.test.ts` **尚未登记进 `tests/run.ts`**(该文件不在本次所有权内),
   登记前 `tests/test.mjs` 不会跑到这 21 条;`docs/changes/README.md` 的索引表同样待统一补。
