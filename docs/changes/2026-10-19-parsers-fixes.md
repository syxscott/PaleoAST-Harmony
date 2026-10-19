# xlsx 解压、sheet 映射、TPS 配对、NEXUS 对齐:解析层 15 处会静默算错的缺陷

## 类型
缺陷修复 / 数值变更

## 问题

2026-10-19 对 `core/parsers/` 的复审发现 15 处缺陷。**其中 11 处会把"看起来合理"的错误数字或
错误标签写进论文**:xlsx 读取器在真实工作簿上**整表读不出来**、TPS 的标本 ID **整列错位**、
NEXUS 的性状 **贴到别的名字上**、树工具 **把不同的树报成相同**。另 4 处是静默接受损坏输入、
写出不可回读的文件、或抛出与文件无关的异常。

| # | 位置 | 旧行为 | 新行为 |
|---|---|---|---|
| 1 | `ExcelParser.inflateDeflate` | 位序按 **MSB 优先**(`(bitBuffer >> bitCount) & 1`),与 RFC 1951 §3.1.1 要求的 **LSB 优先**相反;距离表是 32 项的假表(`1..10,12,14,16,20…`),不是 §3.2.5 的 30 项(`1,2,3,4,5,7,9,13,17…`) → **任何真实 xlsx 都解压失败** | 位序改 LSB 优先、距离表换成 RFC §3.2.5;输出与 `zlib.inflateRawSync` 逐字节一致 |
| 2 | `ExcelParser.parseExcel` | xlsx 解压失败后 **静默回落成 CSV**:把 ZIP 二进制当文本嗅探(二进制里逗号/制表符多 → `looksLikeDelimited` 命中)→ 返回一张**全 null、标签是二进制乱码**的表,**不报错** | ZIP 魔数 → 明确抛 `ExcelParseError`;非 ZIP → 仍可回落,但结果里带 `fallbackReason`(见"修复"中的取舍) |
| 3 | `ExcelParser.parseSheetXml` | 自闭合空单元格 `<c r="A1" s="1"/>` 的 `/>` 被当成开标签收尾,惰性匹配 `[\s\S]*?` 于是吃到下一个 `</c>`(B1 的内容),`r` 捕获组仍是 A1 → `data=[[5,NaN],[7,9]]`,**A1 旧 = 5** | A1 = **NaN**、B1 = 5(改用逐个 `<c>` 标签的扫描器,自闭合不取内容、内容不跨 `<c` 起点) |
| 4 | `ExcelParser.resolveSheetMapping` | 第 N 个 `<sheet>` 配第 N 个 worksheet relationship,忽略 workbook 的 `r:id` → `<sheet r:id="rId2">` 且 rId1 排在前时**返回别的 sheet 的数据**(旧 = **1**,应为 999) | 按 `r:id` → rels `Id` → `Target` 查表(现 = **999**) |
| 5 | `ExcelParser` 文本解码 / `parseCellValue` | ZIP 条目按 **Latin-1** 逐字节解码(`String.fromCharCode`),xlsx 内部是 UTF-8 → "三叶虫" 变成 **9 个乱码字符**;无 `<v>` 或 `<v>xyz</v>` 的单元格返回 **0**,把空单元格**伪造成一个真实的 0**,把统计量系统性拉向 0 | 条目按 **UTF-8**(`TextDecoder`)解码;无值/非数值一律 **NaN**(CSV 路径本来就是 NaN,且有回归测试钉住) |
| 6 | `TPSParser.parseTPS` | `LM=` 处先 flush,而此时记录只有 ID 没地标 → 记录连同 ID 一起**被丢弃**;随后 `current = current ?? {id: 自动}` 再被下一个 `ID=` 覆盖 → 标准写法(`ID=` 在 `LM=` 之前)下**每条记录拿到下一个标本的 ID**:旧 = `[{id:" sp2",lm:[[0,0],[1,1]]},{id:"2",lm:[[2,2],[3,3]]}]` | 现 = `[{id:"sp1",lm:[[0,0],[1,1]]},{id:"sp2",lm:[[2,2],[3,3]]}]`;`LM=` 在 `ID=` 之前的写法保持正确 |
| 7 | `TPSParser` 记录边界 | `LM=` 计数与 2D/3D 标志**逐记录重置**,而 TPS 通常**只有一个文件级 `LM=8` 头** → 第 2 个标本起的坐标**全被忽略** | 计数与 2D/3D 标志改为**文件级**,标本间沿用 |
| 8 | `NexusParser.parseNexus` | taxa 只在 `TAXLABELS` 按序 push、矩阵行只 push 序列,两者**各 append 一次、从不按名字配对** → 过滤过 taxon 的文件里 **Beta 的序列贴到了 Alpha 的名字上**;单字段续行被当无效行丢弃,`nChar` 旧 = **2**(应为 4) | 矩阵行**按名字**与 taxa 对齐(缺行补 **NaN**),续行并入上一行,名单/行数不一致写进 `warnings[]` |
| 9 | `CSVParser.parseCSV` / `ExcelParser.parseDelimited` | 先 `text.trim().split(/\r?\n/)` 再逐行 `splitCSVLine`,而 `splitCSVLine` 不认识跨行引号 → `id,note\nr1,"line1\nline2"\nr2,plain` 被拆成 **3 行**(`nSamples` 旧 = 3,多出的行标签变成 "line2") | 新增引号感知的**记录切分器** `splitCSVRecords`,两个入口都改用它(现 = **2**);`splitCSVLine` 仍是唯一的 RFC 4180 单记录实现,未另造第二份 |
| 10 | `TreeComparator.weightedRF` / `normalisedRF` | `_weightedSplits` 对叶节点提前 return,末端分支永不进 map → 只有末端分支不同 **weightedRF 旧 = 0**(报成"完全相同的树");归一化分母用无根树的 `2(n−3)`,而根树有 n−2 个内部 clade → `((A,B),(C,D))` vs `((A,C),(B,D))` **normalisedRF 旧 = 2**,违反自身文档的 [0,1] | 叶级 split 以 `@` 前缀纳入(现 = **0.5**);分母改 `2(n−2)`(现 = **1.0**) |
| 11 | `NewickParser.parseNewick` | `)` 之后的文本只有在**整串是数字**时才当 support → `(A,B)0.9Homo` 的 name = "0.9Homo"、**support = null**(值丢失);`(A,B` 缺右括号**静默接受**,`A,B` 静默丢掉 B | 数值前缀解析为 support、其余为 label(support = **0.9**、name = "Homo");括号不配对 / 多余逗号 / 空元素一律抛 `NewickParseError` |
| 12 | `ExcelParser.parseExcelText` | `delimiter` 参数**从不传给** `parseDelimited` → 给 `';'` 与给 `','` 结果完全相同 | delimiter 透传(`';'` → 列名 `['v1','v2']`;`','` → 整行一个字段) |
| 13 | `BinaryCache.deserializeMatrix` / `loadMatrix` | 载荷长度非 8 倍数时 `new Float64Array` 抛裸 `RangeError`(与文件无关的报错);`loadMatrix` **不校验** nRows×nCols 与载荷一致(头写 3×3、载荷 4 个 double 也接受) | 抛 `CorruptedCacheError`;`loadMatrix` 校验形状,不一致即抛错 |
| 14 | `NexusWriter.write` / `RESERVED` | 文档结尾多出一个**无 BEGIN 配对的 `END;`**(BEGIN 3 / END 4);加引号字符集漏 `/ = *` → `sp=1`、`a/b` 写出来不可回读 | 去掉多余的 `END;`(BEGIN 3 / END 3);保留字符补齐 `/ = *` |
| 15 | `DATParser.parseDAT` | 不嗅探分隔符 → 制表符 `.dat` 按逗号切,每行一个字段,**矩阵为空**(`nCols` = 0);`hasHeader` 默认 `true` → 无表头文件的**第一行被静默吃掉** | 嗅探 `, \t ; \|`;`hasHeader` 缺省时按"首行能否全部解析为数字"自动判定 |

