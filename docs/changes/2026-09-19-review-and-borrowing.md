# 全仓审查与修复 + 参照项目借鉴

## 类型

缺陷修复（32 条）/ 重构 / 工程基建

---

## 问题

对全仓做了一次系统性代码审查，随后修复，并在修复过程中又发现了若干缺陷。合计确认并修复 **32 条**。

**影响数值输出的部分**（使用旧版本算过结果的需要留意）：

| 分析 | 旧行为 → 新行为 |
|---|---|
| **所有基于特征分解的分析**（PCA / PCoA / LDA / CCA / RDA / Eigenshape / paleoEnvironment） | `eigh` 有两个缺陷；以 `[[4,1,0],[1,3,1],[0,1,2]]` 为例，旧值 `(3.792, 3.000, 2.208)` → 真值 `(4.732, 3.000, 1.268)` |
| **LDA** | 旧实现在非对称矩阵上失败/给出错误判别轴；现在用 `Sw^{-1/2}·Sb·Sw^{-1/2}` 对称化求解 |
| **xlsx 导入** | 旧：丢掉第一条数据行 + 文本单元格被替换为字符串表下标；新：行数正确、类型正确 |
| **Chao 稀疏化外推** | 旧公式在 c→1 时发散（+300 量级）；新：单调且收敛到 Chao1 |
| **PIC** | 节点方差旧用 `v1+v2`；新用逆方差合并 `v1v2/(v1+v2)`。3 叶树标准误 2.0 → √2.5 ≈ 1.5811 |
| **Blomberg K** | 旧：分子用算术均值 + 归一化因子用 `tr(V)/n`；新：两者修正。BM 下 `E[K]` 由 0.83/0.76 → 0.996–1.000 |
| **RASC** | 交换判定取反（原先保留更差的排序） |
| **FBD 化石数分布** | `λ/μ/ρ` 原先被 `void` 丢弃；现在使用 λ/μ 的期望化石数 |
| **simulateNeutral / heuristicSearch / ripleyK** | 原先用 `Math.random()`（不可复现）；现在使用种子 PRNG，默认 42 |

---

## 根因（按类别）

### 1. `core/math/linalg.ts::eigh` —— 两个独立缺陷

1. 特征向量按降序重排，**特征值数组未同步重排** → `eigenvalues[k]` 与第 k 列不配对。
2. **Jacobi 旋转角分母符号写反**（写成 `T[p,p]−T[q,q]`，应为 `T[q,q]−T[p,p]`）→ 旋转反而增大非对角元，迭代不收敛，返回的「特征值」不是特征值。300 次迭代后仍有 1.48 的非对角质量；改符号后 **10 次迭代收敛到 8e-18**。

第 2 条同时存在于 `cpp/napi/matrix_ops.cpp::Eigh`（同一处符号错误）。而同一文件的 `SVD` 用的是正确的 `(be − al)` 形式 —— 这是一个独立于本次修复的交叉印证。

### 2. 静默失效型

- `DialogLayer` 的 Univariate 硬写 `onConfirm(this.analysis('Summary'))` → 选任何检验都跑描述统计。
- `RarefactionDialog` 不提供 `sample_index`，而控制器读取该键 → 恒定用第 0 行。
- `CCADialog` 把同一个矩阵当响应与约束各传一次 → 模型退化。
- `Index.ets` 每次分析前不清空图表序列 → 「新标题 + 旧曲线」。
- `WorkspaceView` 用当前标签的序列给其他标签显示点数 → 计数错误。
- `StatisticsController::runEffectSizes` 返回三个**函数对象**而不是它们的值。
- `ExcelParser::parseCellValue` 从标签**内部**读 `t` 属性 → 类型分支全是死代码。
- `fossilCountDistribution` 网格不足时返回全零向量（读起来像「没有化石」）。

### 3. 结构性

