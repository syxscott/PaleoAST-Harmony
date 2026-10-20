# 断点布局:5 处零散判断 → 一张取值表 + 可单测的规则

## 类型

重构 / 工程

## 问题

视口相关的取值散在页面里，**同一件事被写了 5 遍、5 种写法**：

```ts
// Index.ets
isSmallScreen: this.breakPoint === 'sm',
.showSideBar(this.breakPoint === 'sm' ? this.sidebarOpen : true)
.sideBarWidth(this.breakPoint === 'lg' || this.breakPoint === 'xl' ? 280 : 240)
.minContentWidth(this.breakPoint === 'sm' ? 0 : 480)
if (this.breakPoint === 'sm' && this.sidebarOpen) { ... }
```

问题不在于「长」，而在于**没法测**：规则住在页面组件里，而页面组件用 ArkUI DSL，
Node 测试套件 import 不了它。断点的边界（600 / 840 / 1440 vp）写死在
`config/Breakpoint.ets` 的静态方法里，也一样测不到。

## 根因

「断点 → 某个值」的映射被写成了**条件表达式**，而不是**取值表**。条件表达式
既不能枚举、也不能对账、更不能被单元测试覆盖。

## 修复

### 1. `entry/src/main/ets/config/breakpointRules.ts`（新增，纯 TS）

规则与查表搬出组件层，进入 Node 能测的地方：

- `computeBreakpoint(widthVp)`：宽度 → 桶（边界 600 / 840 / 1440 vp，
  与 HarmonyOS 官方 vp 断点一致）
- `breakpointValue(current, options, default?)`：**取值 + 回退级联**。
  顺序是「当前桶 → 更窄的桶（就近）→ 更宽的桶（就近）→ 调用方默认值」。
  窄的一侧优先，因为小屏设计出来的取值在中间宽度下更安全。

纯 TS 意味着**没有任何 ArkUI 依赖**，`tests/breakpoint2026.test.ts` 能直接
import 它并逐条核对。

### 2. `entry/src/main/ets/config/Breakpoint.ets`（重写）

只保留**传输**：把窗口宽度写进 AppStorage。`Breakpoints.compute()` 与
`updateWindowWidth()` 的对外行为**逐位不变**（AppStorage 键名一个都没改 ——
`breakpoint` / `windowWidthVp` / `windowWidthPx`；改了名字会是个静默失败：
布局只是永远不响应折叠）。

### 3. `Index.ets`（5 处判断 → 4 个取值方法）

```ts
private isSmallScreen(): boolean {
  return breakpointValue(this.breakPoint as Breakpoint,
    { sm: true, md: false, lg: false, xl: false }, false);
}
private sideBarWidth(): number {
  return breakpointValue(this.breakPoint as Breakpoint,
    { sm: 240, md: 240, lg: 280, xl: 280 }, 240);
}
```

**默认值是按旧条件反推的**，所以行为逐位不变：
`breakPoint === 'lg' || 'xl' ? 280 : 240` ⇒ sm/md=240、lg/xl=280、未知=240。

## 关于状态管理 V2 —— 为什么这一项没有采用

参考实现（`CoolMallArkTS` 的 `BreakpointState`）用的是 V2：
`AppStorageV2.connect()` + `@ObservedV2` + `@Trace` + `bp()` 级联。
**级联那部分采用了**（就是上面的 `breakpointValue`），**V2 那部分没有**，
原因写进了 `Breakpoint.ets` 的文件头注释：

1. V2 装饰器（`@Local` / `@Param` / `@ObservedV2` / `@Trace`）**只能在
   `@ComponentV2` 组件里用**，而读断点的 `pages/Index.ets` 是 V1
   `@Component`；
2. V1 组件的 `@State` 观测的是**引用**，不是引用的内容 —— 把 V2 对象塞进
   V1 `@State`，断点变了布局**不会重绘**；
3. 把一个页面转成 `@ComponentV2`，它的子组件也得转（两个版本之间不互相
   传参）—— 那是**全部 57 个 .ets 文件**，不是角落里的一块。

所以「全树迁到 `@ComponentV2`」是**另一个项目**，而且需要真机验证。
这一项做的是能测的那一半：把决策从组件里搬出来。

## 验证

- 新增 `tests/breakpoint2026.test.ts`：**9 例**
  - 桶的边界就是官方 vp 断点
  - 宽度 → 桶（含每一个边界值）
  - **新表与旧条件逐桶对账**（4 个桶 × 3 个取值 = 12 组对照）
  - 缺桶时的回退顺序（窄侧优先）
  - 当前桶优先于回退
  - 默认值的使用
  - **未知断点**（宽度从未算过）→ 走默认值，与旧条件行为一致
  - 空表 → 抛错（编程错误，不是运行时状况）
  - 页面不再自己写条件；AppStorage 键名一个都没改
- 全量单测 **606 / 0**
- `structure_check`、接线闸门、相对导入解析、资源生成检查全绿

## 风险

- **本机无 DevEco，ArkTS 未真编译。** `breakpointValue(this.breakPoint as
  Breakpoint, ...)` 里的 `as` 断言是必要的：`@StorageLink` 声明的是
  `string`，而表是 `Breakpoint` 联合类型。
- 未知断点现在走**默认值**而不是抛错。默认值是按旧条件反推的，所以行为
  一致；但如果将来有人改了默认值而忘了看这条，会静默改变行为 —— 测试里
  钉了旧行为作对照。
- **全树 `@ComponentV2` 迁移仍未做**（见上），V1 的 `AppStorage` 传输保留。