## 根因

1. **inflate 实现从头到尾没对照过 RFC**:位序按"先取字节最高位"写,距离表按"看起来像"编了一组
   (32 项、基数 `1..10,12,14,16,20…`)。这两处**互相独立**:只改位序仍然解压失败,只换距离表也失败。
   审查用 `zlib` 逐字节对拍确认:两处同时改对,输出才与 `zlib.inflateRawSync` 完全一致。
2. **单测为什么没抓到(关键)**:`tests/core.test.ts:47` 的 `buildMinimalXlsx()` 是**手搓的
   STORED zip**(压缩方法 0),而 Excel / LibreOffice / openpyxl 生成的 xlsx **默认是 deflate**
   (压缩方法 8)→ **inflate 路径从未被任何测试触及**。旧用例只断言 STORED 路径,
   于是把 deflate 的全部缺陷完整地掩盖了。lead 用 Python `zipfile` 生成同一份表的两版夹具复现:
   STORED 版 sheet 名 `"S1"`、数据 `[[11],[22],[33]]`;DEFLATE 版 sheet 名退化成兜底默认
   `"Sheet1"`、数据 8 行**全 null**。**任何真实工作簿都读不出来,而且不报错。**
3. **"静默回退"把失败伪装成了成功**:解压抛错后,代码把 ZIP 二进制当 CSV 嗅探;二进制里逗号和
   制表符本来就多,`looksLikeDelimited` 必然命中 → 一张全 null 的"表"被当成正常结果交出去。