- `PlotCanvas.ets` 991 行承担全部职责 → 坐标变换在渲染器、SVG 导出、命中判定中各有副本。
- 同一物理量多处实现：Blomberg K（2 处）、CSV 解析（2 处）。
- 纯类型名当值导入/重导出（6 处）→ 模块图无法实例化。
- `cpp/types/` 与 `oh-package.json5` 的 NAPI 依赖声明缺失 → `.so` 无法被 ArkTS 解析。

---

## 修复

### 数值与算法

- `eigh`：特征值与向量同步重排；旋转角分母改 `T[q,q]−T[p,p]`；新增对称性守卫（非对称即抛错）；新增不收敛检测（残差超标即抛错）。
- LDA：新增 `ldaSolveGeneralized()` 做对称化；`lda` 与 `ldaFit` 共用；移除伪逆多余转置。
- `ExcelParser`：删除表头行后的多余 `data.shift()`；`parseCellValue` 增加 `typeAttr` 参数由调用方从 `<c>` 标签读取；补 `inlineStr` 的 `<is><t>` 提取；行装配支持布尔单元格。
- `CoverageRarefaction`：外推改为有界单调形式，c→1 收敛到 Chao1。
- PIC：节点方差改逆方差合并。
- `blombergKFromVCV`：分子改用 GLS 均值；归一化因子改 `(tr(V) − n/(1ᵀV⁻¹1))/(n−1)`。**两处重复实现合并为一处**（`analysis/phylogenetics/vcv.ts`），`statistics.ts` 改为导入。
- RASC：交换判定取反，与同文件 `_cost` 的取最小约定一致。
- `fossilCountDistribution`：使用 λ/μ；网格盖不住分布时抛出可操作的错误。
- `phyloANOVA`：置换 p 值改用 Phipson 校正，与同模块另三处一致。
- `simulateNeutral` / `heuristicSearch` / `ripleyK`：改用种子 PRNG，新增 `rngSeed`（默认 42）。
- `Normality`：删除未被读取的 `m` 查表与 `m_n` 死变量。

### UI 接线

- `DialogLayer`：Univariate 按自己的名字派发；`Index` 按 `test_type` 分发到四个检验。
- `RarefactionDialog` 新增样本行选择器；`max_n`/`n_points` 真正传入。
- `CCADialog` 新增「约束列数（自末尾计）」，Y/X 分离。
- `Index.runAnalysisWithParams`：分析前清空序列；按结果真实字段填充各分析分支；新增按标签名索引的图表快照（切页重新灌入、换数据集整体失效、标签淘汰同步清理）。
- `RibbonBar` 各标签通过 `RIBBON_TAB_SECTIONS` 真正过滤导航树。
- `NavigationTree` 新增 `allowedSections`。

### 报告与解析

- `LatexCompiler`：`\end{figure}` → `\end{table}`；`escapeLatex` 改单次遍历、空值安全。
- `TableGenerator.latex`：数据行补前导标签列；`_escape` 单次遍历并正确处理 `\ ~ ^`。
- `CSVParser`：`splitCSVLine` 处理 RFC 4180 `""`；`toCSV` 按需加引号；`ExcelParser` 复用同一实现（合并两套解析）。
- `StateManager.setData`：清空全部历史栈与结果缓存。
- `DataController.subsetRows/subsetColumns`：逐行取用并校验、去重索引。

### NAPI

- **补齐 ArkTS 侧的接线**：新增 `cpp/types/libpaleoast_napi/{index.d.ts, oh-package.json5}`，`entry/oh-package.json5` 声明 `file:` 依赖。此前 `/so` 无法被解析，`initNative()` 恒为 false。
- 新增 `cpp/core/ErrorHandler.h`（错误码）与 `cpp/utils/Logger.h`（日志）；`matrix_ops.cpp` 的业务错误由裸 `nullptr` 改为 `"Error:<Code>"` 字符串。
- `NativeMath`：新增 `nativeLastError()`；修正 `nativeDistanceMatrix` 的参数顺序（原先把 metric 当维度、把 0 当 metric，导致维度检查必然失败并静默退化为 TS 路径）。
- `CMakeLists.txt`：`cmake 3.14` + `PACKAGE_FIND_FILE` 引导块 + 链接 `libhilog_ndk.z.so`（此前 C++ 无法打日志）。
- `entry/build-profile.json5`：新增 `abiFilters: [arm64-v8a, x86_64]`（否则真机或模拟器只有一个能拿到 `.so`）；新增 release 的 `buildOptionSet`（开启混淆规则 + 剥离 C++ 调试符号）。

