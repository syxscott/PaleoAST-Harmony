# core/math：SVD 宽矩阵返回转置的 U/Vt、奇异判据用绝对阈值

## 类型

缺陷修复 / 数值变更

## 问题

`core/math/{Matrix,linalg}.ts` 的 5 条缺陷，其中一条让 `svd` 在**宽矩阵**
（行数 < 列数）上返回的形状与自己的文件头契约相反。

## 根因

1. `svd` 在处理宽矩阵时先把 `A` 转置、交换 `m`/`n`，但**交换时没有同时转置**
   `U` 与 `Vt` → 返回的 `U`/`Vt` 各自差一个转置。
2. Jacobi 旋转的守卫 `|gamma| < 1e-14·√(αβ)` 对**两列同时为零**的情况是
   `0 < 0` = false，于是 `tau = (beta-alpha)/(2·gamma)` = 0/0 = **NaN**，
   整个分解被污染（秩亏矩阵 / 零矩阵此前**静默返回一堵 NaN**）。
3. U 的列守卫 `S[j] > 1e-15` 是**绝对**阈值，量级小的矩阵整个 U 被清零。
4. `det` 对非方阵**静默**返回左上子块的行列式；奇异判据用**绝对** 1e-15，
   与同仓 `core/math/Validation.ts` 的 `assertNoSingular`（相对阈值
   `threshold * maxAbs`）口径不一致。

## 修复

| 文件 | 旧行为 → 新行为 |
|---|---|
| `linalg.ts` `svd` | 交换时同时转置 → 宽矩阵 `Vt` 由 3×2 变为 2×3（符合文件头契约），`A = U·diag(S)·Vt` 可拼出来，重构残差 2.4e-15，奇异值与 numpy 2.2.6 逐位一致 |
| | 新增 `assertSvdReconstructs`：返回前校验重构，相对残差 > 1e-10·‖A‖_F 即抛错（**错形状不再静默返回**） |
| | Jacobi 守卫加 `gamma === 0` 短路 → 秩亏 / 零矩阵不再产生 NaN（残差 3.5e-15） |
| | U 列守卫改 `S[j] > 0` |
| | `det` 非方阵抛 `det: matrix must be square`；主元改相对阈值 `1e-14·maxAbs` |
| | `inv` / `solve` / `lstsq` 的奇异判据统一为相对阈值 `1e-14·maxAbs`，与 `Validation.assertNoSingular` 同口径 |
| `Matrix.ts` | **功能无需修改**：广播在 commit `4250bab` 已修好。只补了文档说明 `meanAxis(0)` 归零的是**列**和、`meanAxis(1)` 归零的是**行**和 |

## 验证

- 新增 `tests/fixMath2026.test.ts`：**15 例全绿**。
- **守卫有效性**：把三个源文件整体回退到旧版 → 15 例中 **13 例失败**
  （每个缺陷都被捕获，不是"测试照着 bug 写"）。
- numpy 2.2.6 独立对拍：宽/高/方阵的奇异值逐位一致；200×200 随机阵最大
  相对残差 4.2e-14（自检阈值 1e-10，留 4 个数量级余量）。
- `lstsq` 的宽矩阵解由 2×1 变为 3×1 且 `A·x ≈ b`（1e-14）。

## 风险

- `det` 用全局 `maxAbs` 的相对阈值（按 `assertNoSingular` 同口径），对动态范围
  极大的矩阵（`diag(1e-30,1e30)`，真值 1）会判成 0——同口径取舍，未另立标准。
- 本机无 `tsc`（未获授权安装），未做类型检查；`transform-types` 已解析并执行
  全部改动路径，109 个 core 模块导入冒烟 108 通过（唯一失败是
  `core/io/FilePickerHelper.ts` 的 `@kit.CoreFileKit` shim 缺 `picker`——该 shim
  缺口已由 lead 补上，现全部通过）。
- 一处**审查结论的更正**：`Matrix` 的广播其实**早已修好**（commit `4250bab`），
  当时那条红灯是**断言本身写错了**（`tests/statistics2026.test.ts` 对**行**求和
  断言 0，而按列减均值归零的是**列**和）。本轮只把断言改成正确的不变量，
  未改 `Matrix.ts` 的行为。
