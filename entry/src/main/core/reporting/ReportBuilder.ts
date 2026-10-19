/**
 * Report builder — replaces reporting/report_builder.py
 * Generates reports in Markdown/LaTeX/HTML formats.
 */
import { LATEX_PREAMBLE } from './latexPreamble';
import { escapeLatex, escapeHtml, detokenizePath, formatCI } from './LatexCompiler';
import { MatrixConverter } from './MatrixConverter';

export enum SectionType {
  TITLE = 'title',
  ABSTRACT = 'abstract',
  INTRODUCTION = 'introduction',
  METHODS = 'methods',
  RESULTS = 'results',
  DISCUSSION = 'discussion',
  CONCLUSION = 'conclusion',
  ACKNOWLEDGMENTS = 'acknowledgments',
  REFERENCES = 'references',
  APPENDIX = 'appendix',
  CUSTOM = 'custom'
}

export interface Section {
  title: string;
  content: string;
  type: SectionType;
  level: number;  // 1=section, 2=subsection, 3=subsubsection
  label?: string;
}

export interface FigureReference {
  id: string;
  caption: string;
  path: string;
  width?: string;
}

export interface TableReference {
  id: string;
  caption: string;
  content: string;
  placement?: string;
}

export interface StatisticalResult {
  testName: string;
  statistic: number;
  pValue?: number;
  df?: number;
  effectSize?: number;
  ciLower?: number;
  ciUpper?: number;
}

export interface Author {
  name: string;
  affiliation?: string;
  email?: string;
}

export class ReportBuilder {
  private _sections: Section[] = [];
  private _title = '';
  private _authors: Author[] = [];
  private _affiliations: string[] = [];
  private _date: string = '';
  private _abstract?: string;
  private _keywords: string[] = [];
  private _figures: FigureReference[] = [];
  private _tables: TableReference[] = [];
  private _statisticalResults: StatisticalResult[] = [];
  private _references: string[] = [];
  private _counterFigure = 0;
  private _counterTable = 0;

  setTitle(title: string): ReportBuilder {
    this._title = title;
    return this;
  }

  getTitle(): string {
    return this._title;
  }

  addAuthor(name: string, affiliation?: string, email?: string): ReportBuilder {
    this._authors.push({ name, affiliation, email });
    if (affiliation && !this._affiliations.includes(affiliation)) {
      this._affiliations.push(affiliation);
    }
    return this;
  }

