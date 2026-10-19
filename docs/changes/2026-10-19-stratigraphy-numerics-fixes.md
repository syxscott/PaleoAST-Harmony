# 地层学模块的 17 处缺陷:卡方 p 值发散、RASC 忽略观测、CONISS 带数对不上、外推出负年龄

## 类型
缺陷修复 / 数值变更

## 问题

`core/analysis/stratigraphy/` 整包复审(2026-10-19)发现 17 处缺陷,
其中 2 处致命、6 处严重。**每一处都会把"看起来合理"的错误数字写进论文**:

| # | 位置 | 旧行为 | 新行为 |
|---|---|---|---|
| 1 | `stratigraphy.ts` `gammainc_approx` | 卡方 p 值由发散的连分数算出,**可以是负数**;400 条随机链里 287 条(72%)p 值落在 [0,1] 之外,57 条(14%)显著性与 scipy 相反 | 直接算上尾 `Q(a,x)`,8 个测试点与 scipy `chi2.sf` 逐位吻合到 12 位有效数字 |
| 2 | `RASC.ts` `_refQuality` | `sectionData` 参数**从头到尾没被引用**,排序只是距离矩阵的函数;两段完全相反的观测给出逐位相同的排序 | 用观测剖面的**共现结构**参与参考剖面与排序的权重,不同观测给出不同排序 |
| 3 | `stratigraphy.ts` `coniss` | 约一半输入(2400 例中 1236 例,51.5%)返回的带数 ≠ 请求的 `nZones` | 带数恒为 `min(nZones, 样本数)`,且带是**连续**的样本区间 |
| 4 | `stratigraphy.ts` `stratigraphicCorrelation('euclidean')` | 比较的是**高程列**:两个完全无关的剖面只因采样网格相同就被判为"完全匹配"(相似度 1.0) | 改比 `values`,镜像剖面相似度 0.472 |
| 5 | `StratExtended.ts` `pchipInterpolate` | 约束区间外做三次外推,最深约束以下给出 **-784 Ma** | 区间外改为沿端段斜率的**线性外推**,并用 `extrapolated[]` 标注外推点 |
| 6 | `StratExtended.ts` `pchipSlopes` | 重复一条 (高程, 年龄) 约束 → 整条年龄曲线静默变成 NaN | 重复高程直接抛可读错误 |
| 7 | `UA.ts` `unitaryAssociations` | `events` 已过滤、`fadMatrix`/`ladMatrix` 未过滤,返回对象自相矛盾 | 返回过滤后的矩阵,并新增 `eventIndexMap` 记录原始列号 |
| 8 | `AgeModel.ts` `computeSedimentationRate` | 占位值 `rates[0] = 0` 一起进了 LOWESS,顶部速率被低估 63%(5 → 1.862/3.042/4.141) | 平滑时排除首元素,恒定速率 5 平滑后仍为 5 |
| 9 | `stratigraphy.ts` `armaPredict` | `p > n` 时读 `fitted[-1]`,预测/区间全 NaN | `buildARMAModel` / `armaPredict` 入口校验 `p + q ≤ n − 1`,抛可读错误 |
| 10 | `stratigraphy.ts` `coniss` linkage 第 3 列 | 存的是 `sqrt(ΔSS)`(Ward 高度),broken-stick 文档却称其为 "BD values" | **语义未改**,只把两处文档写准(见「设计歧义」) |
| 11 | `stratigraphy.ts` `extinctionCI` | 探测率 `p = 0` 时给出**零宽**区间(`ciLower === ciUpper`) | `p = 0` → `r = 0` → gap = +∞,下界无界 |
| 12 | `StratExtended.ts` `blockBootstrapCI` | `nBootstrap = 0` 返回 `undefined`(下游 `.toFixed()` 抛 TypeError);`= 1` 把单点当 95% 区间 | `nBootstrap < 2` 抛可读错误 |
| 13 | `stratigraphy.ts` `detectExcursions` | `nExcursions` 统计的是合并后的段数 | `nExcursions` = 异常点数,新增 `nSegments` = 段数 |
| 14 | `stratigraphy.ts` `filterEndemic` | `occurrences <= minOccurrence`,恰好出现 `minOccurrence` 次的种被判为特有种 | 改为 `occurrences < minOccurrence` |
| 15 | `stratigraphy.ts` `movingAverage` | 负窗口 → 整列 NaN | `windowSize < 1` 抛错 |
| 16 | `stratigraphy.ts` `isotopeAnalysis` | `depths`/`values` 长度不一致时趋势静默变 0 | 入口校验长度一致 |
| 17 | `stratigraphy.ts` `directional` / `spectralAnalysis` | 空输入 → 全 NaN;单样本 → `peakPeriod` 为 `undefined`(UI 随后 `.toFixed(2)` 抛 TypeError);常数序列的 Lomb-Scargle → NaN 功率 | 空/退化输入显式抛可解释错误 |

