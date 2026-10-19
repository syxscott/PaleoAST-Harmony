# PRNG 越界、BCa 符号与 mid-rank、LOWESS 中位数:三处会写进论文的静默算错

## 类型
缺陷修复 / 数值变更

## 问题

一轮代码审查报出 7 条。其中 6 条属实,1 条**判断错了**(见下文"一条需要纠正的审查结论")。
6 条里有 5 条会静默产出错误数字,1 条会崩在看不懂的 `TypeError` 上。

### 缺陷 1:`rand()` 与 `createSeededRNG()` 能返回恰好 1.0

`core/math/random.ts` 用 `u32 / 0xFFFFFFFF` 把状态映射到 `[0,1]`。
u32 有 2^32 个取值,除数应该是 `0x100000000`;除以 `0xFFFFFFFF` 会把状态
`0xFFFFFFFF` 映射成**恰好 1.0**,区间成了 `[0,1]` 而不是 `[0,1)`。

构造性见证:从默认状态 12345 出发,第 **2 285 225 982** 次抽样命中状态
2225710159 → u32 = 4294967295:

| | 旧 | 新 |
|---|---|---|
| `rand()` | `1.0` | `0.9999999997671694` |
| `randint(0, 10)` | **10**(越界) | 9 |
| `createSeededRNG(12345)` 同一抽样 | `1.0` | `0.9999999997671694` |
| `floor(rng() * 10)` | **10** | 9 |

`floor(rng() * n) == n` 就是 `Bootstrap.ts` 里 `data[n].slice()` 崩溃的路径
(`data[n]` 是 `undefined`),`Bootstrap.ts:206`。

### 缺陷 2:`poisson(lambda, rngSeed)` 每次调用返回同一个值

`random.ts` 里种子在**函数内部**重建,状态不跨调用保留:

```ts
const u = rngSeed !== undefined ? createSeededRNG(rngSeed) : _float;
```

实测:连续两次 `poisson(5, 42)` 返回完全相同的值;循环 20 000 次
`poisson(lam, 42)` 全是同一个数(均值 1048 而不是 5)。
唯一生产调用方 `core/analysis/macroevolution/macroevolution.ts:656-657` 不传种子
(走模块级 PRNG),行为正确,未受影响。

### 缺陷 3:BCa 加速常数 `a` 的符号反了

`Bootstrap.ts` 的 docstring 写 `a = Σ(θ̄ − θ_i)³ / [6·(Σ(θ̄ − θ_i)²)^(3/2)]`,
代码却算 `θ_i − θ̄` → `sumCu` 整体反号 → `a` 反号 → BCa 区间被镜像。
scipy 1.15.3 `scipy/stats/_resampling.py::_bca_interval` 用
`U_ji = (n-1)*(theta_hat_dot - theta_hat_i)`,同号。

### 缺陷 4:BCa 偏差修正用严格 `<`,scipy 用 mid-rank

scipy `_percentile_of_score` = `((a < score).sum() + (a <= score).sum()) / (2*B)`。
仓库用 `v < estimate`,把**等于**点估计的重采样全部漏掉,z₀ 被系统性压低。

### 缺陷 5:LOWESS 的 MAD 在偶数样本上取了上中心次序统计量

`LOWESS.ts` 原代码 `sortedResid[Math.floor(n / 2)]` 只取排序后**上**一个中心次序统计量;
numpy 的 `np.median`(以及 statsmodels)在偶数样本时取**两个中心次序统计量的平均**。

### 缺陷 6:LOWESS 对 n < 3 抛 TypeError

`lowess([1],[2])` → `TypeError: Cannot read properties of undefined (reading 'd')`。
根因:`k = Math.max(3, Math.floor(frac * n))` 可能大于 n → `dists[k-1]` 越界。

### 一条需要纠正的审查结论(LOWESS 的 MAD 口径)

原审查报告写:

