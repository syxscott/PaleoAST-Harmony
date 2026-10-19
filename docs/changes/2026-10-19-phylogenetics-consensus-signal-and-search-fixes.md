# 系统发育学模块：一致性树、RF 距离、系统发育信号与启发式搜索的静默算错

## 类型

缺陷修复

## 问题

2026-10-19 审查在 `core/analysis/phylogenetics/` 与 `core/state_machine/` 中发现 15 处缺陷，
其中 6 处会直接产出**错误的数字**（用户会写进论文）：

| 缺陷 | 旧值 → 新值 |
|---|---|
| `strictConsensus` 复制子树、丢内节点 | `(((A,B),(C,D)),(E,F))` → `(((A,B,C,D),(A,B,C,D)),E,F)`（6 个分类单元变 10 个叶子）→ 正确树，每个分类单元出现一次 |
| `majorityRuleConsensus` 把 bipartition 当 clade | 3/3 支持的 split 消失，输出 `((A,B,C,D)1;)` → `((A,B)1,(C,D)1)`，split 保留 |
| `computeRFDistance` 计数翻倍 | `rfDistance = 4`、`normalized = 2`（上限是 1）→ `2` / `1.0` |
| `brownianVCV` 用名字做 key | 重名 tip 共用一个 key，共享路径长度被算成各自到根的距离 → 按对象身份计算；重名直接报错 |
| `blombergKFromVCV` 失败通道 | 常数性状 `[5,5,5]` → `1.5000000001062503`（浮点噪声）；NaN/奇异 V → `0`（与「无信号」不可区分）→ 全部抛可解释错误 |
| `heuristicSearch` NNI/SPR 破坏树 | 接受一次 move 就丢掉整棵子树，分数偏低 → 被误判为「改进」→ 树与分数不再一致，bestTree 缺分类单元 |

其余：`pic` 缺性状时崩溃或错位对比、`setupTipDating` 按名字配对 clone 导致年龄挂错、
`toNewick` 给每个内节点加 `';'`（round-trip 只剩 2/6 个分类单元）、`phylogeneticSignal`
静默截断性状数组、`parseNewick` 接受空串并丢弃尾部垃圾、`randint` 调用点 off-by-one、
`RegexCompiler` 不支持字符类（basic lexer 全是 UNKNOWN）、`_matchAt` 在首个失败处早停。

## 根因

1. **split 的键不唯一**：`[sideA, sideB].sort().join('|')` 把一棵二叉树两个 cherry 的互补 split
   折叠成同一个 key；`group.size < superSet.size` 又把等大的组直接跳过；同一个 internalNode 被
   存进 map 的多个 key，于是 `root.addChild(node)` 对同一对象调用两次 → 子树被复制进树里。
2. **bipartition 语义被读成 clade**：多数规则共识把两侧成员塞进同一个节点，
   而严格共识只取一侧 —— 两处口径不一致。
3. **RF 的 split 只记后代集合**：同一个 split 的两侧被当成两个 split，计数翻倍。
4. **VCV 的 key 用节点名**：同名节点共用一个 key，深度被覆盖、LCA 扫描命中 tip 自己。
5. **NNI 手术做在错误的边上**：只做了 `siblingOfParent.addChild(detachChild)` 与
   `parent.addChild(siblingOfParent)`，没有把祖父的孩子槽位换回来；SPR 插到 tip 上时
   `isLeaf` 仍为 true，Fitch 下行不进入该子树，`recordChanges` 取到 undefined 状态集。
   SPR 另有一处：`newParent.addChild(regraftNode)` 之后 `regraftNode.parent` 已变成 newParent，
   再去父节点里替换时把**新节点自己替换成了自己**，嫁接的子树从根不可达。

## 修复

