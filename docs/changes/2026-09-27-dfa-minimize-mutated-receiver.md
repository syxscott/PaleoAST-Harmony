# DFA.minimize() 改写了它被调用的那个自动机

## 类型
缺陷修复

## 问题

`makeComplete()` 是**变异操作**(对应 Python 原版的 `make_complete`,就地加一个 DEAD 状态)。
而 `minimize()` 直接在 `this` 上调它:

```ts
minimize(): DFA {
  // 0) complete first so the transition function is total
  const sigma = this.alphabet.length > 0 ? this.alphabet : this._inferAlphabet();
  this.makeComplete(sigma);        // <-- 改写调用者
```

实测(`a*b`,字母表 `{a,b}`):

```
before minimize:  q0,q1
after  minimize:  q0,q1,DEAD
second call:      3 -> 4 states
```

**每调用一次就多一个状态,无上界。** 循环里最小化,或从两处最小化同一个共享 DFA,
就会看到它不断膨胀。

而 `minimize()` 自己的 docstring 写的是:

> Returns a **new** minimal DFA equivalent to this one

**算法本身是对的** —— 返回的最小 DFA 正确,13 个测试词的语言全部保持,
分区细化没有问题。错的只是副作用,与它自己声明的契约不符。

## 根因

`makeComplete()` 原地改,而 `minimize()` 需要一个"已完备"的输入才能做分区细化。
直接复用接收者是最省事的写法,但违反了 `minimize()` 的返回值契约。

这不是"忘了拷贝"这种低级错误,而是**两个方法的变异语义没有被区分对待**:
一个必须变异(它对应 Python 原版),一个必须不变(它承诺返回新对象)。

## 修复

`minimize()` 在**副本**上完成完备化:

- 克隆所有 `State`(名字与接受标记一并带上);
- 把克隆之间的转移重新指向克隆;
- 重新映射 `start` 与 `accept`;
- 之后 `minimize()` 内部**所有**读取都来自副本,包括第 3 步构造最小 DFA ——
  分区向量索引的是副本的状态表,混用两份会导致错误。

`makeComplete()` **保持变异语义不变**:它对应 Python 原版,而且只有 `minimize()`
有契约问题(只有它承诺返回新对象)。有测试专门锁住这个区别,
以免将来有人"顺手"把 `makeComplete` 也改成不变异从而悄悄改变语义。

## 验证

新增 `tests/automaton2026.test.ts`,4 条测试。

- 接收者状态数不变,且不含 DEAD;
- 重复调用幂等(修复前是 `2,2` 对 `3,4`);
- 返回的最小 DFA 仍然正确:13 个词的语言保持、状态数恰为 2、
  再最小化不会更小、对它再调用也不会改写它;
- `makeComplete` 仍然是变异的(明确钉住)。

**守卫有效性已验证**:把 `Automaton.ts` 换回 `HEAD` 版本重跑,4 条中 3 条如期失败,
失败信息正是那个累积:`expected 2 vs 2, got 3 vs 2`、`expected 2,2, got 3,4`。

门禁:`tests/test.mjs` **273 passed, 0 failed**;`node test/device/run.mjs` 19/19;
`structure_check.py` 175 文件 0 问题。

## 风险

`core/state_machine/` 是死代码,本次修改**不改变任何现有行为**。
价值在于"万一有人接上去,不会带着这个变异上线"。

补丁脚本本身也值得记一笔:第一版只重写了方法体的一部分,
一条断言发现第 3 步仍有 `this.states` 读取(而它们索引的是同一份分区向量),
**拒绝写文件**。第二版把替换范围扩到整个方法体才通过。

模块内另外两处经审阅确认**不是**缺陷:

- `NFA.toDFA()` 遇到空 ε-闭包时 `continue`,产生的是**偏(partial)DFA**。
  `DFA.matches()` 对缺失转移返回 false,`minimize()` 又会先调 `makeComplete`,
  两处都能处理,所以是有意的设计而非漏洞。
- `minimize()` 的细化循环以**块数**判定收敛而非划分本身。
  这是充分的:划分只分裂不合并,块数单调不减,块数不变即无块被分裂,
  划分已是不动点。