## 根因

1. **卡方 p 值**:Numerical Recipes `gammq` 的连分数要求 `c = 1/FPMIN = 1e30`,
   代码写成 `c = 1e-30`,于是 `c = bn + an/c` 第一次迭代就被 `an/c ≈ −5e29` 支配,
   级数发散。**只有两态链侥幸正确**(`a = df/2 = 0.5` 时 `an = n(a−n)` 在 `n = 1` 处恰为 0),
   这正是它长期没被发现的原因。
2. **RASC**:`_refQuality(positions, D, sectionData)` 的函数体只累加 `D[i][j]·Δrank²`,
   `sectionData` 是个摆设;`_constructReferenceSection` 拿到 `sectionData` 后只决定走
   "交换搜索"还是"由距离矩阵缩放"两条分支,两条都与数据内容无关。
3. **CONISS**:`:118-121` 假定"根合并一定在切割集合里",而 Ward 式 linkage 的
   `sqrt(ΔSS)` **不随合并顺序单调**(6 行例子里高度序列是
   `[0.0786, 0.1088, 0.1473, 0.2973, 0.2157]`,根合并只有 0.2157)。
   根合并没被选中就凭空多切一刀;祖先不在切割集合里时整棵子树又被并成一个带。
4. **`euclidean` 分支**累加的是 `(a.heights[k] − b.heights[k])²`,而同函数内
   `pearson`/`spearman`/`dtw` 三个分支用的都是 `a.values`/`b.values` —— 复制粘贴漏改。

## 修复

改动文件(全部在 `core/analysis/stratigraphy/` 内):

- `stratigraphy.ts`:拆分 `_gammaincP` / `_gammaincQ`(连分数 `c` 初始化改 `1e30`),
  新增 `chi2Survival` 直接算上尾;CONISS 分带改为**在合并树上做动态规划**,
  求"把样本序列切成 `min(nZones, n)` 个连续带、使边界处 ΔSS 之和最大"的切法
  (CONISS 只合并相邻簇,合并树是一棵梯子,每个内部节点恰好对应两个样本之间的一个间隙);
  `nZones` 改为**实际带数**,新增 `requestedZones`;其余按上表逐条修正。
- `StratExtended.ts`:`pchipSlopes` 校验 x 严格递增;`pchipInterpolate` 区间外线性外推;
  `blockBootstrapCI` 校验 `nBootstrap ≥ 2` 与 `alpha ∈ (0,1)`;
  broken-stick 的文档写清"被检验的是 Ward 高度 `sqrt(ΔSS)`"。
- `AgeModel.ts`:`buildAgeModel` 拒绝重复高程、外推点夹在 0 Ma(年龄不能比现在还年轻)、
  新增 `extrapolated[]`;`computeSedimentationRate` 的 LOWESS 只拟合真实速率。
- `RASC.ts`:新增 `_coOccurrence` / `_pairWeights`,把"剖面里同时出现的两个事件"
  作为时间接近的可观测代理写进参考剖面与排序的权重;距离矩阵先归一化到 [0,1]
  (缩放不改变单项目标的 argmin,无剖面数据时行为不变)。