4. **正则匹配不了两种形态的标签**:`<c .../>`(自闭合)与 `<c ...>...</c>`(成对)在同一个正则里
   无法区分 —— 惰性匹配一旦越过 `/>` 就会一路吃到下一个 `</c>`。
5. **sheet 映射用位置猜**:workbook 的 `r:id` 是唯一权威,代码却按文档顺序配对;删过 sheet 或被
   工具重排过的文件顺序就不同了。
6. **编码是抄来的**:xlsx 内部 XML 是 UTF-8,代码却用 `String.fromCharCode` 逐字节拼(Latin-1);
   同一个仓库的 `core/data/ExampleData.ts:33` 本来就在用 `TextDecoder`。
7. **TPS 把"记录边界"当成了"LM 边界"**:`flush()` 既负责提交记录、又负责开新块,而 ID 可能出现在
   块之前或块之后;`flush()` 的丢弃条件是 `landmarks.length > 0`,于是"只有 ID 的记录"正好落进
   丢弃分支。`LM=` 计数是**文件级**声明这一点也没被建模,记在了记录上。
8. **NEXUS 的两条流水线各走各的**:taxa 名单和矩阵行分别 append,从来没有交汇点;
   `parts.length >= 2` 这个判断把"续行"和"新行"混为一谈。
9. **切分顺序反了**:RFC 4180 的记录边界由**引号状态**决定,不是由换行决定;先按行切再解析字段,
   顺序就必然错。
10. **树工具抄了无根树的公式**:加权 RF 提前 return 掉叶节点;归一化分母用了无根树的 `2(n−3)`,
    而这些树是**有根**的。
11. **Newick 的 support 与 label 没有分开**:代码用"整串能否 parseFloat"来判断,
    于是"数值 + 标签"这种最常见的写法整个丢掉 support。
12. **异常类型没有分层**:`RangeError` 是语言层的意外,不是"这个缓存文件坏了";
    `loadMatrix` 则根本没做形状校验。

## 修复

改动文件(全部在本次所有权范围内):

