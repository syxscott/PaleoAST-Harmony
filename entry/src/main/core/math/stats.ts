import { Matrix } from './Matrix';

/**
 * Basic statistics functions replacing NumPy/SciPy.stats core.
 */

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function std(arr: number[], ddof: number = 1): number {
  const m = mean(arr);
  const n = arr.length;
  if (n <= ddof) return 0;
  let s = 0;
  for (const v of arr) s += (v - m) ** 2;
  return Math.sqrt(s / (n - ddof));
}

export function variance(arr: number[], ddof: number = 1): number {
  const m = mean(arr);
  const n = arr.length;
  if (n <= ddof) return 0;
  let s = 0;
  for (const v of arr) s += (v - m) ** 2;
  return s / (n - ddof);
}

export function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

export function skewness(arr: number[]): number {
  const n = arr.length;
  if (n < 3) return 0;
  const m = mean(arr), s = std(arr, 1);
  if (s === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += ((v - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * sum;
}

export function kurtosis(arr: number[]): number {
  const n = arr.length;
  if (n < 4) return 0;
  const m = mean(arr), s = std(arr, 1);
  if (s === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += ((v - m) / s) ** 4;
  const k4 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * sum
    - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return k4;
}

export function se(arr: number[]): number {
  return std(arr, 1) / Math.sqrt(arr.length);
}

export function ci95(arr: number[]): [number, number] {
  const m = mean(arr), s = se(arr);
  return [m - 1.96 * s, m + 1.96 * s];
}

export function covMatrix(X: Matrix): Matrix {
  const mu = X.meanAxis(0);
  const Z = X.sub(mu);
  return Z.transpose().matmul(Z).div(X.rows - 1);
}

export function correlation(X: Matrix): Matrix {
  const C = covMatrix(X);
  const d = new Float64Array(C.length);
  for (let i = 0; i < C.rows; i++) {
    const si = Math.sqrt(C.get(i, i));
    for (let j = 0; j < C.cols; j++) {
      const sj = Math.sqrt(C.get(j, j));
      d[i * C.cols + j] = (si > 0 && sj > 0) ? C.get(i, j) / (si * sj) : 0;
    }
  }
  return new Matrix(d, C.rows, C.cols);
}

export function rankdata(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2; // 1-based average rank
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}
