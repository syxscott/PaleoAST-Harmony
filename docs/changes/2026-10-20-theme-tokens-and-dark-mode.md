# 配色 token 化:442 处硬编码色 → 单一真源 + ArkUI 资源机制 + 系统深色模式

## 类型

缺陷修复 / 重构 / 工程

## 问题

`.ets` 层带着 **442 处硬编码 hex 色值**（散在 49 个文件里），暗色主题靠 **72 处手写
`darkMode ? '#a' : '#b'` 三元**实现。

真正的问题在别处：

- `resources/base/element/color.json` **早就存在**，定义了 8 个颜色 —— 但整个
  `.ets` 层对 `$r('app.color.*')` 的引用数是 **0**。ArkUI 的资源机制**从未接上**。
- **没有 `resources/dark/` 目录** → ArkUI 的自动深色模式**根本没有生效过**。
- 应用有自己的暗色开关（`RibbonBar` 写 `AppStorage['darkMode']`），但全仓
  **没有一处 `setColorMode` / `ColorMode`** → 平台的颜色模式与应用变量是
  两件互不相干的事。

也就是说：**深色模式是手写出来的，资源机制是空转的。**

## 根因

442 处硬编码色值里，**316 处（71%）正好命中 `color.json` 里早已定义却无人引用的
token**（`#3498DB` 97 次、`#7F8C8D` 95 次、`#FFFFFF` 80 次）。颜色被复制了
几百遍，token 躺在资源文件里没人用。

深色模式没有接资源系统，是因为**没人把两件事连起来**：应用有开关，平台有
`setColorMode`，中间缺一根线。

## 修复

### 1. 单一真源：`entry/src/main/ets/theme/tokens.ts`（新增，纯 TS）

30 个 token，每个都有 light / dark 两个值，**按角色命名**（`text_secondary`
说清「这个颜色干什么用」，而不是「它长什么样」）。另有 4 个**带 alpha 的
token** 单独放在 `ALPHA_TOKENS` 里。

纯 TS 是刻意的：它不 import 任何 ArkUI 东西，所以 Node 单测能直接检查它。

**alpha 通道的坑**：ArkUI 把**资源色**读成 `#AARRGGBB`、把**字符串色**读成
`#RRGGBBAA`。所以 8 位的色值**绝不能进 color.json** —— 同一个字符串，两种
读法含义不同，浅蓝底会变成一块实色。这 4 个 token 因此只走字符串路径。

### 2. 生成器：`tools/gen_theme_resources.mjs`（新增）

从 token 表生成 `resources/base/element/color.json` 与
**`resources/dark/element/color.json`（新增）**。`--check` 模式只校验不写，
**CI 会跑它** → 资源文件与 token 表不可能漂移。

`module.json5` 引用的 `$color:start_window_background` 名字由清单固定，
因此保留为 token（并让它跟随主题）。

### 3. 替换：442 → 0

替换形状按**类型**分，不是按风格分：

| 位置 | 变成 | 原因 |
|---|---|---|
| UI 属性（`.fontColor` / `.backgroundColor` / `.borderColor` / `.color` / `.border({color})` / `.shadow({color})`） | `$r('app.color.<token>')` | `ResourceColor` 接受 `Resource`，**资源系统自己切换**，暗色三元直接消失 |
| 其余（Canvas 绘制、SVG 导出、调色板数组、**返回颜色的函数**） | `token('<token>', this.darkMode)` | 这些地方要的是**字符串**；SVG 装不下 Resource，返回 `Resource` 的函数也过不了 `string` 返回类型 |

`.fontColor('#FFFFFF')` 与 `.backgroundColor('#FFFFFF')` **语义不同**（蓝底白字
vs 白底），所以映射按**属性角色**走，不按色值一刀切：白字 → `text_on_accent`
（两套主题都是白），白底 → `bg_primary`（跟随主题）。

### 4. 把开关和平台接起来：`entry/src/main/ets/theme/ThemeController.ets`（新增）

`setColorMode` **不在 `UIContext` 上**，而在 `UIAbilityContext` /
`ApplicationContext` 上，枚举是 `ConfigurationConstant.ColorMode.COLOR_MODE_DARK/LIGHT`
（`@kit.AbilityKit`）。平台给的优先级是
「Ability 的颜色模式 > Application 的 > 系统的」，正好适合应用内开关。

- `EntryAbility.onCreate()`：读持久化的偏好，启动即恢复上次的��题
- `RibbonBar` 的开关：`getUIContext().getHostContext() as common.UIAbilityContext`
  → `applyColorMode(ctx, isOn)`

### 5. 顺带修掉的两个真问题

- `DiagnosticConsole` / `FloatingToolbar` 用了 `this.darkMode` 却**没声明这个
  属性**（ArkTS 会编译不过）→ 补 `@StorageLink('darkMode')`
- `DiagnosticConsole.getLevelColor()` 返回 `string`，不能返回 `Resource` →
  走 `token()` 路径

## 验证

- 新增 `tests/theme2026.test.ts`：**10 例**，含 4 条门禁
  - 「`.ets` 层不再有任何裸 hex 字面量」（防止 442 处回潮）
  - 「`$r('app.color.x')` 引用的每个 x 都存在于 color.json」（抓拼写错误）
  - 「`token('x')` 引用的每个 x 都存在于 token 表」
  - 「两份 color.json 与 token 表逐条一致」
  - **「浅色主题的每个颜色与迁移前逐位相同」**（14 个值被钉死）
- `tests/sourceScan.ts`（新增）：注释感知扫描器。**注释里的 `$r('app.color.x')`
  不是引用** —— 门禁自己也被这个骗过一次
- 全量单测 **596 / 0**（此前 586）
- `structure_check` 180 文件 / 0 问题；接线闸门 19/19
- 相对导入解析 **305 条 / 0 不通**（此前 295）
- 颜色资源 `--check`：30 色 × 2 主题，与 token 表一致
- `.ets` 改前/改后差集类型检查：**新增未定义名 0、新增成员诊断 0**
- CI 新增一步：`gen_theme_resources.mjs --check`

## 风险

- **本机没有 DevEco / ohpm / hvigor，ArkTS 仍未真编译过。** 迁移是机械替换 +
  逐条 review diff，但渲染效果**没有实机验证**。
- `setColorMode` 是 **API 12** 的接口；本项目 `compatibleSdkVersion` 是
  `5.0.0(12)`，**刚好够**。若将来降级 SDK，UI 属性会停在浅色（Canvas 与 SVG
  走 token 表，仍然正确）。
- `setColorMode` 失败时只打一条 warn，不影响启动 —— 代价是那一次 UI 属性不切换。
- **Canvas 与 SVG 的深色仍然是手工判断**（`token('x', this.darkMode)`）。
  这是刻意的：Canvas 需要字符串，Resource 转字符串的接口路径无法在本机验证。
  浅色下与资源系统完全一致（同一张表）。
- 4 个带 alpha 的 token 保留 8 位字符串，其 `#RRGGBBAA` 读法与迁移前**逐位相同**
  （未改语义）。但它们**没有深色变体**（`shadow_*` 两套主题同值），
  这是迁移前的原样。
