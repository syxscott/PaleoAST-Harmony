/**
 * Table generator for academic tables — replaces reporting/table_generator.py.
 */
import { Matrix } from '../math/Matrix';
import { escapeHtml } from './LatexCompiler';
import { MatrixConverter } from './MatrixConverter';

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
   * The result is a COMPLETE `\begin{table}…\end{table}` environment. Use
   * latexFragment() when the table goes into `ReportBuilder.addTable()`,
   * which expects the `tabular` only — it wraps the fragment itself. (A
   * complete environment handed to addTable() is unwrapped there, but the
   * fragment is the intended contract.)
   */
  static latex(matrix: Matrix, headers: string[], style: TableStyle = {}): string {
    return [
      '\\begin{table}[htbp]\\centering',
      style.label ? `\\label{${style.label}}` : '',
      TableGenerator.latexFragment(matrix, headers, style),
      style.caption ? `\\caption{${TableGenerator._escape(style.caption)}}` : '',
      '\\end{table}'
    ].filter(Boolean).join('\n');
  }

  /**
   * Build the `tabular` FRAGMENT of a table (no float environment).
   *
   * The header row carries a leading empty cell for the row-label column, so
   * every data row must carry one too (markdown()/html() both emit `R{i}`).
   * Emitting bare data cells made the body one column short of the header and
   * of the declared `colSpec`, which LaTeX renders as a misaligned table.
   *
   * The number of header columns and the width of the matrix must agree: the
   * column spec comes from the headers while the cell count of every row
   * comes from the matrix, and LaTeX rejects the mismatch with "Extra
   * alignment tab has been changed to \cr" (exit code 1, no PDF). The check
   * is done here, where the numbers are known, so the error can name them.
   */
  static latexFragment(matrix: Matrix, headers: string[], style: TableStyle = {}): string {
    if (matrix.cols !== headers.length) {
      throw new Error(
        `Table column count mismatch: ${headers.length} header column(s) but the matrix has `
        + `${matrix.cols} column(s). Every row must have exactly one cell per header column.`);
    }
    const digits = style.digits ?? 3;
    const spec = (style.colSpec ?? 'l'.repeat(headers.length + 1));
    const head = headers.map(h => TableGenerator._escape(h)).join(' & ');
    const rows: string[] = [];
    for (let i = 0; i < matrix.rows; i++) {
      const cells: string[] = [];
      for (let j = 0; j < matrix.cols; j++) {
        cells.push(MatrixConverter.formatCell(matrix.get(i, j), digits));
      }
      rows.push(`R${i + 1} & ${cells.join(' & ')} \\\\`);
    }
    return [
      `\\begin{tabular}{${spec}}`,
      `\\toprule`,
      `& ${head} \\\\`,
      `\\midrule`,
      ...rows,
      `\\bottomrule`,
      `\\end{tabular}`,
    ].join('\n');
  }

  /** Build a Markdown pipe table. */
  static markdown(matrix: Matrix, headers: string[]): string {
    const sep = headers.map(() => '---');
    const lines: string[] = [`|   | ${headers.join(' | ')} |`, `|---|${sep.join('|')}|`];
    for (let i = 0; i < matrix.rows; i++) {
      const cells: string[] = [];
      // A missing value is "NA", not the JavaScript artefact "NaN".
      for (let j = 0; j < matrix.cols; j++) cells.push(MatrixConverter.formatCell(matrix.get(i, j)));
      lines.push(`| R${i + 1} | ${cells.join(' | ')} |`);
    }
    return lines.join('\n');
  }

  /**
   * HTML table.
   *
   * The header cells used to be escaped with the LATEX escaper, which leaves
   * `<` and `>` alone (they are not LaTeX specials) and turns `&` into `\&`
   * (not an HTML entity). A column named `<script>alert(1)</script>` was
   * therefore emitted as a LIVE tag, and `a & b` as `a \& b`. Column names
   * come straight from the user's data file, so this is a real injection
   * surface as soon as the table is opened in a browser — the HTML escaper
   * is used instead.
   */
  static html(matrix: Matrix, headers: string[]): string {
    const thead = `<thead><tr><th></th>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
    const rows: string[] = [];
    for (let i = 0; i < matrix.rows; i++) {
      const cells: string[] = [];
      for (let j = 0; j < matrix.cols; j++) {
        cells.push(`<td>${escapeHtml(MatrixConverter.formatCell(matrix.get(i, j)))}</td>`);
      }
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
