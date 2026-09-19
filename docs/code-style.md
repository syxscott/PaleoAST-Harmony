# 代码风格

目标不是好看，而是**让数值错误无法悄悄通过**。下面的规则按「违反后的后果」排序。

---

## 1. 数值正确性（最重要）

### 1.1 随机过程必须可复现

```ts
// ✗ 缺陷：覆盖结果不可复现，论文无法复核
const jitter = Math.random() * 0.1;

// ✓ 使用种子 PRNG
import { rand, seed as seedRng } from '../../math/random';
export function mySim(..., rngSeed: number = 42): Result {
  seedRng(rngSeed);
  const jitter = rand() * 0.1;
}
```

`Math.random()` 出现在 `core/analysis/**` 中即为缺陷。新增随机过程请把 `rngSeed` 作为**带默认值 42 的末位参数**，与仓库既有约定一致（`coverageRarefaction`、`simulateNeutral`、`heuristicSearch`、`ripleyK`）。

### 1.2 失败要给出原因，不要只给空值

```ts
// ✗ 调用方只知道「失败」
if (n <= 0) return nullptr;

// ✓ C++ 侧给出可解释的 token
if (n <= 0) return ReturnError(env, Paleo::ErrorCode::BAD_ARGUMENT, "multiply: non-positive dimension");
```

TS 侧保留单一 null 判断，原因通过 `nativeLastError()` 查询 —— 界面因此能显示「矩阵奇异」而不是空白。

### 1.3 迭代算法必须检查收敛

```ts
// ✗ 不收敛时返回貌似合理的数字
for (let iter = 0; iter < 100 * n; iter++) { ... }

// ✓ 记录残差，超标就抛错
if (!converged && lastOff > 1e-6 * Math.max(diagScale, 1)) {
  throw new Error(`eigh: Jacobi iteration did not converge (residual ${lastOff.toExponential(3)})`);
}
```

「静默算错比崩溃更严重」是本项目的首要约束。

### 1.4 同一物理量只保留一份实现

重复实现必然会漂移。曾经的实例：Blomberg K 有两份且都错、CSV 解析有两份。
**发现第二份时，删除它并改为导入**，而不是「两份都修一遍」。

### 1.5 判定算法正确性优先用定义性质

不要靠逐字比对公式（公式抄错时比对不出来）。找该统计量的**定义性不变量**：

| 量 | 不变量 |
|---|---|
| Blomberg K | BM 下 `E[K] = 1` |
| CUDA-free Jacobi `eigh` | `A·v = λ·v` 残差 → 0，且不收敛即失败 |
| OU 协方差 | `α → 0` 时收敛到 BM 的 VCV |
| 稀疏化外推 | 单调、且有界于 Chao1 |
| 网络/树 | 对称性、正定性 |

---

## 2. 类型与模块

### 2.1 纯类型必须用 `import type` / `export type`

```ts
// ✗ 让整个模块图无法实例化
import { Matrix, Metric } from '../analysis/statistics';   // Metric 是 type
export { Lexer, Token, TokenType } from './Lexer';         // Token 是 interface

// ✓
import { Matrix } from '../analysis/statistics';
import type { Metric } from '../analysis/statistics';
export { Lexer, TokenType } from './Lexer';
export type { Token } from './Lexer';
```

失败信息是 `does not provide an export named 'X'`，**单测看不见**（测试不导入控制器层）。改过 barrel 后一定要跑逐模块 `import()` 冒烟检查。

### 2.2 分层依赖方向

```
ets/ (UI)  ──►  core/controllers  ──►  core/analysis + core/math
                        │
                        └──►  core/math/NativeMath  ──►  cpp/ (NAPI)
```

- `core/` 不得依赖 `ets/`。
- 只有 `core/math/NativeMath.ts` 可以 `import` `.so`。
- 纯逻辑放到 `.ts`（可被 Node 单测），只有含 ArkUI 语法（`@Component`/`@Builder` 等）的才用 `.ets`。
  例：`ets/components/plot/*.ts` 是纯逻辑所以是 `.ts`，因此有 14 条单测。

