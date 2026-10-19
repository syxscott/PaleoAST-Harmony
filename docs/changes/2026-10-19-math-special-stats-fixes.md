# 数学库尾部数值:卡方/t 分位数在尾部发散、上尾 p 值塌成精确 0

## 类型
缺陷修复 / 数值变更

## 问题

`entry/src/main/core/math/special.ts` 与 `entry/src/main/core/math/stats.ts`
复审(2026-10-19)发现 8 处数值缺陷。这两个文件是全仓 t 检验 / ANOVA /
卡方检验 / 正态性检验 / 系统发育检验的公共底座,**每一处都会把"看起来合理"
的错误数字写进论文**。

| # | 位置 | 旧行为 | 新行为 |
|---|---|---|---|
| 1 | `special.erfc` | 用 `1 - gammainc(0.5, x²)` 求补数,尾部精度全丢:`erfc(8)` = **0**(真值 1.12e-29) | 改用新增的 `gammaincc(0.5, x²)`(连分式直接算 Q),`erfc(8)` = 1.1224297172982905e-29 |
| 2 | `special.chi2PPF` | 尾部发散:`chi2PPF(0.05, 5)` = **3.759944291918185e+08**;`chi2PPF(0.001, 30)` = **658.1968279326461**;`chi2PPF(1e-12, 30)` = **0.1**;`chi2PPF(1e-12, 1)` = **1e-06** | 1.1454762260618159 / 11.587951045644992 / 2.179273186559254 / 1.570796326794909e-24 |
| 3 | `special.tPPF` | `tPPF(1e-12, 1)` = **−7442023.952299317** | −318309886183.79016 |
| 4 | `special.tPDF` | `gamma(df/2)` 在 df > 170 溢出 → `tPDF(9, 1000)` = **NaN** | 改走 log-gamma,df > 170 不再溢出 |
| 5 | `stats.lgamma` | 反射公式漏了绝对值 → `lgamma(-0.5)` = **NaN**(`lgamma(-1.5)` 恰好因 `sin(−1.5π) = +1` 而正常,所以缺陷只在负轴的一段暴露) | 1.265512123484647,并与 `special.lgamma` 对齐(负整数返回 ∞) |
| 6 | `stats.pnorm` | A&S 7.1.26 有理逼近,误差最大 1.5e-07;`pnorm(-8)` = 6.106226635438361e-16(偏 1.8%) | 改 `½·erfc(−z/√2)`,`pnorm(-8)` = 6.220960574271834e-16 |
| 7 | `stats.qchisq` / `stats.qt` | 迭代上限耗尽(或密度下溢)后**静默返回最后一次迭代值**,调用方无从知道没收敛 | 增加收敛判定,不收敛抛可解释错误 |
| 8 | `stats` 的上尾入口 | p 值尾部塌成精确 0:`2*(1 - pt(9, 1000))` = **0**(scipy 同式也是 0),真值 1.11e-18 | 新增 4 个数值稳定的上尾函数 `ptUpper` / `pFUpper` / `pchisqUpper` / `pnormUpper`(语义均为「P(X > x)」) |

## 根因

1. **分位数初值选错,且没有收敛检查**(`chi2PPF` / `tPPF`)。
   `chi2PPF` 的初值是 `k + sqrt(2k)·normPPF(p)`,小 k 或小 p 时**为负**;
   随后的 `if (x <= 0) x = 0.1` 把迭代拉进 Newton 死区,而
   `if (Math.abs(fp) < 1e-15) break;` 会**直接跳出并返回当前 x** ——
   没有"是否收敛"的判据,于是 0.1 被当成答案交出去。
   `tPPF` 是同一个病:`chi2PPF` 跑在 `tCDF(x) - p` 上,而 `tCDF` 是
   `1 - ½·I_x(df/2, ½)`,**尾部饱和到 1**,残差 `tCDF(x) - p` 丢光有效位;
   `|f'| < 1e-15 → break` 同样把"没走到"当成"走到了"。
   两处都是静默算错:返回一个量级完全错误、但看起来仍是有限数的分位数。
2. **`erfc` 用减法求补数**。`gammainc` 在连分式分支返回 `1 - f·exp(...)`,
   于是 `erfc = 1 - (1 - q) = q`,两次抵消;尾部低于 ~1e-16 后有效位全部丢失,
   `erfc(8)` 精确返回 0。
3. **`stats.lgamma` 的反射公式漏了绝对值**。`Math.log(Math.PI / Math.sin(Math.PI * z))`,
   z ∈ (−1, 0) 时 sin 为负,`log(负数)` = NaN。`special.lgamma` 一直写的是
   `Math.abs(sinTerm)` —— **同一个量存在两份实现且已经漂移**(code-style 1.4)。
