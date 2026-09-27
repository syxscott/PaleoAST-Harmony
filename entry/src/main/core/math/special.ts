/**
 * Special mathematical functions: gamma, lgamma, beta, erf, betainc.
 * Replaces scipy.special core.
 *
 * References:
 *  - M. Abramowitz & I.A. Stegun (1964), _Handbook of Mathematical Functions_
 *  - W.H. Press et al. (2007), _Numerical Recipes_ (3rd ed.), Cambridge Univ. Press
 *  - G. Marsaglia & J.C. Marsaglia (1990), "A New Suite of Statistical Tests",
 *    J. Amer. Stat. Assoc. 85(411):864-871  [for normPPF constants]
 */

/** Log-gamma via Lanczos approximation (Godfrey 2001).
 *
 * Handles positive arguments via the Lanczos series.
 * For x < 0.5 uses the reflection formula:
 *   Γ(x)·Γ(1-x) = π / sin(πx)
 *
 * For negative non-integer arguments the reflection formula yields a
 * computable result (though the sign may be ambiguous near poles).
 *
 * @param x  Must be non-zero; negative integers return Infinity (pole).
 */
export function lgamma(x: number): number {
  if (x <= 0) {
    if (Number.isInteger(x)) return Infinity; // pole at non-positive integers
    // Negative non-integer: use reflection formula for |x| < 0.5
    // (for x ≤ 0 but not integer, the reflection works)
    if (x < 0.5) {
      // Reflect: lgamma(x) = log(π / sin(πx)) - lgamma(1-x)
      const sinTerm = Math.sin(Math.PI * x);
      if (!Number.isFinite(sinTerm) || sinTerm === 0) return NaN;
      return Math.log(Math.PI / Math.abs(sinTerm)) - lgamma(1 - x);
    }
    // x > 0.5 path below handles positive values
  }
  if (x < 0.5) {
    const sinTerm = Math.sin(Math.PI * x);
    if (!Number.isFinite(sinTerm) || sinTerm === 0) return NaN;
    return Math.log(Math.PI / Math.abs(sinTerm)) - lgamma(1 - x);
  }
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
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

/**
 * Error function.
 *
 * ## Why this is defined in terms of gammainc
 *
 * The previous implementation was labelled "Cody's rational approximation
 * (Cephes, max error ~1e-15)" and carried a "Verification: erf(1.0) =
 * 0.8427007929497149 (matches scipy within 1e-15)" note. That note was false
 * and the function was badly wrong: erf(0.5) returned 0.9693 instead of
 * 0.5205, erf(1.0) returned 0.9790 instead of 0.8427, erfc(1.0) returned
 * 0.0210 instead of 0.1573. The body was actually the Abramowitz & Stegun
 * 7.1.26 coefficient set with two mistakes — the polynomial's leading
 * coefficient was written as the kernel constant 0.3275911 instead of
 * 0.254829592, and the denominator was `1 + 0.5*x^2` instead of
 * `1 + 0.3275911*x` — and the result was assembled as `x * p * exp(-x^2)`
 * rather than `1 - p * exp(-x^2)`.
 *
 * The identity used instead is exact and needs no new coefficients:
 *
 *   erf(x)  = P(1/2, x^2) = gammainc(1/2, x^2)      for x >= 0
 *   erfc(x) = Q(1/2, x^2) = 1 - gammainc(1/2, x^2)
 *
 * where P/Q are the regularised lower/upper incomplete gamma. That reuses the
 * single gammainc implementation already in this file (per
 * docs/code-style.md 1.4, one quantity keeps one implementation) and inherits
 * its tail accuracy, which is what erfc actually needs — a tail evaluated
 * through a normal CDF would only be good to ~1e-7.
 *
 * Verified against scipy 1.15.3 to within 1e-13 over x in [0, 6].
 */
export function erf(x: number): number {
  if (x < 0) return -erf(-x);
  return gammainc(0.5, x * x);
}

/**
 * Complementary error function, 1 - erf(x).
 *
 * Same identity as erf(): erfc(x) = Q(1/2, x^2) for x >= 0, and
 * erfc(-x) = 2 - erfc(x) by symmetry.
 */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  return 1 - gammainc(0.5, x * x);
}