  setDate(date?: string): ReportBuilder {
    if (date) {
      this._date = date;
    } else {
      const now = new Date();
      this._date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    return this;
  }

  setAbstract(abstract: string, keywords?: string[]): ReportBuilder {
    this._abstract = abstract;
    if (keywords) this._keywords = keywords;
    return this;
  }

  addSection(title: string, content: string, type: SectionType = SectionType.CUSTOM, level: number = 1, label?: string): ReportBuilder {
    this._sections.push({ title, content, type, level, label });
    return this;
  }

  addTitleSection(title: string): ReportBuilder {
    this._sections.push({ title, content: '', type: SectionType.TITLE, level: 0 });
    return this;
  }

  addAbstract(content: string, keywords?: string[]): ReportBuilder {
    this._abstract = content;
    if (keywords) this._keywords = keywords;
    return this;
  }

  addFigure(path: string, caption: string, label?: string, width: string = '0.8\\textwidth'): string {
    this._counterFigure++;
    const id = label || `fig:${this._counterFigure}`;
    this._figures.push({ id, caption, path, width });
    return id;
  }

  /**
   * Add a table.
   *
   * `tableContent` is a LaTeX FRAGMENT (the `tabular` plus its rules); both
   * toLaTeX() and LatexCompiler.renderTable wrap it in
   * `\begin{table}…\end{table}` themselves. A COMPLETE table environment is
   * accepted as well and is unwrapped here, so a caller that hands over
   * `TableGenerator.latex(...)` (which emits a whole environment) no longer
   * produces a nested float — pdflatex rejects that with
   * "LaTeX Error: Not in outer par mode." and produces no PDF at all.
   */
  addTable(tableContent: string, caption: string, label?: string, placement: string = 'htbp'): string {
    this._counterTable++;
    const id = label || `tab:${this._counterTable}`;
    this._tables.push({ id, caption, content: unwrapTableEnvironment(tableContent), placement });
    return id;
  }

  addStatisticalResult(result: StatisticalResult): ReportBuilder {
    this._statisticalResults.push(result);
    return this;
  }

  addReference(bibtexEntry: string): ReportBuilder {
    this._references.push(bibtexEntry);
    return this;
  }

  addText(text: string): ReportBuilder {
    this._sections.push({ title: '', content: text, type: SectionType.CUSTOM, level: 0 });
    return this;
  }

  // ─── Output formats ───────────────────────────────────────────────────────────

  toMarkdown(): string {
    const lines: string[] = [];

    if (this._title) {
      lines.push(`# ${this._title}`);
      lines.push('');
    }

    for (const author of this._authors) {
      lines.push(`*${author.name}*${author.affiliation ? `, ${author.affiliation}` : ''}`);
    }
    if (this._authors.length) lines.push('');

    if (this._date) lines.push(`*${this._date}*`);
    if (this._date) lines.push('');

    if (this._abstract) {
      lines.push('## Abstract');
      lines.push(this._abstract);
      if (this._keywords.length) {
        lines.push('');
        lines.push(`**Keywords:** ${this._keywords.join(', ')}`);
      }
      lines.push('');
    }

    for (const section of this._sections) {
      if (section.type === SectionType.TITLE) continue;
      const prefix = '#'.repeat(section.level);
      lines.push(`${prefix} ${section.title}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');
    }

    // Tables, figures, statistical results and references used to be dropped
    // here: addTable()/addFigure()/addStatisticalResult()/addReference() all
    // recorded their content, but toMarkdown() only emitted title, authors,
    // date, abstract and sections — so a table added to a report simply vanished
    // from the Markdown and HTML output while still appearing in the LaTeX one.
    for (const tbl of this._tables) {
      // `content` is a LaTeX fragment for LaTeX consumers; Markdown and HTML
      // get the caption plus a pointer rather than raw \begin{tabular}, which
      // would render as noise.
      lines.push(`**${tbl.caption || 'Table'}**`);
      lines.push('');
      if (tbl.content) {
        lines.push('```latex');
        lines.push(tbl.content);
        lines.push('```');
        lines.push('');
      }
    }

    for (const fig of this._figures) {
      lines.push(`![${fig.caption}](${fig.path})`);
      lines.push('');
    }

    for (const sr of this._statisticalResults) {
      const bits: string[] = [];
      if (sr.statistic !== undefined) bits.push(`statistic = ${sr.statistic}`);
      if (sr.df !== undefined) bits.push(`df = ${sr.df}`);
      if (sr.pValue !== undefined) bits.push(`p = ${sr.pValue}`);
      if (sr.effectSize !== undefined) bits.push(`effect size = ${sr.effectSize}`);
      if (sr.ciLower !== undefined || sr.ciUpper !== undefined) {
        bits.push(`95% CI = [${sr.ciLower ?? '--'}, ${sr.ciUpper ?? '--'}]`);
      }
      lines.push(`- **${sr.testName}**${bits.length ? ': ' + bits.join(', ') : ''}`);
    }
    if (this._statisticalResults.length) lines.push('');

    if (this._references.length) {
      lines.push('## References');
      lines.push('');
      for (const r of this._references) lines.push('- ' + r);
      lines.push('');
    }

    return lines.join('\n');
  }

  toHTML(): string {
    const lines: string[] = [];

    lines.push('<!DOCTYPE html>');
    lines.push('<html><head><meta charset="UTF-8"><title>Report</title>');
    lines.push('<style>');
    lines.push('body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }');
    lines.push('h1, h2, h3 { color: #333; }');
    lines.push('table { border-collapse: collapse; width: 100%; }');
    lines.push('td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }');
    lines.push('</style></head><body>');

    if (this._title) {
      lines.push(`<h1>${this._escapeHTML(this._title)}</h1>`);
    }

    for (const author of this._authors) {
      lines.push(`<p><em>${this._escapeHTML(author.name)}</em>${author.affiliation ? `, ${this._escapeHTML(author.affiliation)}` : ''}</p>`);
    }

    if (this._abstract) {
      lines.push('<h2>Abstract</h2>');
      lines.push(`<p>${this._escapeHTML(this._abstract)}</p>`);
    }

    for (const section of this._sections) {
      if (section.type === SectionType.TITLE) continue;
      const level = Math.min(section.level, 6);
      lines.push(`<h${level}>${this._escapeHTML(section.title)}</h${level}>`);
      lines.push(`<p>${this._escapeHTML(section.content).replace(/\n/g, '<br>')}</p>`);
    }

    // Same omission as in toMarkdown(): tables, figures, statistical results
    // and references were recorded but never emitted. The stylesheet above even
    // declares `table` / `td` / `th` rules that nothing could ever match.
    for (const fig of this._figures) {
      lines.push(`<figure><img src="${this._escapeHTML(fig.path)}" alt="${this._escapeHTML(fig.caption)}"/>`);
      lines.push(`<figcaption>${this._escapeHTML(fig.caption)}</figcaption></figure>`);
    }

    for (const tbl of this._tables) {
      lines.push(`<h3>${this._escapeHTML(tbl.caption || 'Table')}</h3>`);
      // `content` is a LaTeX fragment by contract. Translating LaTeX tabular to
      // HTML here would be a second, untested implementation of the same
      // table — so the caption is emitted and the fragment is shown verbatim
      // in a <pre>, which is honest about what it is.
      lines.push(`<pre>${this._escapeHTML(tbl.content || '')}</pre>`);
    }

    if (this._statisticalResults.length) {
      lines.push('<h2>Statistical results</h2>');
      // The 95% CI column was missing here (the Markdown output had it), so a
      // confidence interval was silently dropped from the HTML report.
      lines.push('<table><tr><th>Analysis</th><th>Statistic</th><th>df</th><th>p</th><th>Effect size</th><th>95% CI</th></tr>');
      for (const sr of this._statisticalResults) {
        lines.push('<tr>'
          + `<td>${this._escapeHTML(sr.testName)}</td>`
          + `<td>${sr.statistic === undefined ? '--' : this._escapeHTML(String(sr.statistic))}</td>`
          + `<td>${sr.df === undefined ? '--' : this._escapeHTML(String(sr.df))}</td>`
          + `<td>${sr.pValue === undefined ? '--' : this._escapeHTML(String(sr.pValue))}</td>`
          + `<td>${sr.effectSize === undefined ? '--' : this._escapeHTML(String(sr.effectSize))}</td>`
          + `<td>${this._escapeHTML(formatCI(sr.ciLower, sr.ciUpper))}</td>`
          + '</tr>');
      }
      lines.push('</table>');
    }

    if (this._references.length) {
      lines.push('<h2>References</h2><ul>');
      for (const r of this._references) lines.push(`<li>${this._escapeHTML(r)}</li>`);
      lines.push('</ul>');
    }

    lines.push('</body></html>');
    return lines.join('\n');
  }

  toLaTeX(): string {
    const lines: string[] = [];

    // Document class
    lines.push('\\documentclass[11pt,a4paper]{article}');
    lines.push('');

    // Preamble packages
    lines.push(LATEX_PREAMBLE);
    lines.push('');

    // User packages (none by default)
    lines.push('\\usepackage[utf8]{inputenc}');
    lines.push('\\usepackage[T1]{fontenc}');
    lines.push('');

    // Title
    if (this._title) {
      lines.push(`\\title{${this._escapeLaTeX(this._title)}}`);
    }

    // Authors
    if (this._authors.length > 0) {
      const authorLines = this._authors.map(a => {
        let author = this._escapeLaTeX(a.name);
        if (a.email) author += ` (${this._escapeLaTeX(a.email)})`;
        if (a.affiliation) author += `\\\\ ${this._escapeLaTeX(a.affiliation)}`;
        return author;
      });
      lines.push(`\\author{${authorLines.join('\\\\')}}`);
    }

    // Date
    lines.push(`\\date{${this._date || '\\today'}}`);
    lines.push('');

    lines.push('\\begin{document}');
    lines.push('');

    // Title page
    lines.push('\\maketitle');
    lines.push('');

    // Abstract
    if (this._abstract) {
      lines.push('\\begin{abstract}');
      lines.push(this._escapeLaTeX(this._abstract));
      if (this._keywords.length > 0) {
        lines.push('');
        lines.push(`\\par\\textbf{Keywords:} ${this._keywords.map(k => this._escapeLaTeX(k)).join(', ')}`);
      }
      lines.push('\\end{abstract}');
      lines.push('');
    }

    // Sections
    for (const section of this._sections) {
      if (section.type === SectionType.TITLE) continue;
      lines.push(...this._renderLaTeXSection(section));
      lines.push('');
    }

    // Statistical results
    if (this._statisticalResults.length > 0) {
      lines.push(...this._renderStatisticalResults());
    }

    // Figures
    for (const fig of this._figures) {
      lines.push('\\begin{figure}[htbp]');
      lines.push('\\centering');
      // The path is detokenized, not escaped: a LaTeX macro inside the file
      // name is expanded while the name is parsed, so the escaped form made
      // LaTeX look for a file called "C\textbackslash{}Users..." and fail.
      lines.push(`\\includegraphics[width=${fig.width || '0.8\\textwidth'}]{${detokenizePath(fig.path)}}`);
      lines.push(`\\caption{${this._escapeLaTeX(fig.caption)}}`);
      lines.push(`\\label{${fig.id}}`);
      lines.push('\\end{figure}');
      lines.push('');
    }

    // Tables
    for (const tbl of this._tables) {
      lines.push(`\\begin{table}[${tbl.placement || 'htbp'}]`);
      lines.push('\\centering');
      lines.push(tbl.content);
      lines.push(`\\caption{${this._escapeLaTeX(tbl.caption)}}`);
      lines.push(`\\label{${tbl.id}}`);
      lines.push('\\end{table}');
      lines.push('');
    }

    // References
    if (this._references.length > 0) {
      lines.push('\\newpage');
      lines.push('\\section{References}');
      lines.push('');
      for (const ref of this._references) {
        lines.push(this._escapeLaTeX(ref));
        lines.push('');
      }
    }

    lines.push('\\end{document}');
    return lines.join('\n');
  }

  private _renderLaTeXSection(section: Section): string[] {
    const lines: string[] = [];
    const cmd = { 1: '\\section', 2: '\\subsection', 3: '\\subsubsection' }[section.level] || '\\section';
    const label = section.label ? `\\label{${section.label}}` : '';
    lines.push(`${cmd}{${this._escapeLaTeX(section.title)}}${label}`);
    lines.push('');
    lines.push(this._escapeLaTeX(section.content));
    return lines;
  }

  private _renderStatisticalResults(): string[] {
    const lines: string[] = [];
    lines.push('\\section{Statistical Results}');
    lines.push('');
    lines.push('\\begin{table}[htbp]');
    lines.push('\\centering');
    // Six columns, not five: the 95% CI was dropped from the LaTeX output
    // while the Markdown output still carried it.
    lines.push('\\begin{tabular}{llllll}');
    lines.push('\\toprule');
    lines.push('Test & Statistic & df & p-value & Effect size & 95\\% CI \\\\');
    lines.push('\\midrule');

    for (const r of this._statisticalResults) {
      const testName = this._escapeLaTeX(r.testName);
      const stat = r.statistic.toFixed(4);
      const df = r.df !== undefined ? String(r.df) : '--';
      const pVal = r.pValue !== undefined ? this._formatPValue(r.pValue) : '--';
      const effect = r.effectSize !== undefined ? r.effectSize.toFixed(4) : '--';
      const ci = formatCI(r.ciLower, r.ciUpper);
      lines.push(`${testName} & ${stat} & ${df} & ${pVal} & ${effect} & ${ci} \\\\`);
    }

    lines.push('\\bottomrule');
    lines.push('\\end{tabular}');
    lines.push('\\caption{Summary of statistical tests}');
    lines.push('\\end{table}');
    lines.push('');
    return lines;
  }

  private _formatPValue(p: number): string {
    if (p < 0.001) return '$p < 0.001$';
    if (p < 0.01) return `$p = ${p.toFixed(3)}$`;
    return `$p = ${p.toFixed(4)}$`;
  }

  /**
   * HTML escaping.
   *
   * Delegates to the one shared implementation (LatexCompiler.escapeHtml),
   * which TableGenerator and FigureHandler use as well — three copies of an
   * escaper is how the LaTeX escaper ended up in the HTML table writer.
   */
  private _escapeHTML(s: string): string {
    return escapeHtml(s);
  }

  /**
   * LaTeX escaping.
   *
   * This used to be a single regex: `s.replace(/[\\$%&_{}#^~]/g, c => '\\' + c)`.
   * That is wrong for the three characters LaTeX treats as commands rather than
   * literals, and the damage is silent because the document still compiles:
   *   `\` -> `\\`  becomes a LINE BREAK, so a title containing a path is split
   *   `~` -> `\~`  becomes a non-breaking-space ACCENT over the next letter
   *   `^` -> `\^`  becomes a circumflex ACCENT over the next letter
   * Confirmed by compiling both variants with pdflatex and reading the PDF back
   * with pdftotext: the repository version rendered "tilde~here" as
   * "tildeh̃ere" and "caret^up" as "caretûp".
   *
   * The correct escapes are \textbackslash{}, \textasciitilde{} and
   * \textasciicircum{}. LatexCompiler.escapeLatex already did this properly, so
   * per docs/code-style.md 1.4 both call sites now share that one function
   * instead of keeping two copies that drifted apart.
   */
  private _escapeLaTeX(s: string): string {
    return escapeLatex(s);
  }

  // ─── Table helpers ────────────────────────────────────────────────────────────

  static tableFromMatrix(headers: string[], rows: number[][], digits: number = 3): string {
    // Column count check. The column spec is derived from the header count
    // while the cell count of every row comes from the row itself, so a
    // mismatch produced a .tex that pdflatex rejects with "Extra alignment
    // tab has been changed to \cr" (exit code 1, no PDF) — the user is told
    // nothing about their data, only that "the report failed to build".
    // A mismatch is now reported as an error with the numbers involved.
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length !== headers.length) {
        throw new Error(
          `Table column count mismatch: ${headers.length} header column(s) but row ${i + 1} has `
          + `${rows[i].length} cell(s). Every row must have exactly one cell per header column.`);
      }
    }
    const colSpec = 'l'.repeat(headers.length);
    const lines: string[] = [];
    lines.push(`\\begin{tabular}{${colSpec}}`);
    lines.push('\\toprule');
    // Header cells MUST be escaped. Column names come straight from the data
    // file, and an unescaped `_` puts LaTeX into math mode: a dataset with a
    // column called "Length_mm" produced `! Missing $ inserted` at
    // `\textbf{Length_mm}` and the document would not compile at all.
    lines.push(headers.map(h => `\\textbf{${escapeLatex(h)}}`).join(' & ') + ' \\\\');
    lines.push('\\midrule');
    for (const row of rows) {
      // A missing value is "NA" (the CSV convention of this app), not the
      // JavaScript artefact "NaN" that toFixed() produces — that string was
      // typeset verbatim in the paper table.
      lines.push(row.map(v => typeof v === 'number' ? MatrixConverter.formatCell(v, digits) : escapeLatex(String(v))).join(' & ') + ' \\\\');
    }
    lines.push('\\bottomrule');
    lines.push('\\end{tabular}');
    return lines.join('\n');
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────