- `phylogenetics.ts`
  - 新增 `Bipartition` + `canonicalBipartition`：split 的规范形式是「小子集在前，
    等大时字典序在前」，两侧互补且可区分；`getTreeBipartitions` 只收非平凡 split。
  - 新增 `buildConsensusTree`：按兼容 split 递归建树，每个 split 展开成两个互补的
    互惠单系群；根用第一棵树的根 split（未被支持时退化为多叉）。多数规则共识按支持度
    贪心接受**互相兼容**的 split（冲突时高支持者胜出）。
  - `computeRFDistance`：split 键改为规范化两侧。
  - `pic`：保留 null 占位，child 结果与 child 下标始终对齐；只有一个有信息的子节点时
    不产生对比，但**保留该子节点的方差**（旧代码把分支长丢了，量纲被改变）。
  - `heuristicSearch`：NNI 改为在同一条内边上重排三个子树；SPR 只在**内部节点**上嫁接、
    在克隆上操作（不再就地改树）、正确换回祖父的孩子槽位、嫁接到根时更新根指针。
  - `toNewick`：`;` 只允许出现在根；`parseNewick`：空串、括号不配对、尾部残留字符一律抛错。
  - CI/RI 改用 Kluge & Farris (1979) 教科书定义（m = 简约信息位点，L = 最小可能步数，
    g = 该树上的最大可能步数）。
- `vcv.ts`：`brownianVCV` 用 `Map<PhyloNode, number>` 按对象身份记深度/路径，重名 tip 抛错；
  `blombergKFromVCV` **公式不动**，只把失败通道从「返回 0/噪声数」改成抛可解释错误。
- `signal.ts`：性状长度与 tip 数不一致时抛错，不再 `Math.min` 静默截断。
- `TipDating.ts`：clone 映射按**子节点下标**（结构位置）配对，不再按名字。
- `state_machine/Automaton.ts`：实现字符类（`[a-z]`、`[^...]`、`\d \s \w` 等）与转义；
  正类展开成字面量转移，负类保留为运行时类转移；`NFA.longestMatch` 一次扫描求出最长匹配。
- `state_machine/Tokenizer.ts`：`_matchAt` 改用 NFA 最长匹配，不再在首个失败扩展处早停；
  `createBasicLexer` 的规则改成引擎真能表达的写法（`'\\s+'` 而不是 `'\s+'`——后者在 JS 里
  会被解析成 "s+"）。

## 验证

- 新增 `tests/fixPhylo2026.test.ts`（18 个用例，测试名写明旧行为）。
- 更新 `tests/audit2026.test.ts` 的 CI/RI 断言：CI 由 0.5 改为 1（m − L = 0 时指数无定义，
  按仓库既有约定返回 1），RI 由 1/3 改为 1/2（教科书 (g−s)/(g−m)，g = 3）。
- `node --experimental-transform-types tests/test.mjs`：291 passed / 4 failed，
  4 个失败均属其它 agent 的模块（Matrix 广播、Anderson-Darling、PLS、StatisticsController
  的 phyloANOVA 守卫）。
- `conda run -n dev python tools/structure_check.py`：175 files, 0 problems。

## 风险

- **CI 在二元数据上无定义**：m = 简约信息位点数、L = 最小可能步数时，二元性状每个恰好
  需要 1 步，于是 m − L ≡ 0，比率是 0/0；按 lead 裁决返回 1。**这个 1 必须读作「该数据集的
  CI 无定义」，不能读作「没有同塑性」**。多状态性状下 (m−s)/(m−L) 还可能 > 1。
- `brownianVCV` 现在对重名 tip 抛错：化石数据里 "indet." / "cf. sp." 很常见，
  需要用户先改名（否则 V 的行标签有歧义）。
- `blombergKFromVCV` 现在对缺失性状（NaN）、常数性状、奇异 V 抛错：
  `core/analysis/statistics/statistics.ts` 的 `phylogeneticSignal` 仍把缺失性状映射成 NaN，
  因此该路径现在会抛错而不是返回 k = 0（这正是期望的行为，但会改变现有 UI 流程的报错）。
- `heuristicSearch` 的结果与旧版不同（旧的 NNI/SPR 都是错的），历史记录里的 bestScore
  需要重算。
