# utils + controllers:协方差算错轴、EFA 分辨率被丢弃、校验器谎报支持集

## 类型
缺陷修复 / 文档

## 问题

`core/utils/`(35KB,6 文件)+ `core/controllers/`(33KB,2 文件)。
**4 处缺陷,其中 2 处让函数返回的东西与名字承诺的完全不是一回事。**

| 缺陷 | 实测(修复前) | 正确值 |
|---|---|---|
| `covarianceMatrix(X, rowvar=true)` 中心化轴与分母都错 | 5×3 输入的 3×3 块 = `[1.00, -0.50, -0.50; …]` | `[2.50, 0.875, 1.50; 0.875, 8.00, 4.625; 1.50, 4.625, 5.20]` |
| `correlationMatrix` 拿 rowvar=false 的结果当变量×变量 | 5×3 表返回 **5×5** 的"相关矩阵" | 3×3,对称,单位对角 |
| `validateDistanceMetric` 批准 4 个实现会拒绝的名字 | `braycurtis` / `manhattan` / `chebychev` / `chebyshev` 校验通过,`pairwiseDistance` 随后抛 `Unknown metric` | 校验与实现口径一致 |
| EFA 的重采样分辨率被收集后丢弃 | `EFADialog` 的 "Resample points" → `Index.ets` → `runEFA(nh, np)` → `efa(contour, nh)`(漏第三参) | `runEFA(5, 60)` → `nPoints = 60`(此前恒为 200) |

## 原因

### 1. `covarianceMatrix` 的中心化轴与自由度都取错了

```ts
const data = rowvar ? X : X.transpose();
const c = centerMatrix(data, 0);            // 去掉每个【观测】跨变量的均值
const num = c.transpose().matmul(c);         // → 观测 × 观测
const denom = Math.max(1, n - ddof);         // n 是变量数,不是观测数
```

`centerMatrix(data, 0)` 是"每列减去该列均值"。在转置后的矩阵上,列 = 观测,
所以它减掉的是**每个观测跨变量的均值**(一个观测效应),而不是
**每个变量跨观测的均值**。随后 `cᵀc` 得到的是"观测 × 观测"的量,
再除以 `(变量数 − ddof)`。

需要说明的是:`rowvar=false` 时返回 `nRows × nRows` **本身不是 bug**,
那正是 `np.cov(rowvar=False)` 的约定。错的是数值,以及 `correlationMatrix`
把 rowvar=false 的结果当成变量×变量矩阵来用。

`linalg.cov` 是已经过 numpy 对拍验证的实现(`X.sub(X.meanAxis(0))` 在上上轮
修好广播后即正确),形状与语义都对,所以 `covarianceMatrix` 改为委派给它,
不再保留第二份实现。

### 2. `correlationMatrix` 要的是 rowvar=true

它需要变量×变量的相关矩阵,却向 `covarianceMatrix` 要了 `rowvar=false`。
5 观测 × 3 变量的表因此拿到 5×5 的"相关矩阵"。

### 3. 校验器比实现更宽松

`validateDistanceMetric` 的白名单里有 4 个名字不在 `DistanceMetric` 联合类型里。
**一个批准了代码随后会拒绝的东西的校验器,比没有校验器更糟** ——
失败点离原因很远。

### 4. EFA:第三次"收集后丢弃"

这是本次审查里第三次遇到同一缺陷族(前两次是小波尺度、空模型 `nWorkers`)。
`efa(contour, nHarmonics, nPoints)` **本来就有**第三个参数,
`runEFA(nh?: number, np?: number)` **也**接收了 `np`,
只是调用时写成了 `efa(contour, nh)`。对话框收集、Index 传参、方法签名,
三处都对,唯独最后一步没转发 —— 而导出的"可复现分析脚本"会把它记成有效参数。

## 修改

1. `utils/MatrixOps.ts`
   - `covarianceMatrix`:改为按 numpy 语义委派 `linalg.cov`(`rowvar=false` 先转置),
     `ddof≠1` 时按 `(nObs−1)/(nObs−ddof)` 缩放;`nObs ≤ ddof` 明确报错,
     不再用 `Math.max(1, …)` 悄悄夹住。
   - `correlationMatrix`:改用 `rowvar=true`。
2. `utils/Validators.ts`:`validateDistanceMetric` 的白名单改为直接引用
   `DistanceMetric` 类型(编译期就能保证不漂移),并用 `import type` 引入。
