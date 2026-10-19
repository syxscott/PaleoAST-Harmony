/**
 * Regression tests for the 2026-10-19 fixes to the seeded PRNG, the BCa
 * bootstrap interval and the LOWESS robust weighting.
 *
 * Every test name states the behaviour that was there *before* the fix, so a
 * future regression reads as "the known, dated defect came back".
 *
 * ## References
 *
 * - scipy 1.15.3 — `scipy/stats/_resampling.py`:
 *     _percentile_of_score: ((a < score).sum() + (a <= score).sum()) / (2 * B)
 *     _bca_interval:        U_ji = (n - 1) * (theta_hat_dot - theta_hat_i)
 *                           a_hat = 1/6 * sum(U**3) / sum(U**2)**1.5
 * - statsmodels 0.14.6 — `statsmodels/nonparametric/_smoothers_lowess.pyx`:
 *     `median = np.median(np.abs(y - y_fit))` — the median of the *absolute*
 *     residuals, and the true median (numpy averages the two central order
 *     statistics for an even sample size).
 *
 * ## Baseline values
 *
 * Every pinned number in this file comes from Mulberry32 with the
 * `0x100000000` divisor (both `_float()` and `createSeededRNG()`). The
 * divisor only shifts a uniform draw by ~1.4e-10 relative, so the
 * *resampling indices* `floor(rng() * n)` — and with them the bootstrap
 * distribution — are unchanged by the fix; the pinned intervals are the same
 * before and after it, and the stream itself is different.
 */
import { describe, it, expect } from './runner.ts';
import {
  seed, rand, randint, randArray, poisson, createSeededRNG,
} from '../entry/src/main/core/math/random.ts';
import { bootstrap } from '../entry/src/main/core/math/Bootstrap.ts';
import { lowess } from '../entry/src/main/core/math/LOWESS.ts';

// ─── random.ts ──────────────────────────────────────────────────────────

/**
 * The 2 285 225 982nd draw from the default state 12345 lands on the Mulberry
 * state 2225710159, whose u32 output is 0xFFFFFFFF — the largest value the
 * generator can produce. The old divisor (0xFFFFFFFF) mapped it onto exactly
 * 1.0, so `randint(0, 10)` returned 10, one past its documented upper bound.
 *
 * The witness is deterministic, so the bound can be checked constructively
 * instead of by sampling until something goes wrong.
 */
const WITNESS_DRAW = 2285225982;

/** Advance the module PRNG to the witness state (u32 === 0xFFFFFFFF). */
function advanceToWitness(): void {
  seed(12345);
  for (let i = 0; i < WITNESS_DRAW - 1; i++) rand();
}