- `UA.ts`:返回过滤后的 `fadMatrix`/`ladMatrix`,新增 `eventIndexMap`。
- `index.ts`:未改(导出面没有变化)。

## 设计歧义(未擅自改动,留给拍板)

**CONISS linkage 第 3 列到底该存什么**。现状是 `sqrt(ΔSS)`(Ward/ISS 高度),
broken-stick 拿它当"观测 BD 值"用。两个选项:

- **A. 保持 ISS 语义**:把文档改准(已做),broken-stick 检验的是"合并造成的 ISS 跳跃",
  与 Grimm (1987) 一致;`significantZones` 与 p 值保持现状。
- **B. 改存 Bray-Curtis 距离**:linkage 增加一列真正的 BC 距离,broken-stick 检验它。
  这会**改变所有 p 值和 `significantZones`**(例:`[[1,0],[2,0],[10,10]]` 的第 3 列
  现在是 0.2357,真实 BC 距离是 0.3333,差 1/√2),而且 Ward 的 ΔSS 才是 CONISS 论文里
  做分带显著性判断的量。

我按"不擅自改语义"的要求选了 A,并在两处文档里写明被检验的到底是哪个统计量。

## 验证

新增 `tests/fixStratigraphy2026.test.ts`,28 条用例,测试名全部写明旧行为。

- 卡方 p 值:8 个测试点(χ² 与 df 不变)与 scipy 1.15.3 `chi2.sf` 比对,
  相对误差 < 1e-11;另有 400 条随机链的 p 值全部落在 [0,1]。
- CONISS:审查给的两个例子 + 400 个随机剖面,带数全部等于请求值且带连续。
- RASC:两段相反观测的排序必须不同,且共现的两个事件在排序里相邻。
- 年龄模型:区间外不出现负年龄,重复约束抛可读错误。
- 其余 12 处按上表逐条钉住。

门禁:`tests/test.mjs` **290 passed, 5 failed**(5 条全部是别的 agent 负责的
Fitch / Matrix / Shapiro-Wilk / PLS 用例,与本次改动无关);
`structure_check.py` 175 文件 0 问题;核心模块逐个 `import()` 冒烟通过
(唯一失败是 `core/io/FilePickerHelper.ts` 的 `@kit.CoreFileKit` 平台 shim,与本次无关)。

> ⚠️ 新测试文件**尚未注册**进 `tests/run.ts`(该文件不在本次的所有权范围内),
> 需由 `tests/run.ts` 的所有者补一行 `import './fixStratigraphy2026.test.ts';`。

## 风险

- **数值变更**:所有 CONISS 分带结果会变(带数现在等于请求值,带的边界也可能移动);
  所有 Markov p 值会变(以前是错的);`'spline'` 年龄模型在约束区间外与 `'linear'`
  不再互为截断关系。**用旧版本算过的结果需要重跑。**
- **`minOccurrence = 1` 的语义变了**:旧代码把"恰好出现 1 次"的种算作特有种,
  新代码(按 `occurrences < minOccurrence`)把它算作广布种。`minOccurrence = 2` 及以上
  才是"出现次数不足即为特有种"的直觉语义。UI 侧 `BiostratDialog` 默认
  `min_occurrence = 2`,不受影响。
- **RASC 的共现权重是一个代理**:剖面数据里没有单个事件的高程,只有"是否出现",
  所以只能用共现表示时间接近。若上层能拿到每个事件在各剖面的位置(FAD/LAD),
  应改用 Gradstein (1985) 的**带符号距离**矩阵 —— 那才是原算法。
  目前 `StatisticsController.runRASC` 根本不传 `sectionData`,所以这段逻辑暂时**UI 不可达**。
- 新增的抛错(ARMA 阶数、样本数 < 2、Lomb-Scargle 常数序列等)会让原来"静默返回
  垃圾值"的路径变成异常,UI 需要能显示这些错误信息。
