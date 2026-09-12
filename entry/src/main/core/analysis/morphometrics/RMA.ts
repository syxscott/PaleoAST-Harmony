/**
 * Reduced Major Axis (RMA) Regression — replaces morphometrics/rma.py.
 *
 * Unlike ordinary least-squares (OLS) regression which assumes x is measured
 * without error, RMA minimises the area of right-triangles formed by residuals
 * in both x and y directions simultaneously.  This makes RMA symmetric and
 * appropriate for allometry (size-shape relationships) where neither variable
 * is a predictor in the causal sense.
 *
 * The RMA slope is:
 *   b_RMA = sign(r) * (σ_y / σ_x)
 *
 * where σ_x and σ_y are the standard deviations and r is the Pearson correlation.
 *
 * References:
 * - Legendre, P. & Legendre, L. (2012). Numerical Ecology, 3rd ed.  Sec. 13.1.3
 *   "Reduced major axis regression." Elsevier.
 * - Warton, D.I. et al. (2006). "SMATR: Standardised Major Axis Tests and
 *   Routines." R package lmodel2.  doi:10.1111/j.2041-210X.2012.00221.x
 * - Niklas, K.J. (1994). "Plant allometry."  Univ. Chicago Press.  [allometric
 *   applications]
 * - Ricker, W.E. (1984). "Computation and uses of central trend lines."
 *   Canadian J. Zoology 62: 1897-1905.
 */
import { Matrix } from '../../math/Matrix';
import { mean, std } from '../../math/stats';

/** Input type alias for plain arrays or Matrix columns */
export type Vector = number[] | Matrix;

function toArray(v: Vector): number[] {
  return Array.isArray(v) ? v : v.toArray();
}

export interface RMAResult {
  slope: number;
  intercept: number;
  slopeCI: [number, number];   // 95% confidence interval
  r2: number;
  /** Correlation coefficient r */
  r: number;
  /** Standard error of the slope estimate */
  slopeSE: number;
}

export function rmaRegression(x: Vector, y: Vector): RMAResult {
  const X = toArray(x);
  const Y = toArray(y);

  if (X.length !== Y.length) {
    throw new Error(`rmaRegression: x (${X.length}) and y (${Y.length}) must have equal length`);
  }
  if (X.length < 3) {
    throw new Error('rmaRegression: need at least 3 data points');
  }

  const n = X.length;

  // ── Sample statistics ───────────────────────────────────────────────────────
  const xMean = mean(X), yMean = mean(Y);
  const xStd = std(X), yStd = std(Y);

  // Pearson r
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (X[i] - xMean) * (Y[i] - yMean);
  }
  cov /= n - 1;
  const r = xStd > 0 && yStd > 0 ? cov / (xStd * yStd) : 0;

  // ── RMA slope and intercept ────────────────────────────────────────────────
  // b_RMA = sign(cov) * σ_y / σ_x
  const slope = (xStd > 0 && yStd > 0) ? Math.sign(cov) * (yStd / xStd) : 0;
  const intercept = yMean - slope * xMean;

  // ── R² (same as OLS — proportion of variance explained) ────────────────────
  const r2 = r * r;

  // ── Standard error of slope ────────────────────────────────────────────────
  // SE(b_RMA) = |b_RMA| * sqrt((1 - r²) / (n - 2))   [Ricker 1984; Legendre 2012]
  const residVar = 1 - r2;
  const slopeSE = Math.abs(slope) * Math.sqrt(Math.max(0, residVar) / (n - 2));

  // ── 95% CI via t-distribution ─────────────────────────────────────────────
  const tCrit = tQuantile(0.975, n - 2);
  const ci: [number, number] = [
    slope - tCrit * slopeSE,
    slope + tCrit * slopeSE,
  ];

  return { slope, intercept, slopeCI: ci, r2, r, slopeSE };
}

/**
 * Two-sided t-distribution quantile.
 * Uses the regularized incomplete beta function via Newton iteration.
 */
function tQuantile(p: number, df: number): number {
  // For large df approximate with normal quantile
  if (df > 100) {
    return normQuantile(p);
  }
  // t² / (df + t²) ~ Beta(df/2, 1/2) — invert via Newton
  let t = normQuantile(p); // initial guess
  for (let iter = 0; iter < 50; iter++) {
    const cdf = tCDF(t, df);
    const pdf = tPDF(t, df);
    if (pdf < 1e-15) break;
    const err = cdf - p;
    const step = err / pdf;
    t -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return t;
}

function tCDF(t: number, df: number): number {
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  // P(T ≤ t) = 1 - 0.5 * I_x(df/2, 1/2)  for t > 0
  if (t > 0) return 1 - 0.5 * incompleteBeta(x, a, b);
  return 0.5 * incompleteBeta(x, a, b);
}

function tPDF(t: number, df: number): number {
  const c = Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2)) / Math.sqrt(df * Math.PI);
  return c * Math.pow(1 + t * t / df, -(df + 1) / 2);
}

function normQuantile(p: number): number {
  // Rational approximation (Abramowitz & Stegun #26.2.23)
  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00,
  ];
  const d = [
     7.784695709041462e-03, 3.224671290700398e-01,
     2.445134137142996e+00, 3.754408661907416e+00,
  ];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r_: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r_ = q * q;
    return (((((a[0]*r_+a[1])*r_+a[2])*r_+a[3])*r_+a[4])*r_+a[5])*q /
           (((((b[0]*r_+b[1])*r_+b[2])*r_+b[3])*r_+b[4])*r_+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

/**
 * Regularized incomplete beta function I_x(a, b).
 * Uses continued fraction expansion (Numerical Recipes 6.2C).
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry: I_x(a,b) = 1 - I_{1-x}(b,a)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - incompleteBeta(1 - x, b, a);
  }

  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;

  // Continued fraction
  let f = 1, c = 1, d = 0;
  for (let m = 0; m <= 200; m++) {
    const m2 = 2 * m;

    // Numerator
    let aa: number;
    if (m === 0) {
      aa = 1;
    } else if (m % 2 === 0) {
      aa = (m / 2) * (b - m) * x / ((a + m - 1) * (a + m));
    } else {
      aa = -((a + m) * (a + b + m) * x) / ((a + m - 1) * (a + m));
    }

    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + aa / (c === 0 ? 1e-30 : c);
    if (Math.abs(c) < 1e-30) c = 1e-30;

    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return front * (f - 1);
}

function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const g = 7;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
