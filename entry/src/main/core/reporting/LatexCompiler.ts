/**
 * LaTeX compiler for academic reports — replaces reporting/report_builder.py::LatexCompiler.
 *
 * Produces complete .tex document with title, abstract, sections, figures, tables.
 * HarmonyOS Notes:
 * - Actual PDF compilation requires @ohos.file.fs to write .tex file
 * - External pdflatex/xelatex compilation is platform-dependent
 * - For now, generates .tex string that can be compiled on desktop or exported
 */
import { ReportBuilder, SectionType } from './ReportBuilder';
import { LATEX_PREAMBLE } from './latexPreamble';

export interface CompileOptions {
  /**
   * Document title.
   *
   * Optional on purpose: the production export path (Index.ets) sets the
   * title on the ReportBuilder and never passed one here, so every exported
   * .tex came out with an empty `\title{}` and the PDF title page had NO
   * title — silently, with pdflatex exit code 0. When this is empty the
   * builder's title is used instead (same fallback as the author line).
   */
  title?: string;
  authors?: string[];
  documentClass?: 'article' | 'report' | 'book' | 'beamer';
  /**
   * BibTeX keys. `false` is accepted and means "no bibliography": the
   * production call site passes `bibliography: false`, which the old
   * `string[]` type rejected even though the runtime ignored it.
   */
  bibliography?: string[] | false;
  packages?: string[];       // additional LaTeX packages
  fontSize?: number;         // default 11
  /**
   * Paper size. Typed as a union because the value is interpolated straight
   * into `\documentclass[...]{...}` and `\geometry{...}`, and both reject
   * anything that is not a real class option: passing `'a4'` produced
   * `! Package keyval Error: a4 undefined.` and NO pdf at all. It was an
   * unconstrained `string`, so nothing caught the bad value until pdflatex.
   */
  paperSize?: 'a4paper' | 'letterpaper' | 'legalpaper' | 'executivepaper' | 'a5paper' | 'b5paper';
  margin?: string;           // default '1in'
}

export interface CompileResult {
  success: boolean;
  texContent: string;
  outputPath?: string;
  errors?: string[];
}

/**
 * Compile a ReportBuilder document into a full LaTeX source string.
 * Returns the complete .tex content ready for compilation.
 */
