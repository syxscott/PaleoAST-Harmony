# 图表 PNG 导出写的是整个底层 buffer,不是视图本身

## 类型
缺陷修复

## 问题

`core/io/FilePickerHelper.saveBinary()`:

```ts
const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
fs.writeSync(fd, view.buffer);
```

`new Uint8Array(arrayBuffer)` 是**视图,不是拷贝**;而 `subarray` 与父数组**共享同一个
`ArrayBuffer`**。所以 `view.buffer` 可能比数据本身大,`fs.writeSync(fd, view.buffer)`
就把多余的字节也写进了文件。

实测(Node,3 字节视图 + 8 字节底层 buffer):

| | 写出的字节 |
|---|---|
| 修复前 | `[1,2,3,4,5,6,7,8]` —— 8 字节 |
| 应为 | `[1,2,3]` —— 3 字节 |
| 修复后 | 3 字节 |

对 PNG 而言就是**文件尾部多出一段垃圾字节**。

## 是否可达

**当前 UI 路径不可达。** PNG 的 payload 来自
`image.createImagePacker().pack(pixelMap, ...)`,返回的是精确尺寸的新 `ArrayBuffer`,
`new Uint8Array(ab).buffer === ab`,长度正好。

但 `saveBinary` 的签名与注释明确邀请调用方传"image packer 返回的任何东西"
(`bytes: ArrayBuffer | Uint8Array`),而 packer 返回子数组视图是完全正常的做法 ——
这是一个等着被踩的坑,不是理论问题。

## 根因

把"字节序列"和"承载它的 buffer"当成了同一件事。
`Uint8Array` 有 `byteOffset` 与 `byteLength`,只看 `.buffer` 就丢掉了这两个信息。

## 修复

把视图**拷贝**进一个精确尺寸的 buffer 再写:

```ts
const exact = new Uint8Array(view.byteLength);
exact.set(view);
fs.writeSync(fd, exact.buffer);
```

没有选择 `fs.writeSync(fd, buffer, { offset, length })`:
本机没有 HarmonyOS SDK,无法核对该重载的确切签名,
而我刚刚才修掉一个编译不过的文件 —— 不应该再凭记忆写一个可能不存在的 API。
拷贝方案只用标准类型数组语义,对任何输入都正确。

## 验证

新增 `tests/binaryExport2026.test.ts`,3 条测试。

`FilePickerHelper` 依赖 `@kit.CoreFileKit`,无法在 Node harness 里加载,
所以测试钉住让行为正确的两个源码性质(`exact` 缓冲的构造与使用、
`view.buffer` 不再出现),**并把缺陷本身的算术写进测试**
(3 字节视图 / 8 字节 buffer 的对照),而不是复述实现。

门禁:`tests/test.mjs` **241 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题;TypeScript parser 复查 200 个文件 0 处字面量错误。

## 顺带核实、确认**不是**缺陷(记录以免重查)

- `FileManager.getExtension` 对无扩展名路径返回的是整条路径而不是 `''`
  (作者写了 `|| ''` 但永远达不到)。不过两个调用方
  `isTextFile` / `getFileType` 都因为它落在白名单之外而**恰好**给出正确结果,
  且没有任何 `ets` 代码直接调用 `getExtension`。属于潜伏问题,未改。
- `formatPValue` 对 `p = NaN` 会输出 `$p = NaN$`。
  这是可见的坏值而非静默错值,且没有任何分析会产出 NaN p 值。未改。
- `WaveletDialog` 的 `min_scale`/`max_scale` 无钳制 —— 但 `runWavelet` 内部
  `lo = Math.max(1, ...)`、`hi = Math.max(lo, ...)`,`hi/lo >= 1` 恒成立,
  对数梯子长度有界,**不可能挂死**。
- `Index.ets` 的 `loadFile` 用了 `fs.readTextSync`,`fs` 确实在第 26 行 import。
