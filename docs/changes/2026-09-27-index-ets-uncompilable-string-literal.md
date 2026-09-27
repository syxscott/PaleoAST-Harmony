# Index.ets 编译不过:字符串字面量里有真实换行

## 类型
缺陷修复

## 问题

**`entry/src/main/ets/pages/Index.ets` 无法编译。** 整个主页面从 2026-09-19 起就是坏的。

`buildAnalysisScript()` 在磁盘上的内容是:

```ts
    return header.join('
') + '
' + (steps.length > 0 ? steps.join(',
') : '[]');
```

那些是**真实的 0x0A 字节**,不是 `\n` 转义序列。带引号的字符串不允许跨行终止符,
TypeScript 与 ArkTS 都是如此,诊断是 `TS1002 Unterminated string literal`。
ArkTS 是 TypeScript 的严格超集,所以这不是"ArkUI 方言差异",是硬编译错误。

**为什么三个门禁全都没发现**:

| 门禁 | 覆盖范围 | 为何漏掉 |
|---|---|---|
| `tests/test.mjs` | 只 import `core/**` | 完全不加载 `.ets` |
| `test/device/run.mjs` | 静态扫描标识符接线 | 引号不是标识符 |
| `tools/structure_check.py` | 括号配平 | 多一个单引号不改变括号配平 |

`AGENTS.md` 明确写着"默认不跑完整构建",于是这个缺陷在两个方向上都是盲区:
构建能抓到它,但规则不跑构建;规则跑的门禁都碰不到它。

## 根因

意图毫无歧义:每个 `0x0A` 本应是两个字符的转义 `\n`。`git log` 逐提交核查确认
它**从被引入的那一次提交起就是坏的**(`566ec2f`, 2026-09-19,此前的 16 个提交里
该函数根本不存在),此后 10 个改动 `Index.ets` 的提交都原样带着它。
不是本次审查过程中引入的。

顺带发现**同一处还有第二个缺陷**:空分支输出 `[]`,
非空分支输出的是数组的**内容**而没有 `[]` 包裹 —— 两个分支产出的文档结构不同。
每一步都由 `JSON.stringify(..., null, 2)` 生成,所以输出本来就是 JSON 数组的意思。

## 修复

- `buildAnalysisScript` 的四个换行分隔符改为 `\n` 转义。
- 数组分隔符补齐:`'[' + steps.join(',\n') + ']' : '[]'`,
  两个分支现在产出同一种结构。

按字节替换写入(`Index.ets` 含 CJK,避开 `edit` 会把单个字写成 U+FFFD 的问题),
改完扫描确认 0 个坏字符。

## 验证

新增 `tests/etsSyntax.test.ts` + `tests/stringLexer.ts`,4 条测试。

守卫本身要先证明自己可信,所以分两步:

1. **词法扫描器对照 TypeScript parser**。
   parser(`ts.createSourceFile` + `parseDiagnostics`,只取 TS1002/1160/1380/1381)
   对全仓 **194 个文件**报 0 处;同一份仓库代码用一个不依赖 parser 的
   独立词法器扫,同样报 0 处。两者互相印证。
   parser 不能直接进测试:它不认 ArkUI 的 `@Component struct X { build() {} }`,
   会产生 2583 条与字面量无关的连带错误。
2. **扫描器自检 13 个 fixture**,覆盖它唯一微妙的地方
   —— `/` 是正则开头还是除号:含 `'` 和 `"` 的正则字面量(`replace(/['"]:\/g)`)、
   注释里的撇号(`don't`)、块注释、转义引号、合法多行模板串、
   `}` 之后跟正则、连续除法。

3. **回归验证**:用 `git show HEAD:Index.ets` 取修复前的文件喂给扫描器,
   精确命中第 **989、992** 行两处 —— 与 parser 的两处 TS1002 完全一致。

门禁:`tests/test.mjs` **216 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。未跑 DevEco 构建(本机无 SDK)。

## 风险

- 这条修复**没有经过真实构建验证**:本机没有 HarmonyOS SDK,装不了 DevEco。
  词法层面已由两套独立实现交叉确认,但 ArkUI 组件层面的类型问题仍需在有 SDK 的
  机器上构建一次才算完全收口。
- 由此可知,`ets/` 层此前所有"接线"结论都只有静态断言支撑,从未被真实构建或运行验证过。
  本次审查对 `ets/` 的修复应视为"经静态检查",而非"经运行验证"。
- 词法器的正则/除号判定用的是标准启发式,理论上仍可能误判(例如 `}` 之后的 `/`)。
  当前仓库它与 parser 完全一致;若将来引入更刁钻的写法,
  权威判据是 parser 那条命令,不是这个测试。
