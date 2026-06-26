/**
 * PaleoAST-Harmony Matrix Library
 * Replaces NumPy ndarray. Row-major Float64Array storage.
 */
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
    const r = arr.length, c = arr[0]?.length ?? 0, d = new Float64Array(r * c);
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) d[i * c + j] = arr[i][j];
    return new Matrix(d, r, c);
  }
  static from1D(arr: number[], r: number, c: number): Matrix { return new Matrix(new Float64Array(arr), r, c); }
  static diag(v: number[]): Matrix {
    const n = v.length, m = Matrix.zeros(n, n);
    for (let i = 0; i < n; i++) m.data[i * n + i] = v[i]; return m;
  }
  static randn(r: number, c: number): Matrix {
    const d = new Float64Array(r * c);
    for (let i = 0; i < d.length; i += 2) {
      const u1 = Math.random() || 1e-10, u2 = Math.random();
      const rad = Math.sqrt(-2 * Math.log(u1));
      d[i] = rad * Math.cos(2 * Math.PI * u2);
      if (i + 1 < d.length) d[i + 1] = rad * Math.sin(2 * Math.PI * u2);
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
    if (typeof o === 'number') { for (let i = 0; i < d.length; i++) d[i] /= o; }
    else { for (let i = 0; i < d.length; i++) d[i] /= o.data[i]; }
    return new Matrix(d, this.rows, this.cols);
  }
  matmul(o: Matrix): Matrix {
    if (this.cols !== o.rows) throw new Error('matmul shape');
    const m = this.rows, n = o.cols, k = this.cols, d = new Float64Array(m * n);
    for (let i = 0; i < m; i++)
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let p = 0; p < k; p++) s += this.data[i * k + p] * o.data[p * n + j];
        d[i * n + j] = s;
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

  sum(): number { let s = 0; for (let i = 0; i < this.length; i++) s += this.data[i]; return s; }
  mean(): number { return this.length > 0 ? this.sum() / this.length : 0; }
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
  meanAxis(axis: number): Matrix { return this.sumAxis(axis).div(axis === 0 ? this.rows : this.cols); }
  stdAxis(axis: number, ddof: number = 1): Matrix {
    const mu = this.meanAxis(axis);
    if (axis === 0) {
      const d = new Float64Array(this.cols);
      for (let j = 0; j < this.cols; j++) {
        let s = 0;
        for (let i = 0; i < this.rows; i++) { const df = this.data[i * this.cols + j] - mu.data[j]; s += df * df; }
        d[j] = Math.sqrt(s / (this.rows - ddof));
      }
      return new Matrix(d, 1, this.cols);
    } else {
      const d = new Float64Array(this.rows);
      for (let i = 0; i < this.rows; i++) {
        let s = 0;
        for (let j = 0; j < this.cols; j++) { const df = this.data[i * this.cols + j] - mu.data[i]; s += df * df; }
        d[i] = Math.sqrt(s / (this.cols - ddof));
      }
      return new Matrix(d, this.rows, 1);
    }
  }
  cumsum(): Matrix {
    const d = new Float64Array(this.length); d[0] = this.data[0];
    for (let i = 1; i < this.length; i++) d[i] = d[i - 1] + this.data[i];
    return new Matrix(d, this.rows, this.cols);
  }

  anyNaN(): boolean { for (let i = 0; i < this.length; i++) if (Number.isNaN(this.data[i])) return true; return false; }
  replaceNaN(v: number): Matrix {
    const d = new Float64Array(this.data);
    for (let i = 0; i < d.length; i++) if (Number.isNaN(d[i])) d[i] = v;
    return new Matrix(d, this.rows, this.cols);
  }
  argsort(): number[] {
    const idx = Array.from({ length: this.length }, (_, i) => i);
    const d = this.data; idx.sort((a, b) => d[a] - d[b]); return idx;
  }
  argsortDesc(): number[] {
    const idx = Array.from({ length: this.length }, (_, i) => i);
    const d = this.data; idx.sort((a, b) => d[b] - d[a]); return idx;
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