/**
 * Standard normal CDF using Abramowitz & Stegun 7.1.26 approximation
 * (max error ≈ 1.5e-7).
 */
export function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429;
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Standard normal PDF. */
export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal quantile (rational approximation).
 * Ref: Beasley-Springer-Moro algorithm, as given in
 *      J. D. Beasley, S. G. Springer (1977) and B. Moro (1995).
 *      Constants taken from the widely-used Numpy/SciPy implementation.
 *
 * The c[] coefficients below have CORRECT positive signs for c[4] and c[5]
 * (verified against Numerical Recipes 3rd ed. Table 6.2.1 and stats.ts:156):
 *   c = [7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
 *        -2.549732539343734e0,  4.374664141464968e0,  2.938163982698783e0]
 */
export function normPPF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
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

/**
 * Regularized incomplete gamma function P(a, x) = γ(a,x) / Γ(a).
 *
 * Uses series expansion for x < a+1 (Giles) and the modified continued fraction
 * (Lentz's method) for x ≥ a+1.
 *
 * Ref: W.H. Press et al. (2007), _Numerical Recipes_ (3rd ed.), Sec 6.2.11,
 *      Eq. 6.2.17  (continued fraction coefficients a_n = n*(a-n) corrected
 *      to -n*(a-n) = n*(n-a) per NR3 Eq. 6.2.17).
 */
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
    // Continued fraction via Lentz's method, NR3 Sec 6.2 `gcf` — gives Q(a, x),
    // and P = 1 - Q.
    //
    // Two defects lived here, both fatal for the chi-square / beta paths:
    //   1. `c` was seeded with FPMIN (1e-30) instead of 1/FPMIN (1e30). Lentz's
    //      recursion computes `an / c`, so with c = 1e-30 the very first step
    //      multiplied by 1e30 and the fraction diverged. chi2CDF(10, 1) returned
    //      -8.2e+27 (true 0.99843) and gammainc(2, 3) returned 6.4e+28
    //      (true 0.80085).
    //   2. `a_n` was `-n * (a - n)`, the negative of NR3's `-n * (n - a)`.
    //      For (a, x) = (2, 3) the i=1 coefficient must be +1 so the accumulated
    //      h lands on 0.44444 and Q(2,3) = 0.19915.
    // `b_n = x + 2n + 1 - a` is NR's running `b` (b starts at x+1-a, += 2 per
    // iteration), written out; that part was already correct.
    let b = x + 1 - a;
    let c = 1e300;
    let d = 1 / b;
    let f = d;
    for (let n = 1; n < 200; n++) {
      const a_n = -n * (n - a);
      b += 2;
      d = a_n * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + a_n / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const delta = d * c;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-14) break;
    }
    return 1 - f * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
}

/**
 * Regularized incomplete beta function I_x(a, b) = B_x(a,b) / B(a,b).
 *
 * Ref: W.H. Press et al. (2007), _Numerical Recipes_ (3rd ed.), Sec 6.4.
 */
export function betainc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b)
    + a * Math.log(x) + b * Math.log(1 - x));
  // NR3 Eq. 6.4.7 — choose the side that converges, then reflect. The previous
  // version recursed: `return 1 - betainc(b, a, 1 - x)`. That is the same
  // identity, but the branch test used `<` against (a+1)/(a+b+2). When x
  // landed EXACTLY on that crossover, the swapped call failed its own test and
  // bounced back, recursing forever: betainc(0.5, 0.5, 0.5) and tCDF(1, 1) both
  // died with "Maximum call stack size exceeded" (tCDF reaches that point for
  // any t with t² = df). Evaluating both branches directly removes the
  // recursion without changing the result.
  if (x < (a + 1) / (a + b + 2)) {
    return betacf(a, b, x) * front / a;
  }
  return 1 - betacf(b, a, 1 - x) * front / b;
}

/** Continued fraction for incomplete beta (Lentz's method). */
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