4. **`stats.pnorm` 用的是 A&S 7.1.26 近似**。这不是抵消问题而是精度问题:
   该逼近的最大误差 1.5e-07,`pnorm(-8)` 偏 1.8%。
5. **`stats.qchisq` / `qt` 的循环没有收敛判据**。退出条件只有
   `|step| < tol·max(1, x)`;`if (fp < 1e-300) break;` 也会静默退出。
   两条路径都把最后一次迭代值当成答案返回。
6. **CDF 饱和 + `1 - x` 抵消**。t / F / χ² / 正态的 CDF 在尾部都饱和到 1,
   而 `1 - x` 的分辨率只有 ~1e-16,所以任何 `1 - CDF(...)` 形式的 p 值
   在 p < 1e-16 时**必然**是 0。这不是某个调用点的写法问题,是缺一个
   「直接算上尾」的入口。

## 修复

改动文件(只有这两个,外加一个新的测试文件):

- `entry/src/main/core/math/special.ts`
  - 新增导出 `gammaincc(a, x)`:Q(a,x) 由连分式**直接**算出,不再 `1 - P`。
    `gammainc` 相应拆成 `gammaincSeries` / `gammaincCF`,**数值行为不变**;
    `erfc` 改用 `gammaincc`。
  - 新增内部对数空间求值器 `logGammaLower` / `logGammaUpper` / `logBetaI`:
    补数所需的 `log(1 - x)` 由调用方一并传入,避免 `1 - x` 抵消;
    `logBetaI` 收 `logX`/`logXc` 两个对数,连分式参数小到 1e-600 也算得出。
  - 新增内部 `solveMonotone`(括号扩张 + Illinois 伪位 + 二分兜底):
    搜索变量是 `w = log x`,所以 1.6e-24 这种分位数直接可达;
    **不收敛时抛可解释错误**,绝不返回最后一次迭代值。
  - `chi2PPF`:Wilson–Hilferty 初值(与 `stats.qchisq` 同一套);WH 退化
    (基底 ≤ 0.1,即小 df 或极小尾)时改用小 x 渐近
    `x ≈ 2·(tail·a·Γ(a))^{1/a}`;在 `w = log x` 上对 `log P(a, x/2)`(下尾)
    或 `log Q(a, x/2)`(上尾)求根;参数非法(df ≤ 0、p 为 NaN)抛错。
  - `tPPF`:直接解上尾 `P(T > t) = ½·I_{df/(df+t²)}(df/2, ½)`,
    根取 `log(min(p, 1-p))`(`1 - p` 在 p ∈ [0.5, 1] 上由 Sterbenz 引理精确,
    尾概率保持满相对精度);全程对数,`log(df + y²)` 用 log-sum-exp,
    `y²` 不会溢出。
  - `tPDF`:改走 `logTPDF`(log-gamma + `log1p`)。
- `entry/src/main/core/math/stats.ts`
  - `lgamma`:反射公式加 `Math.abs`;负整数返回 ∞,与 `special.lgamma` 对齐。
  - `pnorm`:改 `½·erfc(−z/√2)`。
  - 新增 4 个上尾函数:
    `ptUpper(t, df)` = ½·I_{df/(df+t²)}(df/2, ½);
    `pchisqUpper(x, df)` = Q(df/2, x/2);
    `pFUpper(f, d1, d2)` = I_{d2/(d1·f+d2)}(d2/2, d1/2);
    `pnormUpper(x, mu, sigma)` = ½·erfc((x−mu)/(σ√2))。
    F 与 χ² 都用**小参数一侧**的不完全 β / Γ,尾数从不靠减法得到。
  - `qchisq` / `qt`:加收敛判据,不收敛抛错(报错文案带 p 与 df)。

## 验证

参照值全部来自 conda `dev` 的 **scipy 1.15.3**,没有一处手算。

- **725 例网格对拍**:p ∈ [1e-12, 1−1e-12]、df ∈ [1, 2, 3, 5, 10, 30, 50, 100, 1000]。
  `chi2PPF` / `tPPF` / `ptUpper` / `pchisqUpper` / `pFUpper` / `pnormUpper` /
  `qchisq` / `qt` **全部 0 差异**(相对误差 < 1e-9);唯一的 18 条"不一致"是
  p = 0.5 处 scipy 自返 1e-16 残值而我们返**精确的 0**(中位数的正确值)。