export function compileLaTeX(builder: ReportBuilder, opts: CompileOptions): CompileResult {
  const errors: string[] = [];

  try {
    const docClass = opts.documentClass ?? 'article';
    const fontSize = opts.fontSize ?? 11;
    const margin = opts.margin ?? '1in';

    // Normalise the paper size even though the type is now a union: ArkUI
    // payloads arrive as untyped objects, so a caller can still hand over the
    // bare string 'a4'. Both \documentclass and \geometry need the '*paper'
    // spelling, and a wrong value fails at compile time with
    // "Package keyval Error", long after the caller thought it had succeeded.
    const PAPER_SIZES = ['a4paper', 'letterpaper', 'legalpaper', 'executivepaper', 'a5paper', 'b5paper'];
    const rawPaper = String(opts.paperSize ?? 'a4paper').trim().toLowerCase();
    let paperSize = PAPER_SIZES.indexOf(rawPaper) >= 0 ? rawPaper : 'a4paper';
    if (paperSize !== rawPaper) {
      // Accept the obvious short forms rather than silently falling back.
      if (/^a4$/.test(rawPaper)) paperSize = 'a4paper';
      else if (/^letter$/.test(rawPaper)) paperSize = 'letterpaper';
      else if (/^legal$/.test(rawPaper)) paperSize = 'legalpaper';
      else if (/^a5$/.test(rawPaper)) paperSize = 'a5paper';
      else errors.push('paperSize "' + String(opts.paperSize) + '" is not a LaTeX paper option; using a4paper');
    }

    // Build packages
    const standardPackages = [
      'graphicx', 'booktabs', 'amsmath', 'amssymb',
      'hyperref', 'caption', 'float', 'geometry'
    ];
    const allPackages = [...new Set([...standardPackages, ...(opts.packages ?? [])])];
    const pkgText = allPackages.map(p => `\\usepackage{${p}}`).join('\n');

    // Build title: the caller's title wins, the builder's title is the
    // fallback. The export path never passed a title, so `\title{}` came out
    // empty and the PDF title page had no title at all — a silent, complete
    // loss of the one thing that identifies the report in a manuscript.
    const title = String(opts.title ?? '').trim() || String(builder.getTitle() ?? '').trim();

    // Build author line
    const authorLine = opts.authors?.join(' \\and ') || builder.getAuthors().map(a => a.name).join(' \\and ') || 'PaleoAST';

    // Sections
    const sections = builder.getSections();
    const sectionsTex = sections.map(s => renderSection(s)).join('\n\n');

    // Bibliography (`bibliography` may be `false` — see CompileOptions)
    const bibKeys = Array.isArray(opts.bibliography) ? opts.bibliography : [];
    const bibTex = bibKeys.length > 0
      ? `\n\\bibliographystyle{plainnat}\n\\bibliography{${bibKeys.join(',')}}\n`
      : '';

    // Statistical results
    const statsResults = builder.getStatisticalResults();
    const statsTex = statsResults.length > 0 ? renderStatisticalResults(statsResults) : '';

    // Figures
    const figures = builder.getFigures();
    const figuresTex = figures.map(f => renderFigure(f)).join('\n\n');

    // Tables
    const tables = builder.getTables();
    const tablesTex = tables.map(t => renderTable(t)).join('\n\n');

    // Build complete document
    const texContent = [
      `\\documentclass[${fontSize}pt,${paperSize}]{${docClass}}`,
      '',
      LATEX_PREAMBLE,
      '',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[T1]{fontenc}',
      `\\geometry{${paperSize}, margin=${margin}}`,
      pkgText,
      '',
      `\\title{${escapeLatex(title)}}`,
      `\\author{${escapeLatex(authorLine)}}`,
      `\\date{${builder.getAbstract() ? '\\today' : ''}}`,
      '',
      '\\begin{document}',
      '',
      '\\maketitle',
      ''
    ];

    // Abstract
    const abs = builder.getAbstract();
    if (abs) {
      texContent.push('\\begin{abstract}');
      texContent.push(escapeLatex(abs));
      texContent.push('\\end{abstract}');
      texContent.push('');
    }

    // Table of contents
    texContent.push('\\newpage');
    texContent.push('\\tableofcontents');
    texContent.push('');

    // Main content
    texContent.push(sectionsTex);
    texContent.push('');

    // Statistical results
    if (statsTex) {
      texContent.push(statsTex);
    }

    // Figures
    if (figuresTex) {
      texContent.push(figuresTex);
    }

    // Tables
    if (tablesTex) {
      texContent.push(tablesTex);
    }

    // References
    const refs = builder.getReferences();
    if (refs.length > 0) {
      texContent.push('\\newpage');
      texContent.push('\\section{References}');
      texContent.push('');
      for (const ref of refs) {
        texContent.push(escapeLatex(ref));
        texContent.push('');
      }
    }

    texContent.push(bibTex);
    texContent.push('\\end{document}');

    return {
      success: true,
      texContent: texContent.join('\n')
    };

  } catch (e) {
    errors.push(String(e));
    return {
      success: false,
      texContent: '',
      errors
    };
  }
}

/**
 * Render a single section to LaTeX.
 */
