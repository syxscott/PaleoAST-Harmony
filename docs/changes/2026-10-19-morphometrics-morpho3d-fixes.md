# morphometrics / morpho3d 第二轮审查:13 处缺陷,其中 4 处让叠合与检验完全失效

## 类型

缺陷修复 / 数值变更

## 问题

`core/analysis/morphometrics/`(6 个文件)与 `core/analysis/morpho3d/`(2 个文件)共 13 处缺陷:
**4 处让形态学叠合本身失效**(标本根本没叠上去 / 叠到错的地方),3 处让统计量静默算错,
3 处崩溃或输出垃圾结果,3 处是接口与全局状态约定不一致。全部已由审查 agent 用真实模块 + NumPy 对拍复现过。

| # | 缺陷 | 旧行为(实测) | 新行为 |
|---|---|---|---|
| 1 | `gpa` 把 Kabsch 旋转**反向**应用 | `max\|Xc@R − Yc\| = 1.5626632426918086`;刚性对(旋转 0.85 rad + 平移)Procrustes 距离 `[0.2370, 0.2370]`、`converged: false`、跑满 100 次迭代 | 残差 `2.5e-16`;距离 `4.06e-16 / 2.66e-16`、`converged: true`、**3 次迭代**收敛(sse `2.36e-31`) |
| 2 | `PartialGPA.rotateConfig` 同一处转置错误(逐字相同的公式) | `gpaAlign(rigid pair)` → `sse = 0.14366`、`converged: false` | `sse = 2.36e-31`、`converged: true` |
| 3 | `RotationMatrix.procrustes` 算 `V·U` 而非 `V·Uᵀ` | 刚体一致的 3D 点对:`max\|apply(R, A) − B\| = 0.759`(审查在另一组点上测得 `7.7e-1`),应为 0 | `4.4e-16`;`max\|R − R_true\| = 5.6e-16` |
| 4 | `divideConfigurationIntoBlocks` 调用**不存在的** `_selectColumns` | `ReferenceError: _selectColumns is not defined` —— **默认模式必崩**,UI 快捷操作 "Centroid Configuration Blocks"(`Index.ets:849`)100% 抛异常 | 正常返回;4 地标(8 列)时块 A = 列 `[0,1,4,5]`、块 B = `[2,3,6,7]` |
| 5 | `allometry` 遇零尺寸标本静默出 NaN 与 p=1 | `logCentroidSizes = [-0.2027, 0.4904, -Infinity]`、`rSquared = NaN`、`F = 0`、`isometryPValue = 1.0`(等度量检验"没有异形性",但回归根本没算出来) | 抛可读错误 `allometry: specimen 2 has centroid size 0 (all its landmarks coincide)…` |
| 6 | `tpsDeformation` 遇奇异 TPS 系统静默出垃圾网格 | 4 个**共线**源地标 → 形变网格**所有点 x = −1.0000**(整条塌成一条线) | 抛 `tpsDeformation: singular TPS block system …` |
| 6b | `tpsDeformation` 静默截断 3D 地标 | 3D 输入被当作 2D 处理(z 坐标被丢弃),网格描述的是另一个形变 | 抛 `tpsDeformation only supports 2D landmarks …` |
| 7 | morpho3d `_projectOntoCurve` 混用两种参数化 | 半地标投影回曲线:x=0.5 → **0.0000**、x=1.5 → 0.2500、x=2.5 → 0.5000、x=3.5 → 0.7500(期望 0.5/1.5/2.5/3.5) | 0.5 / 1.5 / 2.5 / 3.5(折线真实最近点) |
| 8 | `slideLandmarks`(MEC)权重数组维度错位 | 半地标 ≥4 个 → `TypeError: Cannot read properties of undefined (reading '0')`;只有 3 个时不崩但 `finalBendingEnergy` 恒为 0(能量取自错位的坐标分量) | 不抛错;能量取自正确分量且有限 |
| 9 | `plsIntegration.rvCoefficient` 不是 Escoufier RV | 两块完全相同(RV 定义值应为 1)→ `0.02040816326530612 = 1/49 = 1/(n−1)²`(n=8);n=50 时小 2401 倍 | `1.0`(与 `integrationIndex` 互相矛盾的状态消失) |
| 10 | `PartialGPA` 的 3D 核符号 `+r`,而 `tpsKernel3D`/`TPSAnalyzer` 用 `−\|r\|` | 两套约定并存,3D 半地标滑动评分里能量符号相反 | 统一为 `−\|r\|`;`PartialGPA.computeBendingEnergy` 与 `TPSAnalyzer.tpsAnalyze` 同数据相差 `8.7e-19` |
| 11 | `plsIntegration` 重置全局 PRNG 状态 | 跑过 PLS 后,`divideConfigurationIntoBlocks(…,'random')` 的置换结果取决于"之前是否跑过 PLS",与该函数自己承诺的"给了种子就不动全局 PRNG 状态"矛盾 | 改用 `createSeededRNG(rngSeed)` 独立流,全局状态不受影响 |
| 12 | `gpa` 入参 `nComponents` 与出参 `nComponents` 同名不同义 | `gpa(data,100,1e-8,undefined,undefined,6)` 被解释为"每地标 6 维",`_detSmall` 只算 6×6 矩阵左上 3×3 的行列式 → 反射修正失效 | 抛 `nDims must be 2 or 3 (dimensions per landmark), got 6`;并在 docstring 写明入参/出参两种含义 |

