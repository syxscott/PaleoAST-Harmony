# 全仓审查修复：p 值失效、输出静默损坏、可复现性

## 类型
缺陷修复

## 问题

一次全仓审查（182 文件 / 33k 行）发现 **15 处会产出错误结果或静默损坏输出的缺陷**。
基线检查当时是全绿的（78/78 单测通过，结构检查 176 文件 0 问题）——**这些缺陷全部存在于测试覆盖之外**。

审查方法：用 conda `dev` 环境的 numpy 1.26.4 / scipy 1.15.3 作权威基准逐函数对拍；用 TeX Live 的
`pdflatex` + `pdftotext` 真实编译并回读 LaTeX 产物。**下表每一个"旧值"都是实测输出，不是推断。**

> ⚠️ **受影响分析必须重跑**：下表左列的每一个数字都曾经是错的。若旧结果已进论文，需重算。

| 分析 | 旧值（实测） | 新值（与 scipy 一致） |
|---|---|---|
| **ANOVA** p 值 | `0.9999916939`，`significant: false` | `9.469964958e-07`，`significant: true` |
| **Kruskal-Wallis** p 值 | `0`（恒为 0） | `0.001930454136` |
| **Fitch 简约** treeLength | `0`（对任何输入恒为 0） | `2`（0/1/0/1 @ ((A,B),(C,D))） |
| **Fitch CI / RI** | 恒为 `1` | 随数据变化 |
| **cohortSurvivorship** 生存率 | 恒 `1`；起源/灭绝率恒 `0`；rateRatio 恒 `NaN` | `nSurv/nFB/nLB` 之比，如 `1/3` |
| **PCA**（经控制器） | 恒走相关矩阵，对话框的 covariance/correlation 无效 | 两者按选择生效 |
| **Mantel 检验** p 值 | 不可复现（`Math.random()`），可为 `0` | 种子化，`(cnt+1)/(nPerm+1) > 0` |
| **Poisson** 大 λ | λ=1000 → 均值 `742.9`（−25.7%） | 均值 ≈ λ |
| **LaTeX 标题/图表说明** | `\`→换行、`~`→重音、`^`→重音 | 正确字面输出 |
| **MatrixConverter** JSON 往返 | NaN / Inf → `0` | 原样保留 |
| **MatrixConverter.fromCSV** | 丢列 + 用 0 填充短行 | 保留最宽行 + NaN 填充 |
| **FigureHandler.toHTML** | caption 里的 `"` 提前闭合 alt 属性，`<script>` 原样注入 | 全部转义 |
| **erf / erfc** | erf(0.5)=0.9693（误差 86%） | 0.5204998778 |
| **chi2CDF** | -8.2e+27 | 0.9984345977 |
| **tCDF** | t² = df 时栈溢出崩溃 | 正常返回 |
| **fitOU** | 注释写 Newton-Raphson，实为最多跑 2 步的固定步长梯度下降 | Nelder-Mead，带收敛判据 |

---

## 根因

### 1. 不完全 Beta 函数的级数只覆盖小 x（ANOVA / Kruskal / 所有 p 值的共同根因）

`core/math/stats.ts::betaincRegularized` 把**小 x 的幂级数无条件套用**，且递推比写成
`(a + i - 1) * x / (i * (a + i))`——形状参数 `b` 在递推里完全缺席（正确为 `(i - b)`）。
结果**随 x 递减**，而 `I_x(a,b)` 必须递增到 1：

| x | 旧值 | scipy |
|---|---|---|
| 0.1 | 0.20939994 | 0.0047 |
| 0.5 | 0.08821477 | 0.9654 |
| 0.9 | 0.00001766 | ≈1 |

`pF()` 和 `pchisq()` 都经由它，于是 `pF(54.5, 2, 12)` 落进塌缩区 → ANOVA 报 p≈1。
`gammainc` 同样有第二处缺陷：连分式的收敛因子写成 `delta = d * h`（累加器自乘），
NR3 Eq. 6.2.14 要求 `del = d * c`；`pchisq` 因此在 x 较大时饱和到 1 → Kruskal 报 p=0。

**修复**：改用 NR3 Sec 6.4 的双分支形式（`x < (a+1)/(a+b+2)` 用连分式，否则反射到
`betacf(b, a, 1-x)`），并修正 `delta = d * c`。这两处修好后 ANOVA 与 Kruskal 的 p 值同时恢复。

> 注：NR3 的 `an = -i*(i-a)` 等价于 `i*(a-i)`，符号极易写反。本次先误改后自查纠正，
> 已在代码注释里注明，并用 `(s,x)=(2,3)` 的 `h = 0.44444 → Q = 0.19915` 作为交叉验证锚点。

### 2. `gammainc` 连分式的 `c` 初值取反（special.ts）

`core/math/special.ts` 里 `let c = 1e-30`，而 NR3 要求 `c = 1/FPMIN = 1e30`。
Lentz 递推第一步就做 `an / c`，`c` 小 60 个数量级直接发散。
同时 `a_n = -n*(a-n)` 是 NR 的 `-n*(n-a)` 的**相反数**。

