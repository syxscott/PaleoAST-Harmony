# 报告导出 9 处缺陷:标题被静默丢弃、HTML 表格可注入、写盘失败被说成"用户取消"

## 类型

缺陷修复

涉及 `core/reporting/*` 与 `core/io/FilePickerHelper.ts`。**本轮不改变任何分析数值**,
旧结果不需要重跑;改变的只有导出产物的内容。

## 问题

全部 9 条都用真实模块 + 真实 `pdflatex`(TeX Live 2025)复现过。

### 1. LaTeX 导出丢弃报告标题(严重)

`LatexCompiler.compileLaTeX()` 只读 `opts.title`:

```ts
`\\title{${escapeLatex(opts.title)}}`,
```

而生产路径 `Index.ets:404` 设 `rb.setTitle('PaleoAST export')`,
`Index.ets:429-432` 调 `compileLaTeX(rb, { documentClass, fontSize, paperSize, margin, packages, bibliography })`
——**没有传 `title`**。于是导出的 `.tex` 里是 `\title{}`。

| | 现象 |
|---|---|
| 旧行为 | `\title{}` → PDF 标题页**无标题**;`pdflatex` **退出码 0,无任何告警** |
| 新行为 | 回退 `builder.getTitle()` → `\title{PaleoAST export}` → 标题页有标题,退出码仍为 0 |

这是"静默算错比崩溃更严重"的典型:文档能编译、能出 PDF,只是内容少了一项。
用户把这样的 PDF 写进论文,标题就没了。同一文件 `:76` 对作者行做了 builder 回退
(`opts.authors?.join(' \\and ') || builder.getAuthors()…`)——**说明标题是遗漏,不是设计**;
而 `ReportBuilder.toLaTeX()`(`:329`)用的是 `this._title`,两个 LaTeX 生产者结论相反。

### 2. `TableGenerator.html` 在 HTML 上下文里用 LaTeX 转义器(中等)

`TableGenerator.html()` 用 `_escape`(`:83-97`)转义列名 —— 那是 LaTeX 转义器:
管 `& % $ # _ { } \ ~ ^`,**不管 `<` `>`**。

```ts
TableGenerator.html(m, ['<script>alert(1)</script>', 'a & b'])
// 旧: <th><script>alert(1)</script></th>   ← 活标签,导出文件在浏览器里执行脚本
// 旧: a \& b                              ← LaTeX 写法,不是 HTML 实体
```

同包的 `ReportBuilder.toHTML`(`:459-462`)与 `FigureHandler.toHTML`(`:62-65`)都用
HTML 转义 → `TableGenerator` 是**唯一用错转义器**的地方。
目前只有测试引用它,但**列名来自用户数据文件**,接入导出路径即成真实攻击面。

### 3. 导出写盘失败被静默报成"用户取消"(中等)

`FilePickerHelper.writeViaPicker()` 的 `catch` 把**所有**异常归一成 `null`:

```ts
} catch (e) {
  return null;      // 空间不足 / 权限 / 只读目录 → 也返回 null
}
```

docstring 写的是 "null when the user cancels",但实现是"任何失败都是取消"。
`writeViaPicker` 是 `saveFile`(`:29-34`)与 `saveBinary`(`:43-57`)的共同出口,
唯一调用方据此显示 **"Report export cancelled" / "Chart export cancelled"**
(`Index.ets:444`、`:467`)——**报告根本没保存,用户却以为是自己取消的**,无任何错误提示。

### 4. 表格列数不校验(中等)

`ReportBuilder.tableFromMatrix`(`:488-505`)的列规格由 `headers.length` 推导,
数据行单元格数由 `row.length` 决定;`TableGenerator.latex`(`:24-50`)同理
(`headers.length` vs `matrix.cols`)。两者**无任何校验**。

```ts
ReportBuilder.tableFromMatrix(['A','B'], [[1,2,3]])
```

生成的 `.tex` 让 `pdflatex` 报 **"Extra alignment tab has been changed to \cr"**,
**退出码 1、无 PDF**。用户会以为是自己数据的问题。

可达性:生产调用 `Index.ets:413-417` 传 `dm.colLabels` 与 `dm.data.row(i)`,
而 `DataMatrix.ts:35` 保证 `colLabels.length === nVariables === 行宽` → **当前生产路径不可达**,
属公共 API 健壮性。

### 5. 统计结果的 95% CI 在 LaTeX / HTML 里被静默丢弃(中等)