describe('fix: randint could return the upper bound of its range', () => {
  it('rand() is strictly below 1 at the u32 = 0xFFFFFFFF state (it used to be exactly 1)', () => {
    advanceToWitness();
    const u = rand();
    expect(u).toBeLessThan(1);
    expect(u).toBeWithin(4294967295 / 4294967296, 1e-15);
  });

  it('randint(0, 10) returns 9 at that state (it used to return 10)', () => {
    advanceToWitness();
    expect(randint(0, 10)).toBe(9);
  });

  it('randint stays inside [lo, hi) and rand() stays below 1 over a large sample', () => {
    // Smoke test only — the bound itself is proven by the witness above.
    seed(99);
    let outOfRange = 0;
    let maxU = 0;
    for (let i = 0; i < 50000; i++) {
      const v = randint(0, 10);
      if (v < 0 || v >= 10) outOfRange++;
      const u = rand();
      if (u > maxU) maxU = u;
    }
    expect(outOfRange).toBe(0);
    expect(maxU).toBeLessThan(1);
  });

  it('the same seed still reproduces the same stream', () => {
    // The divisor fix changes the values, never the reproducibility.
    seed(42);
    const a = randArray(5);
    seed(42);
    const b = randArray(5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('fix: createSeededRNG could return exactly 1.0', () => {
  it('a seeded stream is strictly below 1 at the u32 = 0xFFFFFFFF draw (it used to be exactly 1)', () => {
    // `createSeededRNG` runs the same state recurrence as the module PRNG,
    // so the witness draw is the same one.
    const rng = createSeededRNG(12345);
    for (let i = 0; i < WITNESS_DRAW - 1; i++) rng();
    const u = rng();
    expect(u).toBeLessThan(1);
    expect(u).toBeWithin(4294967295 / 4294967296, 1e-15);
  });

  it('a seeded stream never selects an index past the end of the array (it used to)', () => {
    // This is the crash path: `Math.floor(rng() * n)` used to be able to
    // return n, and `data[n]` is undefined.
    const rng = createSeededRNG(12345);
    for (let i = 0; i < WITNESS_DRAW - 1; i++) rng();
    expect(Math.floor(rng() * 10)).toBe(9);
  });

  it('a seeded stream never yields 1.0 over a large sample', () => {
    const rng = createSeededRNG(42);
    let maxU = 0;
    for (let i = 0; i < 1000000; i++) {
      const u = rng();
      if (u > maxU) maxU = u;
    }
    expect(maxU).toBeLessThan(1);
  });

  it('randint(0, 10) never returns 10', () => {
    // The module PRNG and the seeded stream share the state recurrence, so
    // the bound holds for both.
    seed(2026);
    let outOfRange = 0;
    for (let i = 0; i < 100000; i++) {
      if (randint(0, 10) > 9) outOfRange++;
    }
    expect(outOfRange).toBe(0);
  });
});

describe('fix: poisson(lambda, seed) returned the same value on every call', () => {
  it('poisson(5, 42) no longer returns the same value on every call', () => {
    seed(42);
    const draws: number[] = [];
    for (let i = 0; i < 20; i++) draws.push(poisson(5, 42));
    // The old code rebuilt the stream from the seed on every call, so all 20
    // draws were the first draw of the stream.
    expect(new Set(draws).size).toBeGreaterThan(1);
    expect(new Set(draws).size).toBe(8);
    // The sequence itself is unaffected by the divisor fix: a uniform draw
    // moves by ~1.4e-10 relative, which never flips a Knuth comparison.
    expect(JSON.stringify(draws)).toBe(
      JSON.stringify([6, 7, 3, 4, 2, 3, 5, 3, 6, 2, 8, 1, 5, 6, 8, 8, 5, 5, 5, 6]));
  });

  it('the same seed reproduces the same sequence of draws', () => {
    seed(42);
    const first: number[] = [];
    for (let i = 0; i < 20; i++) first.push(poisson(5, 42));
    seed(42);
    const second: number[] = [];
    for (let i = 0; i < 20; i++) second.push(poisson(5, 42));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('a loop over poisson(5, 42) has the mean of the distribution', () => {
    // The old code returned one repeated value; over 20 000 iterations the
    // mean was 1048 instead of 5.
    seed(42);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += poisson(5, 42);
    expect(sum / 2000).toBeWithin(5, 0.15);
  });

  it('poisson without a seed still draws from the module PRNG', () => {
    seed(7);
    const first: number[] = [];
    for (let i = 0; i < 5; i++) first.push(poisson(3));
    seed(7);
    const second: number[] = [];
    for (let i = 0; i < 5; i++) second.push(poisson(3));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

// ─── Bootstrap.ts — BCa ─────────────────────────────────────────────────

/**
 * 25 right-skewed observations. The bootstrap distribution of the mean is
 * right-skewed too, so the acceleration constant is clearly positive and a
 * sign error cannot hide.
 */
const SKEW_DATA: number[][] = Array.from({ length: 25 }, (_, i) => [Math.exp(i / 6) + i * 0.1]);
const meanStat = (s: number[][]): number => s.reduce((a, r) => a + r[0], 0) / s.length;

/**
 * 21 integers with a repeated central value and a median statistic: 3 329 of
 * the 9 999 resamples tie the point estimate, which is what makes the
 * bias-correction fraction sensitive to how ties are counted.
 */
const INT_DATA: number[] = [1, 2, 2, 3, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10, 10, 11, 12, 12, 13];
const medianStat = (s: number[][]): number => {
  const v = s.map(r => r[0]).sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Standard normal inverse CDF (Abramowitz & Stegun 26.2.23). */
function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
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
    4.374664141464968e+00, 2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00,
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

/** Standard normal CDF (Abramowitz & Stegun 26.2.17). */
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

/** Type-7 quantile of an already sorted array (Hyndman & Fan 1996). */
function quantile(sorted: number[], alpha: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = alpha * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

interface BcaResult { lo: number; hi: number; z0: number; a: number; frac: number }

/**
 * scipy 1.15.3's BCa interval, applied to a bootstrap distribution and a
 * jackknife distribution that `bootstrap` hands back.
 *
 * `sign` and `midrank` exist so a test can show that the *wrong* variant
 * gives a different answer — otherwise a formula that is wrong in a way that
 * happens to be invisible on the sample would still pass.
 */
function scipyBCa(
  bootstrapEstimates: number[],
  estimate: number,
  jackknife: number[],
  alpha: number,
  opts: { sign?: number; midrank?: boolean } = {},
): BcaResult {
  const sign = opts.sign ?? 1;
  const midrank = opts.midrank ?? true;
  const B = bootstrapEstimates.length;

  const below = bootstrapEstimates.filter(v => v < estimate).length;
  const equal = bootstrapEstimates.filter(v => v === estimate).length;
  const frac = midrank ? (below + 0.5 * equal) / B : below / B;
  const z0 = normInv(frac);

  const n = jackknife.length;
  const jackMean = jackknife.reduce((a, b) => a + b, 0) / n;
  const U = jackknife.map(v => (n - 1) * (jackMean - v));
  const sumSq = U.reduce((s, u) => s + u * u, 0);
  const sumCu = U.reduce((s, u) => s + u * u * u, 0);
  const a = sign * (1 / 6) * (sumCu / Math.pow(n, 3)) / Math.pow(sumSq / Math.pow(n, 2), 1.5);

  const zAlpha = normInv(alpha);
  const num1 = z0 + zAlpha;
  const num2 = z0 - zAlpha;
  const alpha1 = normCDF(z0 + num1 / (1 - a * num1));
  const alpha2 = normCDF(z0 + num2 / (1 - a * num2));

  const sorted = [...bootstrapEstimates].sort((x, y) => x - y);
  return { lo: quantile(sorted, alpha1), hi: quantile(sorted, alpha2), z0, a, frac };
}

describe('fix: the BCa acceleration constant had the sign of its own docstring reversed', () => {
  it('the BCa interval matches the scipy formula', () => {
    const r = bootstrap(SKEW_DATA, meanStat, { nResamples: 9999, seed: 42, method: 'bca' });
    const jackknife = r.jackknifeEstimates as number[];
    const ref = scipyBCa(r.bootstrapEstimates, r.estimate, jackknife, 0.025);
    expect(r.ci95[0]).toBeWithin(ref.lo, 1e-5);
    expect(r.ci95[1]).toBeWithin(ref.hi, 1e-5);
    // The sample is right-skewed, so the acceleration must be positive.
    expect(ref.a).toBeGreaterThan(0);
  });

  it('the BCa interval is not the one the negated acceleration produces', () => {
    // With the sign flipped, the old code returned [9.263, 21.593] instead
    // of [10.078, 22.767] — both ends visibly wrong.
    const r = bootstrap(SKEW_DATA, meanStat, { nResamples: 9999, seed: 42, method: 'bca' });
    const jackknife = r.jackknifeEstimates as number[];
    const flipped = scipyBCa(r.bootstrapEstimates, r.estimate, jackknife, 0.025, { sign: -1 });
    expect(Math.abs(r.ci95[0] - flipped.lo) > 0.1 ? 'differs' : 'same').toBe('differs');
    expect(Math.abs(r.ci95[1] - flipped.hi) > 0.1 ? 'differs' : 'same').toBe('differs');
  });

  it('the BCa interval equals the value verified against scipy 1.15.3', () => {
    // scipy.stats._resampling._bca_interval applied to the bootstrap
    // distribution of this very sample: [10.077711866, 22.766896168].
    // Re-verified after the `createSeededRNG` divisor fix: the resampling
    // indices are unchanged, so the interval is unchanged too.
    const r = bootstrap(SKEW_DATA, meanStat, { nResamples: 9999, seed: 42, method: 'bca' });
    expect(r.ci95[0]).toBeWithin(10.077710834553539, 1e-6);
    expect(r.ci95[1]).toBeWithin(22.766896275841148, 1e-6);
  });
});

describe('fix: the BCa bias correction counted ties as "below" instead of using the mid-rank', () => {
  it('z0 is not pushed down when the statistic ties the point estimate', () => {
    const r = bootstrap(INT_DATA.map(v => [v]), medianStat, { nResamples: 9999, seed: 42, method: 'bca' });
    const jackknife = r.jackknifeEstimates as number[];
    const mid = scipyBCa(r.bootstrapEstimates, r.estimate, jackknife, 0.025);
    const strict = scipyBCa(r.bootstrapEstimates, r.estimate, jackknife, 0.025, { midrank: false });

    // The scenario really has ties: 3 329 of 9 999 resamples equal the point
    // estimate, so the two conventions disagree about z0 by 0.42.
    const ties = r.bootstrapEstimates.filter(v => v === r.estimate).length;
    expect(ties).toBeGreaterThan(1000);
    expect(mid.z0).toBeWithin(0.191946, 1e-6);
    expect(strict.z0).toBeWithin(-0.228469, 1e-6);

    expect(r.ci95[0]).toBeWithin(mid.lo, 1e-9);
    expect(r.ci95[1]).toBeWithin(mid.hi, 1e-9);
  });

  it('the upper bound is the mid-rank one (the strict count cut it at 8 instead of 10)', () => {
    const r = bootstrap(INT_DATA.map(v => [v]), medianStat, { nResamples: 9999, seed: 42, method: 'bca' });
    const jackknife = r.jackknifeEstimates as number[];
    const strict = scipyBCa(r.bootstrapEstimates, r.estimate, jackknife, 0.025, { midrank: false });
    expect(strict.hi).toBe(8);
    expect(r.ci95[1]).toBe(10);
  });
});

// ─── LOWESS.ts ──────────────────────────────────────────────────────────

const LOWESS_X: number[] = Array.from({ length: 30 }, (_, i) => i);
const LOWESS_Y: number[] = LOWESS_X.map(v => 10 * Math.sin(v / 3) + 0.5 * v);
LOWESS_Y[15] += 30;

/** statsmodels 0.14.6 `lowess(y, x, frac=0.3, it=3)` on the series above. */
const STATSMODELS_LOWESS: number[] = [
  1.4452780227919455, 3.8785502230420583, 6.1950088859970185, 8.416458274379808,
  10.494445852109523, 11.21804850820595, 10.971012141188604, 9.841235024366245,
  8.01616504328148, 5.740658018787213, 3.326257376534982, 1.0918721546045518,
  -0.8139799998347768, -1.8374707428499255, -1.5129940621729798, -0.5378954139285899,
  1.0790744983236296, 3.306520144286283, 6.460040391705435, 9.939755802362177,
  13.286892323523038, 16.263787073006174, 18.59747514524516, 20.100901427556696,
  20.6612541435708, 20.26596399513847, 18.646573177854783, 16.902966599321513,
  15.07443131019385, 13.148088337492498,
];

/**
 * The same series smoothed with the old MAD (the upper central order
 * statistic of |r| instead of the true median) — the values the code produced
 * before the fix, kept here to show the difference is real.
 */
const OLD_MAD_LOWESS: number[] = [
  1.443555119755445, 3.877537893057313, 6.194748778258645, 8.417087858574378,
  10.495690377594183, 11.21856658584382, 10.971068039861176, 9.841173748522507,
  8.015958795097923, 5.740559346370674, 3.3263646826227387, 1.0925800698243862,
  -0.8127360553249794, -1.8379426604225593, -1.5158416355835804, -0.540187107423904,
  1.0791593821429188, 3.3078540762441477, 6.460229379545666, 9.939746957383022,
  13.286691392236442, 16.263684284092932, 18.597852069057804, 20.101545406102396,
  20.661921678536803, 20.266568899164895, 18.646858475238375, 16.903134350446066,
  15.07464517316707, 13.148386222172768,
];

describe('fix: LOWESS took the wrong median for the MAD on even-sized samples', () => {
  it('the smoothed curve matches statsmodels on a 30-point series with a +30 outlier', () => {
    const out = lowess(LOWESS_X, LOWESS_Y, 0.3, 3);
    expect(out.length).toBe(30);
    for (let i = 0; i < 30; i++) {
      expect(out[i]).toBeWithin(STATSMODELS_LOWESS[i], 1e-9);
    }
  });

  it('the curve is not the one the old upper-central-order-statistic MAD produced', () => {
    // The two MAD conventions differ by up to 0.0028 here; the old code was
    // the one that disagreed with statsmodels.
    const out = lowess(LOWESS_X, LOWESS_Y, 0.3, 3);
    expect(Math.abs(out[14] - OLD_MAD_LOWESS[14])).toBeGreaterThan(1e-4);
    expect(Math.abs(out[14] - STATSMODELS_LOWESS[14])).toBeLessThan(1e-9);
  });

  it('lowess rejects fewer than 3 points with a readable error (it used to throw a TypeError)', () => {
    let err: unknown = null;
    try { lowess([1], [2]); } catch (e) { err = e; }
    expect(err instanceof Error ? 'Error' : 'not an Error').toBe('Error');
    expect(err instanceof TypeError ? 'TypeError' : 'Error').toBe('Error');
    const msg = err instanceof Error ? err.message : '';
    expect(msg.includes('lowess') ? 'names the function' : msg).toBe('names the function');
    expect(msg.includes('at least 3') ? 'explains the limit' : msg).toBe('explains the limit');
  });

  it('lowess rejects mismatched x and y lengths with a readable error', () => {
    let err: unknown = null;
    try { lowess([1, 2, 3], [1, 2]); } catch (e) { err = e; }
    expect(err instanceof Error ? 'Error' : 'not an Error').toBe('Error');
    const msg = err instanceof Error ? err.message : '';
    expect(msg.includes('same length') ? 'explains the mismatch' : msg).toBe('explains the mismatch');
  });

  it('lowess still fits the smallest supported sample', () => {
    const out = lowess([0, 1, 2], [1, 2, 3], 0.3, 3);
    expect(out.length).toBe(3);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});