  getSections(): Section[] { return [...this._sections]; }
  getFigures(): FigureReference[] { return [...this._figures]; }
  getTables(): TableReference[] { return [...this._tables]; }
  getStatisticalResults(): StatisticalResult[] { return [...this._statisticalResults]; }
  getAuthors(): Author[] { return [...this._authors]; }
  getAbstract(): string | undefined { return this._abstract; }
  getReferences(): string[] { return [...this._references]; }

  clear(): void {
    this._sections = [];
    this._title = '';
    this._authors = [];
    this._affiliations = [];
    this._date = '';
    this._abstract = undefined;
    this._keywords = [];
    this._figures = [];
    this._tables = [];
    this._statisticalResults = [];
    this._references = [];
    this._counterFigure = 0;
    this._counterTable = 0;
  }
}

// ─── Table environment normalisation ────────────────────────────────────────

/**
 * Turn a COMPLETE `\begin{table}…\end{table}` environment into the fragment
 * the report wrapper expects (the `tabular` plus its rules).
 *
 * `addTable` stores a fragment; both toLaTeX() and LatexCompiler.renderTable
 * wrap it in a table environment themselves. A caller that handed over
 * `TableGenerator.latex(...)` — which already emits a whole environment —
 * therefore produced a table inside a table, and pdflatex rejects that with
 * "LaTeX Error: Not in outer par mode." (exit code 1, no PDF at all).
 *
 * The inner `\caption{}` and `\label{}` are removed: the report supplies its
 * own caption and label, and keeping both would typeset two captions and
 * define two labels for one table.
 *
 * A fragment (no `\begin{table}`) is returned unchanged.
 */