`StatisticalResult` 定义了 `ciLower/ciUpper`(`ReportBuilder.ts:50-51`),
`toMarkdown` 用了(`:221`),但 `toLaTeX`(`:425-451` 表头固定 5 列)、
`toHTML`(`:286-299` 表头固定 5 列)与 `LatexCompiler.renderStatisticalResults`(`:241-274`)
**整列消失**。同一对象在 Markdown 里输出 `95% CI = [0.12, 1.1]`,
论文格式比 Markdown **少一整列信息**,而导出过程一声不响。

### 6. `FigureHandler.toLatex()` 不转义图片路径(中等)

`FigureHandler.ts:31` 把 `f.path` 原样拼进 `\includegraphics`:

```ts
fh.add('C:\\Users\\paleo\\fig1.png', 'caption').toLatex()
// → \includegraphics[width=0.9\linewidth]{C:\Users\paleo\fig1.png}
```

反斜杠被 LaTeX 读成控制序列 → **"Undefined control sequence."**(审查 agent 记为 ×3 处;
我实测的日志里该串出现 12 行,每次报错在日志中重复打印),**退出码 1、无 PDF**。
同一行 caption 走了 `escapeLatex`(`:32`),path 没有。

### 7. 缺失值在论文表格里显示为 "NaN"(轻微)

`ReportBuilder.tableFromMatrix`(`:500`)的 `v.toFixed(digits)` 对 NaN 产出字面量 **"NaN"**,
被原样排进论文表格(`pdftotext` 可读出 `NaN`);而**同一个 App** 的 CSV 导出
(`CSVParser.ts:96`)写的是 **"NA"**。同一个缺失值两种写法,论文表格里出现的是 JS 产物。

### 8. `CompileOptions.bibliography` 类型与唯一生产调用不符(轻微)

`LatexCompiler.ts:17` 声明 `bibliography?: string[]`,而唯一生产调用
`Index.ets:431` 传 `bibliography: false`。运行时无害(`false?.length` → undefined,
不进 bibliography 分支),但**类型上不合法**。

### 9. `TableGenerator.latex()` 与 `addTable` 的 fragment 契约互斥(轻微)

`addTable`(`ReportBuilder.ts:131-136`)收的是 **fragment**(只有 `tabular` + 规则),
由 `toLaTeX()` / `LatexCompiler.renderTable` 各自包一层 `\begin{table}…\end{table}`;
而 `TableGenerator.latex()`(`:37-49`)产出的是**完整 float 环境**。
两者相遇就是**浮动体套浮动体**:

```
rb.addTable(TableGenerator.latex(M, headers), 'cap')   // = tests/core.test.ts:854 的写法
```

`pdflatex` 报 **"LaTeX Error: Not in outer par mode."**,**退出码 1** → `TableGenerator`
在当前唯一的生产表路径下**根本不可用**。而 `core.test.ts:849` 只断言字符串里有
`\begin{table}` / `\end{table}`,所以这条坏组合被测试"钉住"却没暴露。

## 根因

1. **标题**:两个 LaTeX 生产者(`ReportBuilder.toLaTeX` 与 `LatexCompiler.compileLaTeX`)
   对"标题从哪来"各写各的,后者只认 `opts.title`。生产调用点没传,于是落成空标题。
   —— 同一逻辑两份实现,现已统一为"opts 优先、builder 兜底"(与作者行同款回退)。

2. **HTML 转义**:`TableGenerator` 复制了一份 LaTeX 转义器,却把它用在了 HTML 上。
   包内共有 **3 份** HTML 转义(ReportBuilder / FigureHandler 各一份私有的)
   + 1 份 LaTeX 转义,谁抄谁完全靠人。已合并为唯一的 `escapeHtml()`。

3. **写盘失败**:`writeViaPicker` 的 `try` 同时包住**选文件**和**写文件**,
   `catch` 一刀切成 `null`,于是"失败"与"取消"不可区分。

4. **列数**:列规格与单元格数来自两个不同的来源(headers vs 行本身),
   中间没有任何断言,错误只能在 LaTeX 编译器那里以"用户数据有问题"的面貌暴露。

5. **CI 列**:`StatisticalResult` 的字段比表格的列多,LaTeX/HTML 两份统计表渲染器
   各自硬编码了 5 列表头,Markdown 那份是手写字段列表 —— 加字段时漏了另外两份。

6. **图片路径**:\includegraphics 的文件参数会被**展开**,所以"把路径当普通文本转义"
   这个思路在这里是错的(详见下一节)。

7. **缺失值**:`toFixed()` 的 NaN 分支没人管;CSV 导出那侧早就有 `NA` 约定,
   表格这边没有跟上 —— **同一个缺失值两种写法**。

