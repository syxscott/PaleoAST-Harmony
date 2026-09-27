# morphometrics 第二轮审查:5 处缺陷,其中 3 处让统计检验完全失效

## 类型
缺陷修复

## 问题

`core/analysis/morphometrics/`(约 3000 行,6 个文件)。**5 处缺陷,其中 3 处让检验/分析
得出与真实情况相反的结论且全程不报错。**

| 缺陷 | 实测(修复前) | 正确值 |
|---|---|---|
| 模块内第二份 Jacobi 特征分解 `eigh_local` | 30×6 随机协方差矩阵返回特征值 `[30.591, 12.351, 10.195]`,特征向量与真解近乎正交(`1-|<v,v'>| = 0.97`) | `[37.977, 10.508, 9.358]` |
| `allometry` 的等度量检验 | R²=0.966、F=67.2 的强异形数据 → **p = 1.0**,永不拒绝 | p ≈ 7.04e-23 |
| `RMA` 的 95% 置信区间 | 斜率 2.01、n=12 → 区间 `[-388, 390]`(下界还高于上界) | `[1.9877, 2.0407]` |
| `eigenshape` 组件数未夹紧 | 请求 9 个组件(只有 3 个变量)→ 载荷矩阵与摘要文本全 NaN | 夹紧到 3 |
| `tpsWarpGrid` 作用于 3D 拟合 | 二维格点喂给三维 warp,读 `p[2]` → 每个坐标都是 NaN | 明确拒绝 |
| `buildKernelMatrix(_, 3)` | `dim` 只限制坐标循环,核恒为 `r² ln r`,对三维输入静默返回二维核矩阵 | 报错并指向 `buildKernelMatrix3D` |

## 原因

### 1. 第三份 Jacobi 特征分解(最严重)

`core/math/linalg.ts` 里的 `eigh` 已经过 numpy 对拍验证,并且修过 `atan2` 的符号问题。
`morphometrics.ts` 又自己抄了一份 `eigh_local` + `eye_local`,**没带上那个符号修复**,
也没有收敛性断言。`relativeWarps` 与 `allometry`(给定 `nComponents` 时的 PCA 基)
全部建立在这份未修复的求解器上。

关键在于 `allometry` 里 PCA 基就是回归的设计矩阵,所以 R²、F、等度量 p 值
都是在一个**错误基**上算出来的。

### 2. `betainc_local` 求的是 complementary incomplete beta

`allometry` 用模块自带的 `fCDF_local` → `betainc_local` 求 F 分布上尾。
`betainc_local` 累加的是**升幂**超几何级数,该级数收敛到的是
complementary incomplete beta(关于 x **递减**),而不是 `I_x(a,b)`(递增)。
这一点在 `tests/audit2026.test.ts` 里已经有对应测试
("betainc increases with x instead of decreasing")。外层再来一个 `1 -`
把方向又翻了回来,于是两种数据集都得到"不显著"。

### 3. `incompleteBeta` 连分式抄错

`RMA.ts` 自带一份 t 分位数,底层是 Numerical Recipes 6.2C 的 `betacf`。
NR 的 `betacf` **每次迭代交替使用两个不同的 `aa` 形式**,这份移植把它们合并成
一个,并且分母写成了 `(a+m-1)(a+m)` 而非 NR 的 `(a-1+2m)(a+2m)`。
`tCDF` 因此错误,Newton 发散,t 分位数算出 ±1e14 量级;df > 100 时又静默退化成正态分位数。

`math/stats.ts` 里已有经 scipy 验证的 `qt`,两份实现本不该并存。

### 4. 组件数与格点形状未校验

`eigenshape` 的 `nc = nComponents ?? min(len, nVar)` 没有上限;`tpsWarpGrid` 的格点
固定是二维的,却接受三维拟合。两处都是"参数没校验 → 读到 undefined → NaN"。

## 修改

1. `morphometrics.ts`:删除 `eigh_local` / `eye_local`,`relativeWarps` 与 `allometry`
   改用 `math/linalg` 的 `eigh`。
