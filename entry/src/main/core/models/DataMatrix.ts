import { Matrix } from "../math/Matrix";

/**
 * DataMatrix — replaces models/data_matrix.py (907 lines).
 * Core data container with row/column labels and metadata.
 */
export class DataMatrix {
  readonly data: Matrix;
  readonly rowLabels: string[];
  readonly colLabels: string[];
  readonly nSamples: number;
  readonly nVariables: number;

  constructor(
    data: Matrix,
    rowLabels: string[] = [],
    colLabels: string[] = [],
  ) {
    this.data = data;
    this.nSamples = data.rows;
    this.nVariables = data.cols;
    this.rowLabels = rowLabels.length === data.rows
      ? rowLabels
      : Array.from({ length: data.rows }, (_, i) => "Sample_" + (i + 1));
    this.colLabels = colLabels.length === data.cols
      ? colLabels
      : Array.from({ length: data.cols }, (_, i) => "Var_" + (i + 1));
  }

  getRow(i: number): number[] { return this.data.row(i); }
  getCol(j: number): number[] { return this.data.col(j); }

  transpose(): DataMatrix {
    return new DataMatrix(this.data.transpose(), [...this.colLabels], [...this.rowLabels]);
  }

  subset(rows: number[], cols?: number[]): DataMatrix {
    const cIdx = cols ?? Array.from({ length: this.data.cols }, (_, i) => i);
    const d = new Float64Array(rows.length * cIdx.length);
    for (let i = 0; i < rows.length; i++)
      for (let j = 0; j < cIdx.length; j++)
        d[i * cIdx.length + j] = this.data.get(rows[i], cIdx[j]);
    return new DataMatrix(
      new Matrix(d, rows.length, cIdx.length),
      rows.map(i => this.rowLabels[i]),
      cIdx.map(j => this.colLabels[j]),
    );
  }

  getColumnIndex(name: string): number {
    return this.colLabels.indexOf(name);
  }

  getRowIndex(name: string): number {
    return this.rowLabels.indexOf(name);
  }

  getColumn(name: string): number[] | null {
    const idx = this.getColumnIndex(name);
    return idx >= 0 ? this.data.col(idx) : null;
  }

  getRowByName(name: string): number[] | null {
    const idx = this.getRowIndex(name);
    return idx >= 0 ? this.data.row(idx) : null;
  }

  summary(): string {
    return "DataMatrix(" + this.nSamples + " x " + this.nVariables + ")
" +
      "Row labels: [" + this.rowLabels.slice(0, 3).join(", ") + (this.nSamples > 3 ? ", ..." : "") + "]
" +
      "Col labels: [" + this.colLabels.slice(0, 3).join(", ") + (this.nVariables > 3 ? ", ..." : "") + "]";
  }
}