function renderSection(section: { title: string; content: string; type: SectionType; level: number; label?: string }): string {
  if (section.type === SectionType.TITLE) {
    return ''; // Title already rendered by maketitle
  }

  const lines: string[] = [];

  // Section command based on level
  let cmd: string;
  switch (section.level) {
    case 1: cmd = '\\section'; break;
    case 2: cmd = '\\subsection'; break;
    case 3: cmd = '\\subsubsection'; break;
    default: cmd = '\\section';
  }

  const label = section.label ? `\\label{${section.label}}` : '';
  lines.push(`${cmd}{${escapeLatex(section.title)}}${label}`);
  lines.push('');
  lines.push(escapeLatex(section.content));

  return lines.join('\n');
}

/**
 * Render a figure reference to LaTeX.
 *
 * The path is wrapped in `\detokenize{}` — see detokenizePath() for why the
 * LaTeX escaper cannot be used here.
 */
function renderFigure(fig: { id: string; caption: string; path: string; width?: string }): string {
  return [
    '\\begin{figure}[htbp]',
    '\\centering',
    `\\includegraphics[width=${fig.width || '0.8\\textwidth'}]{${detokenizePath(fig.path)}}`,
    `\\caption{${escapeLatex(fig.caption)}}`,
    `\\label{${fig.id}}`,
    '\\end{figure}'
  ].join('\n');
}

/**
 * Render a table reference to LaTeX.
 */
function renderTable(tbl: { id: string; caption: string; content: string; placement?: string }): string {
  return [
    `\\begin{table}[${tbl.placement || 'htbp'}]`,
    '\\centering',
    tbl.content,
    `\\caption{${escapeLatex(tbl.caption)}}`,
    `\\label{${tbl.id}}`,
    '\\end{table}'
  ].join('\n');
}

/**
 * Render statistical results table.
 *
 * The 95% CI column was missing here (and in ReportBuilder.toHTML), so a
 * confidence interval recorded on a result was silently dropped from the
 * LaTeX/HTML output while the Markdown output still carried it.
 */
function renderStatisticalResults(results: Array<{
  testName: string;
  statistic: number;
  pValue?: number;
  df?: number;
  effectSize?: number;
  ciLower?: number;
  ciUpper?: number;
}>): string {
  const lines: string[] = [];

  lines.push('\\section{Statistical Results}');
  lines.push('');
  lines.push('\\begin{table}[htbp]');
  lines.push('\\centering');
  lines.push('\\begin{tabular}{llllll}');
  lines.push('\\toprule');
  lines.push('Test & Statistic & df & p-value & Effect size & 95\\% CI \\\\');
  lines.push('\\midrule');

  for (const r of results) {
    const testName = escapeLatex(r.testName);
    const stat = r.statistic.toFixed(4);
    const df = r.df !== undefined ? String(r.df) : '--';
    const pVal = r.pValue !== undefined ? formatPValue(r.pValue) : '--';
    const effect = r.effectSize !== undefined ? r.effectSize.toFixed(4) : '--';
    const ci = formatCI(r.ciLower, r.ciUpper);
    lines.push(`${testName} & ${stat} & ${df} & ${pVal} & ${effect} & ${ci} \\\\`);
  }

  lines.push('\\bottomrule');
  lines.push('\\end{tabular}');
  lines.push('\\caption{Summary of statistical tests}');
  lines.push('\\end{table}');

  return lines.join('\n');
}

/**
 * Format a 95% confidence interval for a table cell.
 *
 * `--` when neither bound is known, `[lower, --]` when only one is. The
 * brackets are plain text in LaTeX and in HTML, so no escaping is needed.
 */
export function formatCI(lower?: number, upper?: number, digits: number = 4): string {
  if (lower === undefined && upper === undefined) return '--';
  const lo = lower !== undefined ? lower.toFixed(digits) : '--';
  const hi = upper !== undefined ? upper.toFixed(digits) : '--';
  return `[${lo}, ${hi}]`;
}

/**
 * Format p-value for LaTeX.
 */
function formatPValue(p: number): string {
  if (p < 0.001) return '$p < 0.001$';
  if (p < 0.01) return `$p = ${p.toFixed(3)}$`;
  return `$p = ${p.toFixed(4)}$`;
}