### 3. `erf` / `erfc` 系数张冠李戴 + 恒等式用反

代码注释自称 "Cody's rational approximation (Cephes, max error ~1e-15)"，并写着
`erf(1.0) = 0.8427007929497149 (matches scipy within 1e-15)`——**这句验证声明是假的**，
实际返回 0.97897。函数体其实是 Abramowitz & Stegun 7.1.26 的系数，但把核常数
`0.3275911` 写进了多项式的 `a1` 位置（应为 `0.254829592`），分母也写成 `1 + 0.5*x²`
（应为 `1 + 0.3275911*x`），最后还组装成 `x*p*exp(-x²)` 而非 `1 - p*exp(-x²)`。

**修复**：删掉那段系数，改用精确恒等式复用同文件已验证的 `gammainc`：
`erf(x) = P(1/2, x²)`、`erfc(x) = Q(1/2, x²)`。既满足 code-style §1.4「同一物理量只保留一份实现」，
又天然具备 erfc 所需的尾部精度。

### 4. `betainc` 递归终止条件（special.ts）

用 `<` 而非 `<=` 对 `(a+1)/(a+b+2)` 判分支，当 x 恰好落在该交叉点时，换参后的递归调用再次落进
同一分支，来回弹跳 → `betainc(0.5,0.5,0.5)` 与 `tCDF(1,1)` 均栈溢出。
`morphometrics.ts:839` 导入的正是这个 `tCDF`。**修复**：两个分支直接求值，去掉递归。

### 5. Fitch 打分位置错了（phylogenetics.ts，2 处）

`computeParsimonyScore` 与 `fitchParsimony` 都在**上行遍历**里比较"子集 ∩ 父集"来计步。
但 `fitchDown` 构造父集时，取交集则父集是每个子集的**子集**，取并集则是**超集**——
两种情况父集都必然包含子集，所以 `overlap` 恒为真，**`treeLength` 对任何输入都返回 0**。
`computeConsistencyIndex` / `computeRetentionIndex` 的 `treeLength === 0 → return 1`
守卫随即把 CI 和 RI 永久钉在 1。

**修复**：在向下遍历里、于交集为空（发生并集）时计一步——这才是 Fitch 唯一计费的事件。

### 6. `pca` 的 `scale:boolean` 槽位被塞进字符串

`pca` 第 3 参是 `scale: boolean`，第 4 参才是 `method`。`StatisticsController.runPCA` 写的是
`pca(data, nc, method as any)`，非空字符串恒真 ⇒ `scale` 永久为真 ⇒ 控制器路径的 PCA
永远是相关矩阵，对话框的 covariance/correlation 选择完全无效。

### 7. `cohortSurvivorship` 两处缺陷叠加

`nTotal` 写成 `nSurv`（Python 原版是 `n_fb + n_lb + n_surv`）；
**且** 分类判据里的 `o >= tStart && o < tEnd` 在 `tStart > tEnd` 时**永不成立**，
`tStart <= L && L < tEnd` 同理——两个边界穿越类恒为 0。Python 用的是相反的时间朝向
（`t_start < t_end`），移植时只调换了边界值而没调运算符。

### 8. 静默改写数据

- `MatrixConverter.toJSON` 用 `JSON.stringify`，NaN/Inf 被写成 `null`；`fromJSON` 再用
  `new Float64Array([null])` 读成 `0`。**"未测到"变成"测到零"**，会污染下游每一个均值与回归。
- `fromCSV` 用首行宽度截断长行、用 `0` 补齐短行（丢数据 + 凭空造数）。
- `FigureHandler.toHTML` 原样插值 `path` / `caption`。

### 9. LaTeX 转义三份实现、两份错误

`ReportBuilder._escapeLaTeX` 与 `FigureHandler._escape` 用
`s.replace(/[\\$%&_{}#^~]/g, c => '\\'+c)`。`\\` 是**换行**、`\^` 和 `\~` 是**重音宏**，
而 LaTeX 编译零报错。pdflatex + pdftotext 实测：`tilde~here` 渲染成 `tildeh̃ere`，
`caret^up` 渲染成 `caretûp`，`back\slash` 被断成两行。

**修复**：`LatexCompiler.escapeLatex` 本来就是对的（用 `\textbackslash{}` /
`\textasciitilde{}` / `\textasciicircum{}`），现已导出并让另外两处复用它——三份收敛为一份。

### 10. 可复现性

- `mantelTest` 是全 `core/` 树**唯一**残留的 `Math.random()`（999 次置换每次都不同），
  且 `pValue = cnt/nPerm` 可为 0。改用种子 PRNG（新增 `rngSeed = 42` 末位参数）+
  Phipson & Smyth 的 `(cnt+1)/(nPerm+1)`，与项目在 `phyloANOVA` 里的既有做法一致。
