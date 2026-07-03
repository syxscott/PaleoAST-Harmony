/**
 * Matrix converter (Matrix ↔ CSV / TSV / LaTeX / Markdown) — replaces reporting/matrix_converter.py.
 */
import { Matrix } from '../math/Matrix';

export type MatrixFormat = 'csv' | 'tsv' | 'latex' | 'markdown' | 'json';

export class MatrixConverter {
  static toCSV(M: Matrix, delimiter: string = ',', precision: number = 6): string {
    const sep = delimiter;
    const out: string[] = [];
    for (let i = 0; i < M.rows; i++) {
      const row: string[] = [];
      for (let j = 0; j < M.cols; j++) row.push(M.get(i, j).toFixed(precision));
      out.push(row.join(sep));
    }
    return out.join('\n');
  }

  static toLaTeX(M: Matrix, precision: number = 4): string {
    const lines: string[] = [`\\begin{pmatrix}`];
    for (let i = 0; i < M.rows; i++) {
      const cells: string[] = [];
      for (let j = 0; j < M.cols; j++) cells.push(M.get(i, j).toFixed(precision));
      lines.push(cells.join(' & ') + (i < M.rows - 1 ? ' \\\\' : ''));
    }
    lines.push('\\end{pmatrix}');
    return lines.join('\n');
  }

  static toMarkdown(M: Matrix): string {
    const lines: string[] = [];
    const header = Array.from({ length: M.cols }, (_, j) => `C${j + 1}`).join(' | ');
    lines.push(`|   | ${header} |`);
    lines.push(`|---|${Array(M.cols).fill('---').join('|')}|`);
    for (let i = 0; i < M.rows; i++) {
      const cells: string[] = [];
      for (let j = 0; j < M.cols; j++) cells.push(M.get(i, j).toString());
      lines.push(`| R${i + 1} | ${cells.join(' | ')} |`);
    }
    return lines.join('\n');
  }

  static toJSON(M: Matrix): string {
    return JSON.stringify({ rows: M.rows, cols: M.cols, data: M.toArray() });
  }

  static fromCSV(text: string, delimiter: string = ','): Matrix {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const rows = lines.length;
    const cols = lines[0].split(delimiter).length;
    const data = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) {
      const cells = lines[i].split(delimiter);
      for (let j = 0; j < Math.min(cells.length, cols); j++) data[i * cols + j] = Number(cells[j]);
    }
    return new Matrix(data, rows, cols);
  }

  static fromJSON(text: string): Matrix {
    const obj = JSON.parse(text);
    return new Matrix(new Float64Array(obj.data), obj.rows, obj.cols);
  }
}
