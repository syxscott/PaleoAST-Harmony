/**
 * Report builder — replaces reporting/report_builder.py
 * Generates reports in Markdown/LaTeX/HTML formats.
 */
import { LATEX_PREAMBLE } from './latexPreamble';

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

  addTable(tableContent: string, caption: string, label?: string, placement: string = 'htbp'): string {
    this._counterTable++;
    const id = label || `tab:${this._counterTable}`;
    this._tables.push({ id, caption, content: tableContent, placement });
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
      lines.push(`\\includegraphics[width=${fig.width || '0.8\\textwidth'}]{${this._escapeLaTeX(fig.path)}}`);
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
    lines.push('\\begin{tabular}{lllll}');
    lines.push('\\toprule');
    lines.push('Test & Statistic & df & p-value & Effect size \\\\');
    lines.push('\\midrule');

    for (const r of this._statisticalResults) {
      const testName = this._escapeLaTeX(r.testName);
      const stat = r.statistic.toFixed(4);
      const df = r.df !== undefined ? String(r.df) : '--';
      const pVal = r.pValue !== undefined ? this._formatPValue(r.pValue) : '--';
      const effect = r.effectSize !== undefined ? r.effectSize.toFixed(4) : '--';
      lines.push(`${testName} & ${stat} & ${df} & ${pVal} & ${effect} \\\\`);
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

  private _escapeHTML(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private _escapeLaTeX(s: string): string {
    return s.replace(/[\\$%&_{}#^~]/g, c => `\\${c}`);
  }

  // ─── Table helpers ────────────────────────────────────────────────────────────

  static tableFromMatrix(headers: string[], rows: number[][], digits: number = 3): string {
    const colSpec = 'l'.repeat(headers.length);
    const lines: string[] = [];
    lines.push(`\\begin{tabular}{${colSpec}}`);
    lines.push('\\toprule');
    lines.push(headers.map(h => `\\textbf{${h}}`).join(' & ') + ' \\\\');
    lines.push('\\midrule');
    for (const row of rows) {
      lines.push(row.map(v => typeof v === 'number' ? v.toFixed(digits) : String(v)).join(' & ') + ' \\\\');
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
