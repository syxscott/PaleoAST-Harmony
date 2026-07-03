/**
 * LaTeX compiler for academic reports — replaces reporting/report_builder.py::LatexCompiler.
 *
 * Produces a complete .tex document with title, abstract, sections, figures, tables.
 * Includes helpers to embed PNG/SVG/PDF figures.
 */
import { ReportBuilder } from './ReportBuilder';

export interface CompileOptions {
  title: string;
  author?: string;
  documentClass?: string;     // 'article' | 'report' | 'book'
  bibliography?: string[];    // BibTeX keys
  packages?: string[];       // additional LaTeX packages
}

export class LatexCompiler {
  /**
   * Compile a ReportBuilder document into a full LaTeX source string.
   */
  static compile(builder: ReportBuilder, opts: CompileOptions): string {
    const docClass = opts.documentClass ?? 'article';
    const pkgs = (opts.packages ?? []).concat([
      'graphicx', 'amsmath', 'amssymb', 'booktabs',
      'geometry', 'hyperref', 'caption', 'float'
    ]);
    const pkgText = pkgs.map(p => `\\usepackage{${p}}`).join('\n');

    const bib = opts.bibliography?.length
      ? `\n\\bibliographystyle{plain}\n\\bibliography{${opts.bibliography.join(',')}}\n`
      : '';

    const sections = builder.getSections().map(s => this._renderSection(s)).join('\n\n');

    return [
      `\\documentclass{${docClass}}`,
      pkgText,
      `\\title{${this._escape(opts.title)}}`,
      `\\author{${this._escape(opts.author ?? 'PaleoAST')}}`,
      `\\date{\\today}`,
      `\\begin{document}`,
      `\\maketitle`,
      sections,
      bib,
      `\\end{document}`
    ].join('\n\n');
  }

  private static _renderSection(s: string): string {
    // Markdown-style headings: '# Title' → \section{Title}
    if (s.startsWith('# ')) return `\\section{${this._escape(s.slice(2))}}`;
    if (s.startsWith('## ')) return `\\subsection{${this._escape(s.slice(3))}}`;
    if (s.startsWith('### ')) return `\\subsubsection{${this._escape(s.slice(4))}}`;
    if (s.startsWith('![')) {
      // ![caption](path)
      const m = s.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (m) {
        return `\\begin{figure}[H]\n\\centering\n\\includegraphics[width=0.9\\linewidth]{${m[2]}}\n\\caption{${this._escape(m[1])}}\n\\end{figure}`;
      }
    }
    if (s.startsWith('```')) {
      const lines = s.split('\n');
      const code = lines.slice(1, -1).join('\n');
      return `\\begin{verbatim}\n${code}\n\\end{verbatim}`;
    }
    if (s.startsWith('|')) {
      return this._renderTable(s);
    }
    return this._escape(s);
  }

  private static _renderTable(md: string): string {
    const rows = md.split('\n').map(r => r.split('|').map(c => c.trim()).filter(Boolean));
    if (rows.length < 2) return md;
    const header = rows[0];
    // Skip separator row (---)
    const body = rows.slice(2);
    const colSpec = header.map(() => 'l').join(' ');
    const lines = [
      `\\begin{table}[H]\\centering`,
      `\\begin{tabular}{${colSpec}}`,
      `\\toprule`,
      header.map(this._escape).join(' & ') + ' \\\\',
      `\\midrule`,
      ...body.map(r => r.map(this._escape).join(' & ') + ' \\\\'),
      `\\bottomrule`,
      `\\end{tabular}`,
      `\\end{table}`
    ];
    return lines.join('\n');
  }

  private static _escape(s: string): string {
    return s.replace(/[\\$%&_{}#^~]/g, c => `\\${c}`);
  }
}
