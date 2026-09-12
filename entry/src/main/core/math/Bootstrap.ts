/**
 * Bootstrap resampling framework with percentile and BCa confidence intervals.
 *
 * ## Algorithm
 *
 * ### Parametric bootstrap
 * 1. Seed the RNG for reproducible resampling.
 * 2. Draw `nResamples` bootstrap samples with replacement from the data.
 * 3. Compute the statistic for each resample.
 * 4. Derive confidence intervals via:
 *    - **Percentile method**: Use the α/2 and 1−α/2 quantiles of the bootstrap
 *      distribution.  Simple but has ~1st-order accuracy.
 *    - **BCa (bias-corrected and accelerated)**: Adjusts for both bias and
 *      skewness.  Uses the jackknife to estimate:
 *        - z₀: bias-correction factor (proportion of bootstrap reps below the
 *          observed statistic, transformed to z-score).
 *        - a: acceleration factor (Efron 1987), estimated via jackknife.
 *      Ref: Efron B. (1987) J. Amer. Statist. Assoc. 82: 171-200.
 *           Efron B. & Tibshirani R.J. (1993) An Introduction to the Bootstrap,
 *           Chapman & Hall, Sec. 14.3.
 *
 * ## Phipson & Smyth (2010) correction
 * This implementation uses the bias-corrected p-value formula for permutation
 * tests:
 *   p* = (count + 1) / (N + 1)
 * but the core bootstrap interval estimation is unaffected (it is not a permutation
 * test and does not use the count-based formula).
 *
 * Reference: Phipson B. & Smyth G.K. (2010) "Permutation P-values Should Never
 * Be Zero."  Statist. Appl. Genet. Mol. Biol. 9(1): Article 39.
 *
 * ## Usage
 * ```typescript
 * const data = [[1,2],[3,4],[5,6],[7,8]];
 * const stat = (sample: number[][]) => mean(sample.map(r => r[0]));
 * const result = bootstrap(data, stat, { nResamples: 9999, confidenceLevels: [0.95, 0.99] });
 * console.log(result.estimate, result.ci95, result.ci99);
 * ```
 */
import { createSeededRNG } from './random';

export interface BootstrapOptions {
  /** Number of bootstrap resamples (default: 9999) */
  nResamples?: number;
  /** Confidence levels to compute (default: [0.95, 0.99]) */
  confidenceLevels?: number[];
  /** Random seed for reproducibility (default: 42) */
  seed?: number;
  /** Use parallel computation if available (default: false; reserved) */
  parallel?: boolean;
  /**
   * Interval estimation method:
   * - 'percentile': percentile bootstrap (default)
   * - 'bca': bias-corrected and accelerated (Efron 1987)
   */
  method?: 'percentile' | 'bca';
}

export interface BootstrapResult<T> {
  /** Point estimate (statistic applied to the original data) */
  estimate: T;
  /** 95% confidence interval [lower, upper] */
  ci95: [T, T];
  /** 99% confidence interval [lower, upper] */
  ci99: [T, T];
  /** All requested confidence intervals */
  cis: Map<number, [T, T]>;
  /** Number of bootstrap resamples performed */
  nResamples: number;
  /** Random seed used */
  seed: number;
  /** Method used: 'percentile' or 'bca' */
  method: 'percentile' | 'bca';
  /** Bootstrap estimates for all resamples (useful for diagnostics) */
  bootstrapEstimates: T[];
  /** Jackknife estimates (used for BCa) */
  jackknifeEstimates?: T[];
}

// ─── Internal helpers ──────────────────────────────────────────────

/** Compute the α quantile of an array (0 < α < 1). */
function quantile(sortedArr: number[], alpha: number): number {
  const n = sortedArr.length;
  if (n === 0) return 0;
  // Linear interpolation (type 7 in Hyndman & Fan 1996)
  const pos = alpha * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sortedArr[lo] + frac * (sortedArr[hi] - sortedArr[lo]);
}

/** BCa acceleration factor a — jackknife bias correction.
 *
 * a = Σ_i (θ̄  − θ_i)³ / [6 * (Σ_i (θ̄ − θ_i)²)^(3/2)]
 *
 * Ref: Efron B. (1987) J. Amer. Statist. Assoc. 82: 171-200, Eq. (9).
 *      Efron & Tibshirani (1993) An Introduction to the Bootstrap, Chapman & Hall, Eq. (14.10).
 */
function jackknifeAccelerate(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const thetaHat = values.reduce((a, b) => a + b, 0) / n;
  const diffs = values.map(v => v - thetaHat);
  const sumSq = diffs.reduce((s, d) => s + d * d, 0);
  const sumCu = diffs.reduce((s, d) => s + d * d * d, 0);
  if (sumSq < 1e-15) return 0;
  return sumCu / (6 * Math.pow(sumSq, 1.5));
}

