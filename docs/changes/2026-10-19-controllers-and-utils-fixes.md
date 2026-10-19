# 控制器与工具层 15 处缺陷:SIMPER 丢掉度量、Phylo ANOVA 对空分组答 p=1、Box-Cox λ 恒为网格上界

## 类型
缺陷修复 / 数值变更

## 问题

2026-10-19 对 `core/controllers/`、`core/utils/`、`core/config/Imputation.ts`、
`core/app_infrastructure/` 的复审发现 15 处缺陷。**其中 4 处会把"看起来合理"的错误数字
写进论文**,4 处是同一逻辑的多份实现各自漂移:

| # | 位置 | 旧行为 | 新行为 |
|---|---|---|---|
| 1 | `StatisticsController.runSIMPER` | 收了 `metric` 却**从不转发**(`simper(data, groups)`),恒用默认 Bray-Curtis;同一张表 Euclidean 应为 **20.999**、实得 Bray-Curtis **0.5065**;`recordAnalysis` 却把用户选的 metric 写进"可复现分析脚本",**脚本与结果不符** | metric 作为第 4 实参转发(`simper(data, groups, undefined, metric)`);不支持的度量直接抛错 |
| 2 | `StatisticsController.runPhyloANOVA` | `groups` 恒为 `{}`(UI 两条路径都传空对象),`phyloANOVA` 在 `nGroups < 2` 时早退返回 `pValue: 1`,界面显示"**组间无显著差异**"——一个**从未发生**的分析 | 有 tip 的树 + 无效分组 → 抛可读错误;无 tip 的退化树保留历史行为 |
| 3 | `utils/Transformations.boxcoxTransform` | 目标函数只有 `Σ(x^λ−1)/λ`,缺 Jacobian 项与方差项 → **λ 恒被顶到网格上界 2**,scipy MLE 是 **0.2259**;任何右偏数据都得到同一个 λ | 改用含 `(λ−1)Σln x` 与 `−(n/2)ln σ̂²(λ)` 的 profile log-likelihood(与 `scipy.stats.boxcox_llf` 同式),粗扫 + 黄金分割求 λ |
| 4 | `config/Imputation` / `utils/Transformations` | "缺失"有两套定义:`analyzeMissing` 把 `null` 当缺失,`impute*` 只判 `isNaN` → `imputeMean([[null,1],[2,2],[3,3]])` **原样保留 null**,残留的 null 进入 KNN 距离计算时按 0 参与算术 | 统一 `isMissingValue(v)`(NaN / null / undefined),四个实现共用 |
| 5 | 同上 | 整列全缺失时 `config.imputeMean` 填 **0**、`config.imputeKNN` 留 **NaN**、`utils.imputeKNN` 填 **0** —— 同一函数三份实现、两种行为 | 三份实现合并为一份(`config/Imputation` 改为再导出 `utils/Transformations` 的实现),整列全缺失时**保留缺失**(填 0 等于伪造一个观测值) |
| 6 | `StatisticsController.runEFA` | 表格列数为奇数(5 列)时 `n = row.length / 2 = 2.5`,`row[n+i]` 全是 `undefined` → 函数**正常返回"成功"**,但 harmonics / coefficients / reconstructed **全是 NaN**,界面画一张空图且不报错 | 列数非偶数时抛可读错误,说明 EFA 要求 `[x1..xN, y1..yN]` 布局 |
| 7 | `utils/EventBus.once` | 回调抛错时 `off` 永不执行,包装器留在订阅表里 → 再次 `emit` 时**回调执行了 2 次**(期望 1 次) | 先 `off` 再调用回调 |
| 8 | `utils/EventBus.emit` | `emit` 先把回调快照成数组,期间被 `off()` 掉的监听器**仍会被调用 1 次**(注释声称是"安全的浅拷贝",实际是快照语义) | 调用前复查订阅集合;注释写明语义 |
| 9 | `DataController.validateData` | 含 1 个 NaN 的 3×2 表返回 `valid: true` + `"1 missing values detected"`;只看 `valid` 的上层会带着缺失值继续跑分析 | `nNaN > 0` 时 `valid: false`,并新增 `hasMissing` 字段 |
| 10 | `DataController.transformZScore` | 常数列上抛 `Error: Division by zero`(来自 `core/math/Matrix`),而 `utils/Transformations.zscoreStandardize` 与 `utils/MatrixOps.standardizeMatrix` 都用 `\|\| 1` 兜底返回 0 | 改为复用 `zscoreStandardize`,同一变换一份实现 |
| 11 | `DataController.transformPercent` vs `utils/Transformations.percentStandardize` | 同名变换**语义相反**:前者按行归一,后者默认按列归一 | `transformPercent(axis = 1)` 显式暴露轴语义(0 = 按列、1 = 按行),实现复用 `percentStandardize` |
| 12 | `utils/Decorators.validateInputs` | 循环条件 `i < names.length && i < args.length` → 实参少于验证项时**剩下的验证项被静默跳过**,非法输入通过 | 按 `names.length` 遍历,缺失的实参视为校验失败(抛错) |
| 13 | `utils/Decorators.logExecutionTime` / `deprecated` | 装饰器里直接 `console.log` / `console.warn`,用在生产方法上**每次调用都打一行日志**(`CodeAudit` 自己就把"stray console.log"列为要查的问题) | 改为可注入 sink(`setDecoratorLogSink`),**默认静默** |
| 14 | `utils/MatrixOps.pairwiseDistance` | Bray-Curtis 分母缺绝对值:`[1,-1]` 与 `[0,0]` 的分母 = 0 → 距离 **0**,两个不同标本被报成"完全相同" | 分母加 `Math.abs`(与 `core/analysis/statistics` 的实现对齐),并注明这是重复实现 |
| 15 | `app_infrastructure/ExceptionHandler.formatUserError` | 把错误降级成一句友好短句,**原始原因被丢弃**;兜底分支还截断到 200 字 | 友好文案后**附上完整原始原因**(`(cause: …)`),不再截断 |
| 16 | `app_infrastructure/StartupLoader` | 7 个预热模块里有 4 个是空存根 `load: () => { void 0; }`;native 模块用 `void initNative().catch(...)` **丢弃 promise**,启动失败永远报不出来 | 4 个空存根换成真实自检(跑真实的 stratigraphy / morphometrics / phylogenetics / plugin registry);native 的 promise 被 `await`,拒绝即启动失败 |

