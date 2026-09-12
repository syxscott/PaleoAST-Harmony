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
  title: string;
  authors?: string[];
  documentClass?: 'article' | 'report' | 'book' | 'beamer';
  bibliography?: string[];    // BibTeX keys
  packages?: string[];       // additional LaTeX packages
  fontSize?: number;         // default 11
  paperSize?: string;        // default 'a4paper'
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
    const paperSize = opts.paperSize ?? 'a4paper';
    const margin = opts.margin ?? '1in';

    // Build packages
    const standardPackages = [
      'graphicx', 'booktabs', 'amsmath', 'amssymb',
      'hyperref', 'caption', 'float', 'geometry'
    ];
    const allPackages = [...new Set([...standardPackages, ...(opts.packages ?? [])])];
    const pkgText = allPackages.map(p => `\\usepackage{${p}}`).join('\n');

    // Build author line
    const authorLine = opts.authors?.join(' \\and ') || builder.getAuthors().map(a => a.name).join(' \\and ') || 'PaleoAST';

    // Sections
    const sections = builder.getSections();
    const sectionsTex = sections.map(s => renderSection(s)).join('\n\n');

    // Bibliography
    const bibTex = opts.bibliography?.length
      ? `\n\\bibliographystyle{plainnat}\n\\bibliography{${opts.bibliography.join(',')}}\n`
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
      `\\title{${escapeLatex(opts.title)}}`,
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
 */
function renderFigure(fig: { id: string; caption: string; path: string; width?: string }): string {
  return [
    '\\begin{figure}[htbp]',
    '\\centering',
    `\\includegraphics[width=${fig.width || '0.8\\textwidth'}]{${escapeLatex(fig.path)}}`,
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
    '\\end{figure}'
  ].join('\n');
}

/**
 * Render statistical results table.
 */
function renderStatisticalResults(results: Array<{
  testName: string;
  statistic: number;
  pValue?: number;
  df?: number;
  effectSize?: number;
}>): string {
  const lines: string[] = [];

  lines.push('\\section{Statistical Results}');
  lines.push('');
  lines.push('\\begin{table}[htbp]');
  lines.push('\\centering');
  lines.push('\\begin{tabular}{lllll}');
  lines.push('\\toprule');
  lines.push('Test & Statistic & df & p-value & Effect size \\\\');
  lines.push('\\midrule');

  for (const r of results) {
    const testName = escapeLatex(r.testName);
    const stat = r.statistic.toFixed(4);
    const df = r.df !== undefined ? String(r.df) : '--';
    const pVal = r.pValue !== undefined ? formatPValue(r.pValue) : '--';
    const effect = r.effectSize !== undefined ? r.effectSize.toFixed(4) : '--';
    lines.push(`${testName} & ${stat} & ${df} & ${pVal} & ${effect} \\\\`);
  }

  lines.push('\\bottomrule');
  lines.push('\\end{tabular}');
  lines.push('\\caption{Summary of statistical tests}');
  lines.push('\\end{table}');

  return lines.join('\n');
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
 * Escape special LaTeX characters.
 */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, c => `\\${c}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
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
