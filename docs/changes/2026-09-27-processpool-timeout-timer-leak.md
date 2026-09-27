# ProcessPool.execute() 泄漏超时定时器:每次成功调用都挂住事件循环

## 类型
缺陷修复

## 问题

```ts
const result = await Promise.race([
  Promise.resolve(fn()),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
]);
```

`fn` 先返回时那个 `setTimeout` **从不被清除**,于是每次成功调用都把事件循环
按住整个 `timeoutMs`(默认 **30 秒**)。

实测(`timeoutMs = 3000`,`fn` 是个平凡函数):

| | 进程墙钟时间 |
|---|---|
| 修复前 | **3174 ms**(挂满整个超时) |
| 修复后 | **155 ms** |

在设备上这意味着最后一次分析之后再压 30 秒;在 node 里任何调用
`execute()` 的脚本或测试都无法及时退出。

## 根因

`Promise.race` 只决定**哪个 promise 先赢**,不负责取消输掉的那些。
超时 promise 仍然持有它的定时器句柄,事件循环就不会空。

## 修复

把定时器句柄存下来,在 `finally` 里清除:

```ts
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  const result = await Promise.race([
    Promise.resolve(fn()),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
    }),
  ]);
  return { result, error: null, duration: Date.now() - start };
} catch (e) {
  return { result: null, error: String(e), duration: Date.now() - start };
} finally {
  if (timer !== undefined) clearTimeout(timer);
}
```

**超时守卫本身没有改动** —— 真的超时时仍然会超时,而且这一点有测试钉住,
以免这个修复把它变成空操作。

## 验证

新增 `tests/processPool2026.test.ts`,4 条测试:成功路径快速返回且不占住事件循环、
真超时仍被捕获、`fn` 抛错时定时器也被清除,以及下面那条被钉住的既有契约。

**守卫有效性**:以进程墙钟时间对照修复前后的同一脚本(3174 ms → 155 ms)。

门禁:`tests/test.mjs` **277 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。

## 同一轮里**没有**改的三处(记录在案)

### 1. `ProcessPool.map` 的 blanket catch —— 我改错了,已回退

它的 `catch` 同时包住 taskpool 派发**和**调用方的 `fn`,所以某个 item 抛错会让
`Promise.all` reject,进而把**整批**重跑一遍顺序执行。我开始修这个重复劳动,
**被测试套件抓住**:`tests/core.test.ts:591` 的名字就叫
"ProcessPool.map isolates per-item errors without aborting",并把
`[1, 0, 3] → [10, null, 3.33]` 钉死。**把失败项替换成 null 并继续,是既定契约,
不是疏漏。** 已回退,并补了一条测试记录这个契约,免得下一轮再来一次。

要把"taskpool 不接受这个闭包"和"`fn` 抛了"分开,需要先探测 taskpool 可用性 ——
那是对死代码的重新设计,不是修 bug。**留作记录,不改。**

### 2. `CodeAudit.ts` —— 核实为干净

跑全仓 175 个源文件:0 处括号错误、0 处重复导出、7 条 issue 全部是
它自己注释里的自指,或已在报告过的死代码里的 `console.log`。

它的 `prevSignificant`(判断 `/` 是正则还是除号)在跳过字符串后不更新,
理论上会在 `x = "abc" / 2` 上失步 —— 但在**本仓库上不产生任何误报**,
所以是理论弱点,不是可证缺陷。**不报。**

### 3. `StartupLoader.ts` —— 启动进度条在演它没做的事(第三例)

`createPaleoastStartupLoader()` 的注释写 "real self-checks",但 7 个预热模块里
**4 个是 `load: () => { void 0; }` 空存根**;`native` 那个还把
`_startupInitNative()` 的 promise 丢掉且不 await,所以原生初始化失败
**永远无法让启动失败**。

启动页会报告这些模块"已加载",而实际上什么都没做 —— 与 `FileDropHandler`
(宣称拖放但从未挂载)、`DiagnosticConsole`(永远 0 条)同一族。
**报告但不改**(死代码,接上去属于新功能)。

## 风险

`core/hpc/` 是死代码(`Index.ets` 明确注明闭包无法跨线程,所有分析都同步跑),
本次修改**不影响任何现有行为**;价值在于别把这个泄漏带上线。

设备侧的实际影响无法在本机测量(无 SDK):node 下测得 3174 ms → 155 ms,
说明句柄确实被释放了;ArkTS 的 `setTimeout` 语义与之相同,但真机影响未验证。
