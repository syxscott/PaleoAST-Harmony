/**
 * Special mathematical functions: gamma, lgamma, beta, erf, betainc.
 * Replaces scipy.special core.
 */

/** Log-gamma via Stirling + Lanczos approximation. */
export function lgamma(x: number): number {
  if (x <= 0) return Infinity;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Gamma function. */
export function gamma(x: number): number { return Math.exp(lgamma(x)); }

/** Log-beta function. */
export function lbeta(a: number, b: number): number {
  return lgamma(a) + lgamma(b) - lgamma(a + b);
}

/** Beta function. */
export function beta(a: number, b: number): number { return Math.exp(lbeta(a, b)); }

/** Error function via Abramowitz & Stegun approximation. */
export function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/** Complementary error function. */
export function erfc(x: number): number { return 1 - erf(x); }

/** Standard normal CDF. */
export function normCDF(x: number): number { return 0.5 * erfc(-x / Math.SQRT2); }

/** Standard normal PDF. */
export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal quantile (rational approximation). */
export function normPPF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, -4.374664141464968e0, -2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

/** t-distribution CDF. */
export function tCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const ibeta = betainc(df / 2, 0.5, x);
  if (t >= 0) return 1 - 0.5 * ibeta;
  return 0.5 * ibeta;
}

/** t-distribution quantile (Newton iteration). */
export function tPPF(p: number, df: number): number {
  let x = normPPF(p);
  for (let i = 0; i < 20; i++) {
    const f = tCDF(x, df) - p;
    const fp = tPDF(x, df);
    if (Math.abs(fp) < 1e-15) break;
    x -= f / fp;
  }
  return x;
}

/** t-distribution PDF. */
export function tPDF(t: number, df: number): number {
  return (gamma((df + 1) / 2) / (Math.sqrt(df * Math.PI) * gamma(df / 2))) *
    Math.pow(1 + t * t / df, -(df + 1) / 2);
}

/** F-distribution CDF. */
export function fCDF(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  return betainc(d1 / 2, d2 / 2, d1 * x / (d1 * x + d2));
}

/** Chi-squared CDF. */
export function chi2CDF(x: number, k: number): number {
  if (x <= 0) return 0;
  return gammainc(k / 2, x / 2);
}

/** Chi-squared quantile (Newton iteration). */
export function chi2PPF(p: number, k: number): number {
  // Initial guess via normal approximation
  let x = k + Math.sqrt(2 * k) * normPPF(p);
  if (x <= 0) x = 0.1;
  for (let i = 0; i < 30; i++) {
    const f = chi2CDF(x, k) - p;
    const fp = chi2PDF(x, k);
    if (Math.abs(fp) < 1e-15) break;
    x -= f / fp;
    if (x <= 0) x = 1e-6;
  }
  return Math.max(0, x);
}

/** Chi-squared PDF. */
export function chi2PDF(x: number, k: number): number {
  if (x <= 0) return 0;
  return Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - k / 2 * Math.log(2) - lgamma(k / 2));
}

/** Regularized incomplete gamma function P(a, x). */
export function gammainc(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // Series expansion
    let sum = 1 / a, term = 1 / a;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < 1e-14 * Math.abs(sum)) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  } else {
    // Continued fraction
    let f = 1e-30, c = 1e-30, d = 1 / (x + 1 - a);
    f = d;
    for (let n = 1; n < 200; n++) {
      const a_n = n * (a - n);
      const b_n = x + 2 * n + 1 - a;
      d = b_n + a_n * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
      c = b_n + a_n / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      const delta = c * d;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-14) break;
    }
    return 1 - f * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
}

/** Regularized incomplete beta function I_x(a, b). */
export function betainc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x < (a + 1) / (a + b + 2)) {
    return betacf(a, b, x) * Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b)) / a;
  }
  return 1 - betainc(b, a, 1 - x);
}

/** Continued fraction for incomplete beta. */
function betacf(a: number, b: number, x: number): number {
  const maxIter = 200, eps = 1e-14;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return h;
}

/** Beta distribution CDF. */
export function betaCDF(x: number, a: number, b: number): number {
  return betainc(a, b, x);
}

/** Beta distribution quantile (Newton iteration). */
export function betaPPF(p: number, a: number, b: number): number {
  let x = a / (a + b); // Initial guess
  for (let i = 0; i < 30; i++) {
    const f = betaCDF(x, a, b) - p;
    const fp = betaPDF(x, a, b);
    if (Math.abs(fp) < 1e-15) break;
    x -= f / fp;
    x = Math.max(1e-10, Math.min(1 - 1e-10, x));
  }
  return x;
}

/** Beta distribution PDF. */
export function betaPDF(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lbeta(a, b));
}