3. `controllers/StatisticsController.ts`
   - `runEFA`:`efa(contour, nh, np)` —— 转发对话框收集的重采样分辨率;
     补注释说明"只用第 0 行作轮廓标本"是对话框里写明的约定,不是猜测。
   - `runBrokenStick`:删掉从未使用的 `row` 参数。broken-stick 检验需要的是
     CONISS 的合并高度(来自整个矩阵),并没有"按标本筛选"这回事;
     留着这个参数只会让人以为有筛选。
4. `models/StateManager.ts`:删除无调用点的 `estimateMemory`。

## 验证

参照值全部来自 conda `dev` 的 **numpy 1.26.4 / scipy 1.15.3**,以及仓内已验证的
`linalg.cov`,没有一处手算。

- 新增 `tests/utils2026.test.ts`,14 条回归测试,测试名一律描述旧行为。
- `covarianceMatrix(Y, true)` 与 `linalg.cov(Y)` 逐项吻合到 1e-15,
  与 numpy `np.cov` 的 `[2.5, 0.875, 1.5; 0.875, 8, 4.625; 1.5, 4.625, 5.2]` 一致;
  `ddof=0` 给出总体协方差 2.0。
- `correlationMatrix`:3×3、对称、单位对角,且每个元素等于 `cov/(sd·sd)`;
  spearman 同形状。
- `validateDistanceMetric` 与 `pairwiseDistance` 在 8 个合法名 + 5 个非法名上
  判定完全一致。
- `efa(contour, 5, 40/400)` 的 `nPoints` 分别为 40/400;
  `runEFA(5, 60)` → 60,`runEFA(5, 350)` → 350。
- 门禁:`tests/test.mjs` **193 passed, 0 failed**;`node test/device/run.mjs` 19/19;
  `structure_check.py` 174 文件 0 问题。
- 未跑 DevEco 构建:只动 `core/**` 与 `tests/**`。

## 其它

- **我自己的怀疑被数值测试否定了两次。** 第一次是 `mantelTest` 里
  `dy = u2[i] - mean(u1)` 看着像把 u1 的均值错用给了 u2 —— 但因为
  `Σ(u1ᵢ − mean(u1)) = 0`,它与用 `mean(u2)` 在代数上完全等价,
  `r(D,D) = 1` 且 `r(D,E)` 与教科书写法逐位吻合。**没改**,
  并把这个"看着像 bug 但不是"的断言写进了测试,免得以后有人再来"修"它。
  第二次是我一度以为 `rowvar=false` 返回 `nRows×nRows` 是形状错误,
  实际那正是 numpy 的约定,错的只是数值。
- **死代码:44 个导出符号在自身文件外零引用**(扫 `entry/src/main` 全部 184 个
  ts/ets + `tests/`)。整文件未被任何地方引用的有:
  - `utils/Decorators.ts`(171 行):6 个装饰器全部未使用。
    其中 `cache` 还有真陷阱 —— 它的 `cached` 是**装饰器工厂的闭包变量**,
    被该类**所有实例共享**,且**完全不看参数**:实例 A 调完,实例 B 拿到 A 的结果。
  - `utils/Validators.ts`(154 行):12 个校验器全部未使用。
  - `Exceptions.ts` 里 9 个异常类未使用(纯分类学,不算缺陷)。
  - `MatrixOps.ts` 里 11 个函数、`Transformations.ts` 里 6 个
    (只有 `hellingerTransform` 被新测试引用)。
  - `StateManager` 的 `ReadLockContext` / `WriteLockContext` 未使用。
  **本轮只报告不删除** —— 与前两轮不同,那些死代码是我替换函数的副产品;
  这里删除整模块是独立决定,应由你拍板。`cache` 的跨实例串缓存即使删掉整个文件
  也不会造成可观察的错误(没有调用点),所以也不值得单独"修"。
- 我为做可达性分析写的第一版脚本不可靠(只解析单行 `import`,多行 import 全漏,
  连明显在用的 `models/` 都判成不可达),已改用"全仓文件内容 + 符号级正则计数",
  上面 44 这个数字来自后者。
- **未审**:`ets/` 剩余部分 —— `PlotCanvas.ets`(57KB)、`Index.ets`(56KB,已读约 2/3)、
  30 个 dialog、`HistoryRepository`、`EntryAbility`。
  已记录待处理:`Spreadsheet` 的 `onDataChanged` / `onSelectionChanged` 同样未接;
  `Index.ets` 的 `runCCA(data, data)` 把同一份数据同时当物种与环境、
  `'TPS Grid'` 把 `data.to2D()` 同时当 source 和 target(弯曲能量恒为 0)。