> 仓库 MAD = 1.5294(`median(|r|)`),statsmodels = 1.6263(`median(|r − median(r)|)`),
> 文件头引用的是 Cleveland (1979),值得对齐 statsmodels 的**相对中位数 MAD**。

**这条判断是错的**,照做会让仓库离它引用的参考实现更远。依据:

1. statsmodels 0.14.6 源码 `statsmodels/nonparametric/_smoothers_lowess.pyx`
   `calculate_residual_weights`:
   ```python
   std_resid_data[j] = fabs(y[j] - y_fit[j])      # |r|
   median = <double>np.median(std_resid)          # median(|r|)
   scale = 6.0 * median
   ```
   是**绝对** MAD,不是 `median(|r − median(r)|)`(那是 Hampel 估计量)。
2. 实测:仓库**原本**的口径(绝对 MAD)与 statsmodels 的输出已经吻合到 **2e-12**,
   前提是中位数取对。真缺陷是中位数取错(缺陷 5),不是 MAD 的定义。
3. 若改成相对 MAD,30 点含一个 +30 离群点的序列与 statsmodels 的最大偏差
   从 **0.0028 放大到 0.18**。

因此本轮改的是**中位数**,不是 MAD 的定义;`LOWESS.ts` 里已写明依据,
避免下一个人再"修正"回去。

## 根因

- 缺陷 1:`u32 → double` 的除数写成了 `0xFFFFFFFF`(2^32 − 1)而不是 `0x100000000`。
  两处(`_float()` 与 `createSeededRNG()`)各自写死,没有共用一个转换函数。
- 缺陷 2:把"带种子的随机流"当成了"每次调用重新播种",于是每次都重放同一条流的第一个抽样。
- 缺陷 3/4:BCa 是照着教科书公式写的,但 `diffs` 的方向和 `#{θ* < θ̂}` 的并列处理没对照 scipy 源码核过。
- 缺陷 5:中位数实现取的是顺序统计量而不是中位数。
- 缺陷 6:样本量与近邻数 `k` 的关系没有校验。

## 修复

| 文件 | 旧行为 → 新行为 |
|---|---|
| `core/math/random.ts` | ① `_float()` 除数 `0xFFFFFFFF` → `0x100000000`(`rand()` 严格 < 1)② `createSeededRNG()` 除数同样改成 `0x100000000`(流永不含 1.0,`floor(rng()*n)` 永不越界)③ `poisson(lambda, seed)` 改为**按种子缓存的持久流**(`_seededStreams`),`seed()` 清空缓存 |
| `core/math/Bootstrap.ts` | ④ `jackknifeAccelerate` 的 `diffs` 由 `v − θ̄` 改为 `θ̄ − v`(`a` 符号)⑤ z₀ 改为 scipy mid-rank:`frac = (below + 0.5·equal) / B` |
| `core/math/LOWESS.ts` | ⑥ MAD 改用**真中位数**(偶数样本平均两个中心次序统计量)⑦ n<3 与 x/y 长度不等时抛可读 `Error`;`k` 收敛到 `min(n, …)` |
| `tests/fixRandom2026.test.ts` | 新建,22 条回归测试 |

`core/math/Validation.ts` **未改**:`assertNoSingular` 用相对阈值
`threshold * maxAbs`(1e-14·maxAbs),而 `core/math/linalg.ts` 用绝对 1e-15,
两者口径不一致 —— `linalg.ts` 不在本轮范围内,已单独提示负责该文件的 agent 对齐。

## 验证

### 数值对拍