## 根因

1. **SIMPER**:`simper(data, groups, variableNames?, metric)` 的 metric 在**第 4 位**,
   控制器写了 `simper(this.getData(), groups)`,形参被静默丢弃。机械扫描 99 个 `run*`
   方法的形参使用情况,`runSIMPER` 是**唯一一个形参未被引用**的。
2. **Phylo ANOVA**:`phyloANOVA` 用 `nGroups < 2` 早退表达"没有可做的检验",
   控制器把空对象原样透传,于是"没法做"被翻译成了"做过了,没有显著差异"。
   同一轮修过 PERMANOVA / ANOSIM / LDA / SIMPER 的 `requireGroups()`,**Phylo ANOVA 漏网**。
3. **Box-Cox**:目标函数少了 Jacobian 项 `(λ−1)Σln x` 与 profile 似然里的 `−(n/2)ln σ̂²(λ)`,
   少了这两项,目标函数对 λ 单调偏大,argmax 必然落在网格端点。
4. **缺失值**:`analyzeMissing` 与 `impute*` 写于不同时间,各写各的 `isNaN` 判据;
   `impute*` 又有三份拷贝,拷贝之间已经漂移。
5. **EventBus**:`once` 的包装器把 `off` 放在回调**之后**;`emit` 用快照迭代,
   注释描述的语义与实现不一致。
6. **装饰器**:`logExecutionTime` / `deprecated` 当初是"开发期小工具",
   但它们是装饰器 —— 一旦挂到生产方法上就是每次调用一行日志。

## 修复

改动文件(全部在本次的所有权范围内):

- `core/controllers/StatisticsController.ts`:`runSIMPER` 转发 metric 并校验取值;
  `runPhyloANOVA` 在"有 tip 但分组无效"时抛错;`runEFA` 校验列数为偶数;
  `runStratCorr` 补注释说明它与 `runComputeCorrelation` 是两种分析(派发点不在本文件)。
- `core/controllers/DataController.ts`:`transformZScore` / `transformPercent` 改为复用
  `core/utils/Transformations` 的实现;`validateData` 增加 `hasMissing`,`valid` 随缺失值置 false。
- `core/utils/Transformations.ts`:新增导出 `isMissingValue`;`boxcoxTransform` 改用
  profile log-likelihood 求 λ(粗扫 + 黄金分割,与 `scipy.stats.boxcox_llf` 同式);
  `imputeMean` / `imputeKNN` 统一缺失判据,整列全缺失时保留缺失;
  `percentStandardize` 补写轴语义。
