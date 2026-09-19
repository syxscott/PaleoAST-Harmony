# 真机 / 设备端测试

本目录把「界面能不能真的跑通一次分析」变成可执行的检查。

## 为什么需要它

单元测试只调用 `StatisticsController`，**从不经过 `ets/pages/Index.ets`**。审查中实际抓到的高频缺陷恰好都在这一段接线里：

- 对话框用**错误的名字**派发（Univariate 硬写 `'Summary'` → 选任何检验都跑描述统计）；
- 对话框收集了参数，但派发开关**从不读取**该键（Rarefaction 的 `sample_index` / `max_n` / `n_points` 全部被丢弃）；
- 分析在导航树里点得到，但 `runDialogAnalysisCore` 里**没有对应 `case`**；
- 某个 `DialogManager.open(X)` 打开了一个**没人处理**的对话框。

这些既不会被类型检查发现，也不会被单测发现。静态模式无需设备即可全部覆盖。

## 两种模式

### 1. 静态接线检查（默认，无需设备，可进 CI）

```bash
node test/device/run.mjs
node test/device/run.mjs --json          # 机器可读
node test/device/run.mjs --cases <dir>
```

对 `cases/*.json` 里的每条用例，解析生产代码并验证：

| 检查 | 抓什么缺陷 |
|---|---|
| 分析名在 `runDialogAnalysisCore` 里有 `case` | 分析从界面不可达 |
| 用例里每个参数键在该 `case` 块中**确实被读取**（含它调用的私有 helper，例如 `sampleIndex(params)`） | 对话框的值被静默丢弃 |
| 分析名出现在 `NavigationTree` 或某个 `DialogManager.open()` 的目标里 | 没有入口 |
| 反向：每个 `DialogManager.open(X)` 的 X 都有 `case` | 打开一个没人处理的对话框 |

### 2. 设备探测（需要真机或模拟器）

```bash
node test/device/run.mjs --device <udid>
node test/device/run.mjs --device <udid> --hdc "C:/.../hdc.exe"
```

确认 hdc 能看到设备、目标 bundle 已安装、`EntryAbility` 能拉起。
**它只做「通不通」的探测**，不代替逐用例的界面断言。

## 用例格式

```json
{
  "suite": "analysis-smoke",
  "cases": [
    { "analysis": "PCA", "params": { "nComponents": 3, "method": "covariance" } }
  ]
}
```

- `analysis`：必须与 `Index.ets` 里 `case '<name>':` **完全一致**（含空格与大小写，例如 `'Diversity Indices'`）。
- `params`：键名必须与派发开关读取的键一致（例如 PCA 用 `nComponents`，PCoA 用 `n_components` —— 两种命名风格确实并存，以代码为准）。

现有 `cases/analysis-smoke.json` 覆盖 19 条，含 Univariate 的 5 种检验、多元统计、多样性、聚类、地层与形态测量各一类。

## 已知缺口（下一步）

用例目前只验证**接线**。要形成真正的端到端覆盖，还需要：

1. 用 `hdc uitest`（或截图比对）驱动界面：打开对话框 → 填参数 → 确认 → 断言状态栏与图表；
2. 断言数值：把结果与 `tests/core.test.ts` 里已验证的期望值对齐（例如同一份输入下 PCA 特征值）；
3. 覆盖数据导入路径（CSV / xlsx）—— 目前 0 覆盖。

在补上第 1 点之前，**不要把本目录的运行结果当作端到端通过。**

## 与单测的分工

| 层次 | 命令 | 覆盖 |
|---|---|---|
| 算法 | `node --experimental-transform-types tests/test.mjs` | 78 个用例，core 层数值正确性 |
| 接线 | `node test/device/run.mjs` | 界面入口 → 派发 → 参数传递 |
| 设备 | 同上 `--device` | 安装、启动、可达性 |
| 结构 | `python tools/structure_check.py` | 括号平衡、重复导出 |