- `core/parsers/ExcelParser.ts`:
  - `readBit` 改 **LSB 优先**(RFC 1951 §3.1.1);`DIST_BASE`/`DIST_EXTRA` 换成 **§3.2.5 的 30 项**。
  - 新增 `ExcelParseError`;`parseExcel` 失败时**先判 ZIP 魔数**。
  - 新增 `extractCells()`:逐个读 `<c>` 开标签,自闭合标签不取内容;成对单元格的内容**不跨越下一个
    `<c` 起点**(遇到截断的单元格就截到下一个单元格之前)。
  - `parseWorkbookXml` 改为返回 `{name, rid}`,`resolveSheetMapping` 按 **`r:id` → rels `Id` → `Target`**
    查表(位置只作兜底)。
  - 新增 `decodeUtf8()`(`TextDecoder('utf-8')`),ZIP 条目与条目名统一按 UTF-8 解码;
    `parseCellValue` 无 `<v>` 或值非数字时返回 **NaN**;`cellToLabel()` 让 NaN 单元格不再变成标签 "NaN"。
  - `parseDelimited` 改用记录切分 + 可传入 delimiter;`parseExcelText` 把 delimiter 传下去。
- `core/parsers/CSVParser.ts`:新增 `splitCSVRecords()`(引号感知的记录切分器),`parseCSV` 改用它;
  `splitCSVLine` 保持唯一 RFC 4180 单记录实现不变。
- `core/parsers/TPSParser.ts`:重写记录状态机 —— ID 单独保存、**记录边界由"块是否读完"决定而不是由
  `LM=` 决定**;`LM=` 计数与 2D/3D 标志提升为**文件级**;ID 值做 `trim()`。
- `core/parsers/NexusParser.ts`:矩阵行按**名字**与 taxa 对齐(缺行补 NaN),支持续行与交错矩阵,
  不一致写进新增的 `warnings[]`;`NexusData` 相应加了可选字段。
- `core/parsers/NewickParser.ts`:新增 `NewickParseError`;`)` 之后**数值前缀 = support、其余 = label**;
  括号不配对 / 多余逗号 / 空元素抛错;`toNewick` 改为先 support 后 label(与解析对称,保证 round-trip)。
- `core/parsers/TreeComparator.ts`:叶级 split 以 `@` 前缀纳入 `_weightedSplits`;`normalisedRF`
  分母改 `2(n−2)`,并把 `common.size <= 3` 的早退放宽到 `< 3`(n = 3 时分母为 2,不再需要早退)。
- `core/parsers/DATParser.ts`:`delimiter` 缺省时嗅探 `, \t ; \|`;`hasHeader` 缺省时按首行是否全为数字
  自动判定。
- `core/parsers/BinaryCache.ts`:载荷长度、CRC、8 倍数、文件过短四类问题统一抛 `CorruptedCacheError`;
  `loadMatrix` 增加 **nRows×nCols 与载荷长度**的形状校验。
- `core/parsers/NexusWriter.ts`:删掉结尾多余的 `END;`;`RESERVED` 补 `/ = *`。
- `core/parsers/index.ts`:补导出 `splitCSVRecords` / `splitCSVLine` / `NewickParseError` /
  `ExcelParseError` / `CorruptedCacheError`。
- `tests/fixParsers2026.test.ts`:新建,24 条回归测试。

**⚠️ 待用户拍板的设计取舍:解析失败是否仍回退 CSV。**
本轮的选择是**"ZIP → 明确抛 `ExcelParseError`;非 ZIP → 仍可回落,但结果里带 `fallbackReason`"**。
理由:`parseExcel(bytes)` 同时承担"CSV 以字节形式传进来"这一入口(真实存在,`DataController` 一类
调用方会把文件字节直接丢进来),一刀切地禁止回落会误伤这条路径;而**真正的危险只在于"回退后不告诉
调用方"** —— 旧代码回退后返回的是一张看起来正常的表。折中做法是:回退发生时在 `ExcelData` 上写明
`fallbackReason`,ZIP 则**直接失败**(ZIP 永远不可能是分隔文本)。若用户要求"任何回退都算错误",
改动点在 `parseExcel` 的 catch 分支一处。

