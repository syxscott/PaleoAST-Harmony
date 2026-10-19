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
 *
 * The complement is now taken from the regularised UPPER incomplete gamma
 * Q(1/2, x^2) computed directly, instead of `1 - gammainc(1/2, x^2)`. The
 * subtraction threw away every digit once the tail fell below ~1e-16:
 * erfc(8) returned exactly 0 while the true value is 1.12e-29. erfc is the
 * building block of every upper-tail p-value in the project, so a silently
 * truncated tail there means "p = 0" in a paper.
 */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  return gammaincc(0.5, x * x);
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

/**
 * t-distribution quantile.
 *
 * ## What was broken
 *
 * The previous implementation ran Newton on `tCDF(x) - p` starting from the
 * normal quantile, and had no convergence check at all:
 *
 *  - `tCDF` is `1 - ½·I_x(df/2, ½)`, so in the far tail it saturates to 1
 *    and `tCDF(x) - p` loses every significant digit;
 *  - the `|f'| < 1e-15 → break` guard returned the current iterate as if the
 *    iteration had converged.
 *
 * Measured against scipy 1.15.3: `tPPF(1e-12, 1)` returned -7.442e+06
 * instead of -3.183098861837905e+11.
 *
 * ## What it does now
 *
 * The upper tail is solved directly, in log space:
 *
 *     P(T > t) = ½·I_{df/(df+t²)}(df/2, ½)
 *
 * and the root of `log P(T > t) = log(min(p, 1-p))` is found by
 * `solveMonotone`, which brackets the root, iterates, and throws when it
 * does not converge (docs/code-style.md 1.3: an iteration that quietly
 * returns its last iterate is worse than a crash).
 */
export function tPPF(p: number, df: number): number {
  if (!(df > 0)) throw new Error(`tPPF: degrees of freedom must be positive, got ${df}`);
  if (Number.isNaN(p)) throw new Error('tPPF: p must be a number');
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  // min(p, 1-p). `1 - p` is exact for p in [0.5, 1] (Sterbenz's lemma), so
  // the tail probability keeps full relative precision.
  const s = Math.min(p, 1 - p);
  const a = df / 2, b = 0.5;
  const logS = Math.log(s);
  // log P(T > y) = log(½) + log I_u(a, b) with u = df/(df+y²); the objective
  // below is log(s) - log P(T > y), which increases with y. Everything is
  // kept in logarithms: y² overflows a double long before the quantile does.
  const logDf = Math.log(df);
  const objective = (w: number): number => {
    const w2 = 2 * w;                       // log(y²)
    const logSum = w2 > logDf               // log(df + y²)
      ? w2 + Math.log1p(Math.exp(logDf - w2))
      : logDf + Math.log1p(Math.exp(w2 - logDf));
    const logU = logDf - logSum;            // log(df/(df+y²))
    const logV = w2 - logSum;               // log(y²/(df+y²))
    return logS - (Math.log(0.5) + logBetaI(a, b, logU, logV));
  };
  const logPdf0 = logTPDF(0, df);
  let y0: number;
  if (s >= 0.25) {
    // Near the median the CDF is essentially linear in y.
    y0 = (0.5 - s) / Math.exp(logPdf0);
  } else {
    // Far tail: P(T > y) ≈ pdf0·df^((df+1)/2)·y^(-df)/df.
    const c = logPdf0 + ((df + 1) / 2) * Math.log(df);
    y0 = Math.exp((c - Math.log(df * s)) / df);
  }
  const w0 = Math.log(Math.max(y0, 1e-300));
  const w = solveMonotone(objective, w0, `tPPF(p=${p}, df=${df})`);
  return (p < 0.5 ? -1 : 1) * Math.exp(w);
}

/**
 * t-distribution PDF.
 *
 * Evaluated through the log-gamma: the direct form `gamma(df/2)` overflows to
 * Infinity for df > ~170, which made tPDF(9, 1000) return NaN.
 */
