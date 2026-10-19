import { Matrix } from '../math/Matrix';
import { DataMatrix, StateManager } from '../models/index';
import { parseCSV, toCSV } from '../parsers/index';
import { isMissingValue, percentStandardize, zscoreStandardize } from '../utils/Transformations';
import { fs } from '@kit.CoreFileKit';

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

  /**
   * @param includeLabels write the column-header row and the row-label column.
   *        The export dialog's "Include labels" checkbox publishes this value
   *        and it was never read; `toCSV` grew the flag so the control does what
   *        it says. `false` round-trips through
   *        `parseCSV(text, delimiter, false, false)`.
   */
  exportCSV(delimiter = ',', includeLabels = true): string {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data to export');
    return toCSV(dm, delimiter, includeLabels);
  }

  /** Export and persist to a sandbox path (data_controller.py export flow). */
  exportCSVToFile(path: string, delimiter = ',', includeLabels = true): void {
    const text = this.exportCSV(delimiter, includeLabels);
    const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(file.fd, text);
    } finally {
      fs.closeSync(file.fd);
    }
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

  /**
   * Z-score of every column.
   *
   * This used to be `data.sub(data.meanAxis(0)).div(data.stdAxis(0))`, which
   * THROWS "Division by zero" on a constant column. The two other
   * z-score implementations in the repository
   * (`utils/Transformations.zscoreStandardize` and
   * `utils/MatrixOps.standardizeMatrix`) both guard the standard deviation
   * with `|| 1` and return 0 for a constant column, so the same table
   * produced an error here and a value there. This now delegates to the
   * shared implementation: one transform, one behaviour.
   */
  transformZScore(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    return zscoreStandardize(dm.data, 0);
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

  /**
   * Relative-abundance ("percent") standardization.
   *
   * AXIS SEMANTICS (identical to `utils/Transformations.percentStandardize`):
   *   axis 0 -> every COLUMN is scaled to sum to 1;
   *   axis 1 -> every ROW is scaled to sum to 1.
   *
   * The default is axis 1, i.e. the row-wise behaviour this method always
   * had (each specimen becomes a composition of 1). Note that
   * `percentStandardize` itself defaults to axis 0, so the two functions are
   * NOT interchangeable under their bare names — the axis has to be stated.
   * The implementation is now shared instead of duplicated.
   */
  transformPercent(axis: number = 1): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data');
    return percentStandardize(dm.data, axis);
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

  /**
   * Select a set of rows, in the order requested.
   *
   * The previous version sliced the CONTIGUOUS range [first, last+1], so a
   * request for e.g. [0, 2, 4] returned all five rows while rowLabels held only
   * three entries — a DataMatrix whose rows and labels disagree (and a crash
   * downstream). Indices are now validated, de-duplicated and copied one by one.
   */
  subsetRows(indices: number[]): DataMatrix {
    const dm = this.getDM();
    const valid = this.sanitize(dm.data.rows, indices);
    const d = new Float64Array(valid.length * dm.data.cols);
    for (let r = 0; r < valid.length; r++)
      for (let c = 0; c < dm.data.cols; c++)
        d[r * dm.data.cols + c] = dm.data.get(valid[r], c);
    const newRL = valid.map(i => dm.rowLabels[i]);
    return new DataMatrix(new Matrix(d, valid.length, dm.data.cols), newRL, [...dm.colLabels]);
  }

  subsetColumns(indices: number[]): DataMatrix {
    const dm = this.getDM();
    const valid = this.sanitize(dm.data.cols, indices);
    const d = new Float64Array(dm.data.rows * valid.length);
    for (let i = 0; i < dm.data.rows; i++)
      for (let j = 0; j < valid.length; j++)
        d[i * valid.length + j] = dm.data.get(i, valid[j]);
    const newCL = valid.map(j => dm.colLabels[j]);
    return new DataMatrix(new Matrix(d, dm.data.rows, valid.length), [...dm.rowLabels], newCL);
  }

  /** Keep in-range integer indices, de-duplicated, original order preserved. */
  private sanitize(dim: number, indices: number[]): number[] {
    const out: number[] = [];
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i >= dim) continue;
      if (out.includes(i)) continue;
      out.push(i);
    }
    return out;
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

  /**
   * Structural check of the loaded table.
   *
   * `valid` used to be `true` for a table that contained missing values, so
   * a caller that only looks at `valid` kept running analyses on a table
   * with holes in it and treated the result as valid. `valid` is now false
   * when anything is missing, and `hasMissing` says so explicitly.
   */
  validateData(): { valid: boolean; hasMissing: boolean; message: string; nRows: number; nCols: number; nNaN: number } {
    const dm = this.state.dataMatrix;
    if (!dm) return { valid: false, hasMissing: false, message: 'No data loaded', nRows: 0, nCols: 0, nNaN: 0 };
    let nNaN = 0;
    for (let i = 0; i < dm.data.length; i++) if (isMissingValue(dm.data.data[i])) nNaN++;
    return {
      valid: nNaN === 0,
      hasMissing: nNaN > 0,
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
