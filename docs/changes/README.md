# 变更记录

每次修复缺陷、改动数值输出或做结构性重构，在这里加一条 `YYYY-MM-DD-<slug>.md`。

## 为什么要记

1. **数值改动的可追溯性** —— 用户拿旧版本算过结果，需要知道哪些分析要重跑。
2. **避免回改** —— 「这里为什么不能这么写」的记录，比代码里的 `// fix` 有用得多。
3. **给 AI 助手上下文** —— 下一次会话读这里，比重新读一遍 diff 快。

## 格式

```markdown
# <一句话标题>

## 类型
缺陷修复 / 新功能 / 重构 / 文档

## 问题
观察到什么，期望什么。给出具体数字（旧值 → 新值）。

## 根因
为什么，以及同一逻辑是否存在多份实现（合并到了哪一份）。

## 修复
改了哪些文件、关键决策。

## 验证
新增测试名 / 跑过的检查 / 受影响的分析是否需要重跑。

## 风险
未覆盖场景、遗留限制。
```

## 索引

| 日期 | 标题 | 类型 |
|---|---|---|
| 2026-10-19 | [全仓审查与修复:16 条致命缺陷 + 验证基础设施的空洞](2026-10-19-full-repo-audit-fixes.md) | 缺陷修复 / 数值变更 / 工程 |
| 2026-10-19 | [statistics:置换检验不播种、p 值尾部塌成 0、PERMANOVA 的 SS 与 F 不同口径](2026-10-19-statistics-numerics-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [UI 层:兜底绘图挑错字段、箱线图画布与 SVG 不一致、分组跨数据集残留](2026-10-19-ets-plot-dispatch-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [core/math:SVD 宽矩阵返回转置的 U/Vt、奇异判据用绝对阈值](2026-10-19-math-matrix-linalg-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [core/math:特殊函数尾部分位数发散、lgamma 负数 NaN、新增上尾函数](2026-10-19-math-special-stats-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [core/math:randint 可能取到上界、BCa 加速常数符号反了、LOWESS 偶数样本中位数](2026-10-19-math-random-bootstrap-lowess-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [地层学:卡方 p 值由发散的连分数算出、CONISS 分带数与请求不符、spline 年龄模型外推出负年龄](2026-10-19-stratigraphy-numerics-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [宏观演化:fitEarlyBurst 永远返回垃圾拟合、fitOU 没做 OU 变换、logRankTest 风险集漏删失](2026-10-19-macroevolution-numerics-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [生态学:稀释曲线的 nIterations 是死参数、SQS 两种 method 的 quorum 不同义](2026-10-19-ecology-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [系统发育:共识树输出损坏、RF 距离恒为真值 2 倍、Blomberg K 对退化输入返回噪声数](2026-10-19-phylogenetics-consensus-signal-and-search-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [形态测量:Kabsch 旋转反向应用、3D Procrustes 算 V·U、RV 系数不是 Escoufier RV](2026-10-19-morphometrics-morpho3d-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [解析器:xlsx 的 inflate 违反 RFC 1951、TPS 的 ID 错位、NEXUS 矩阵行与 taxa 不绑定](2026-10-19-parsers-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-10-19 | [导出:LaTeX 丢标题、HTML 上下文用 LaTeX 转义器、写盘失败被报成「用户取消」](2026-10-19-reporting-export-fixes.md) | 缺陷修复 |
| 2026-10-19 | [controllers + utils:SIMPER 丢弃 metric、Phylo ANOVA 对空分组作结论、缺失值口径三套](2026-10-19-controllers-and-utils-fixes.md) | 缺陷修复 / 数值变更 |
| 2026-09-27 | [ProcessPool.execute 泄漏超时定时器:每次成功调用都悬住事件循环](2026-09-27-processpool-timeout-timer-leak.md) | 缺陷修复 |
| 2026-09-27 | [DFA.minimize() 改写了自己:每调一次多一个 DEAD 状态](2026-09-27-dfa-minimize-mutated-receiver.md) | 缺陷修复 |
| 2026-09-27 | [BCa 在退化分布上静默返回 NaN 区间;同时锁住 normInv/normCDF/BCa 公式](2026-09-27-bootstrap-bca-degenerate-nan.md) | 缺陷修复 / 数值变更 |
| 2026-09-27 | [Bray-Curtis 分母漏了绝对值:两个不同的样本被报成距离 0](2026-09-27-bray-curtis-denominator-missing-abs.md) | 缺陷修复 / 数值变更 |
| 2026-09-27 | [PNG 导出写的是整个底层 buffer,不是视图本身](2026-09-27-binary-export-writes-whole-buffer.md) | 缺陷修复 |
| 2026-09-27 | [负的置换次数会回答一个没人问的问题:产出 p = -0.5 与 p = 1.0](2026-09-27-permutation-count-lower-bound.md) | 缺陷修复 |
| 2026-09-27 | [成分数只有上界(零列/负数)与 4 个非 UTF-8 源文件:结构门禁用 errors='ignore' 吞了坏字节](2026-09-27-component-count-lower-bound-and-utf8.md) | 缺陷修复 |
| 2026-09-27 | [快捷分析链路:本人上一个提交引入的回归 + 跑不了的分析被报成 completed](2026-09-27-ets-dispatch-groups-and-false-completion.md) | 缺陷修复 |
| 2026-09-27 | [Index.ets 编译不过:字符串字面量里的真实换行](2026-09-27-index-ets-uncompilable-string-literal.md) | 缺陷修复 |
| 2026-09-27 | [分析历史去重会吞掉真实运行:参数相同的两次分析只留下一条](2026-09-27-history-dedup-data-fingerprint.md) | 缺陷修复 |
| 2026-09-27 | [statistics 第二轮审查:9 处缺陷,含 1 处全模块级 NaN](2026-09-27-statistics-matrix-nan-fixes.md) | 缺陷修复 |
| 2026-09-27 | [ets 层:两个"恒等映射"被当成真分析展示,导出复选框完全无效](2026-09-27-ets-identity-analyses-and-export-flag.md) | 缺陷修复 |
| 2026-09-27 | [utils + controllers:协方差算错轴、EFA 分辨率被丢弃、校验器谎报支持集](2026-09-27-utils-covariance-and-efa-resolution.md) | 缺陷修复 / 文档 |
| 2026-09-27 | [models + UI 接线:分组分析整条链路断开,用户分组永远到不了模型](2026-09-27-group-pipeline-and-transpose-metadata.md) | 缺陷修复 |
| 2026-09-27 | [morphometrics 第二轮审查:5 处缺陷,其中 3 处让统计检验完全失效](2026-09-27-morphometrics-eigensolver-and-tests.md) | 缺陷修复 / 重构 |
| 2026-09-27 | [3D 形态测量数值验证:修 2 处缺陷,并把"未接入"写进文档](2026-09-27-morpho3d-validation.md) | 缺陷修复 / 文档 |
| 2026-09-27 | [全仓审查：p 值失效、输出静默损坏、可复现性](2026-09-27-full-repo-audit-fixes.md) | 缺陷修复 |
| 2026-09-19 | [全仓审查与修复 + 参照项目借鉴](2026-09-19-review-and-borrowing.md) | 缺陷修复 / 重构 / 工程 |