8. **bibliography 类型**:类型只表达了"调用方应该怎么用",没有表达"实际怎么被调用"。

9. **表环境**:`addTable` 的契约(fragment)是写在注释里的,没有任何代码执行它;
   `TableGenerator.latex` 的契约(完整环境)也是写在注释里的,两边都没对齐。

### 为什么 `escapeLatex` **不是** `\includegraphics` 参数的可行修法

这一点是本轮最关键的技术判断,单独记下来:

- **裸路径**(缺陷 6 的旧行为):`C:\Users\paleo\fig1.png` → `Undefined control sequence.`,exit 1。
- **`escapeLatex` 转义过的路径**:`\includegraphics{...}{C\textbackslash{}Users\textbackslash{}paleo\textbackslash{}fig1.png}`
  —— **仍然失败**,而且失败方式更隐蔽:

  | | 实测结果 |
  |---|---|
  | 错误 | `Missing endcsname inserted`(3 处) |
  | 实际查找的文件名 | `…\textbackslash{}Users…`(宏被**展开**后混进了文件名) |
  | 退出码 | 1,无 PDF |

  原因是 `\includegraphics` 的文件参数在解析时会被**展开**:`\textbackslash{}` 是一个宏,
  展开成 `\`,而 `\Users` 里的 `\U` 又是一个未定义的控制序列 →
  `Missing endcsname inserted`。**宏在文件名位置不可用。**

  把同一条路径交给 `ReportBuilder`(它当时确实转义了)——**同样失败**,这就排除了
  "只有 FigureHandler 没转义"的解释:转义本身就是错的修法。

- **可行解是 `\detokenize{}`**:它是 e-TeX 原语,把参数里的每个字符变成 catcode-12 的
  字符 token,路径原样送到 graphicx,不做任何展开。

  | | pdflatex 实测 |
  |---|---|
  | 旧:裸路径 | `Undefined control sequence`(日志 12 行),exit 1,无 PDF |
  | 旧:`escapeLatex` 路径 | `Missing endcsname inserted` ×3,exit 1,无 PDF |
  | 新:`\detokenize{}` 相对名 `fig1.png` | **exit 0,PDF 正常生成** |
  | 新:`\detokenize{}` 绝对 POSIX 路径 | **exit 0,PDF 正常生成** |
  | 新:`\detokenize{}` 绝对反斜杠路径 | exit 1,但只有 `File not found`(LaTeX 语法不再坏) |

  所以 `FigureHandler` / `ReportBuilder.toLaTeX` / `LatexCompiler.renderFigure`
  **三处**统一改用 `\detokenize{}`。

## 修复

改动文件(全部在 `core/reporting/` 与 `core/io/` 内):

| 文件 | 改动 |
|---|---|
| `reporting/LatexCompiler.ts` | `title` 改可选并回退 `builder.getTitle()`;`bibliography?: string[] \| false`;图路径改 `\detokenize{}`;统计表补 CI 列(6 列);新增共享 `escapeHtml()` / `detokenizePath()` / `formatCI()` |
| `reporting/ReportBuilder.ts` | `tableFromMatrix` 校验列数并抛可解释错误;缺失值 → `NA`;HTML 统计表补 CI 列;图路径改 `\detokenize{}`;`addTable` 收到完整 table 环境时自动拆包;`_escapeHTML` 改调共享实现 |
| `reporting/TableGenerator.ts` | `html()` 改用 HTML 转义;`latex()` 校验列数;缺失值 → `NA`;新增 `latexFragment()`,`latex()` 由它拼装 |
| `reporting/FigureHandler.ts` | 图路径改 `\detokenize{}`;`_escapeHTML` 改调共享实现 |
| `reporting/MatrixConverter.ts` | 新增 `formatCell()`:NaN → `NA`,±Inf → `Inf` / `-Inf` |
| `reporting/index.ts` | barrel 补 `escapeHtml` / `detokenizePath` / `formatCI` / `unwrapTableEnvironment` |
| `io/FilePickerHelper.ts` | 写盘失败**上抛**,"取消"仍返回 `null`;picker 自身失败不再冒充取消;`picker` 改动态 import |

关键决策:

1. **标题回退**:`opts.title` 优先,空则用 `builder.getTitle()` —— 与作者行
   (`opts.authors || builder.getAuthors()`)同款,不引入第三种规则。
2. **共享实现**:`escapeHtml` / `detokenizePath` / `formatCI` 放在 `LatexCompiler.ts`
   (它已经是包内共享转义函数的落脚点),`ReportBuilder` / `TableGenerator` /
   `FigureHandler` 全部调用它 —— 按 `docs/code-style.md` 1.4"一个量,一份实现"。
3. **完整 table 环境拆包**:`addTable` 收到 `\begin{table}…\end{table}` 时把外层环境
   拆掉,只留 `tabular`;同时剥掉内层 `\caption{}` / `\label{}`(否则一个表会有两个标题、
   两个标签)。拆包用**括号配对**扫描而不是 `[^}]*` 正则,这样 caption 里带转义花括号
   (`a \{b\}`)时不会被拦腰截断、留下多余的 `\}`。
4. **缺失值统一 `NA`**:与 `CSVParser.toCSV` 的既有约定一致;`MatrixConverter.formatCell`
   是唯一实现,LaTeX / HTML / Markdown 三种表格共用。
5. **写盘失败上抛**:`saveFile` / `saveBinary` 的 `null` 现在**只**表示"用户取消";
   写盘失败让 promise reject,调用方现有的 `.catch` 就会显示真实原因
   (`Index.ets:446` 的 "Report export error: …")。为让这段行为在 node 台架里可测,
   把"选目标 + 写盘"抽成公开的 `saveVia(pick, write)`,`writeToUri(uri, write)` 单列。
6. **picker 改动态 import**:`import { picker } from '@kit.CoreFileKit'` 是**静态**具名导入,
   而 node 台架的 shim 没有 `picker` 导出 → 整个模块**无法实例化**
   (`does not provide an export named 'picker'`),于是这段逻辑一行都测不了。
   改用 `await import('@kit.CoreFileKit')`(包内 `ProcessPool` / `TaskScheduler` 对
   `@kit.ArkTS` 就是这个写法)后,取消/失败的区分才能被真测。

### 需要其它 agent 同步的调用点

- **`tests/run.ts`**:本轮新增的 `tests/fixReporting2026.test.ts` 需要在 `tests/run.ts` 里
  加一行 `import './fixReporting2026.test.ts';` 才会进
  `node --experimental-transform-types tests/test.mjs`。
  **该行已由 lead 补上**(复核时 `run.ts` 已含此 import),21 条新测试已随标准命令运行。
- **`Index.ets:436`(建议)**:目前是 `if (!content) { … 'LaTeX report produced no output' }`,
  只看内容为空、不看 `compiled.success`,所以 `compileLaTeX` 捕获到的错误原因
  (例如列数不匹配)会被吞掉。建议改判 `compiled.success` 并显示 `compiled.errors`。
- **`Index.ets:431`(可选)**:`bibliography: false` 现在类型合法,可直接删掉该字段。
- **`Index.ets:404/429/442/466/471/358/376`(无需改)**:标题回退已生效;
  `null` 仍只代表"用户取消",写盘失败改为 reject 后正好落到既有 `.catch`。
- **`tests/core.test.ts:849-859`(无需改断言)**:缺陷 9 修好后该组合恰好产出
  一组 `\begin{table}` / `\end{table}`,既有断言仍然成立;如要加固可断言"恰好 1 个"。

## 验证

### 真实 pdflatex 编译(TeX Live 2025)

端到端:用修好的代码生成 `e2e.tex`(标题在 builder 上、opts 不传 title;一张含 NaN 的
数据表;一条带 CI 的统计结果;一张图片),`pdflatex -interaction=nonstopmode`:

```
pdflatex exit=0  pdf=True
errors: undefCtl=0 notFound=0 outerPar=0 extraTab=0
```

`pdftotext` 读回 PDF:

| 断言 | 结果 |
|---|---|
| 标题 | `PaleoAST export` ✅(旧行为:标题页**无标题**,PDF 首行是表头) |
| CI 列 | `95% CI` + `[0.1200, 1.1000]` ✅ |
| 缺失值 | `NA` ✅ |
| JS 产物 | 不含 `NaN` ✅ |

逐条缺陷的编译证据:

| 缺陷 | 旧 | 新 |
|---|---|---|
| 6 图路径 | 裸路径 `Undefined control sequence` ×12 行 / exit 1 / 无 PDF;`escapeLatex` 路径 `Missing endcsname inserted` ×3 / exit 1 | `\detokenize{}` → **exit 0,PDF 生成** |
| 4 列数 | `Extra alignment tab has been changed to \cr` / exit 1 | 抛 `Table column count mismatch: 2 header column(s) but row 1 has 3 cell(s)` |
| 9 嵌套浮动体 | `LaTeX Error: Not in outer par mode.` / exit 1 | 恰好 1 组 `\begin{table}` / `\end{table}`,exit 0 |
| 5 CI 列 | 5 列,无 CI | 6 列,`95\% CI` / `95% CI` |

### 新增测试

`tests/fixReporting2026.test.ts`,**21 条**,测试名一律写出旧行为:

- `compileLaTeX wrote an empty \title{} when opts.title was empty`
- `compileLaTeX still prefers an explicitly passed title`
- `TableGenerator.html left "<script>" as a live tag and "&" as a LaTeX escape`
- `the shared HTML escaper is the one used by every HTML writer`
- `tableFromMatrix produced a .tex that pdflatex rejects ("Extra alignment tab")`
- `TableGenerator.latex produced a .tex that pdflatex rejects ("Extra alignment tab")`
- `a matching table is still accepted`
- `the LaTeX statistics table had five columns and no CI`
- `the compiled .tex statistics table had five columns and no CI`
- `the HTML statistics table had five columns and no CI`
- `a result without a CI still shows the placeholder`
- `FigureHandler.toLatex emitted a raw Windows path (pdflatex: Undefined control sequence)`
- `the LaTeX-escaped path was not a fix either (the macro is expanded)`
- `saveVia resolved to null (i.e. "cancelled") when the write failed`
- `a cancelled save still resolves to null`
- `a picker failure is not mistaken for a cancellation`
- `tableFromMatrix wrote the JavaScript artefact "NaN" into the table`
- `TableGenerator.latex wrote "NaN" into the table`
- `the CSV export of the same missing value is "NA" as well`
- `addTable wrapped TableGenerator.latex output in another table (Not in outer par mode)`
- `a plain fragment is still wrapped exactly once`

测试本身不依赖 TeX(纯字符串断言),保证任何机器都能跑;上面的 pdflatex 数字是
本机的真实编译结果。

### 门禁

- 新增套件:**21 passed, 0 failed**。
- 全量 `node --experimental-transform-types tests/test.mjs`(本轮记录时):
  **544 passed, 8 failed (552)**。8 条失败**全部不在本轮范围**,来自并行修改中的
  `core/math/stats.ts`(`pnorm is not defined` ×2)与 `core/analysis`
  (`isUsable is not defined` ×3、phyloANOVA ×1)以及既有的 Matrix 广播、
  Anderson-Darling、PLS 三条数值断言。
  **reporting / io 相关基线用例与本轮 21 条新测试全绿。**
  (该总数会随其它 agent 的并行改动浮动;记录时 `tests/run.ts` 引用的
  `fixStatistics2026.test.ts` 尚未由对应 agent 创建,该文件缺失会让整个 runner
  起不来,故临时以"跳过缺失文件"的方式跑通。)
- `conda run -n dev python tools/structure_check.py`:**178 文件 0 问题**。
- 改了 barrel,补跑全模块 import 冒烟:**109/109 干净**(无
  `does not provide an export named 'X'`)。

## 风险

1. **HarmonyOS 取消码 13900012 未在真机验证**。`FilePickerHelper.isUserCancel()` 按
   业务错误码 `13900012`(文件选择器的取消码)判定,另加消息里含 `cancel` / `dismiss` 的兜底。
   若真机用别的码或别的文案,用户会看到"导出错误"而不是"已取消"——
   **这是保守失败,不会静默**:宁可多报一次错,也不能把写盘失败说成用户取消。
   建议真机验证一次后把实际码固化进 `PICKER_CANCEL_CODE`。
2. **`\detokenize{}` 无法承载含 `{` / `}` 的路径**(它需要括号配对)。
   这类路径现在抛可解释错误(`Figure path must not contain "{" or "}"`),
   而不是生成一份坏文档。带花括号的文件名极罕见。
3. **完整 table 环境被拆包时,内层 `\caption{}` / `\label{}` 会被丢弃**,
   以 `addTable` 的 caption / label 为准 —— 避免一个表出现两个标题、两个标签。
   想要内层标签的调用方应改用 `TableGenerator.latexFragment()` 并把 label 传给 `addTable`。
4. **`MatrixConverter.toCSV` 仍写 `NaN`**(与 `CSVParser.toCSV` 的 `NA` 仍不一致)。
   不在本轮范围(缺陷 7 限定在论文表格),但同一个缺失值两种写法的问题在
   reporting 包的 CSV 导出上**依然存在**,后续应一并统一。
5. `Index.ets` 未在真机验证(本轮无 HarmonyOS SDK);所有 LaTeX 结论均在
   pdfTeX(TeX Live 2025)上取得,`xelatex` / `lualatex` 对 `\detokenize` 的支持相同,
   但未实测。