## 根因

1. **Kabsch 约定搞反(第 1、2 条)**。`_findRotation` / `PartialGPA.findRotation` 从 SVD 得到的是
   **列向量**旋转 `p' = R·p`(R = V·Uᵀ),而地标是**行向量**,叠加要 `cfg @ Rᵀ`。
   两份 docstring 写的都是 `cfg @ Rᵀ`(**都说对了**),错的是两份实现:`morphometrics.ts` 的
   `p[b] += cfg[i][a] * R[a][b]` 与 `PartialGPA.ts` 的同一行,算的都是 `cfg @ R`。
   纯平移的对照组不触发旋转,所以旧单测唯一覆盖的场景完全看不到这个 bug。
2. **删定义、留调用点(第 4 条)**。commit `3a78612`("删掉第三份未验证的特征分解")把
   `_selectColumns` 的**定义**(连同其注释)删掉了,却保留了 `morphometrics.ts` 里的**两个调用点**。
   TypeScript 会对这两处报 **TS2304(名称未定义)** —— 说明**这条路径从未被 build 过**。
   现有门禁也抓不到:`tools/structure_check.py` 只查括号配平与重复导出,不查未定义标识符;
   单测从未覆盖 `divideConfigurationIntoBlocks`。
3. **下标写错,但矩阵"看起来正常"(第 3 条)**。`Quaternion.ts` 累加的是 `V[i][k]·U[k][j]` = `V·U`,
   注释要求的是 `V@Uᵀ` = `Σ_k V[i][k]·U[j][k]`。两者都正交、det=+1,所以旋转矩阵肉眼看上去完全健康,
   只有叠合残差能暴露它。私有 `_jacobi3x3` / `_jacobiSVD3x3` 本身是对的,与 NumPy 逐项吻合
   (`max|USVᵀ−H| = 1.0e-15`),只需改一行下标。
4. **NaN 穿过了大小守卫(第 5 条)**。`s = 0` → `Math.log(0) = -Infinity` 进入设计矩阵 → `XᵀX` 含 ±Infinity
   → Gauss-Jordan 消元产生 `Infinity − Infinity = NaN` → 枢轴守卫写成 `if (Math.abs(pivot) < 1e-15) throw`,
   而 **`NaN < 1e-15` 恒为 false**,抛错分支永远不触发,于是 NaN 的 R² 和 p=1 被当成正常结果返回。
5. **奇异系统被"跳过"而不是报错(第 6 条)**。`morphometrics.ts` 的 `solveLinearSystem` 对小枢轴
   `continue`(跳过该列继续消元),把奇异系统解成一个有限的垃圾解;同一项目的另两份实现
   (`PartialGPA._solveLinearSystem`、`TPSAnalyzer._solveBlock`)遇到奇异都会抛错 —— 只有这一份是静默的。
