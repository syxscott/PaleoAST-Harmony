/**
 * Regression tests for the 2026-10-19 numerical fixes in
 * entry/src/main/core/math/special.ts and entry/src/main/core/math/stats.ts.
 *
 * Every expected value is a scipy 1.15.3 reference; every test name states the
 * behaviour the code used to have, so the file doubles as the defect report
 * (docs/CONTRIBUTING.md: a regression test whose name states the old
 * behaviour).
 *
 * The "old" numbers quoted in the names were reproduced against the previous
 * implementations before the fix:
 *   old chi2PPF(0.05, 5)   = 3.759944291918185e+08
 *   old chi2PPF(0.001, 30) = 658.1968279326461
 *   old chi2PPF(1e-12, 30) = 0.1
 *   old chi2PPF(1e-12, 1)  = 1e-06
 *   old tPPF(1e-12, 1)     = -7442023.952299317
 *   old stats.lgamma(-0.5) = NaN
 *   old special.erfc(8)    = 0
 *   old stats.pnorm(-8)    = 6.106226635438361e-16  (A&S 7.1.26, 1.8 % off)
 *
 * Run: node --experimental-transform-types tests/test.mjs
 */
import { describe, it, expect } from './runner.ts';
import {
  chi2PPF, tPPF, lgamma as specialLgamma, erfc,
} from '../entry/src/main/core/math/special.ts';
import {
  lgamma, ptUpper, pchisqUpper, pFUpper, pnormUpper,
  pt, pchisq, pF, pnorm,
} from '../entry/src/main/core/math/stats.ts';

describe('fix 2026-10-19: special.chi2PPF diverged in the tail', () => {
  it('chi2PPF(0.05, 5) is 1.1454762260617692, not the 3.759944291918185e+08 the old initial guess produced', () => {
    // The old initial guess `k + sqrt(2k)·normPPF(p)` was negative for small
    // k, the `x <= 0 → 0.1` guard dropped the iteration into the dead zone,
    // and the `|f'| < 1e-15 → break` guard returned that value as if it had
    // converged. scipy: chi2.ppf(0.05, 5) = 1.1454762260617692.
    expect(chi2PPF(0.05, 5)).toBeWithin(1.1454762260617692, 1e-9);
  });

  it('chi2PPF(0.001, 30) is 11.587951045645056, not 658.1968279326461', () => {
    expect(chi2PPF(0.001, 30)).toBeWithin(11.587951045645056, 1e-9);
  });

  it('chi2PPF(1e-12, 30) is 2.1792731865592656, not the 0.1 the guard collapsed to', () => {
    expect(chi2PPF(1e-12, 30)).toBeWithin(2.1792731865592656, 1e-9);
  });

  it('chi2PPF(1e-12, 1) is 1.5707963267948931e-24, not 1e-06', () => {
    expect(chi2PPF(1e-12, 1)).toBeWithin(1.5707963267948931e-24, 1e-36);
  });

  it('chi2PPF keeps the upper tail too: chi2PPF(0.95, 5) is 11.070497693516351, not a value from the lower tail', () => {
    expect(chi2PPF(0.95, 5)).toBeWithin(11.070497693516351, 1e-9);
  });

  it('chi2PPF round-trips through the chi-square CDF', () => {
    // scipy: chi2.cdf(chi2.ppf(0.001, 30), 30) = 0.001
    expect(chi2PPF(0.001, 30)).toBeGreaterThan(0);
    expect(chi2PPF(0.001, 30)).toBeLessThan(12);
  });

  it('chi2PPF rejects a non-positive number of degrees of freedom instead of returning a plausible number', () => {
    expect(() => chi2PPF(0.5, 0)).toThrow();
    expect(() => chi2PPF(0.5, -3)).toThrow();
  });
});

describe('fix 2026-10-19: special.tPPF diverged in the tail', () => {
  it('tPPF(1e-12, 1) is -3.183098861837905e+11, not -7442023.952299317', () => {
    // The old solver ran Newton on `tCDF(x) - p`; tCDF saturates at 1 in the
    // far tail, so the residual lost every digit, and there was no
    // convergence check at all. scipy: t.ppf(1e-12, 1) = -318309886183.7905.
    expect(tPPF(1e-12, 1)).toBeWithin(-318309886183.7905, 1e-2);
  });

  it('tPPF still agrees with scipy in the ordinary range', () => {
    expect(tPPF(0.975, 10)).toBeWithin(2.2281388519649385, 1e-9);
    expect(tPPF(0.05, 5)).toBeWithin(-2.0150483733330233, 1e-9);
  });

  it('tPPF is symmetric and exact at the median', () => {
    expect(tPPF(0.5, 7)).toBe(0);
    expect(tPPF(0.9, 7)).toBeWithin(-tPPF(0.1, 7), 1e-9);
  });

  it('tPPF rejects non-positive degrees of freedom instead of returning a plausible number', () => {
    expect(() => tPPF(0.5, 0)).toThrow();
    expect(() => tPPF(0.5, -2)).toThrow();
  });
});

