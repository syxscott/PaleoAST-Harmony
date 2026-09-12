import { Matrix } from './Matrix';
import { normCDF } from './special';
import { tCDF } from './special';

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

// ─── Distribution functions (used by Normality, t-test, LogRank, KM) ──────────

/** Standard normal PDF. */
export function dnorm(x: number, mu: number = 0, sigma: number = 1): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/**
 * Standard normal CDF.
 * @deprecated Use normCDF from special.ts directly for standard normal,
 *            or use this with mu/sigma for shifted/scaled normal.
 */
export function pnorm(x: number, mu: number = 0, sigma: number = 1): number {
  if (sigma <= 0) throw new Error('pnorm: sigma must be positive');
  return normCDF((x - mu) / sigma);
}

/**
 * Standard normal quantile (inverse CDF), Beasley-Springer-Moro algorithm.
 */
export function qnorm(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  // Rational approximation for central region
  const a: number[] = [-3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00];
  const b: number[] = [-5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01];
  const c: number[] = [-7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00];
  const d: number[] = [7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q: number, r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= phigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

/** Chi-square PDF: x^(k/2-1) exp(-x/2) / (2^(k/2) Γ(k/2)). */
export function dchisq(x: number, df: number): number {
  if (x < 0) return 0;
  const k = df / 2;
  return Math.exp((k - 1) * Math.log(x) - x / 2 - k * Math.log(2) - lgamma(k));
}

/** Chi-square CDF via regularised lower incomplete gamma. */
export function pchisq(x: number, df: number): number {
  return gammainc(df / 2, x / 2);
}

/** Log gamma (Lanczos approximation). */
export function lgamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218854, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526872087, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularised lower incomplete gamma P(s, x) by series + continued fraction. */
export function gammainc(s: number, x: number): number {
  if (x <= 0) return 0;
  if (x < s + 1) {
    // Series expansion
    let term = 1 / s;
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= x / (s + n);
      sum += term;
      if (term < 1e-15 * Math.abs(sum)) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - lgamma(s));
  }
  // Continued fraction (Lentz's method) — computes Q(s, x); P = 1 - Q
  let b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * h;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  const q = Math.exp(-x + s * Math.log(x) - lgamma(s)) * h;
  return 1 - q;
}

/** Quantile of chi-square (inverse CDF) — root-finding on pchisq. */
export function qchisq(p: number, df: number, tol: number = 1e-8, maxIter: number = 200): number {
  // Initial guess via Wilson-Hilferty approx
  const z = qnorm(p);
  let x = df * Math.pow(1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df)), 3);
  if (!isFinite(x) || x <= 0) x = Math.max(0.01, df);
  // Newton-Raphson
  for (let i = 0; i < maxIter; i++) {
    const f = pchisq(x, df) - p;
    // PDF derivative is χ² density at x
    const fp = dchisq(x, df);
    if (fp < 1e-300) break;
    const step = f / fp;
    x -= step;
    if (x <= 0) x = 1e-10;
    if (Math.abs(step) < tol * Math.max(1, x)) break;
  }
  return x;
}

/** F-distribution CDF P(F | d1, d2). */
export function pF(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  const x = (d1 * f) / (d1 * f + d2);
  return betaincRegularized(d1 / 2, d2 / 2, x);
}

/**
 * Regularized incomplete beta function I_x(a, b) = B_x(a,b) / B(a,b).
 *
 * Uses the continued fraction representation from
 * W.H. Press et al. (2007), _Numerical Recipes_ (3rd ed.), Sec 6.4.
 * This is the core function used by pF() (F-distribution) and pt() (t-distribution).
 *
 * @param a  First shape parameter (> 0)
 * @param b  Second shape parameter (> 0)
 * @param x  Upper limit of integration (0 ≤ x ≤ 1)
 * @returns 0 ≤ I_x(a,b) ≤ 1
 */
function betaincRegularized(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta_val = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta_val) / a;
  let term = 1, sum = 1;
  for (let i = 1; i < 200; i++) {
    term *= (a + i - 1) * x / (i * (a + i));
    sum += term;
    if (term < 1e-15 * sum) break;
  }
  return Math.min(1, Math.max(0, front * sum));
}

/**
 * t-distribution CDF P(T ≤ t | df).
 * @deprecated Use tCDF from special.ts
 */
export function pt(t: number, df: number): number {
  return tCDF(t, df);
}

/** t-distribution quantile. */
export function qt(p: number, df: number, tol: number = 1e-8, maxIter: number = 100): number {
  // Hill's algorithm initial guess then Newton-Raphson
  let x = qnorm(p);
  for (let i = 0; i < maxIter; i++) {
    const cdf = pt(x, df);
    const pdf = Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2)) / Math.sqrt(df * Math.PI) *
                Math.pow(1 + x * x / df, -(df + 1) / 2);
    const f = cdf - p;
    const step = f / Math.max(pdf, 1e-300);
    x -= step;
    if (Math.abs(step) < tol * Math.max(1, Math.abs(x))) break;
  }
  return x;
}