6. **两种量纲在一个公式里相除(第 7 条)**。`_findNearestCurvePoint` 返回 `t = idx/(len−1)`(**索引比例**),
   `_projectOntoCurve` 却拿它与**弦长参数** `tParams[idx]` 比较并求 `u`,`u` 可为负 → 线性外插到段外。
7. **权重布局与消费者的约定不一致(第 8 条)**。`Sliding._estimateTPSWeights` 返回 **3×n**(dim-major),
   而 `tpsKernel.bendingEnergy` 按 `weights[j][c]` 索引,期望 **n×dim**;n ≥ 4 时索引越界。
8. **三个协方差块缩放不一致(第 9 条)**。`C = AᵀB/(n−1)` 缩放了,`Saa = AᵀA`、`Sbb = BᵀB` 没缩放,
   分子分母因此差 (n−1)²。审阅建议的"白化"写法(`S_aa^{−1/2} S_ab S_bb^{−1/2}`)算的是平方典范相关之和,
   对两块相同会给出变量数而不是 1,**不是 RV 的定义**;采用的是经典 Escoufier RV
   (`RV = tr(S_ab S_ba) / sqrt(tr(S_aa²)·tr(S_bb²))`,三块同尺度),与同项目
   `analysis/statistics/statistics.ts` 的 `plsAnalysis` 公式一致。
9. **同一份核抄了两遍(第 10 条)**。`PartialGPA.computeBendingEnergy` 自己算 3D 核,写成 `+r`,
   与 `tpsKernel3D` 的 `−|r|` 不一致(不影响最优位置,但翻转 λ 与能量的相对权重)。

## 修复

改了 7 个文件:

| 文件 | 关键决策 |
|---|---|
| `core/analysis/morphometrics/morphometrics.ts` | `_rotateConfig` 改用 `Rᵀ`;恢复 `_selectColumns`;`divideConfigurationIntoBlocks` 改用 **coordinate-major**;`allometry` 入口拒绝零尺寸标本、枢轴守卫改 `!Number.isFinite(pivot) \|\| |pivot|<1e-15`;`tpsDeformation` 奇异/3D/退化格点一律抛错;`resolveShape` 校验 nDims ∈ {2,3} |
| `core/analysis/morphometrics/PartialGPA.ts` | `rotateConfig` 改用 `Rᵀ`;3D 核 `+r` → `−\|r\|` |
| `core/analysis/morphometrics/Integration.ts` | RV 系数三块同尺度;置换改用 `createSeededRNG` |
| `core/analysis/morpho3d/Quaternion.ts` | `procrustes` 累加改为 `V[i][k]·U[j][k]`(= `V·Uᵀ`) |
| `core/analysis/morpho3d/Sliding.ts` | 投影统一用弦长参数并取折线真实最近点;权重改 n×dim(两处加断言);维度按数据取 2/3(2D 输入原先全程 NaN,半地标静默塌到曲线首点) |
| `tests/morphometrics2026.test.ts` | 改一条既有断言(见"验证") |
| `tests/fixMorpho2026.test.ts` | 新建,18 条回归测试 |

**coordinate-major 布局的理由**:`gpa` 的输出、`allometry`、`efa` 读的都是 **coordinate-major**
(`[x₀..x_k, y₀..y_k(, z₀..z_k)]`,地标 j 占第 j 列与第 nLM+j 列)。`divideConfigurationIntoBlocks` 的
入参文档写的就是 "aligned data"(即 `gpa` 的输出),旧代码却按 **landmark-major**(`lm*2 + d`)取列,
在 coordinate-major 数据上取到的是"后半段地标的 x 坐标被当成了它们的 y 坐标"。
既然旧实现在任何模式下都直接抛 `ReferenceError`,不存在需要保持的既有行为,因此统一到模块约定。

**副作用(待用户拍板)**:在 coordinate-major 布局下,`'size_matched'` 分支(把扁平列在中点切开)
切出来的是 **"x 坐标块 vs y 坐标块",不是地标切分**。该分支的旧语义是"扁平化地标列的中点切分"
(在 landmark-major 下恰好等价于前后半地标),现已不是。是否要把 `'size_matched'` 改成按地标切分
(或直接改名/改文档),是一个语义决策,留给用户。

## 验证