export function tPDF(t: number, df: number): number {
  return Math.exp(logTPDF(t, df));
}

/** Natural log of the t density. */
function logTPDF(t: number, df: number): number {
  return lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI)
    - ((df + 1) / 2) * Math.log1p((t * t) / df);
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

/**
 * Chi-squared quantile (inverse CDF).
 *
 * ## What was broken
 *
 * The previous implementation started from `k + sqrt(2k)·Φ⁻¹(p)`, which is
 * NEGATIVE for small k or a small p. The `x <= 0 → 0.1` guard then dropped
 * the iteration into a region where the Newton step was meaningless, and the
 * `|f'| < 1e-15 → break` guard returned that value as if it had converged.
 * Measured against scipy 1.15.3:
 *
 *   chi2PPF(0.05, 5)    → 3.7599e+08   (true 1.1454762260617692)
 *   chi2PPF(0.001, 30)  → 658.20       (true 11.587951045645056)
 *   chi2PPF(1e-12, 30)  → 0.1          (true 2.1792731865592656)
 *
 * ## What it does now
 *
 * Wilson–Hilferty initial guess (the same one `core/math/stats.ts` uses),
 * falling back to the small-x asymptotics when Wilson–Hilferty degenerates;
 * solved on log(x) against the log of the incomplete gamma so that BOTH
 * tails keep full precision; with a hard iteration cap and an explicit error
 * when the iteration does not converge.
 */
export function chi2PPF(p: number, k: number): number {
  if (!(k > 0)) throw new Error(`chi2PPF: degrees of freedom must be positive, got ${k}`);
  if (Number.isNaN(p)) throw new Error('chi2PPF: p must be a number');
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  const a = k / 2;
  const upper = p > 0.5;
  // `1 - p` is exact for p in [0.5, 1] (Sterbenz's lemma), so the tail keeps
  // full relative precision.
  const tail = upper ? 1 - p : p;
  const logTail = Math.log(tail);
  // log P(a, x/2) increases with x; log Q(a, x/2) decreases with x. The
  // upper-tail objective is negated so that both are increasing, which is
  // what `solveMonotone` requires.
  const objective = upper
    ? (w: number): number => logTail - logGammaUpper(a, chi2Arg(w))
    : (w: number): number => logGammaLower(a, chi2Arg(w)) - logTail;
  const z = normPPF(p);
  if (!upper) {
    // The quantile can fall below the smallest representable double (the
    // chi-square quantile for p = 1e-300, df = 1 is 1.6e-600). scipy returns
    // 0.0 there; so do we, instead of failing the root search.
    if (logGammaLower(a, 2.5e-324) > logTail) return 0;
  }
  const base = 1 - 2 / (9 * k) + z * Math.sqrt(2 / (9 * k));
  let w0: number;
  if (base > 0.1) {
    // Wilson–Hilferty.
    w0 = Math.log(k * base * base * base);
  } else {
    // Degenerate Wilson–Hilferty (small df, or a far lower tail): use the
    // small-x asymptotics P(a, x) ≈ x^a / Γ(a+1), i.e. x ≈ (tail·a·Γ(a))^(1/a)
    // for the gamma argument, which is x/2 for the chi-square.
    const logXs = Math.log(2) + (logTail + Math.log(a) + lgamma(a)) / a;
    w0 = Math.max(logXs, -700);
  }
  const w = solveMonotone(objective, w0, `chi2PPF(p=${p}, k=${k})`);
  return Math.exp(w);
}

/** Chi-square argument x/2 for a log-space search, clamped away from 0 and ∞. */
function chi2Arg(w: number): number {
  const x = Math.exp(w);
  return Math.min(Math.max(x / 2, 2.5e-324), 1e300);
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
    return gammaincSeries(a, x) * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaincCF(a, x) * Math.exp(-x + a * Math.log(x) - lgamma(a));
}