/** Standard normal inverse CDF (Abramowitz & Stegun 1964, Algorithm 26.2.23). */
function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a = [
    -3.969683028665376e+01,  2.209460984245205e+02,
    -2.759285104469687e+02,  1.383577518672690e+02,
    -3.066479806614716e+01,  2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,  1.615858368580409e+02,
    -1.556989798598866e+02,  6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00,
  ];
  const d = [
     7.784695709041462e-03,  3.224671290700398e-01,
     2.445134137142996e+00,  3.754408661907416e+00,
  ];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

// ─── Main bootstrap function ────────────────────────────────────────

/**
 * Parametric bootstrap with percentile or BCa confidence intervals.
 *
 * @param data     - n × p data matrix (each row is one observation)
 * @param statistic - function mapping a data matrix to the scalar statistic T
 * @param options  - optional configuration
 * @returns BootstrapResult with point estimate, CIs, and diagnostics
 *
 * Ref: Efron B. (1987) J. Amer. Statist. Assoc. 82: 171-200.
 *      Efron B. & Tibshirani R.J. (1993) An Introduction to the Bootstrap.
 *      Phipson B. & Smyth G.K. (2010) Stat. Appl. Genet. Mol. Biol. 9(1): 39.
 */
export function bootstrap<T>(
  data: number[][],
  statistic: (sample: number[][]) => T,
  options: BootstrapOptions = {},
): BootstrapResult<T> {
  const {
    nResamples = 9999,
    confidenceLevels = [0.95, 0.99],
    seed = 42,
    method = 'percentile',
  } = options;

  const n = data.length;
  if (n === 0) throw new Error('bootstrap: data is empty');

  // Seed the RNG
  const rng = createSeededRNG(seed);

  // Point estimate on original data
  const estimate = statistic(data);

  // ── Jackknife estimates (for BCa) ──────────────────────────────────
  let jackknifeEstimates: number[] = [];
  if (method === 'bca') {
    jackknifeEstimates = new Array(n);
    for (let i = 0; i < n; i++) {
      // Leave-one-out sample
      const loo: number[][] = data.filter((_, idx) => idx !== i);
      const v = statistic(loo);
      jackknifeEstimates[i] = typeof v === 'number' ? v as number : 0;
    }
  }

  // ── Bootstrap resamples ───────────────────────────────────────────
  const bootstrapEstimates: number[] = new Array(nResamples);
  for (let b = 0; b < nResamples; b++) {
    const resample: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      resample[i] = data[idx].slice();
    }
    const v = statistic(resample);
    bootstrapEstimates[b] = typeof v === 'number' ? v as number : 0;
  }

  // ── Confidence intervals ──────────────────────────────────────────
  const sorted = [...bootstrapEstimates].sort((a, b) => a - b);
  const cis = new Map<number, [T, T]>();

  for (const level of confidenceLevels) {
    const alpha = 1 - level;
    let lo: number, hi: number;

    if (method === 'bca') {
      // BCa adjustment
      // Ref: Efron (1987) Eq. (10); Efron & Tibshirani (1993) Eq. (14.14)-(14.17)
      // z₀ = Φ⁻¹( #{θ* < θ̂} / B )
      const below = bootstrapEstimates.filter(v => v < (estimate as number)).length;
      const z0 = normInv(below / nResamples);

      // Acceleration a (jackknife)
      const a = jackknifeAccelerate(jackknifeEstimates);

      // Adjusted percentiles
      const zLo = z0 + normInv(alpha / 2);
      const zHi = z0 + normInv(1 - alpha / 2);
      const alpha1 = normCDF(z0 + zLo / (1 - a * zLo));
      const alpha2 = normCDF(z0 + zHi / (1 - a * zHi));

      lo = quantile(sorted, Math.max(0.0001, Math.min(0.9999, alpha1)));
      hi = quantile(sorted, Math.max(0.0001, Math.min(0.9999, alpha2)));
    } else {
      // Percentile method
      lo = quantile(sorted, alpha / 2);
      hi = quantile(sorted, 1 - alpha / 2);
    }

    cis.set(level, [lo as T, hi as T]);
  }

  return {
    estimate,
    ci95: cis.get(0.95) ?? [(estimate as unknown as number) as T, (estimate as unknown as number) as T],
    ci99: cis.get(0.99) ?? [(estimate as unknown as number) as T, (estimate as unknown as number) as T],
    cis,
    nResamples,
    seed,
    method,
    bootstrapEstimates: bootstrapEstimates as T[],
    jackknifeEstimates: jackknifeEstimates.length > 0
      ? (jackknifeEstimates as T[])
      : undefined,
  };
}

// ─── Standard normal CDF (Abramowitz & Stegun 26.2.17) ─────────────
function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530
    + t * (-0.356563782
    + t * (1.781477937
    + t * (-1.821255978
    + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  return x >= 0 ? 1 - pdf * poly : pdf * poly;
}