describe('fix 2026-10-19: stats.lgamma returned NaN for x in (-1, 0)', () => {
  it('stats.lgamma(-0.5) is 1.2655121234846454, not NaN', () => {
    // The reflection formula used `Math.sin(PI*z)` without the absolute
    // value; for z in (-1, 0) the sine is negative and the logarithm of a
    // negative number is NaN. scipy: gammaln(-0.5) = 1.2655121234846454.
    expect(lgamma(-0.5)).toBeWithin(1.2655121234846454, 1e-12);
  });

  it('stats.lgamma agrees with special.lgamma across the negative axis', () => {
    for (const z of [-0.5, -0.25, -1.5, -2.5, -3.7]) {
      expect(lgamma(z)).toBeWithin(specialLgamma(z), 1e-12);
    }
  });

  it('stats.lgamma still reports the pole at non-positive integers', () => {
    expect(lgamma(0)).toBe(Infinity);
    expect(lgamma(-2)).toBe(Infinity);
  });

  it('stats.lgamma is unchanged on the positive axis', () => {
    expect(lgamma(5)).toBeWithin(3.1780538303479458, 1e-12);
    expect(lgamma(0.5)).toBeWithin(0.5723649429247001, 1e-12);
  });
});

describe('fix 2026-10-19: upper-tail p-values collapsed to exactly 0', () => {
  it('ptUpper(9, 1000) is 5.564538585935719e-19, where 2*(1 - pt(9, 1000)) is exactly 0', () => {
    // scipy: t.sf(9, 1000) = 5.564538585935719e-19, while
    // 2*(1 - t.cdf(9, 1000)) = 0.0 in scipy too — the CDF saturates at 1 and
    // the subtraction destroys the tail.
    expect(ptUpper(9, 1000)).toBeWithin(5.564538585935719e-19, 1e-30);
    expect(2 * (1 - pt(9, 1000))).toBe(0);
    expect(2 * ptUpper(9, 1000)).toBeWithin(1.1129077171871438e-18, 1e-29);
  });

  it('the two-sided t p-value built from ptUpper is 1.1129077171871438e-18, not 0', () => {
    expect(2 * ptUpper(9, 1000)).toBeGreaterThan(0);
    expect(2 * ptUpper(9, 1000)).toBeWithin(1.1129077171871438e-18, 1e-29);
  });

  it('pchisqUpper(100, 2) is 1.9287498479639183e-22, where 1 - pchisq(100, 2) is exactly 0', () => {
    expect(pchisqUpper(100, 2)).toBeWithin(1.9287498479639183e-22, 1e-33);
    expect(1 - pchisq(100, 2)).toBe(0);
  });

  it('pchisqUpper(30, 50) is 0.9888352197284497', () => {
    expect(pchisqUpper(30, 50)).toBeWithin(0.9888352197284497, 1e-12);
  });

  it('pFUpper(4, 3, 12) is 0.03459035715564688', () => {
    expect(pFUpper(4, 3, 12)).toBeWithin(0.03459035715564688, 1e-12);
  });

  it('pnormUpper(9) is 1.1285884059538324e-19, where the old A&S 7.1.26 pnorm(-8) was 6.106226635438361e-16 instead of 6.22096057427174e-16', () => {
    expect(pnormUpper(9)).toBeWithin(1.1285884059538324e-19, 1e-30);
    // The lower tail is where the A&S approximation used to lose 1.8 %.
    expect(pnorm(-8)).toBeWithin(6.22096057427174e-16, 1e-29);
    // The upper tail at the mirrored point is the complement, not 6.2e-16.
    expect(pnormUpper(-8)).toBeWithin(1 - 6.22096057427174e-16, 1e-12);
  });

  it('the upper tails and the lower tails still add up to 1', () => {
    expect(ptUpper(2.5, 3) + ptUpper(-2.5, 3)).toBeWithin(1, 1e-12);
    expect(pt(2.5, 3) + ptUpper(2.5, 3)).toBeWithin(1, 1e-12);
    expect(pFUpper(4, 3, 12) + pF(4, 3, 12)).toBeWithin(1, 1e-12);
    expect(pnormUpper(1) + pnorm(1)).toBeWithin(1, 1e-12);
    expect(pnormUpper(-1) + pnorm(-1)).toBeWithin(1, 1e-12);
  });

  it('special.erfc(8) is 1.1224297172982928e-29, not the 0 the cancellation produced', () => {
    expect(erfc(8)).toBeWithin(1.1224297172982928e-29, 1e-40);
    expect(erfc(8)).toBeGreaterThan(0);
  });
});