**未改(明确不是缺陷)**:`splitCSVLine` 确为唯一 RFC 4180 实现、`ExcelParser` 转发复用,没有第二份;
xlsx 已修好的坑(单元格 `t` 属性在 `<c>` 上、`inlineStr` 取 `<is><t>`、表头行由循环起点排除、
公式取 `<v>` 缓存值、布尔 `t="b"`→1/0、列跳跃与稀疏行补 NaN、sharedStrings 带 BOM)保持不动;
DEFLATE 的 stored block 分支与 CRC32 实现正确;`toCSV` 按需加引号并能回读。

## 验证

### 新增测试

`tests/fixParsers2026.test.ts`,**24 条**,测试名一律写明**被修复的旧行为**:

- `a real DEFLATE-compressed workbook is parsed instead of falling back to a table of garbage`
- `a workbook that cannot be decoded raises an error instead of being sniffed as delimited text`
- `a self-closing empty cell no longer steals the value of the next cell`
- `sheets are located through the workbook r:id instead of by position`
- `xlsx labels are decoded as UTF-8 and an empty cell is NaN instead of a fabricated 0`
- `parseExcelText uses the delimiter it was given`
- `a quoted line break does not split one record into two rows`
- `the workbook text path does not split a record on a quoted line break either`
- `a record keeps the ID that stands in front of its LM block`
- `a record still takes the ID that follows its LM block`
- `one file-level LM header with one ID per specimen yields one record per specimen`
- `matrix rows are matched to the taxa by name, not by position`
- `a taxon without a matrix row is reported and filled with NaN`
- `a matrix row continued on the next line is not dropped`
- `weightedRF is not 0 when only a terminal branch length differs`
- `normalisedRF stays inside [0, 1] for two rooted trees`
- `a Newick support value is not swallowed by the label`
- `an unbalanced Newick string raises an error instead of losing a name`
- `a tab-separated .dat is no longer parsed into an empty matrix`
- `a headerless .dat keeps its first row as data`
- `a payload that is not a whole number of doubles raises a CorruptedCacheError`
- `loadMatrix rejects a header whose shape does not match the payload`
- `the document has no END without a matching BEGIN`
- `a name containing "/", "=" or "*" is quoted`

xlsx 夹具在测试里用 **`node:zlib` 的 `deflateRawSync` 现造**(不再手搓 STORED zip),因此
inflate 路径第一次被测试覆盖。

### 对拍数字

| 项 | 旧 | 新 |
|---|---|---|
| 任意 deflate xlsx(lead 的 8 行夹具) | 8 行全 null、sheet 名 "Sheet1" | 200 行夹具**全对**、sheet 名 "S1" |
| openpyxl 真文件的中文标签 | 9 个乱码字符 | `三叶虫` / `长度` |
| 自闭合 `<c r="A1" s="1"/>` 后接 B1=5 | A1 = 5 | A1 = **NaN**、B1 = 5 |
| `r:id="rId2"` 指向 sheet2(值 999) | 1 | **999** |
| 空单元格 / `<v>xyz</v>` | 0 | **NaN** |
| TPS(`ID=` 在 `LM=` 之前) | `[{id:" sp2"},{id:"2"}]` | `[{id:"sp1"},{id:"sp2"}]` |
| NEXUS 续行 | nChar = 2 | nChar = **4** |
| CSV 引号内换行 | nSamples = 3 | nSamples = **2** |
| weightedRF(仅末端分支差 1) | 0 | **0.5** |
| normalisedRF(`((A,B),(C,D))` vs `((A,C),(B,D))`) | 2 | **1.0** |
| Newick `(A,B)0.9Homo` | support = null、name = "0.9Homo" | support = **0.9**、name = "Homo" |
| NEXUSWriter | BEGIN 3 / END **4** | BEGIN 3 / END **3** |

### 用户可见的改进:仓库自带示例 `moth_wings.tps`

