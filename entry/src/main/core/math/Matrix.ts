/**
 * PaleoAST-Harmony Matrix Library
 * Replaces NumPy ndarray. Row-major Float64Array storage.
 *
 * Note: Matrix.randn() uses the seeded PRNG from random.ts.
 * Call random.seed(n) before generating random matrices for reproducible results.
 */
import { randn as _randn } from './random';

export class Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;

  constructor(data: Float64Array, rows: number, cols: number) {
    if (data.length !== rows * cols) throw new Error(`Matrix: ${data.length} != ${rows}x${cols}`);
    this.data = data; this.rows = rows; this.cols = cols;
  }

  static zeros(r: number, c: number): Matrix { return new Matrix(new Float64Array(r * c), r, c); }
  static ones(r: number, c: number): Matrix { const d = new Float64Array(r * c); d.fill(1); return new Matrix(d, r, c); }
  static eye(n: number): Matrix { const m = Matrix.zeros(n, n); for (let i = 0; i < n; i++) m.data[i * n + i] = 1; return m; }
  static from2D(arr: number[][]): Matrix {
    const r = arr.length;
    if (r === 0) return new Matrix(new Float64Array(0), 0, 0);
    const c = arr[0]?.length ?? 0;
    // Validate all rows have consistent length
    for (let i = 1; i < r; i++) {
      if (arr[i].length !== c) throw new Error(`from2D: row ${i} has ${arr[i].length} cols, expected ${c}`);
    }
    const d = new Float64Array(r * c);
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) d[i * c + j] = arr[i][j];
    return new Matrix(d, r, c);
  }
  static from1D(arr: number[], r: number, c: number): Matrix { return new Matrix(new Float64Array(arr), r, c); }
  static diag(v: number[]): Matrix {
    const n = v.length, m = Matrix.zeros(n, n);
    for (let i = 0; i < n; i++) m.data[i * n + i] = v[i]; return m;
  }
  /** Matrix of standard normal random numbers using seeded RNG (random.ts). */
  static randn(r: number, c: number): Matrix {
    const d = new Float64Array(r * c);
    for (let i = 0; i < d.length; i += 2) {
      const v0 = _randn();
      d[i] = v0;
      if (i + 1 < d.length) d[i + 1] = _randn();
    }
    return new Matrix(d, r, c);
  }

  get(i: number, j: number): number { return this.data[i * this.cols + j]; }
  set(i: number, j: number, v: number): void { this.data[i * this.cols + j] = v; }
  row(i: number): number[] { const s = i * this.cols; return Array.from(this.data.subarray(s, s + this.cols)); }
  col(j: number): number[] {
    const r: number[] = [];
    for (let i = 0; i < this.rows; i++) r.push(this.data[i * this.cols + j]);
    return r;
  }
  to2D(): number[][] {
    const r: number[][] = [];
    for (let i = 0; i < this.rows; i++) r.push(this.row(i));
    return r;
  }
  toArray(): number[] { return Array.from(this.data); }
  clone(): Matrix { return new Matrix(new Float64Array(this.data), this.rows, this.cols); }

  get shape(): [number, number] { return [this.rows, this.cols]; }
  get length(): number { return this.rows * this.cols; }
  reshape(r: number, c: number): Matrix {
    if (r * c !== this.length) throw new Error('reshape');
    return new Matrix(new Float64Array(this.data), r, c);
  }
  transpose(): Matrix {
    const d = new Float64Array(this.length);
    for (let i = 0; i < this.rows; i++)
      for (let j = 0; j < this.cols; j++) d[j * this.rows + i] = this.data[i * this.cols + j];
    return new Matrix(d, this.cols, this.rows);
  }

  sliceRows(s: number, e: number): Matrix {
    if (s < 0 || e > this.rows || s > e) throw new Error(`sliceRows: invalid range [${s}, ${e}) for ${this.rows} rows`);
    const n = e - s, d = new Float64Array(n * this.cols);
    d.set(this.data.subarray(s * this.cols, e * this.cols));
    return new Matrix(d, n, this.cols);
  }
  sliceCols(s: number, e: number): Matrix {
    const nc = e - s, d = new Float64Array(this.rows * nc);
    for (let i = 0; i < this.rows; i++)
      for (let j = s; j < e; j++) d[i * nc + (j - s)] = this.data[i * this.cols + j];
    return new Matrix(d, this.rows, nc);
  }

  add(o: Matrix | number): Matrix {
    const d = new Float64Array(this.data);
    if (typeof o === 'number') { for (let i = 0; i < d.length; i++) d[i] += o; }
    else { for (let i = 0; i < d.length; i++) d[i] += o.data[i]; }
    return new Matrix(d, this.rows, this.cols);
  }
  sub(o: Matrix | number): Matrix {
    const d = new Float64Array(this.data);
    if (typeof o === 'number') { for (let i = 0; i < d.length; i++) d[i] -= o; }
    else { for (let i = 0; i < d.length; i++) d[i] -= o.data[i]; }
    return new Matrix(d, this.rows, this.cols);
  }
  mul(o: Matrix | number): Matrix {
    const d = new Float64Array(this.data);
    if (typeof o === 'number') { for (let i = 0; i < d.length; i++) d[i] *= o; }
    else { for (let i = 0; i < d.length; i++) d[i] *= o.data[i]; }
    return new Matrix(d, this.rows, this.cols);
  }
  div(o: Matrix | number): Matrix {
    const d = new Float64Array(this.data);
    if (typeof o === 'number') {
      if (o === 0) throw new Error('Division by zero');
      for (let i = 0; i < d.length; i++) d[i] /= o;
    } else {
      for (let i = 0; i < d.length; i++) {
        if (o.data[i] === 0) throw new Error('Division by zero');
        d[i] /= o.data[i];
      }
    }
    return new Matrix(d, this.rows, this.cols);
  }
  /**
   * Matrix multiplication with cache-optimized loop ordering.
   *
   * For small matrices (< 64x64): blocked algorithm (block size 32)
   * For large matrices: i-k-j ordering (SIMD-friendly, stride-1 access)
   *
   * i-k-j ordering ensures contiguous access to A[i,*] and B[*,j].
   */
  matmul(o: Matrix): Matrix {
    if (this.cols !== o.rows) throw new Error('matmul shape');
    const m = this.rows, n = o.cols, k = this.cols;
    const d = new Float64Array(m * n);

    const BLOCK = 32;
    if (m < 64 && n < 64 && k < 64) {
      // Blocked algorithm for small matrices — improves cache locality
      for (let i0 = 0; i0 < m; i0 += BLOCK) {
        for (let j0 = 0; j0 < n; j0 += BLOCK) {
          for (let k0 = 0; k0 < k; k0 += BLOCK) {
            const iMax = Math.min(m, i0 + BLOCK);
            const jMax = Math.min(n, j0 + BLOCK);
            const kMax = Math.min(k, k0 + BLOCK);
            for (let i = i0; i < iMax; i++) {
              const baseI = i * k;
              for (let kk = k0; kk < kMax; kk++) {
                const aik = this.data[baseI + kk];
                const baseD = i * n;
                for (let j = j0; j < jMax; j++) {
                  d[baseD + j] += aik * o.data[kk * n + j];
                }
              }
            }
          }
        }
      }
    } else {
      // i-k-j ordering: stride-1 on A[i,*] and B[*,j]
      // Ready for SIMD vectorization when available
      for (let i = 0; i < m; i++) {
        const baseI = i * n;
        for (let kk = 0; kk < k; kk++) {
          const aik = this.data[i * k + kk];
          const baseK = kk * n;
          for (let j = 0; j < n; j++) {
            d[baseI + j] += aik * o.data[baseK + j];
          }
        }
      }
    }
    return new Matrix(d, m, n);
  }
  negate(): Matrix {
    const d = new Float64Array(this.length);
    for (let i = 0; i < this.length; i++) d[i] = -this.data[i];
    return new Matrix(d, this.rows, this.cols);
  }

  map(fn: (v: number) => number): Matrix {
    const d = new Float64Array(this.length);
    for (let i = 0; i < this.length; i++) d[i] = fn(this.data[i]);
    return new Matrix(d, this.rows, this.cols);
  }
  sqrt(): Matrix { return this.map(Math.sqrt); }
  log(): Matrix { return this.map(Math.log); }
  log10(): Matrix { return this.map(x => Math.log(x) / Math.LN10); }
  exp(): Matrix { return this.map(Math.exp); }
  abs(): Matrix { return this.map(Math.abs); }
  pow(e: number): Matrix { return this.map(x => Math.pow(x, e)); }
  clip(lo: number, hi: number): Matrix { return this.map(x => Math.max(lo, Math.min(hi, x))); }
  maximum(o: Matrix | number): Matrix {
    if (typeof o === 'number') return this.map(x => Math.max(x, o));
    const d = new Float64Array(this.length);
    for (let i = 0; i < this.length; i++) d[i] = Math.max(this.data[i], o.data[i]);
    return new Matrix(d, this.rows, this.cols);
  }

  /**
   * Sum using Kahan compensated summation.
   * Compensates for catastrophic cancellation in arrays with >10^6 elements.
   */
  sum(): number {
    let s = 0, c = 0; // c = compensation
    for (let i = 0; i < this.length; i++) {
      const vi = this.data[i];
      const y = vi - c;
      const t = s + y;
      c = (t - s) - y;
      s = t;
    }
    return s;
  }
  /**
   * Mean computed via Welford one-pass algorithm.
   * Numerically stable even for large or near-uniform arrays.
   */
  mean(): number {
    if (this.length === 0) return 0;
    let mean = 0;
    for (let i = 0; i < this.length; i++) {
      const x = this.data[i];
      const delta = x - mean;
      mean += delta / (i + 1);
    }
    return mean;
  }
  /**
   * Sample variance via Welford one-pass algorithm.
   * Uses ddof (default 1) for unbiased estimator.
   */
  variance(ddof: number = 1): number {
    if (this.length <= ddof) return NaN;
    let mean = 0, M2 = 0;
    for (let i = 0; i < this.length; i++) {
      const x = this.data[i];
      const delta = x - mean;
      mean += delta / (i + 1);
      const delta2 = x - mean;
      M2 += delta * delta2;
    }
    return M2 / (this.length - ddof);
  }
  min(): number { let m = Infinity; for (let i = 0; i < this.length; i++) if (this.data[i] < m) m = this.data[i]; return m; }
  max(): number { let m = -Infinity; for (let i = 0; i < this.length; i++) if (this.data[i] > m) m = this.data[i]; return m; }
  sumAxis(axis: number): Matrix {
    if (axis === 0) {
      const d = new Float64Array(this.cols);
      for (let j = 0; j < this.cols; j++) { let s = 0; for (let i = 0; i < this.rows; i++) s += this.data[i * this.cols + j]; d[j] = s; }
      return new Matrix(d, 1, this.cols);
    } else {
      const d = new Float64Array(this.rows);
      for (let i = 0; i < this.rows; i++) { let s = 0; for (let j = 0; j < this.cols; j++) s += this.data[i * this.cols + j]; d[i] = s; }
      return new Matrix(d, this.rows, 1);
    }
  }
  meanAxis(axis: number): Matrix {
    const divisor = axis === 0 ? this.rows : this.cols;
    if (divisor === 0) throw new Error('meanAxis: dimension is 0');
    return this.sumAxis(axis).div(divisor);
  }
  /**
   * Standard deviation along axis using Welford one-pass algorithm.
   * @param axis - 0: column-wise, 1: row-wise
   * @param ddof - Delta degrees of freedom (default 1, unbiased estimator)
   */
  stdAxis(axis: number, ddof: number = 1): Matrix {
    if (axis === 0) {
      const denom = this.rows - ddof;
      if (denom <= 0) throw new Error('stdAxis: degrees of freedom >= sample size');
      const d = new Float64Array(this.cols);
      for (let j = 0; j < this.cols; j++) {
        let mean = 0, M2 = 0;
        for (let i = 0; i < this.rows; i++) {
          const x = this.data[i * this.cols + j];
          const delta = x - mean;
          mean += delta / (i + 1);
          const delta2 = x - mean;
          M2 += delta * delta2;
        }
        d[j] = Math.sqrt(M2 / denom);
      }
      return new Matrix(d, 1, this.cols);
    } else {
      const denom = this.cols - ddof;
      if (denom <= 0) throw new Error('stdAxis: degrees of freedom >= sample size');
      const d = new Float64Array(this.rows);
      for (let i = 0; i < this.rows; i++) {
        let mean = 0, M2 = 0;
        for (let j = 0; j < this.cols; j++) {
          const x = this.data[i * this.cols + j];
          const delta = x - mean;
          mean += delta / (j + 1);
          const delta2 = x - mean;
          M2 += delta * delta2;
        }
        d[i] = Math.sqrt(M2 / denom);
      }
      return new Matrix(d, this.rows, 1);
    }
  }
  /**
   * Cumulative sum using Kahan compensated summation.
   * Reduces numerical error for large arrays.
   */
  cumsum(): Matrix {
    const d = new Float64Array(this.length);
    let s = 0, c = 0;
    for (let i = 0; i < this.length; i++) {
      const vi = this.data[i] - c;
      const t = s + vi;
      c = (t - s) - vi;
      s = t;
      d[i] = s;
    }
    return new Matrix(d, this.rows, this.cols);
  }

  anyNaN(): boolean { for (let i = 0; i < this.length; i++) if (Number.isNaN(this.data[i])) return true; return false; }
  replaceNaN(v: number): Matrix {
    const d = new Float64Array(this.data);
    for (let i = 0; i < d.length; i++) if (Number.isNaN(d[i])) d[i] = v;
    return new Matrix(d, this.rows, this.cols);
  }
  /**
   * Stable argsort: returns indices that would sort the matrix.
   * Tie-breaker uses original index (stable sort).
   * NaN values are sorted to the end.
   */
  argsort(): number[] {
    const idx = Array.from({ length: this.length }, (_, i) => i);
    const d = this.data;
    idx.sort((a, b) => {
      const da = d[a], db = d[b];
      const naA = Number.isNaN(da), naB = Number.isNaN(db);
      if (naA && naB) return a - b;   // both NaN: tie-break by original index
      if (naA) return 1;              // NaN sorts to end
      if (naB) return -1;
      if (da !== db) return da - db;  // value tie-break
      return a - b;                   // index tie-break (stability)
    });
    return idx;
  }
  /**
   * Stable descending argsort: returns indices in descending order.
   * NaN values are sorted to the end.
   */
  argsortDesc(): number[] {
    const idx = Array.from({ length: this.length }, (_, i) => i);
    const d = this.data;
    idx.sort((a, b) => {
      const da = d[a], db = d[b];
      const naA = Number.isNaN(da), naB = Number.isNaN(db);
      if (naA && naB) return a - b;
      if (naA) return 1;
      if (naB) return -1;
      if (da !== db) return db - da;
      return a - b;
    });
    return idx;
  }

  toString(): string {
    const lines: string[] = [];
    for (let i = 0; i < Math.min(this.rows, 5); i++) {
      const v: string[] = [];
      for (let j = 0; j < Math.min(this.cols, 6); j++) v.push(this.get(i, j).toFixed(4));
      if (this.cols > 6) v.push('...');
      lines.push('[' + v.join(', ') + ']');
    }
    if (this.rows > 5) lines.push('... (' + this.rows + ' rows)');
    return 'Matrix(' + this.rows + 'x' + this.cols + ')\n' + lines.join('\n');
  }
}

export function matrix(arr: number[][]): Matrix { return Matrix.from2D(arr); }
export function vec(arr: number[]): Matrix { return Matrix.from1D(arr, arr.length, 1); }
