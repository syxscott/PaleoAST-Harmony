# Splash.ets 的相对导入少上溯一级:指向一个不存在的目录,整个启动页编译不过

## 类型

缺陷修复 / 工程

## 问题

`entry/src/main/ets/pages/Splash.ets` 用**一级**相对路径导入启动加载器：

```ts
import { createPaleoastStartupLoader, type StartupProgress } from '../core/app_infrastructure/StartupLoader';
```

加载器实际在 `entry/src/main/core/app_infrastructure/StartupLoader.ts`，而导入方位于
`entry/src/main/` **之下两级**（`main/ets/pages/`），必须上溯两级。一级路径
`'../core/...'` 落到 `entry/src/main/ets/core/app_infrastructure/`——**该目录不存在**。

ArkTS 编译器无法解析该模块 → `Splash.ets` 编译失败 → 应用**没有启动页**，
停在白屏。

该缺陷自 `Splash.ets` 引入起一直存在，**不是** 2026-10-19 全仓审查引入的；
那次审查的 10 个分域 agent 各自只看了自己那一层，没人有跨层的导入图。

## 根因

仓库里**没有任何一道门**能看见「相对路径指向不存在的文件」：

| 门 | 覆盖范围 | 为什么看不见 |
|---|---|---|
| 单元测试（`tests/test.mjs`） | 只 import `core/**` | `.ets` 层用 ArkUI DSL，Node 里 import 不了 |
| 导入冒烟（109/109 模块） | `core/**` 全部模块 | 同上，`ets/` 树完全不在其中 |
| 设备接线闸门（`test/device/run.mjs`） | 跑 JSON 用例 | grep 标识符名，不解析路径 |
| `tools/structure_check.py` | 括号配平 + 重复导出 | 括号是配平的，路径写错不影响括号 |
| CI（`unit-and-structure` job） | 以上三步 | 门禁没被执行 = 没有门禁 |

也就是说：`.ets` 层的**导入图**此前从未被任何检查解析过。

## 修复

| 文件 | 改动 |
|---|---|
| `entry/src/main/ets/pages/Splash.ets` | `'../core/...'` → `'../../core/...'`（与 `Index.ets` / `PlotCanvas.ets` / `WorkspaceView.ets` / `utils/dataFingerprint.ts` 一致） |
| `tests/etsImports.test.ts`（**新增**） | 解析 `entry/src/main/` 下**每一条**相对导入，逐条落到文件系统上验证 |
| `tests/run.ts` | 注册新套件 |

新门禁的关键设计——**先证明它会咬合，再让它守门**：

1. 用一个**真实存在的坏路径**（`'../core/app_infrastructure/StartupLoader'`）断言它解析不到，
   用修好的路径断言它解析得到。门禁若分不清好坏，就等于没有门禁。
2. 覆盖四种合法形态：字面文件、`.ts` 后缀、目录 barrel（`core/models/index`）、
   同级文件（`./rowGroups`）、子目录（`./plot/boxGeometry`）。
3. 扫描前先剥注释，**注释里的 import 不算 import**（否则一次注释掉的代码就能让 CI 变红）；
   字符串里的 `import` 同理。
4. 断言实际检查数量 > 200，防止「目录写错 → 一个文件都没扫到 → 绿」的假通过。

## 验证

- 全仓 `entry/src/main/` 共 **295 条相对导入**，修复前 **1 条**解析不到（Splash.ets），
  修复后 **0 条**。
- 新增 `tests/etsImports.test.ts`：**4 例全绿**（含门禁自检 2 例）。
- 全量单测 **586 例全绿**（此前 582）。
- `.ets` 层的「改前/改后」差集类型检查（`62715c7` → `HEAD`）：
  **新增未定义名 0 条、新增成员/参数诊断 0 条**；消失的恰好是本次修复的
  `suggested`（`PlotCanvas.ets` 未声明变量）与 `dataFingerprint`（`Index.ets`
  的 `this.` 调用）。

## 风险

- **本机没有 DevEco / ohpm / hvigor**，因此「ArkTS 真的能编译」**仍未验证**。
  导入路径的正确性是按 ArkTS 的相对解析规则推断的（与仓库其余 294 条能解析的
  相对导入同规则），不是编译器实测。
- 门禁只覆盖 `entry/src/main/`（随包发布的代码）。`tests/` 与 `tools/` 的
  相对导入**没有**纳入：前者由测试套件自身 import 兜住，后者由 CI 实际执行兜住。
- 只校验「相对导入能否解析到文件」。**不校验**被导入符号是否存在、类型是否匹配、
  循环依赖——那些要等真正的 ArkTS 编译。