`entry/src/main/resources/rawfile/examples/moth_wings.tps`(30 个标本、每个 8 个地标、**只有一个文件级
`LM=8` 头**)旧解析器**只产出 1 条记录**,而且 ID 是最后一个标本的名字(`Mosquito_030`)——
29 个标本的坐标被整段丢弃,形态学分析会拿到一个标本而不是 30 个。修复后:**30 条记录、30 个唯一 ID、
每个 8 个地标**。

### 门禁

- 本轮新增套件 `tests/fixParsers2026.test.ts` 单独跑:**24 passed, 0 failed**;
  该文件已由 `tests/run.ts` 的所有者注册进主套件。
- `node --experimental-transform-types tests/test.mjs` → 全量 **545 passed, 7 failed**(552,
  含其它 agent 并行落地的套件)。剩下 7 条**都不在本轮范围**:
  `pchisq` 未定义(Kruskal-Wallis ×2)、`pnorm` 未定义(Mann-Whitney ×2)、
  `Matrix` 广播、Anderson-Darling、`PLS covarianceExplained` —— 是其它 agent 修改中的在途状态。
- `python tools/structure_check.py` → **0 problems**(检查文件数随其它 agent 的新增而变)。
- 核心模块逐个 `import()` 冒烟:108/109 通过;唯一失败是 `core/io/FilePickerHelper.ts`
  (测试 shim 的 `@kit.CoreFileKit` 没有 `picker` 导出),与本轮改动无关。

## 风险

- **数值变更,旧结果需要重跑**:
  - 所有 **TPS** 形态学结果:记录数从 1 变成 N(对只有文件级 `LM=` 头的文件),
    标本 ID 从"最后一个的名字"变成各标本自己的 ID。**用旧版本算过的 TPS 结果必须重跑。**
  - 所有 **weightedRF / normalisedRF** 数值都会变(末端分支现在计入,分母从 `2(n−3)` 改成 `2(n−2)`)。
  - 所有 **xlsx 导入**结果都会变(以前读不出来,现在能读);以前读出来的"全 null 表"本来就是错的。
  - **NEXUS** 的性状矩阵会重排到正确名字上;缺行现在补 NaN(以前整行不存在)。
- **NEXUS 的两种"缺失"语义不同**:缺**行**(taxa 名单里有、矩阵里没有)填 **NaN**;
  行**内**的缺失/间隔字符仍按既有状态编码填 **0**。这是"整行没有数据"与"这一个性状缺失"的区分,
  但两者的表示形式不一致,下游若直接对 `characters` 求均值,NaN 会传播、0 不会。
- **DAT 空格分隔的 `.dat` 仍不支持**:嗅探只覆盖 `, \t ; \|`;纯空格分隔的文件仍会按逗号切成单列。
- **TPS 的 ID 做了 `trim()`**:`ID= sp1` 读成 `sp1`(旧为 `" sp1"`,带前导空格)。
  ID 内部的空格保留。
- **`toNewick` 的输出顺序变了**:内部节点现在是 `)support label`(旧为 `)label support`),
  与新的解析顺序一致;若下游有比对旧格式字符串的代码,需相应调整。
- **`parseDAT` 的 `hasHeader` 默认值语义变了**:以前恒为 `true`,现在缺省时自动判定;
  无表头文件的第一行不再被吃掉(这是修复),但依赖旧默认行为的调用方需显式传 `hasHeader`。
- **`ExcelData` 新增可选字段 `fallbackReason`**:只增不改,不破坏既有调用方;
  但 UI 目前**没有展示它** —— 若用户希望"回退"在界面上可见,需要另外接线。
- **`NexusData` 新增可选字段 `warnings[]`**:同样是只增不改;UI 目前不展示,
  「名单与行数不一致」目前只对调用方可见。
- **NEXUS 仍不校验 `NTAX`**:声明的 `NTAX` 与实际名单不一致时,本轮只报 warning、不改数据。
