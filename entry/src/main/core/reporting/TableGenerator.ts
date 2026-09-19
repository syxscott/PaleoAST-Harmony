/**
 * Table generator for academic tables — replaces reporting/table_generator.py.
 */
import { Matrix } from '../math/Matrix';

export interface TableStyle {
  colSpec?: string;          // e.g. 'lcr' or 'llll'
  digits?: number;
  decimalMark?: string;      // default '.'
  siunit?: boolean;
  caption?: string;
  label?: string;
}

export class TableGenerator {
  /**
   * Build a LaTeX table from a numeric Matrix and headers.
   *
   * The header row carries a leading empty cell for the row-label column, so
   * every data row must carry one too (markdown()/html() both emit `R{i}`).
   * Emitting bare data cells made the body one column short of the header and
   * of the declared `colSpec`, which LaTeX renders as a misaligned table.
   */
  static latex(matrix: Matrix, headers: string[], style: TableStyle = {}): string {
    const digits = style.digits ?? 3;
    const spec = (style.colSpec ?? 'l'.repeat(headers.length + 1));
    const head = headers.map(this._escape).join(' & ');
    const rows: string[] = [];
    for (let i = 0; i < matrix.rows; i++) {
      const cells: string[] = [];
      for (let j = 0; j < matrix.cols; j++) {
        const v = matrix.get(i, j);
        cells.push(v.toFixed(digits));
      }
      rows.push(`R${i + 1} & ${cells.join(' & ')} \\\\`);
    }
    return [
      `\\begin{table}[htbp]\\centering`,
      style.label ? `\\label{${style.label}}` : '',
      `\\begin{tabular}{${spec}}`,
      `\\toprule`,
      `& ${head} \\\\`,
      `\\midrule`,
      ...rows,
      `\\bottomrule`,
      `\\end{tabular}`,
      style.caption ? `\\caption{${this._escape(style.caption)}}` : '',
      `\\end{table}`
    ].filter(Boolean).join('\n');
  }

  /** Build a Markdown pipe table. */
  static markdown(matrix: Matrix, headers: string[]): string {
    const sep = headers.map(() => '---');
    const lines: string[] = [`|   | ${headers.join(' | ')} |`, `|---|${sep.join('|')}|`];
    for (let i = 0; i < matrix.rows; i++) {
      const cells: string[] = [];
      for (let j = 0; j < matrix.cols; j++) cells.push(matrix.get(i, j).toString());
      lines.push(`| R${i + 1} | ${cells.join(' | ')} |`);
    }
    return lines.join('\n');
  }

  /** HTML table. */
  static html(matrix: Matrix, headers: string[]): string {
    const thead = `<thead><tr><th></th>${headers.map(h => `<th>${this._escape(h)}</th>`).join('')}</tr></thead>`;
    const rows: string[] = [];
    for (let i = 0; i < matrix.rows; i++) {
      const cells: string[] = [];
      for (let j = 0; j < matrix.cols; j++) cells.push(`<td>${matrix.get(i, j)}</td>`);
      rows.push(`<tr><th>R${i + 1}</th>${cells.join('')}</tr>`);
    }
    return `<table>${thead}<tbody>${rows.join('')}</tbody></table>`;
  }

  /**
   * Escape a string for LaTeX text mode.
   *
   * Backslash, tilde and caret need explicit macros: a bare `\\` is a line
   * break and `\~` / `\^` are accents, so blindly prefixing a backslash (the
   * previous behaviour) produced wrong output for all three.
   */
  private static _escape(s: string): string {
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
}