2. `morphometrics.ts`:删除 `fCDF_local` / `betainc_local` / `lgamma_m`,
   `isometryPValue` 改用 `math/stats` 的 `pF`。
3. `RMA.ts`:删除 `tQuantile` / `tCDF` / `tPDF` / `normQuantile` / `incompleteBeta` /
   `logGamma` 共 6 个函数(约 140 行),`slopeCI` 改用 `math/stats` 的 `qt`。
4. `Eigenshape.ts`:`nc` 夹紧到 `[1, nVar]`。
5. `TPSAnalyzer.ts`:`tpsWarpGrid` 对三维拟合与退化格点尺寸明确报错。
6. `tpsKernel.ts`:`buildKernelMatrix` 的 `dim !== 2` 报错并指向 `buildKernelMatrix3D`。

合计删除约 190 行重复且未验证的数值实现,收敛为"一个量只有一份实现"。

## 验证

参照值全部来自 conda `dev` 的 **scipy 1.15.3 / numpy 1.26.4**,以及一份独立的
NumPy 块方程组求解,没有一处手算。

- 新增 `tests/morphometrics2026.test.ts`,14 条回归测试,测试名一律描述旧行为。
- `relativeWarps`:特征值、解释方差、累计解释方差与 `numpy.linalg.eigh` 逐项吻合
  (最大差 ~1e-14);特征向量与 `math/linalg.eigh` 的 `|<v, v'>| = 1 - 5.6e-16`。
- `allometry`:强异形数据 p < 1e-15(scipy `f.sf(67.2138, 16, 38) = 7.0353e-23`),
  等度量数据 p = 0.999357136(scipy 同值)。
- `rmaRegression`:CI 半宽 = `scipy.stats.t.ppf(0.975, 10) * slopeSE`,
  端点与 scipy 参考值吻合到 1e-10;`r` 与 `scipy.stats.pearsonr` 吻合到 1e-12。
- `eigenshape`:特征值与 numpy 吻合到 1e-10;请求 9 个组件时夹紧到 3 且无 NaN。
- 3D TPS:弯曲能量与独立 NumPy 块求解一致到 1e-9;二维格点路径逐点有限。
- 核矩阵:2D `r² ln r` 与 3D `-|r|` 都与按定义手算的矩阵一致。
- 门禁:`node --experimental-transform-types tests/test.mjs` **167 passed, 0 failed**;
  `python tools/structure_check.py` 174 文件 0 问题。
- 未跑 DevEco 构建:只动 `core/**` 与 `tests/**`。

## 其它

- 本轮再次印证了上一轮记下的教训:**任何"看起来不对"的结论,先假设是自己错了。**
  本轮我自己误判了一次 —— 复核 `allometry` 时先怀疑 `p = 1.0` 是我构造的数据不对,
  换了等度量数据仍是 0.9998,才回头确认是 p 值方向反了。
- `divideConfigurationIntoBlocks` 把 `d < 2` 和 `nLandmarks = cols / 2` 写死,
  对三维数据会静默取错列。该函数没有 `nDims` 参数,补参数属于接口变更,
  本轮未动;若 UI 将来开放三维分块,需先加参数再改这里。
- `tpsDeformation` 里 `Math.min(...srcX)` 同样是展开写法,地标数需超过引擎参数上限
  才会爆栈(几何形态学通常几十个地标),风险低,未改。
- `PartialGPA.computeBendingEnergy` 三维用 `K = +r`,而 `tpsKernel3D` 用 `-r`,
  两者符号约定不一致。`TPSAnalyzer` 的文档已声明三维核为 `-|r|`(使 E = wᵀKw ≥ 0),
  `PartialGPA` 那一处更像是遗漏而非有意选择,但它只影响半地标滑动的评分常数,
  不改变最优位置(评分是 `距离 + λ·能量`,整体符号会改变 λ 的相对权重)。
  本轮未改,留作下一轮带基准实现确认。
- **未审**:`models` + `controllers` + `utils` 1976 行、`ets/` UI 层 6533 行。