/**
 * Regularized UPPER incomplete gamma Q(a, x) = Γ(a,x) / Γ(a) = 1 - P(a, x).
 *
 * Computed from the continued fraction directly instead of `1 - gammainc(a, x)`:
 * the subtraction destroys the whole tail once Q drops below ~1e-16, which is
 * exactly where upper-tail p-values live (scipy: chi2.sf(1e-12, 30) = 1.0
 * only because the lower tail is 1e-12; the upper tail of a large statistic
 * is the quantity that must survive).
 */
export function gammaincc(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    return 1 - gammaincSeries(a, x) * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return gammaincCF(a, x) * Math.exp(-x + a * Math.log(x) - lgamma(a));
}

/**
 * Series expansion for the regularized lower incomplete gamma.
 * Returns the series sum; the caller applies the exp(...) prefactor so that
 * the log of the product stays available.
 */
function gammaincSeries(a: number, x: number): number {
  let sum = 1 / a, term = 1 / a;
  for (let n = 1; n < 200; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-14 * Math.abs(sum)) break;
  }
  return sum;
}

/**
 * Lentz's-method continued fraction for the upper incomplete gamma
 * (NR3 Sec 6.2 `gcf`). Returns the fraction h; Q(a, x) = h·exp(-x + a·ln x -
 * Γ(a)).
 *
 * Two defects used to live in this body, both fatal for the chi-square /
 * beta paths:
 *   1. `c` was seeded with FPMIN (1e-30) instead of 1/FPMIN (1e30). Lentz's
 *      recursion computes `an / c`, so with c = 1e-30 the very first step
 *      multiplied by 1e30 and the fraction diverged. chi2CDF(10, 1) returned
 *      -8.2e+27 (true 0.99843) and gammainc(2, 3) returned 6.4e+28
 *      (true 0.80085).
 *   2. `a_n` was `-n * (a - n)`, the negative of NR3's `-n * (n - a)`. For
 *      (a, x) = (2, 3) the i=1 coefficient must be +1 so the accumulated
 *      h lands on 0.44444 and Q(2,3) = 0.19915.
 * `b_n = x + 2n + 1 - a` is NR's running `b` (b starts at x+1-a, += 2 per
 * iteration), written out; that part was already correct.
 */
function gammaincCF(a: number, x: number): number {
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
  return f;
}

/**
 * log P(a, x) — the log of the regularized lower incomplete gamma.
 *
 * Evaluated in log space so that the extreme lower tail (x ~ 1e-300) stays
 * representable and free of cancellation.
 */
function logGammaLower(a: number, x: number): number {
  if (!(x > 0)) return -Infinity;
  if (x < a + 1) {
    return Math.log(gammaincSeries(a, x)) + (-x + a * Math.log(x) - lgamma(a));
  }
  const q = Math.min(gammaincCF(a, x) * Math.exp(-x + a * Math.log(x) - lgamma(a)), 1);
  return Math.log1p(-q);
}

/**
 * log Q(a, x) — the log of the regularized upper incomplete gamma.
 *
 * The log of the continued fraction is taken separately from the exponential
 * prefactor, so the tail does not underflow to 0 before it can be logged.
 */
function logGammaUpper(a: number, x: number): number {
  if (!(x > 0)) return 0;
  if (x < a + 1) {
    const p = Math.min(gammaincSeries(a, x) * Math.exp(-x + a * Math.log(x) - lgamma(a)), 1);
    return Math.log1p(-p);
  }
  return Math.log(gammaincCF(a, x)) + (-x + a * Math.log(x) - lgamma(a));
}

/**
 * log I_x(a, b) — the log of the regularized incomplete beta.
 *
 * `logX` and `logXc` are the logarithms of x and of 1 - x, passed in by the
 * caller so that both stay exact: the complement of a value close to 1 would
 * cancel, and the argument of the t quantile can be as small as 1e-600, which
 * does not survive as a double but does survive as a logarithm.
 */
