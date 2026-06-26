import { Matrix } from '../math/Matrix';
import { DataMatrix, StateManager } from '../data/index';
import { parseCSV, toCSV } from '../parsers/index';

/**
 * DataController — handles data loading, export, transformation.
 * Replaces Python controllers/data_controller.py.
 */
export class DataController {
  private state: StateManager = StateManager.getInstance();

  loadCSV(text: string, delimiter = ',', hasHeader = true, hasRowLabels = true): DataMatrix {
    const dm = parseCSV(text, delimiter, hasHeader, hasRowLabels);
    this.state.setData(dm);
    return dm;
  }

  exportCSV(delimiter = ','): string {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data to export');
    return toCSV(dm, delimiter);
  }

  transpose(): DataMatrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    const t = dm.transpose();
    this.state.setData(t);
    return t;
  }

  transformLog(offset = 1.0): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    const d = new Float64Array(dm.data.length);
    for (let i = 0; i < dm.data.length; i++) {
      const v = dm.data.data[i] + offset;
      d[i] = v > 0 ? Math.log10(v) : NaN;
    }
    return new Matrix(d, dm.data.rows, dm.data.cols);
  }

  transformSqrt(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    for (let i = 0; i < dm.data.length; i++) {
      if (dm.data.data[i] < 0) throw new Error('sqrt requires non-negative data');
    }
    return dm.data.sqrt();
  }

  transformZScore(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    return dm.data.sub(dm.data.meanAxis(0)).div(dm.data.stdAxis(0));
  }

  transformHellinger(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    const rowSums = dm.data.sumAxis(1);
    const d = new Float64Array(dm.data.length);
    for (let i = 0; i < dm.data.rows; i++) {
      const rs = rowSums.get(i, 0) || 1;
      for (let j = 0; j < dm.data.cols; j++) d[i * dm.data.cols + j] = Math.sqrt(Math.max(0, dm.data.get(i, j)) / rs);
    }
    return new Matrix(d, dm.data.rows, dm.data.cols);
  }

  transformPercent(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    const rowSums = dm.data.sumAxis(1);
    const d = new Float64Array(dm.data.length);
    for (let i = 0; i < dm.data.rows; i++) {
      const rs = rowSums.get(i, 0) || 1;
      for (let j = 0; j < dm.data.cols; j++) d[i * dm.data.cols + j] = dm.data.get(i, j) / rs;
    }
    return new Matrix(d, dm.data.rows, dm.data.cols);
  }

  transformWisconsin(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    // Step 1: column max normalization
    const colMaxData = new Float64Array(dm.data.cols);
    for (let j = 0; j < dm.data.cols; j++) {
      let mx = -Infinity;
      for (let i = 0; i < dm.data.rows; i++) mx = Math.max(mx, dm.data.get(i, j));
      colMaxData[j] = mx || 1;
    }
    const step1 = new Float64Array(dm.data.length);
    for (let i = 0; i < dm.data.rows; i++)
      for (let j = 0; j < dm.data.cols; j++) step1[i * dm.data.cols + j] = dm.data.get(i, j) / colMaxData[j];
    // Step 2: row total normalization
    const d = new Float64Array(dm.data.length);
    for (let i = 0; i < dm.data.rows; i++) {
      let rs = 0;
      for (let j = 0; j < dm.data.cols; j++) rs += step1[i * dm.data.cols + j];
      if (rs === 0) rs = 1;
      for (let j = 0; j < dm.data.cols; j++) d[i * dm.data.cols + j] = step1[i * dm.data.cols + j] / rs;
    }
    return new Matrix(d, dm.data.rows, dm.data.cols);
  }

  // ─── Subset Operations ─────────────────────────────────────────

  subsetRows(indices: number[]): DataMatrix {
    const dm = this.getDM();
    const newData = dm.data.sliceRows(indices[0], indices[indices.length - 1] + 1);
    const newRL = indices.map(i => dm.rowLabels[i]);
    return new DataMatrix(newData, newRL, [...dm.colLabels]);
  }

  subsetColumns(indices: number[]): DataMatrix {
    const dm = this.getDM();
    const d = new Float64Array(dm.data.rows * indices.length);
    for (let i = 0; i < dm.data.rows; i++)
      for (let j = 0; j < indices.length; j++)
        d[i * indices.length + j] = dm.data.get(i, indices[j]);
    const newCL = indices.map(j => dm.colLabels[j]);
    return new DataMatrix(new Matrix(d, dm.data.rows, indices.length), [...dm.rowLabels], newCL);
  }

  // ─── Apply Transform to State ──────────────────────────────────

  applyTransformToState(transformFn: (data: Matrix) => Matrix): void {
    const dm = this.getDM();
    const transformed = transformFn(dm.data);
    const newDM = new DataMatrix(transformed, [...dm.rowLabels], [...dm.colLabels]);
    this.state.setData(newDM);
    this.state.markModified();
  }

  // ─── Validation ────────────────────────────────────────────────

  validateData(): { valid: boolean; message: string; nRows: number; nCols: number; nNaN: number } {
    const dm = this.state.dataMatrix;
    if (!dm) return { valid: false, message: 'No data loaded', nRows: 0, nCols: 0, nNaN: 0 };
    let nNaN = 0;
    for (let i = 0; i < dm.data.length; i++) if (isNaN(dm.data.data[i])) nNaN++;
    return {
      valid: true,
      message: nNaN > 0 ? `${nNaN} missing values detected` : 'Data OK',
      nRows: dm.nSamples,
      nCols: dm.nVariables,
      nNaN,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────

  hasData(): boolean { return this.state.hasData; }

  private getDM(): DataMatrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data loaded');
    return dm;
  }
}
