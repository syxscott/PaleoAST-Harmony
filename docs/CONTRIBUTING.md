# 贡献指南

本项目的产出会被写进论文，因此**「结果对不对」优先于「功能多不多」**。

---

## 1. 开发环境

- DevEco Studio（HarmonyOS SDK 5.0.0(12)）
- Node.js 22+（跑单测，不需要设备）
- Python 3.10+（跑结构检查）

```bash
# 单元测试（78 个用例，必须全绿）
node --experimental-transform-types tests/test.mjs

# 结构检查（括号平衡 + 重复导出）
python tools/structure_check.py
```

> `--experimental-transform-types` 不能省：`tests/runner.ts` 用了构造器参数属性。
> 也不要直接跑 `tests/run.ts`，必须走 `tests/test.mjs` —— 核心模块使用无扩展名相对导入，靠 `tests/loader.mjs` 解析。

---

## 2. 一次改动的完整流程

1. **定位**：先读 [`architecture/troubleshooting.md`](architecture/troubleshooting.md) 对应症状，拿到调用链。
2. **复现**：写一个**会失败的**测试。测试名要描述被修复的旧行为，
   例如 `xlsx import keeps the first data row and resolves cell types`。
3. **修因**：改根因，不要加特例绕过。若发现同一逻辑有两份实现，**删掉一份**。
4. **验证**：
   - 新测试从红变绿；
   - 全部 78 个用例仍绿（回归优先）；
   - 改了 barrel 就补跑逐模块 `import()` 冒烟检查（见 `AGENTS.md`）——纯类型误当值导入只有这一步能抓。
5. **记录**：在 `docs/changes/YYYY-MM-DD-<slug>.md` 加一条（模板见下）。
6. **提交**：`type(scope): subject`，英文半角冒号。

---

## 3. 变更记录模板

`docs/changes/YYYY-MM-DD-<slug>.md`：

```markdown
# <一句话标题>

## 类型
缺陷修复 / 新功能 / 重构 / 文档

## 问题
观察到什么，期望什么。给出具体数字（旧值 → 新值）。

## 根因
为什么会这样。若同一逻辑存在多份实现，指明合并到了哪一份。

## 修复
改了哪些文件、关键决策是什么。

## 验证
- 新增测试名
- 跑了哪些检查、结果如何
- 若为数值改动：影响哪些分析，用户是否需要重跑旧结果

## 风险
未覆盖的场景、遗留限制
```

---

## 4. 三条硬约束

### 4.1 可复现性

随机过程必须使用 `core/math/random` 的种子 PRNG，`rngSeed` 默认 42。
`Math.random()` 出现在 `core/analysis/**` 中按缺陷处理。

### 4.2 不许静默算错

- 迭代算法不收敛必须抛错，不得返回「看起来合理」的值。
- 原生层失败必须带错误码（`cpp/core/ErrorHandler.h`），不得只返回 `null`。
- 若某输入组合无法正确处理，**报错优于猜测**。

### 4.3 许可

本项目是 **MIT**。`.workbuddy/refs/` 下的参照仓库中：

| 仓库 | 许可 | 可否复制代码 |
|---|---|---|
| `mpchart` | Apache-2.0 | ✅ 可（保留 NOTICE/声明） |
| `qcharts` | MIT | ✅ 可（保留版权声明） |
| `CalculatorX` | **GPL-3.0** | ❌ **不可**。只可学习架构、约定、构建手法，然后 clean-room 重写 |

不确定时：只描述「学到了什么模式」，自己重新实现。

---

## 5. 新增一个分析功能

以 `FooAnalyzer` 为例，改动点固定为五处：

| 步骤 | 文件 | 要点 |
|---|---|---|
| 1. 算法 | `core/analysis/<模块>/foo.ts` | 纯函数优先；结果类型加 `Result` 后缀；随机过程带 `rngSeed` |
| 2. 导出 | `core/analysis/<模块>/index.ts` | 纯类型走 `export type` |
| 3. 控制器 | `core/controllers/StatisticsController.ts` | 加 `runFoo()`；入参做范围校验 |
| 4. 导航与对话框 | `ets/components/NavigationTree.ets`、`components/dialogs/FooDialog.ets` | 条目名必须与 `Index.ets` 的 `case` **完全一致**（含空格） |
| 5. 接线 | `ets/pages/Index.ets` | `runDialogAnalysisCore` 加 `case`，读对话框提供的键；`runAnalysisWithParams` 填图表序列（记得先清空） |

若该分析属于新的 Ribbon 分类，还要改 `Index.ets` 的 `RIBBON_TAB_SECTIONS`。

**验收标准**

- [ ] 结果与某个独立参照（R 包 / 论文 / 手算）在固定输入上一致，并写成测试
- [ ] 对话框的每个参数都真的传到了算法（逐个 grep 键名）
- [ ] 图表不再沿用上一次分析的序列
- [ ] `docs/architecture.md` 的分层表与 `troubleshooting.md` 的症状表已按需更新

---

## 6. 报告问题

用仓库的 issue 模板。报「结果不对」时请附上：

- 输入文件（可脱敏的最小复现）
- 得到的值与期望的值
- 期望值的来源（论文 / R 包 / 手算过程）
