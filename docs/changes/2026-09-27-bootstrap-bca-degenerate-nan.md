# BCa 在退化分布上静默返回 NaN 区间;同时把 normInv / normCDF / BCa 公式钉住

## 类型
缺陷修复 / 数值变更

## 问题

`core/math/Bootstrap.ts` 是**死代码**(没有任何生产代码调用它),因此**也没有任何测试覆盖**。
即便如此审它仍然有价值 —— 本次审查已经在死代码里挖出一个活的数值 bug(Bray-Curtis 分母)。
这一轮又挖出一处,外加三处差点改错的地方。

### 缺陷:退化分布上返回 NaN, NaN

分布退化时(样本全常数,或统计量取 `min`),所有重采样估计都等于点估计,
于是 `#{θ* < θ̂}` 为 **0**,`normInv(0)` 是 `-Infinity`,直接进入
`z0 + zLo / (1 - a*zLo)` —— 95% BCa 区间变成 `NaN, NaN`,**没有任何提示**。

scipy 对这一种情况是**显式警告**的:

> `DegenerateDataWarning: The BCa confidence interval cannot be calculated.
> This problem is known to occur when the distribution is degenerate or the
> statistic is np.min.`

而本项目的规则更严(`docs/code-style.md`):**响亮失败,不要编造结果**。
静默的 `NaN, NaN` 正是"编造/垃圾结果"这一类。

### 三处差点改错的地方(记录下来,因为这才是重点)

1. **BCa 看起来把偏差修正 `z0` 加了两次**:
   `zLo = z0 + z_α`,然后 `normCDF(z0 + zLo / (1 - a*zLo))`。
   读 scipy 自己的源码 `scipy/stats/_resampling.py` 第 152-155 行:
   ```python
   num1 = z0_hat + z_alpha
   alpha_1 = ndtr(z0_hat + num1/(1 - a_hat*num1))
   ```
   **和仓库逐字相同**。那两个 `z0` 是公式里不同的项,不是重复应用。
2. **我设的对照例失败了**:我以为"a = 0 时两种写法应当一致",
   实际相差 0.53 —— 正是这个失败让我回头质疑自己的结论,而不是去改代码。

结论:三次都**没有改**。改的是那条真的 NaN。

## 根因

`normInv(0)` 与 `normInv(1)` 返回 ±Infinity 是**正确**行为(A&S 近似在定义域端点的极限),
问题在于调用方**没有处理**这个结果。缺少的不是数学,是输入检查。

## 修复

```ts
const degenerate = below === 0 || below === nResamples;
const frac = degenerate ? 0.5 : below / nResamples;
const z0 = degenerate ? 0 : normInv(frac);
```

退化时用未经偏差修正的分位数(即 `z0 = 0`,退化成 percentile 法),
函数变成全函数,任何输入都不再产生 NaN。

## 顺带核实:三处公式全部正确(对照 scipy 1.15.3)

| 项 | 仓库 vs scipy 最差误差 | A&S 文档容差 | 结论 |
|---|---|---|---|
| `normInv`(A&S 26.2.23) | 5.0e-09 | 4.5e-04 | 正确 |
| `normCDF`(A&S 26.2.17) | 7.0e-08 | 7.5e-08 | 正确 |
| BCa `alpha1/alpha2` | 7.0e-08 | — | 与 scipy **同一形式**,差值恰好来自 normCDF 自身的近似误差 |

这是本次会话**第三次**凭记忆给出的公式是错的
(Shapiro-Wilk 的 Fortran `_poly`、Bray-Curtis 的分母、BCa)。
三次都是因为去查了权威源码才没改坏。

## 验证

新增 `tests/bootstrapNumerics2026.test.ts`,7 条测试。

三个 helper 是**模块私有**的,不能 import,所以走 `bootstrap` 端到端 + 源码层锁定:

- BCa 三行必须保持 scipy 的形状(将来有人"顺手"把两个 z0 合并会被拦下);
- **A&S 全部 27 个系数逐字断言** —— 这里抄错只会得到一个看似合理的错误区间,
  是最难发现的一类;
- 固定种子可复现(项目强制要求种子化 PRNG);
- 区间有序、落在重采样分布内、经验覆盖率在 90%~99%;
- 退化输入返回有限值且不做无意义的抖动。

**守卫有效性已验证**:把 `Bootstrap.ts` 换回 `HEAD` 版本重跑,退化用例如期失败
(`expected finite, got NaN, NaN`)。

门禁:`tests/test.mjs` **269 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。

## 风险

- `bootstrap` 仍是死代码,本次修复**不影响任何现有行为**;它的价值是
  "万一有人接上去,不会带着一个静默 NaN 上线"。
- 退化时现在退化为 percentile 区间,而不是 scipy 那样返回 NaN + 警告。
  两者都不提供有意义的区间,但本项目偏好不编造数字。若你更希望与 scipy 完全一致
  (NaN + 显式警告),这行需要改回去。
- 死代码是否删除仍是待你拍板的三项之一;本文件不构成"应该保留"的建议。