- `core/config/Imputation.ts`:`imputeMean` / `imputeKNN` **删除重复实现**,改为再导出
  `core/utils/Transformations` 的那一份;`analyzeMissing` / `removeRowsWithNaN` /
  `removeColumnsWithNaN` 统一使用 `isMissingValue`。
- `core/utils/EventBus.ts`:`once` 先注销再调用;`emit` 调用前复查订阅集合。
- `core/utils/Decorators.ts`:新增 `setDecoratorLogSink` / `getDecoratorLogSink`(默认静默);
  `validateInputs` 按验证项个数遍历。
- `core/utils/MatrixOps.ts`:Bray-Curtis 分母加 `Math.abs`,并注明是重复实现。
- `core/app_infrastructure/ExceptionHandler.ts`:`formatUserError` 附上完整原始原因。
- `core/app_infrastructure/StartupLoader.ts`:4 个空存根换成真实自检;native 预热被 await。

**未改**:`core/plugins/*` —— 已核对,`PluginRegistry` 只是一个以插件自身 `name` 为键的
`Map`,没有扫描目录、也没有按字符串键触发的隐藏路径;`registerAnalysis` /
`loadBuiltinPlugins` 都需要调用方显式传 factory,全仓无调用点。按要求不改。

## 验证

新增 `tests/fixControllers2026.test.ts`,26 条用例,测试名全部写明旧行为。

- SIMPER:控制器结果与直接调用 `simper(data, groups, undefined, 'euclidean')` 逐位一致,
  且与 Bray-Curtis 不同;另用手算的四个跨组配对均值交叉验证
  (Euclidean 4.6922999、Bray-Curtis 0.0606562)。
- Box-Cox:λ = 0.2259439070403843(scipy 1.15.3 `scipy.stats.boxcox` 的 MLE,容差 1e-6),
  变换值与 scipy 逐位吻合;显式 λ 仍然照用。
- 缺失值:`null` 被当成缺失处理(`imputeMean` 填 2.5、`imputeKNN` 填 2),
  四份插补实现对整列全缺失的行为一致。
- EFA / Phylo ANOVA / EventBus.once / EventBus.emit / validateInputs /
  validateData / transformZScore / pairwiseDistance / formatUserError /
  StartupLoader:各一条用例钉住旧行为。

门禁:`tests/test.mjs` **292 passed, 3 failed**(3 条全部是别的 agent 负责的
Matrix 广播 / Shapiro-Wilk / PLS 用例,与本次改动无关);
`structure_check.py` 175 文件 0 问题;核心模块 109/109 逐个 `import()` 冒烟通过。

> ⚠️ 新测试文件**尚未注册**进 `tests/run.ts`(该文件不在本次的所有权范围内),
> 需由 `tests/run.ts` 的所有者补一行 `import './fixControllers2026.test.ts';`。

## 风险

- **数值变更**:所有 Box-Cox 结果会变(λ 以前恒为 2,现在是真 MLE);所有 SIMPER 结果在
  用户选 Euclidean 时会变(以前恒为 Bray-Curtis)。**用旧版本算过的结果需要重跑。**
- **新增的抛错**会让原来"静默返回垃圾值"的路径变成异常,UI 需要能显示这些错误信息:
  SIMPER 度量不受支持、Phylo ANOVA 分组无效、EFA 列数为奇数。
- **`impute*` 对整列全缺失的行为变了**:以前 `config.imputeMean` 填 0,
  现在保留缺失(NaN)。这是有意的 —— 填 0 等于伪造一个观测值。
- **`DataController.validateData().valid` 语义变了**:以前含缺失值也是 `true`,
  现在是 `false`。上层若只看 `valid`,以前会带着缺失值继续跑分析。
- **`transformPercent` 新增可选参数**:默认值 `axis = 1` 保持原有按行归一的行为,
  但同名函数 `utils/Transformations.percentStandardize` 默认是 `axis = 0`(按列),
  两者仍不能互换使用。
- **`core/models/DataMatrix.ts` 另有一份自己的插补实现**(`imputeMean` / `imputeMedian` /
  `imputeKNN`),只判 `isNaN`、且整列全缺失时行为又不一样。该文件不在本次所有权范围内,
  未改。
- **`Phylo ANOVA` 的抛错条件**:无 tip 的退化树(`new PhyloNode('root', 0, false)`)
  仍返回 `pValue: 1` —— 那棵树没有任何 contrast,谈不上检验;UI 路径走
  `requireParsedTree()`,拿到的一定是有 tip 的树,因此生产路径一定会抛错。