- 新增 `tests/fixMathSpecial2026.test.ts`,**23 条用例**,测试名一律写明旧行为:
  - `chi2PPF(0.05, 5) is 1.1454762260617692, not the 3.759944291918185e+08 the old initial guess produced`
  - `chi2PPF(0.001, 30) is 11.587951045645056, not 658.1968279326461`
  - `chi2PPF(1e-12, 30) is 2.1792731865592656, not the 0.1 the guard collapsed to`
  - `chi2PPF(1e-12, 1) is 1.5707963267948931e-24, not 1e-06`
  - `tPPF(1e-12, 1) is -3.183098861837905e+11, not -7442023.952299317`
  - `stats.lgamma(-0.5) is 1.2655121234846454, not NaN`
  - `ptUpper(9, 1000) is 5.564538585935719e-19, where 2*(1 - pt(9, 1000)) is exactly 0`
  - `pchisqUpper(100, 2) is 1.9287498479639183e-22, where 1 - pchisq(100, 2) is exactly 0`
  - `special.erfc(8) is 1.1224297172982928e-29, not the 0 the cancellation produced`
  - 以及参数校验抛错、上下尾互补、往返一致性等用例。
- 门禁:`node --experimental-transform-types tests/test.mjs` **290 passed, 5 failed**
  (5 条全部是别的 agent 负责的 Fitch / Matrix / Anderson-Darling / PLS 用例,
  与本次改动无关;其中 Anderson-Darling 那条的数值因 `pnorm` 精度提升
  由 0.2180041180920611 变为 0.2180047214032328,仍然失败);
  `python tools/structure_check.py` **175 文件 0 问题**。
- 未跑 DevEco 构建:本次只动 `core/math/**` 与 `tests/**`,不涉及构建配置、
  依赖或公共 API 形态。

> ⚠️ 新测试文件**尚未注册**进 `tests/run.ts`(该文件不在本次所有权范围内),
> 需由其所有者补一行 `import './fixMathSpecial2026.test.ts';`。

## 风险

- **极端边界**:`chi2PPF(1e-300, 1)` = **0** —— 真值 1.57e-600 超出双精度可表示
  范围,scipy 同样返回 0.0,行为一致;`tPPF(1e-300, 1)` = **−3.183098861837784e+299**
  (真值 1/(πs)),而 scipy 自身只给 −1e+100 的假上限。
- **同一量仍有两份实现**(违反 code-style 1.4):`stats.qchisq` / `stats.qt`
  与 `special.chi2PPF` / `special.tPPF` 各算一套卡方 / t 分位数。
  本轮**没有统一**:`stats` 侧是活代码(已被 `statistics.ts` 使用),改算法会动到
  线上路径;而且委托会改变 p = 0 / p = 1 的语义(现在 `qchisq(0, df)` 返回 df,
  委托后是 0)。若要统一,建议 `stats.qchisq → special.chi2PPF`、
  `stats.qt → special.tPPF` 委托(stats → special 方向**无循环依赖**),
  并同步收敛判据的报错文案。
- **数值变更,旧结果需要重跑**:
  - `erfc` 尾部的值会变(以前是 0,现在是真的小量),凡是用它算尾概率的地方都会变;
  - `pnorm` 的值会变(误差从 1.5e-07 降到 ~1e-15),Shapiro-Wilk 权重因此有
    ~1e-07 量级的变化,Anderson-Darling 统计量随之变化 ~6e-07;
  - `qchisq` / `qt` 在极端输入下**由静默返回垃圾值变成抛错**,UI 需要能显示
    这些错误信息。
- **给下一轮的调用点清单**(上尾函数;行号为 2026-10-19 22:0x 快照,他人仍在并行改动):
  - 本轮已被并行迁移:`statistics.ts:540`、`statistics.ts:553` → `2 * ptUpper(...)`;
    `statistics.ts:603` → `pFUpper(...)`。
  - 仍待迁移:`statistics.ts:1436`(1 − pchisq)、`statistics.ts:2319`(2·(1 − pnorm))、
    `stratigraphy/StratExtended.ts:157`、`stratigraphy/StratCorr.ts:41`、
    `phylogenetics/signal.ts:93`、`morphometrics/morphometrics.ts:749`、
    `morphometrics/morphometrics.ts:874`、`macroevolution/macroevolution.ts:636`。
  - `macroevolution.ts:461`、`macroevolution.ts:886`、`phylogenetics.ts:1546` 用的是
    各文件**私有的 `normCDF_*` 副本**(code-style 1.4 的又一例重复实现),
    应改用 `0.5 * erfc(|z| / √2)`,而不是再抄一份近似。