### 工程基建（借鉴参照项目）

- `code-linter.json5`（官方 linter，含 `@performance/recommended`）
- `.github/workflows/ci.yml` —— 无需设备的质量门：只阻断「未解决冲突」与「密钥入库」，其余只警告
- `.github/{ISSUE_TEMPLATE,PULL_REQUEST_TEMPLATE.md,SECURITY.md}`
- `AGENTS.md`（AI 助手约定）、`local.properties.template`、`build-profile.json5.template`
- `ets/utils/{Logger,PreferenceManager,AppSettings}.ets`、`ets/database/HistoryRepository.ets`（RDB 分析历史：单宽表 + 扩展槽 + 复合索引 + 静默去重 + 滚动保留 100 条）
- `ets/components/plot/{ViewPortHandler,ChartComputator,ChartHighlighter,ValueFormatter}.ts` —— 从 `PlotCanvas` 抽出的纯逻辑（可 Node 单测）
- `tools/structure_check.py`（正确处理正则字面量的结构检查）
- `test/device/`（hdc 驱动的声明式真机测试骨架）
- 本 `docs/` 目录与 `AGENTS.md`

---

## 验证

- `tests/core.test.ts`：47 → **78 个用例全绿**。新增用例覆盖：`eigh` 配对与收敛、LDA 可分性、中位数、PIC 标准误、Blomberg K 的 `E[K]=1`、Chao 有界性、RASC 代价单调、xlsx 首行与类型、CSV 往返、StateManager 换数据、subsetRows、LaTeX 表格环境、runEffectSizes 返回数值、视口往返/缩放/平移/退化范围、刻度、命中判定、格式化。
- 逐模块动态 `import()`：108 个 core 模块全部可导入，0 失败（修复前 `StatisticsController` 直接无法导入）。
- `tools/structure_check.py`：0 问题。
- 仓库自带 `CodeAudit.auditSource`：修复其正则字面量误判后，全仓 0 错误（修复前 20 个假阳性）。
- **BM 模拟判定 Blomberg K**：用树自身 VCV 的 Cholesky 采样 20,000 次，`E[K]` 由 0.8339 / 0.7556 → 0.996–1.000（应为 1）。另单独模拟归一化因子 30,000 次，与推导式吻合到蒙特卡洛误差内。
- **OU 协方差实证**：α→0 收敛到 BM VCV（偏差 O(α·t)）、严格对称、正定 —— 确认原怀疑为误报，未改动代码。

**需要重跑的场景**：用旧版本产出过 PCA/PCoA/LDA/CCA/Eigenshape/LDA 载荷、xlsx 导入结果、Chao 外推、PIC 标准误、Blomberg K 的用户，建议重算。

---

## 风险与遗留

- **NAPI 已接线但未被调用**：`nativeSVD` 等尚无调用方，且 C++ 的 `matrixSVD` 只返回奇异值、`matrixEigh` 只返回特征值，与 TS 版本不是等价替换。**启用前必须逐一对拍并补对比测试。**
- `matrix_ops.cpp::Clustering` 已实现 Ward.D2，但 `NativeMath.ts` 缺 `nativeClustering` 包装，从 TS 层不可达。
- `PlotCanvas` 的 `dendrogram` 类型缺 linkage 通道，Clustering/CONISS 目前绘制真实的「合并高度曲线」而非树状图。
- 真机端 `hasNative()` 的最终确认需要设备（`test/device/` 骨架已就位）。
- i18n 仍只有 en / zh。
