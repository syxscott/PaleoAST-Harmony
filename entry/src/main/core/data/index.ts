import { Matrix } from '../math/Matrix';

/**
 * DataMatrix — replaces Python models/data_matrix.py
 * Holds the core data with row/column labels and metadata.
 */
export class DataMatrix {
  data: Matrix;
  rowLabels: string[];
  colLabels: string[];
  rowMeta: Map<number, Record<string, string>>;
  colMeta: Map<number, Record<string, string>>;

  constructor(
    data: Matrix,
    rowLabels: string[] = [],
    colLabels: string[] = [],
  ) {
    this.data = data;
    this.rowLabels = rowLabels.length === data.rows
      ? rowLabels
      : Array.from({ length: data.rows }, (_, i) => `Sample_${i + 1}`);
    this.colLabels = colLabels.length === data.cols
      ? colLabels
      : Array.from({ length: data.cols }, (_, i) => `Var_${i + 1}`);
    this.rowMeta = new Map();
    this.colMeta = new Map();
  }

  get nSamples(): number { return this.data.rows; }
  get nVariables(): number { return this.data.cols; }

  getRow(i: number): number[] { return this.data.row(i); }
  getCol(j: number): number[] { return this.data.col(j); }

  getGroups(): number[] | null {
    const groups: number[] = [];
    let hasGroups = false;
    for (let i = 0; i < this.nSamples; i++) {
      const meta = this.rowMeta.get(i);
      const g = meta?.['group'];
      if (g !== undefined && g !== '') {
        groups.push(parseInt(g) || 0);
        hasGroups = true;
      } else {
        groups.push(0);
      }
    }
    return hasGroups ? groups : null;
  }

  subset(rows: number[], cols?: number[]): DataMatrix {
    const rLen = rows.length;
    const cIdx = cols ?? Array.from({ length: this.data.cols }, (_, i) => i);
    const cLen = cIdx.length;
    const d = new Float64Array(rLen * cLen);
    for (let i = 0; i < rLen; i++) {
      for (let j = 0; j < cLen; j++) {
        d[i * cLen + j] = this.data.get(rows[i], cIdx[j]);
      }
    }
    const newRL = rows.map(i => this.rowLabels[i]);
    const newCL = cIdx.map(j => this.colLabels[j]);
    return new DataMatrix(new Matrix(d, rLen, cLen), newRL, newCL);
  }

  transpose(): DataMatrix {
    return new DataMatrix(this.data.transpose(), [...this.colLabels], [...this.rowLabels]);
  }
}

/**
 * Result cache for storing analysis outputs.
 */
export class StateManager {
  private static _instance: StateManager | null = null;
  private _data: DataMatrix | null = null;
  private _cache: Map<string, unknown> = new Map();
  private _modified: boolean = false;

  static getInstance(): StateManager {
    if (!StateManager._instance) StateManager._instance = new StateManager();
    return StateManager._instance;
  }

  get hasData(): boolean { return this._data !== null; }
  get dataMatrix(): DataMatrix | null { return this._data; }
  get isModified(): boolean { return this._modified; }

  setData(dm: DataMatrix): void {
    this._data = dm;
    this._modified = false;
  }

  clearData(): void {
    this._data = null;
    this._cache.clear();
    this._modified = false;
  }

  markModified(): void { this._modified = true; }

  cacheResult(key: string, result: unknown): void { this._cache.set(key, result); }
  getCachedResult<T>(key: string): T | null { return (this._cache.get(key) as T) ?? null; }
}