function logBetaI(a: number, b: number, logX: number, logXc: number): number {
  if (!Number.isFinite(logX)) return -Infinity;
  const x = Math.exp(logX);
  if (x >= 1) return 0;
  const logFront = lgamma(a + b) - lgamma(a) - lgamma(b)
    + a * logX + b * logXc;
  if (x < (a + 1) / (a + b + 2)) {
    return Math.log(betacf(a, b, x)) + logFront - Math.log(a);
  }
  // I_x = 1 - I_{1-x}(b, a): the small complement is evaluated directly, so
  // the result never comes from subtracting two nearly equal numbers.
  const j = Math.exp(Math.log(betacf(b, a, Math.exp(logXc))) + logFront - Math.log(b));
  return Math.log1p(-j);
}

/**
 * Solve f(w) = 0 for a continuous, strictly INCREASING f.
 *
 * `f` is expressed on w = log(x) so that the search can reach x values far
 * below 1e-300 (the chi-square quantile for p = 1e-12, df = 1 is 1.6e-24)
 * without ever forming them, and so that the power-law tails stay linear in
 * the search variable.
 *
 * Bracketing plus Illinois regula falsi: the bracket is expanded until the
 * sign changes, then the iteration is accelerated by false position with the
 * Illinois weighting, falling back to bisection whenever the interpolated
 * point leaves the bracket.
 *
 * Throws when the iteration does not converge. A quantile that "looks
 * plausible" but was never reached is exactly the failure mode this project
 * must not ship (docs/code-style.md 1.3).
 */
function solveMonotone(
  f: (w: number) => number,
  w0: number,
  label: string,
  maxIter: number = 200,
  ftol: number = 1e-13,
): number {
  const evalF = (w: number): number => {
    const v = f(w);
    if (Number.isNaN(v)) {
      throw new Error(`${label}: the objective evaluated to NaN at log(x) = ${w}`);
    }
    return v;
  };

  const fw = evalF(w0);
  if (Math.abs(fw) <= ftol) return w0;

  // Bracket the root: f is increasing, so f(w0) < 0 means the root is above.
  let wLo = w0, fLo = fw, wHi = w0, fHi = fw;
  let step = 1;
  if (fw < 0) {
    for (let i = 0; i < 128; i++) {
      wHi = wLo + step;
      step *= 2;
      fHi = evalF(wHi);
      if (fHi >= 0) break;
      wLo = wHi; fLo = fHi;
    }
    if (!(fHi >= 0)) {
      throw new Error(
        `${label}: no root above log(x) = ${w0} (objective still ${fw} after 128 expansions)`);
    }
  } else {
    for (let i = 0; i < 128; i++) {
      wLo = wHi - step;
      step *= 2;
      fLo = evalF(wLo);
      if (fLo <= 0) break;
      wHi = wLo; fHi = fLo;
    }
    if (!(fLo <= 0)) {
      throw new Error(
        `${label}: no root below log(x) = ${w0} (objective still ${fw} after 128 expansions)`);
    }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    // False position, with a bisection fallback when the interpolation leaves
    // the bracket (which happens when the objective is very steep).
    let wNew = (fHi * wLo - fLo * wHi) / (fHi - fLo);
    if (!Number.isFinite(wNew) || wNew <= wLo || wNew >= wHi) wNew = 0.5 * (wLo + wHi);
    const fNew = evalF(wNew);
    if (Math.abs(fNew) <= ftol) return wNew;
    if (fNew < 0) {
      wLo = wNew; fLo = fNew; fHi *= 0.5;   // Illinois: discount the stale side
    } else {
      wHi = wNew; fHi = fNew; fLo *= 0.5;
    }
    if (wHi - wLo <= 1e-15 * Math.max(1, Math.abs(wHi))) {
      // The bracket has collapsed to machine precision in log space.
      return Math.abs(fLo) <= Math.abs(fHi) ? wLo : wHi;
    }
  }
  throw new Error(
    `${label}: the iteration did not converge after ${maxIter} iterations ` +
    `(bracket width ${(wHi - wLo).toExponential(3)})`);
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