| 项 | 旧 | 新 | 参照 |
|---|---|---|---|
| `rand()` @ u32=0xFFFFFFFF | `1.0` | `0.9999999997671694` | `[0,1)` 语义 |
| `randint(0, 10)` @ 同一抽样 | `10` | `9` | 文档承诺 `[lo, hi)` |
| `poisson(5, 42)` 连抽 20 次 | 1 个不同值 | 8 个不同值 | — |
| `poisson(5, 42)` ×2000 均值 | `6`(恒定) | `5.023` | λ=5 |
| BCa 区间(25 点右偏样本) | `[9.263075, 21.593407]` | `[10.077711, 22.766896]` | scipy 1.15.3 `[10.077711866, 22.766896168]`(差 ~1e-9) |
| BCa z₀(21 个整数 + 中位数统计量) | `-0.228469` | `+0.191946` | scipy mid-rank |
| BCa 95% 上限(同上) | `8` | `10` | scipy mid-rank |
| LOWESS vs statsmodels(30 点含 +30 离群点) | 最大差 `2.85e-03` | 最大差 `2.03e-12` | statsmodels 0.14.6 |

### 新增测试

`tests/fixRandom2026.test.ts`,22 条,测试名一律写明**被修复的旧行为**:

- `rand() is strictly below 1 at the u32 = 0xFFFFFFFF state (it used to be exactly 1)`
- `randint(0, 10) returns 9 at that state (it used to return 10)`
- `a seeded stream is strictly below 1 at the u32 = 0xFFFFFFFF draw (it used to be exactly 1)`
- `a seeded stream never selects an index past the end of the array (it used to)`
- `poisson(5, 42) no longer returns the same value on every call`
- `the BCa interval matches the scipy formula` / `... is not the one the negated acceleration produces`
- `z0 is not pushed down when the statistic ties the point estimate`
- `the smoothed curve matches statsmodels on a 30-point series with a +30 outlier`
- `lowess rejects fewer than 3 points with a readable error (it used to throw a TypeError)`

**守卫有效性已验证**:把三个源文件换回旧版重跑,22 条里 **15 条失败**
(BCa 符号、mid-rank、LOWESS 中位数、n<3、poisson、两个越界见证全部变红);
`createSeededRNG` 单独退回旧除数时,两条构造性见证如期失败
(`expected < 1, got 1` / `expected 9, got 10`)。
剩下 7 条是**故意不随旧代码变红**的对照项(同种子可复现、无种子路径、
大样本冒烟、n=3 仍可拟合、错误变体的区分度)。

### 门禁

- `node --experimental-transform-types tests/test.mjs` → **292 passed, 3 failed**(295)。
  剩下 3 条**都不在本轮范围**(Matrix 广播、Anderson-Darling、PLS `covarianceExplained`),
  是其它 agent 并行修改中的在途状态;把本轮三个源文件退回旧版后这 3 条同样失败。
- `python tools/structure_check.py` → 175 文件 **0 problems**。

## 风险

- **数值变更,旧结果需要重跑**:所有用到种子 PRNG 的分析(置换检验、宏演化中性模拟、
  形态测量重采样、bootstrap)在**同一 seed 下**的随机流都变了(相对差 ~1.4e-10)。
  分布层面的结论不变,但逐位对照旧报告的数值会不一致。
  注:bootstrap 的**重采样下标**没变(相对 1.4e-10 的位移不会跨过整数边界),
  所以本文件里钉住的 BCa 区间前后相同。
- `poisson(lambda, seed)` 的流由 `seed()` 重置。若调用方在两次 `poisson` 之间调用 `seed()`,
  会拿到该种子的第一个抽样 —— 这与仓库既有约定("带 rngSeed 的函数自己播种")一致,
  但**不要**在循环里反复 `seed()`。
- LOWESS 与 statsmodels 只在 **x 等距**时逐位一致:statsmodels 取**连续 k 个**近邻,
  本仓取**距离最近的 k 个**,x 不等距时邻域不同。属本轮范围外。
- `Bootstrap.ts` 仍无生产 importer(死代码),本次修复不影响线上行为;
  它的价值是"万一有人接上去,不会带着一个符号反了的 BCa 上线"。
- 基准值依赖 Mulberry32 + `0x100000000` 除数这一组合;若将来换 PRNG 算法,
  `tests/fixRandom2026.test.ts` 里钉住的数值需要重算。