参照值全部来自 conda `dev` 的 **numpy 2.2.6 / scipy 1.15.3**,以及独立写的 NumPy 实现
(独立 GPA 迭代循环、独立 Kabsch、独立 RV 计算、独立折线最近点),没有一处手算。

- **2D Kabsch**:NumPy `max|Xc@R − Yc|` = `2.5066754227864863e-16`(旧代码路径 `cfg@R` 为 `1.5626632426918086`)。
  独立 NumPy GPA 循环对同一组刚性配置:3 次迭代收敛、sse `2.26e-31`、叠合残差(逐坐标)
  `1.3e-16 … 3.9e-16`;本模块给出 Procrustes 距离 `4.06e-16 / 2.66e-16`、sse `2.36e-31`,与之一致。
- **2D `PartialGPA.gpaAlign`**:刚性对 sse `2.3573382519299767e-31`、`converged: true`。
- **3D `RotationMatrix.procrustes`**:`max|apply(R, A) − B| = 4.440892098500626e-16`(`max|R − R_true| = 5.6e-16`);
  NumPy `R = V·Uᵀ` 的残差 `2.2e-16`、`max|R − R_true| = 3.3e-16`;旧公式 `V·U` 的残差 `0.759`。
- **`divideConfigurationIntoBlocks`**:默认模式与 `'random'` 模式均正常返回,块列 = `[0,1,4,5]` / `[2,3,6,7]`。
- **`allometry`**:零尺寸标本 → 抛错并指明标本序号;正常数据 R² / p 不受影响(既有 scipy 对拍用例仍绿)。
- **`tpsDeformation`**:共线地标 → 抛 `singular`;3D → 抛 `only supports 2D`;正常四边形格点 25 个、能量 0.003607、全有限。
- **Sliding 投影**:x = 0.5 / 1.5 / 2.5 / 3.5 → 投影回 0.5 / 1.5 / 2.5 / 3.5(与 NumPy 折线最近点一致)。
- **RV**:`plsIntegration(A, A).rvCoefficient = 1.0`;NumPy 同式 = `1.0`,旧缩放 = `0.020408163265306117`。
- **3D 核符号统一**:`PartialGPA.computeBendingEnergy` = `0.00538866647623621`,
  `TPSAnalyzer.tpsAnalyze` = `0.0053886664762362105`,差 `8.7e-19`。

### 新增测试

`tests/fixMorpho2026.test.ts`(**18 条**,测试名一律描述旧行为):

```
audit: the Kabsch rotation was applied transposed, so no specimen ever stacked
  › gpa superimposes a rigid pair (rotation + translation) exactly and converges
  › gpa still superimposes a pure translation (the case the old test covered)
  › PartialGPA.gpaAlign superimposes a rigid pair (sse -> 0)
  › PartialGPA.gpaAlign keeps the unrotated case exact
audit: the 3D Procrustes rotation was V·U instead of V·Uᵀ
  › RotationMatrix.procrustes superimposes a rigid 3D pair exactly
audit: the block division called a helper that no longer existed
  › divideConfigurationIntoBlocks no longer throws ReferenceError
  › the random division also works and is reproducible
audit: a zero-size specimen made the isometry test report p = 1
  › allometry refuses a specimen whose landmarks all coincide
audit: a singular TPS system produced a garbage deformation grid
  › tpsDeformation refuses collinear source landmarks
  › tpsDeformation still warps a well-conditioned configuration
  › tpsDeformation refuses 3D landmarks instead of truncating them
audit: the semilandmark weights were dim-major while bendingEnergy wanted n x dim
  › slideLandmarks no longer throws a TypeError with four semi-landmarks
  › a semi-landmark is projected onto the point of the curve nearest to it
audit: the Escoufier RV coefficient was off by a factor of (n-1)^2
  › two identical blocks score RV = 1
  › unrelated blocks score RV well below 1
audit: the 3D kernel was still the 2D one
  › the 2D builder refuses dim = 3 and points at the 3D builder
  › the 2D builder gives r^2 log r and the 3D builder gives -|r|
audit: gpa accepted a "nComponents" argument that meant something else entirely
  › a dimensions-per-landmark value other than 2 or 3 is refused
```

### 改过的既有断言