export function unwrapTableEnvironment(content: string): string {
  if (!content) return content;
  const begin = /^\s*\\begin\{table\}(\[[^\]]*\])?/.exec(content);
  if (!begin) return content;
  const endIdx = content.lastIndexOf('\\end{table}');
  if (endIdx < 0) return content;   // not a complete environment: leave it alone
  let body = content.slice(begin[0].length, endIdx);
  body = removeLatexCommand(body, 'caption');
  body = removeLatexCommand(body, 'label');
  // The report wrapper emits its own \centering.
  body = body.replace(/^[ \t]*\\centering[ \t]*\r?\n?/gm, '');
  return body.trim();
}

/**
 * Remove every `\name{…}` from a LaTeX fragment and return what is left.
 *
 * The braces are matched by counting (not by a `[^}]*` regex), so a caption
 * whose text contains an escaped brace — `a \{b\}` — is removed as a whole
 * instead of being cut in half and leaving a stray `\}` behind.
 */
function removeLatexCommand(src: string, name: string): string {
  const marker = '\\' + name + '{';
  let out = src;
  let idx = out.indexOf(marker);
  while (idx >= 0) {
    const before = idx > 0 ? out[idx - 1] : '';
    if (/[A-Za-z]/.test(before)) {
      // A longer command name ending in `name` (e.g. \mycaption) — skip it.
      idx = out.indexOf(marker, idx + 1);
      continue;
    }
    let depth = 0;
    let i = idx + marker.length - 1;   // sits on the opening brace
    let closed = false;
    for (; i < out.length; i++) {
      const ch = out[i];
      if (ch === '\\') { i++; continue; }   // an escaped character is not a brace
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { i++; closed = true; break; }
      }
    }
    if (!closed) return out;   // unbalanced braces: leave the fragment alone
    out = out.slice(0, idx) + out.slice(i);
    idx = out.indexOf(marker);
  }
  return out;
}
