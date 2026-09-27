/**
 * Matrix converter (Matrix ↔ CSV / TSV / LaTeX / Markdown) — replaces reporting/matrix_converter.py.
 */
import { Matrix } from '../math/Matrix';

export type MatrixFormat = 'csv' | 'tsv' | 'latex' | 'markdown' | 'json';

/** Token used to carry a non-finite cell through JSON without losing it. */
const NA = 'NaN';
const POS_INF = 'Infinity';
const NEG_INF = '-Infinity';

/**
 * JSON cannot represent NaN or ±Infinity: `JSON.stringify` writes them as
 * `null`, and `new Float64Array([null])` then yields 0. So a matrix carrying
 * missing values used to round-trip through toJSON/fromJSON with every NaN and
 * Infinity rewritten as a hard zero — turning "not measured" into "measured
 * zero", which then propagates into any mean, regression or ordination built on
 * the result. Non-finite cells are therefore encoded as explicit tokens and
 * decoded back.
 */
function encodeCell(v: number): number | string {
  if (Number.isNaN(v)) return NA;
  if (v === Infinity) return POS_INF;
  if (v === -Infinity) return NEG_INF;
  return v;
}

function decodeCell(v: unknown): number {
  if (v === NA) return NaN;
  if (v === POS_INF) return Infinity;
  if (v === NEG_INF) return -Infinity;
  return Number(v);
}

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
    const data: (number | string)[] = [];
    for (let i = 0; i < M.rows; i++) {
      for (let j = 0; j < M.cols; j++) data.push(encodeCell(M.get(i, j)));
    }
    return JSON.stringify({ rows: M.rows, cols: M.cols, data });
  }

  /**
   * Parse delimited text into a matrix.
   *
   * The column count used to be taken from the FIRST line only. Longer lines
   * were silently truncated (data loss) while shorter ones were padded with 0,
   * which fabricates measurements where none existed — so `"1,2,3 / 4,5 / 6,7,8,9"`
   * came back as `[[1,2,3],[4,5,0],[6,7,8]]`, dropping the 9 and inventing a 0.
   * The width is now the widest row, and missing cells stay NaN.
   */
  static fromCSV(text: string, delimiter: string = ','): Matrix {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return new Matrix(new Float64Array(0), 0, 0);
    const split = lines.map(l => l.split(delimiter));
    const rows = split.length;
    const cols = split.reduce((m, r) => Math.max(m, r.length), 0);
    // Fill with NaN, not 0: a Float64Array starts zero-filled, so short rows
    // would otherwise acquire invented measurements. A cell the file did not
    // provide must read back as missing.
    const data = new Float64Array(rows * cols).fill(NaN);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < split[i].length; j++) data[i * cols + j] = decodeCell(split[i][j]);
    }
    return new Matrix(data, rows, cols);
  }

  static fromJSON(text: string): Matrix {
    const obj = JSON.parse(text);
    const data = new Float64Array(obj.data.length);
    for (let i = 0; i < obj.data.length; i++) data[i] = decodeCell(obj.data[i]);
    return new Matrix(data, obj.rows, obj.cols);
  }
}