`tests/morphometrics2026.test.ts` 的 **'both builders still produce the right kernel on the right
dimension'**(此前是全仓唯一的失败用例):期望值从"全 0"改为**真实的 r²ln r 矩阵**
(`[0,0,0, 0,0,ln2, 0,ln2,0]`)。原因是**旧断言自己算错了、实现是对的**:
`(1,0)` 与 `(0,1)` 两点的距离是 √2,`r²ln r = 2·ln√2 = ln2 = 0.6931`,而旧断言只考虑了距离为 1
(此时 `r²ln r = 0`)就断言整个矩阵为零。`buildKernelMatrix` 对 `dim = 3` 抛错并指向
`buildKernelMatrix3D` 的行为本来就是对的(上一轮已修),未作改动。

### 门禁

- `node --experimental-transform-types tests/test.mjs`:**我负责的 18 条新用例 + 上述既有失败断言全部转绿**。
  仓库整体 288 passed / 7 failed(295 total)。7 条失败全部落在**其它 agent 的范围**:
  `core/math/special.ts` 的 `pnorm`/`pchisq` 未定义(并发编辑中的瞬时失败)、`statistics` 的
  Matrix 元素广播、Anderson-Darling、`plsAnalysis` 的 `covarianceExplained`、Mann-Whitney z。
  (并发 agent 收尾后失败数会继续变化;我这一块始终 0 失败。)
- `conda run -n dev python tools/structure_check.py`:**0 problems**(本文件加入后共检查 178 个文件;
  计数随其它 agent 的变更记录增加)。
- 未跑 DevEco 构建:仓库根无 `tsconfig.json`、环境无 `tsc`,且本轮只动 `core/**` 与 `tests/**`;
  ArkTS 兼容性上避开了 `as const` 等受限语法。

### 对用户已有结果的影响

这是**数值变更**:任何用本项目算过 GPA / Partial GPA / 3D Procrustes / 半地标滑动 / 形态学整合 RV
的旧结果都**需要重跑**(旋转方向错了,叠合坐标是错的)。此前基于这些结果写入论文的结论需要重新核对。

## 风险

1. **`gpa` 结果字段 `nComponents` 改名会动公开 API**:入参 `nComponents` 是 `nDims` 的别名(每地标维数),
   出参 `GPAResult.nComponents` 却是每标本坐标总数,同名反义。本轮只做了**校验 + 文档说明**,
   没有改名;目前**没有任何 UI 代码读取 `GPAResult.nComponents`**,改名风险低,但属公开 API 变更,需用户点头。
2. **`PartialGPA.computeLocalBendingEnergy` 仍恒用 2D 核**(r²ln r),3D 输入时与
   `computeBendingEnergy`(已统一为 `−|r|`)不一致;不在本轮范围内。
3. **3D 核存在两套约定**:morphometrics 一侧用 `−|r|`(使 `E = wᵀKw ≥ 0`),
   morpho3d 的 `TPS3D` / `Sliding._tpsBendingEnergy3D` 用 `+r` 并对二次型取绝对值。
   本轮只统一了 `PartialGPA`,遗留的 morpho3d 一侧未动。
4. **morpho3d MEC 的"梯度"是粗略代理**(`k_ij/r · dU/dr · Δ`,量级极大),半地标会一路滑到曲线端点。
   属既有行为,本轮未改;投影修好后至少不再被丢到曲线的无关位置。
5. **`'size_matched'` 在 coordinate-major 布局下是"x 块 vs y 块"**,不是地标切分(见"修复")——
   待用户拍板的语义问题。
6. **`divideConfigurationIntoBlocks` 的 3D 仍不支持**(`nLandmarks = cols/2` 写死),
   已在 `docs/changes/2026-09-27-morphometrics-eigensolver-and-tests.md` 记为待办,本轮未动。
7. **`docs/dead-code.md:39-41` 的一条判断有误,已更正**:该处原写两份 Kabsch docstring
   "措辞不同、读注释会得出错误结论";实测**两份 docstring 都写 `cfg @ Rᵀ`,都说对了,错的是两份实现**。
   该更正已于 2026-10-19 由 lead 写入 `docs/dead-code.md`(本文件未改动该文档)。