---

## 3. 代码结构

### 3.1 一个类只承担一件事

反例与正例都来自真实的修复：

```ts
// ✗ 曾有：991 行的 PlotCanvas 同时负责坐标变换、缩放平移、命中判定、
//    数值格式化、26 种绘制分支、PNG/SVG 导出 —— 于是
//    「新标题配旧曲线」「SVG 与屏幕不一致」这类缺陷反复出现。
// ✓ 现在：ViewPortHandler（视口唯一真源）
//         ChartComputator（刻度）
//         ChartHighlighter（命中判定）
//         ValueFormatter（格式化）
//         PlotCanvas（只做编排与绘制）
```

判断标准：**这段逻辑能不能在 Node 里单测？** 能，就抽成纯 TS 模块。

### 3.2 魔法值集中声明

```ts
// ✗ 散落的 20、5、0.1
if (d < 20) { ... }

// ✓
static readonly HOVER_RADIUS: number = 20;
static readonly TICK_DIVISIONS: number = 5;
```

### 3.3 注释解释「为什么」，并在修复处留下历史

```ts
// Rotation J = [[c, s], [-s, c]] applied as T <- J^T T J zeroes T[p,q] when
//     tan(2θ) = 2·T[p,q] / (T[q,q] − T[p,p]).
// The denominator's sign matters: the old (T[p,p] − T[q,q]) form rotates the
// wrong way and never converges — (3.792, 3.000, 2.208) instead of the true
// (4.732, 3.000, 1.268).
```

**不要在修复处只写 `// fix`。** 写清错在哪、为什么错、怎么发现的 —— 下一个人（或下一次 AI 会话）才不会改回去。

---

## 4. ArkTS / ArkUI 注意点

- 组件状态用 `@State` / `@Prop` / `@Link`；只有真正跨模块共享的才进 `AppStorage`。
- `@Prop` 数组配 `@Watch` 时，父级必须在 `@State` 里缓存这个数组。否则每次 `build()` 都生成新数组引用，`@Watch` 会被反复触发。
- `build()` 里不要创建对象/数组字面量（`@performance/recommended` 会告警，见 `code-linter.json5`）。
- 长列表用 `LazyForEach` + `IDataSource`（见 `SpreadsheetDataSource.ts`）。
- 对话框的 `onConfirm` 必须按自己的名字派发：`.onConfirm(this.analysis('Univariate'))`。
- 对话框新增参数时，同步改 `Index.ets` 里 `runDialogAnalysisCore` 的读取键 —— 键名不一致是静默失效的常见来源。

---

## 5. 命名

| 对象 | 约定 | 例 |
|---|---|---|
| 分析函数 | `lowerCamelCase`，动词开头 | `computeDiversity`、`hierarchicalClustering` |
| 结果类型 | `PascalCase` + `Result` 后缀 | `ClusteringResult`、`EFAResult` |
| 控制器方法 | `run` + 分析名 | `runPCA`、`runRarefaction` |
| 对话框 | `<Analysis>Dialog` | `PCADialog`、`RarefactionDialog` |
| 图表基础设施 | `<Concern>Handler` / `<Concern>or` | `ViewPortHandler`、`ChartHighlighter` |

---

## 6. 提交前自检

```bash
node --experimental-transform-types tests/test.mjs   # 必须全绿
python tools/structure_check.py                      # 必须 0 问题
```

- [ ] 新增/修复的算法有对应的回归测试，测试名**描述旧行为**（例如「xlsx import keeps the first data row」）
- [ ] 改动数值输出时，在 `docs/changes/` 记一条并说明影响哪些分析
- [ ] 未从 GPL/AGPL 的参照仓库（`.workbuddy/refs/`）复制代码
