# Bray-Curtis 分母漏了绝对值:两个不同的样本被报成距离 0

## 类型
缺陷修复 / 数值变更

## 问题

仓库里有**两份** Bray-Curtis 实现,都写成:

```ts
num += Math.abs(a[k] - b[k]);
den += a[k] + b[k];        // 少了 Math.abs
```

- `entry/src/main/core/analysis/statistics/statistics.ts:1412`(`computeDistanceMatrix`,**活的那份**)
- `entry/src/main/core/scipy/DistanceCluster.ts:26`(`rowDistance`,无生产调用方)

`den` 可以在任何含负数的向量对上变成 0 或负数,于是 `den > 0 ? num / den : 0`
走进兜底分支返回 **0.0**。对 NMDS / PCoA / ANOSIM / PERMANOVA / SIMPER 而言,
距离 0 的含义是**这两个样本完全相同**。

实测(修复前,对照 scipy 1.15.3):

| a | b | 仓库(修复前) | scipy |
|---|---|---|---|
| `[1, 2, 3]` | `[4, 5, 6]` | 0.4285714286 | 0.4285714286 ✓ |
| `[1, -2, 3]` | `[4, 5, -6]` | **3.8000000000** | 1.7272727273 |
| `[1, -1]` | `[0.5, -0.5]` | **0.0000000000** | 0.3333333333 |
| `[-1, -2]` | `[-3, -4]` | **0.0000000000** | 0.4000000000 |
| `[2, -5, 3]` | `[-4, 6, 1]` | **6.3333333333** | 2.7142857143 |
| `[10, -1]` | `[1, -10]` | **0.0000000000** | 0.8181818182 |

最后一行那种:`[-10,-1]` 与 `[-1,-10]` 是完全不同的向量,仓库报 0.0。

## 正确的公式是什么 —— 这里我差点改错

我第一反应是教科书定义 `Σ(|u_i| + |v_i|)`。**它是错的。**

拿它去对照 scipy 时,6 个用例里有 2 个对不上。scipy 自己的 docstring
(`scipy.spatial.distance.braycurtis`)写的是:

```
\sum{|u_i-v_i|} / \sum{|u_i+v_i|}
```

绝对值套在**和**外面,不是套在每一项上。6 个用例全部与 `Σ|u_i+v_i|` 吻合,
与 `Σ(|u_i|+|v_i|)` 只吻合 4 个。

项目明确以 scipy 为准(`core/scipy/DistanceCluster.ts` 的文件头就是
"replaces scipy.spatial.distance"),所以目标是 scipy 那个,
而不是生态学文献里更常见的那个。**这条如果凭记忆改就会引入第二个偏差。**

## 修复

两处都改为 `den += Math.abs(a[k] + b[k]);`,并注释说明绝对值的位置。

## 数值影响范围(重要)

| 数据 | 影响 |
|---|---|
| 全非负(丰度、计数、体长、质量) | **无变化** —— 三种分母形式在这里完全等价 |
| 含负数(PCA 得分、环境协变量、中心化/标准化后的矩阵) | 结果**会变**,之前是错的 |

所以典型的古生物丰度数据跑出来的历史结果不受影响;
但如果之前用含负数的数据跑过 Bray-Curtis 的 NMDS / PCoA / ANOSIM / PERMANOVA /
SIMPER,**那些结果需要重跑**。

`bray_curtis` 是 PCoA / NMDS 对话框的**默认度量**,所以这条路径影响面不小。

## 验证

新增 `tests/brayCurtis2026.test.ts`,5 条测试。

- 6 个用例逐一对照 scipy 的实测值(不是手推),同时测 `DistanceCluster.rowDistance`
  与活的 `computeDistanceMatrix`,并检查距离矩阵的对称性。
- 两个明显不同的样本距离必须 > 0(直接钉住"被报成相同"这个失败模式)。
- 全非负数据的输出未变 —— 明确证明既有结果不受影响。
- 两份实现必须用同一个公式:如果将来加了第三份,这条断言会拦住漂移。

**守卫有效性已验证**:把两个文件换回 `HEAD` 版本重跑,5 条中 4 条如期失败,
失败信息正是上表那些数字(`got 3.8, scipy 1.7272727272727273`、
`still 0 -- reported identical`)。恢复后全绿。

门禁:`tests/test.mjs` **246 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。

## 顺带记录:同名但并非 scipy 语义的两个度量

`jaccard` 与 `hamming` 在本仓是按坐标定义的(相等位比例 / 不等位比例),
而 scipy 的 `jaccard` 是**集合**的 Jaccard、`hamming` 面向布尔向量。
这不是 bug —— 是项目自己的定义恰好借用了 scipy 的名字。
但如果将来有人按 scipy 的语义去解释这些数字,会得出错误结论。
本次**未改**(改了会改变已有行为,而没有任何依据说明哪个才对)。
