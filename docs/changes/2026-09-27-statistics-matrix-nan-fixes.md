# statistics 第二轮审查:9 处缺陷,含 1 处全模块级 NaN

## 类型
缺陷修复

## 问题

`core/analysis/statistics/`(3102 行)+ 5 个辅助文件,以及它暴露出来的 `core/math/Matrix`
与 `core/math/linalg|stats`。**9 处缺陷,其中 5 处让整个功能返回 NaN 或 null 而不报任何错。**

| 缺陷 | 实测(修复前) | 正确值 |
|---|---|---|
| `Matrix.sub/add/mul/div` 无广播 | `X.sub(X.meanAxis(0))` 只有第 1 行正确,第 2 行起全 NaN | 逐行中心化 |
| `cov` / `covMatrix` | 全 NaN 矩阵(用了上面那个 `sub`) | `[[5.7,2.1,7.35],[2.1,9.3,-1.2],[7.35,-1.2,11.3]]` |
| `hellinger` | 全 NaN(`rowSums[i]` 把 n×1 的 Matrix 当数组下标) | 第 0 行 `sqrt([3,1,2]/6)` |
| `cca`(cca + rda 两个分支) | 特征值 `[0, 0]`,inertia 0,解释方差 0% | `[0.28967, 0.00502]`,inertia 7.3619 |
| `dca` | 特征值 `[0, 0]`,梯度长度全 0 | `[6.00353, 0.90345]` |
| Shapiro-Wilk `W` | n=5 时 **1.78**(数学上 W≤1),n=1000 正态数据 **0.0118** | `0.78881`(S&W 1965 样本) |
| `isotonicRegression` 块游标 | NMDS 返回 `stress=Infinity`、`coordinates=null` | stress 3e-6,收敛 |
| `fclusterFromLinkage` | 7 点要 1/2/3 簇,四种 linkage **一律返回 5 簇** | 恰好 k 簇,与 scipy 分区一致 |
| `plsAnalysis` | B 平移 +1000 使 RV 变 2.2e-02;`nComponents=1` 直接抛 `matmul shape` | RV 平移不变;nc<min(p,q) 可算 |

## 原因

### 1. `Matrix` 逐元素运算没有广播,也不校验形状

`add/sub/mul/div/maximum` 直接 `for (i < this.length) d[i] op= o.data[i]`。
`meanAxis(0)` / `sumAxis(0)` / `stdAxis(0)` 返回的是 **1×p 行向量**,
`o.data` 长度只有 p,于是从第 p 个下标起读到 `undefined`,`x - undefined` 就是 NaN。

全仓 10 个调用点都按 NumPy 语义在用(仓内另有 `MatrixOps.centerMatrix`、
`Transformations.zscoreStandardize` 用显式 `get(0, j)` 写对了同一个操作),
所以这不是"某个调用点用错了",是 **`Matrix` 少实现了广播**。
被污染的下游:`linalg.cov`、`stats.covMatrix`、`cca`(两个分支)、
`morphometrics/Integration.plsIntegration`(直接抛 `svd:A[0] is not finite`)、
`morphometrics.relativeWarps`、异形学回归、`DataController.transformZScore`。

### 2. 把 Matrix 当数组下标访问

`cca` / `dca` / `hellinger` 三处都写了 `rowTotals[i]`、`colTotals[j]`。
`rowTotals` 是 n×1 的 Matrix,`rowTotals[i]` 恒为 `undefined`:
`cca` 里 `rowTotals[i] > 0` 恒假 → 整块乘 0;`hellinger` 里 `rs <= 0` 恒假 →
过了保护再拿 `undefined` 去除 → 全 NaN。**三处都没有任何报错。**

### 3. Shapiro-Wilk 的权重方向配反了

`_generateMVector` 用 Blom 正态分位数 `Φ⁻¹((i-3/8)/(n+1/4))` 生成**递增**的权重,
再和**递减**的间距 `(x₍ₙ₊₁₋ᵢ₎ - x₍ᵢ₎)` 相乘 —— 两路互相抵消。
另外归一化强制 `Σaᵢ² = 1` 用在半向量上,而反对称全向量的要求是 `2Σaᵢ² = 1`,差一个 √2。
n=5 时 W=1.78 超过理论上限 1,`log(1-W)` 变 NaN,连 p 值也是 NaN。

这不是"近似精度不够",是**根本没在做 Shapiro-Wilk 检验**。
已整体换成 Royston (1995) Remark AS R94 —— scipy 用的同一套算法。

### 4. `isotonicRegression` 用了两个语义不同的游标

回填时 `b` 一边当块数组下标、一边按块大小累加。
只要第一个合并块跨越了两个以上 tie-group,后面所有块就读到了 `blockSums` 越界处,
填进 `undefined` → NaN。NMDS 的 disparities 因此全 NaN,stress 全程 NaN,
`if (stress < bestStress)` 一次都没成立,最后返回 `stress = Infinity` + `coordinates = null`。
n=6 侥幸能跑(第一个块只含 1 组),n≥12 必挂。

### 5. `fclusterFromLinkage` 对簇槽位而非观测做并查集