/**
 * Escape special LaTeX characters (text mode).
 *
 * Done in ONE pass. Chaining `.replace(/\\/ …)` before the brace rule broke
 * backslashes: the backslash macro's own `{}` were then escaped again, turning
 * a single `\` into `\textbackslash\{\}`. Backslash, tilde and caret also need
 * their macros rather than a prefixed backslash (`\~` and `\^` are accents).
 */
export function escapeLatex(s: string | undefined | null): string {
  // `CompileOptions` fields are all optional, so opts.title / caption / label can
  // legitimately arrive undefined. Iterating them threw
  // "TypeError: s is not iterable" and aborted the whole compile.
  if (s === undefined || s === null) return '';
  let out = '';
  for (const ch of s) {
    switch (ch) {
      case '\\': out += '\\textbackslash{}'; break;
      case '~': out += '\\textasciitilde{}'; break;
      case '^': out += '\\textasciicircum{}'; break;
      case '&': case '%': case '$': case '#': case '_': case '{': case '}':
        out += '\\' + ch;
        break;
      default: out += ch;
    }
  }
  return out;
}

/**
 * Escape special HTML characters.
 *
 * The LaTeX escaper must NOT be used for HTML: it leaves `<` and `>` alone
 * (they are not LaTeX specials) and turns `&` into `\&`, which is not an
 * HTML entity. A cell containing `<script>alert(1)</script>` therefore came
 * out of the HTML table writer as a LIVE tag, and `a & b` came out as
 * `a \& b`. Column names come straight from the user's data file, so this is
 * a real injection surface as soon as the table is rendered in a browser.
 *
 * This is the one HTML escaper of the reporting package — ReportBuilder,
 * TableGenerator and FigureHandler all use it (docs/code-style.md 1.4: one
 * quantity, one implementation).
 */