- `poisson` 用 Knuth 原式，但 `exp(-λ)` 在 λ > 745.13 下溢为 0，L 变 0 后循环跑到乘积也
  下溢为止，返回一个与 λ 无关的值。λ=1000 时 300 次抽样均值 742.9（−25.7%）。
  `simulateNeutral` 每步请求 `specRate * N * dt`，N 到约 75000 就会触发。
  改为把 λ 折半到 10 以下、用 Knuth 抽 m 次再求和（精确）。
  同时删掉 `macroevolution.ts` 里逐字重复的那份副本——正是 code-style §1.4 禁止的重复实现。

---

## 修复

| 文件 | 改动 |
|---|---|
| `core/math/stats.ts` | `betaincRegularized` 改 NR3 双分支 + 新增 `betacf`；`gammainc` 收敛因子 `d*h → d*c` |
| `core/math/special.ts` | `gammainc` 的 `c` 初值与 `a_n` 符号；`betainc` 去递归；`erf`/`erfc` 改用 `gammainc` 恒等式，删除 `erfcCore` |
| `core/math/random.ts` | `poisson` 大 λ 改精确分解，移除 `rngSeed` 以对齐既有签名 |
| `core/analysis/phylogenetics/phylogenetics.ts` | 两处 Fitch 打分改为在并集处计步 |
| `core/analysis/macroevolution/macroevolution.ts` | `cohortSurvivorship` 的 `nTotal` 与分类判据；`fitOU` 改 Nelder-Mead；删除重复的 `poisson_sim` |
| `core/controllers/StatisticsController.ts` | `runPCA` 显式传 `scale` 与 `method` 两个位置 |
| `core/utils/MatrixOps.ts` | `mantelTest` 种子化 + Phipson 校正，展开为可读实现 |
| `core/reporting/{LatexCompiler,ReportBuilder,FigureHandler}.ts` | `escapeLatex` 导出并成为唯一实现；`FigureHandler.toHTML` 转义 |
| `core/reporting/MatrixConverter.ts` | JSON 用显式 token 承载非有限值；`fromCSV` 取最宽行 + NaN 填充 |
| `core/models/StateManager.ts` | `clearData` 补清 `_cmdUndo` / `_cmdRedo` |
| `core/config/i18n/translations_{en,zh}.ts` | EN 补齐 46 个 ZH 独有的键；ZH 补译 7 个颜色名与 2 个形状名 |
| `tests/audit2026.test.ts`（新增） | 29 条回归测试 |
| `tests/run.ts` | 挂载新测试文件 |

---

## 验证

**新增 29 条回归测试**，测试名一律描述**旧行为**，例如
`ANOVA p-value is no longer ~1.0 with significant=false for separated groups`、
`Fitch parsimony no longer returns treeLength 0 for every input`、
`chi2CDF no longer returns -8.2e+27 for a small chi-square`。

```
node --experimental-transform-types tests/test.mjs   # 107 passed, 0 failed（原 78 + 新 29）
python tools/structure_check.py                      # checked 176 files, 0 with problems
node test/device/run.mjs                             # 19 passed, 0 failed
```

另做独立 scipy 对拍（154 项 special.ts + 46 项 stats.ts 函数级）全部一致，容差 1e-10；
其中 Kruskal p 与 scipy 相差 2.3e-16，即 scipy 自身打印精度。LaTeX 转义改动经
`pdflatex` 重新编译 + `pdftotext` 回读确认渲染正确。

---

## 风险与未覆盖

- **以下疑点经实测被排除，不应改动**：LOWESS（与独立实现的参考局部线性版逐位一致，
  线性数据上误差 7.8e-14；此前观察到的二次曲线偏差是局部线性法的固有性质）、
  Bootstrap（seed 确实生效）、层次聚类含 Ward（与 scipy 逐位一致）、
  `TableGenerator.latex`（表头表体列数一致、转义正确）、
  `stats.pt`/`qt`、Welch t 检验、Mann-Whitney U、`lgamma`、`normCDF`（1.5e-7 量级符合其声明）。
- **本轮未深入**：`cpp/napi/matrix_ops.cpp` 的 `Clustering` 内核（原生路径当前无调用方）、
  `ets/database/HistoryRepository.ets` 的 ResultSet 迭代、`core/utils/{Decorators,Transformations}.ts`。
- **仍存在但不在本轮范围**：`entry/src/main/chart/`（1104 行）完全未接线；
  `core/reporting`、`core/plugins`、`core/state_machine`、`core/hpc` 约 2700 行无运行时入口；
  `PreferenceManager.set` 零调用点（README 宣称的设置持久化从未发生）；
  11 处对话框参数被 `runDialogAnalysisCore` 丢弃（其中 6 处控制器本就接受该参数，
  且这些无效参数仍被写进 RDB 历史与导出脚本）。
- `normCDF` 仍是 A&S 7.1.26 近似（绝对误差 ≤ 1.5e-7）。若论文 p 值需要更高精度，
  应改用已修好的 `gammainc`/`betainc` 走正态—不完全 Beta 通路。
- 未运行 DevEco 构建（AGENTS.md 规定非必要不跑）。改动均为算法/数据/报告层，
  未触碰 ArkUI 组件、路由、构建配置或全局样式。