linkage 行的 id 是**簇槽位**(0..n-1 是单点,之后每合并一次新增一个 n、n+1…)。
直接对槽位做并查集,只把两个"代表"并到一起,代表底下的观测仍各自独立成簇。
所以只有 `nClusters ≥ n-2` 的情形碰巧正确,1/2/3 簇全部返回 5 簇。

### 6. PLS 用了未中心化的块

`plsAnalysis` 直接对原始块求 `AᵀB/(n-1)`。PLS 定义在中心化块上,
所以 Escoufier RV 会随数据整体平移而变 —— 同一批标本,单位不同就给出不同的整合度。
同仓的 `plsIntegration` 早就中心化了,两份实现约定不一致。
`covarianceExplained` 还用了 `s/Σs` 而非惯量 `s²/Σs²`。
另外 `yScores` 多了一次 `.transpose()`,只在 `nc == q` 时才凑巧可乘。

## 修改

1. **`core/math/Matrix.ts`** — `add/sub/mul/div/maximum` 收敛到一个 `elementwise` 共享内核,
   支持同形、`1×p` 行广播、`r×1` 列广播;其余形状**抛错**而不是退化成 NaN。
   `div` 先扫一遍除数再算,避免广播中途失败留下算了一半的结果。
2. **`core/analysis/statistics/statistics.ts`**
   - `cca` / `dca` / `hellinger`:`rowTotals[i]` → `rowTotals.get(i, 0)`,
     `colTotals[j]` → `colTotals.get(0, j)`。
   - `isotonicRegression`:块下标与组游标分开。
   - `fclusterFromLinkage`:改为显式传递成员表再标号;`nClusters < 1` 明确报错。
   - `plsAnalysis`:两块中心化;`covarianceExplained` 改用 `s²/Σs²`;
     `yScores` 去掉多余的 `.transpose()`;补行数/样本数校验。
   - `univariateSummary`:`Math.min(...vals)` 改循环 —— 20 万行的列原本直接爆栈。
   - `mannWhitneyU`:`zScore` 改为与 `pValue` 同源的连续性校正 z。
   - 删除 11 个已无调用点的局部近似函数(`normCDF_approx`、`fCDF_approx`、
     `chi2Inverse_approx` 及其依赖,约 100 行),兑现文件头"不得新增调用点"的约定。
3. **`core/analysis/statistics/Normality.ts`** — `_shapiroWilk` 整体重写为 AS R94,
   p 值尾概率用 `erfc`(1e-13 精度)而不是 `1 - pnorm`(会抵消成 0);
   删除 `_generateMVector` 与 `_ppnd7`(后者与 `math/stats.qnorm` 重复)。

## 验证

参照值全部来自 conda `dev` 的 **scipy 1.15.3 / numpy 1.26.4**,没有一处手算。

- 新增 `tests/statistics2026.test.ts`,23 条回归测试,测试名一律描述旧行为。
- Shapiro-Wilk:与 scipy 在 **n = 3..5000 × 4 种分布 × 144 组样本**上对拍,
  W 最大相对偏差 **2.4e-09**,p 最大 4.6e-05(且只出现在 p≈1e-17 的尾端,属浮点抵消)。
  构造出的 a 系数与 Shapiro & Wilk (1965) 公布表逐项吻合(n=5: 0.664639/0.241360)。
- PLS:与 numpy 的 SVD 逐项吻合 —— 奇异值、RV、xScores、yScores(最大差 1.8e-15)、
  协方差解释占比,`nc = 1/2/3` 全覆盖。
- 聚类:4 种 linkage × k=1..7 全部返回恰好 k 簇;k=3 的分区与
  `scipy.cluster.hierarchy.fcluster` 一致。
- 门禁:`node --experimental-transform-types tests/test.mjs` **153 passed, 0 failed**;
  `node test/device/run.mjs` 19/19;`python tools/structure_check.py` 174 文件 0 问题。
- 未跑 DevEco 构建:本次只动 `core/**` 与 `tests/**`,不涉及构建配置、依赖或公共 API 形态。

## 其它

- **本次审查中我自己误判了 4 次,根因相同**:没先确认 API 契约就下断言。
  典型一次是实现 Shapiro-Wilk 时把 Fortran `_poly` 的幂次顺序当成了普通多项式,
  结果 n=6 时 `1-2a₁²-2a₂²` 塌成 0、除数变负;还有一次用中位数而非均值去中心化,
  把 S&W 样本的 W 从 0.789 算成 0.670。两次都是先对照 scipy 源码才发现是自己错了。
  **结论:任何"看起来不对"的结论,先假设是自己错了。**
- `directional` 在完全均匀分布下 R 落到 1e-17 量级浮点噪声,`−2 ln R` 放大后
  `circularStdDeg` 在 8.6~510° 间跳变。公式与 scipy 一致,该量在均匀极限下本无解释意义,
  本轮未改。
- Anderson-Darling 统计量在 n≈1000 且数据极端非正态时会与 scipy 差约 0.5%:
  `F(x)` 在双精度下溢到 0,代码跳过了对应项。这是表示精度限制而非逻辑错误,
  相对 5% 显著性临界值 0.752 的影响可忽略,本轮未改。
- 未审:`morphometrics` 余下约 2400 行、`models`+`controllers`+`utils` 1976 行、`ets/` 6533 行。