export function escapeHtml(s: string | undefined | null): string {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap a file path in `\detokenize{}` for use as a graphicx file name.
 *
 * Neither the raw path nor the LaTeX escaper works here:
 *
 * - raw (`C:\Users\paleo\fig1.png`) → pdflatex reports
 *   "Undefined control sequence." and produces NO pdf (verified with
 *   TeX Live 2025: 12 occurrences, exit code 1);
 * - escaped (`C\textbackslash{}Users\textbackslash{}...`) → the macro is
 *   expanded while the file name is parsed, so LaTeX looks for a file
 *   literally called `C\textbackslash{}Users...` and dies with
 *   "Missing endcsname inserted" (verified, exit code 1).
 *
 * `\detokenize` turns every character into a catcode-12 token, so the path
 * reaches graphicx verbatim: a relative name (`fig1.png`) and an absolute
 * POSIX/forward-slash path both compile cleanly (exit code 0, verified).
 * A backslash-separated absolute path still fails to FIND the file on a
 * POSIX compiler, but it no longer breaks the LaTeX syntax.
 *
 * `{` and `}` cannot be carried by `\detokenize` (it needs balanced
 * braces), so such a path is rejected with an explanation instead of
 * producing a broken document.
 */
export function detokenizePath(path: string): string {
  const p = String(path ?? '');
  if (p.indexOf('{') >= 0 || p.indexOf('}') >= 0) {
    throw new Error(
      'Figure path must not contain "{" or "}" (\\detokenize{} needs balanced braces): ' + p);
  }
  return '\\detokenize{' + p + '}';
}

/**
 * Export report as .tex file.
 * In HarmonyOS, this would use @ohos.file.fs to write the file.
 */
export async function exportTeXFile(content: string, filename: string): Promise<string> {
  // Real sandbox write via fs (see FileManager.writeText)
  const { FileManager } = await import('../io/FileManager');
  await FileManager.writeText(filename, content);
  return filename;
}

/**
 * Compile LaTeX to PDF (requires external pdflatex).
 * This is a placeholder - actual implementation would spawn a subprocess.
 */
export async function compilePDF(texPath: string, outputDir?: string): Promise<CompileResult> {
  // HarmonyOS apps cannot spawn external processes (sandboxed), so a local
  // pdflatex run is impossible on device. Best possible behaviour: validate
  // the .tex, hand back its content for sharing, and point the user at the
  // PC-side compile step.
  const { FileManager } = await import('../io/FileManager');
  void outputDir;
  try {
    if (!(await FileManager.exists(texPath))) {
      return {
        success: false,
        texContent: '',
        errors: [
          `TeX file not found: ${texPath}. Generate one first with compileLaTeX() + exportTeXFile().`,
        ],
      };
    }
    const tex = await FileManager.readText(texPath);
    return {
      success: false,
      texContent: tex,
      errors: [
        'PDF compilation requires the pdflatex toolchain, which cannot run inside the HarmonyOS app sandbox.',
        'Export the returned .tex source (it is included in texContent) and compile it on a PC: `pdflatex <file>.tex` (run twice for cross references).',
      ],
    };
  } catch (e) {
    return {
      success: false,
      texContent: '',
      errors: [`PDF export failed: ${String(e)}`],
    };
  }
}

/**
 * LatexCompiler class for backward compatibility.
 * Use the standalone functions for new code.
 */
export class LatexCompiler {
  /**
   * Compile a ReportBuilder to LaTeX string.
   */
  static compile(builder: ReportBuilder, opts: CompileOptions): CompileResult {
    return compileLaTeX(builder, opts);
  }

  /**
   * Export to .tex file.
   */
  static async exportToFile(builder: ReportBuilder, opts: CompileOptions, filename: string): Promise<string> {
    const result = compileLaTeX(builder, opts);
    if (!result.success) throw new Error(result.errors?.join(', '));
    return exportTeXFile(result.texContent, filename);
  }

  /**
   * Create scientific report.
   */
  static createScientificReport(
    title: string,
    authors: string[],
    abstract: string,
    sections: Array<{ title: string; content: string; level?: number }>,
    options?: Partial<CompileOptions>
  ): CompileResult {
    return createScientificReport(title, authors, abstract, sections, options);
  }
}

// ─── Convenience functions ─────────────────────────────────────────────────────

/**
 * Create a basic scientific report.
 */
export function createScientificReport(
  title: string,
  authors: string[],
  abstract: string,
  sections: Array<{ title: string; content: string; level?: number }>,
  options?: Partial<CompileOptions>
): CompileResult {
  const builder = new ReportBuilder();
  builder.setTitle(title);
  authors.forEach(a => builder.addAuthor(a));
  builder.setAbstract(abstract, options?.bibliography);
  builder.setDate();

  for (const s of sections) {
    builder.addSection(s.title, s.content, SectionType.CUSTOM, s.level ?? 1);
  }

  return compileLaTeX(builder, {
    title,
    authors,
    ...options
  });
}

/**
 * Create a phylogenetic analysis report.
 */
export function createPhylogeneticReport(
  title: string,
  authors: string[],
  methods: string,
  results: string,
  figurePath?: string
): CompileResult {
  const builder = new ReportBuilder();
  builder.setTitle(title);
  authors.forEach(a => builder.addAuthor(a));
  builder.setAbstract('Phylogenetic analysis of morphological data using Neighbor-Joining and UPGMA methods.');
  builder.setDate();

  builder.addSection('Introduction', 'Phylogenetic relationships were inferred from distance-based methods.', SectionType.INTRODUCTION, 1);
  builder.addSection('Methods', methods, SectionType.METHODS, 1);
  builder.addSection('Results', results, SectionType.RESULTS, 1);

  if (figurePath) {
    builder.addFigure(figurePath, 'Phylogenetic tree', 'fig:tree');
  }

  return compileLaTeX(builder, { title, authors });
}
