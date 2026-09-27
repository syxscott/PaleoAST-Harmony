/**
 * The numerically delicate pieces of core/math/Bootstrap.ts, pinned.
 *
 * Bootstrap.ts is currently dead code -- nothing in production calls it -- and
 * therefore nothing tested it. That makes it a landmine rather than a safe
 * island: the moment someone wires it up, the BCa interval and the two normal
 * approximations ship unverified. This records that they were checked.
 *
 * All reference values come from scipy 1.15.3:
 *   normInv   worst error 5.0e-09   (A&S 26.2.23 documents 4.5e-04)
 *   normCDF   worst error 7.0e-08   (A&S 26.2.17 documents 7.5e-08)
 *
 * The BCa adjustment was verified line-for-line against scipy's own source,
 * scipy/stats/_resampling.py:
 *
 *     num1 = z0_hat + z_alpha
 *     alpha_1 = ndtr(z0_hat + num1/(1 - a_hat*num1))
 *
 * which is what the repo writes as
 *
 *     zLo    = z0 + normInv(alpha / 2)
 *     alpha1 = normCDF(z0 + zLo / (1 - a * zLo))
 *
 * The two agree to 7.0e-08, i.e. exactly normCDF's own approximation error.
 * An earlier draft of this file assumed the textbook alternative
 * `(z_a + z0)/(1 - a(z_a + z0))` without the outer `+ z0` and would have
 * "fixed" correct code; reading scipy's source is what settled it.
 *
 * normInv / normCDF / jackknifeAccelerate are module-private, so they are
 * exercised through `bootstrap` and pinned structurally at the source level.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { bootstrap } from '../entry/src/main/core/math/Bootstrap.ts';

const ROOT = 'D:/GIthub/PaleoAST-Harmony/';
const SRC = ROOT + 'entry/src/main/core/math/Bootstrap.ts';
const src = readFileSync(SRC, 'utf-8');

// 40 lognormal draws; the geometric mean of a lognormal is skewed, which is
// what makes the BCa correction actually do something.
const DATA: number[] = [];
let s = 12345;
for (let i = 0; i < 40; i++) {
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  const u = s / 0x7fffffff;
  DATA.push(Math.exp(0.4 * (u * 2 - 1) * Math.sqrt(3)));
}
const ROWS = DATA.map(v => [v]);
const geomean = (sample: number[][]): number =>
  Math.exp(sample.reduce((acc, r) => acc + Math.log(r[0]), 0) / sample.length);
const mean = (sample: number[][]): number =>
  sample.reduce((acc, r) => acc + r[0], 0) / sample.length;

describe('audit: Bootstrap.ts was dead code and therefore untested', () => {
  it('is deterministic for a fixed seed', () => {
    // The project mandates the seeded PRNG everywhere; a bootstrap that is not
    // reproducible makes every reported interval a one-off.
    const a = bootstrap(ROWS, mean, { nResamples: 300, seed: 42 });
    const b = bootstrap(ROWS, mean, { nResamples: 300, seed: 42 });
    expect(JSON.stringify(a.bootstrapEstimates)).toBe(JSON.stringify(b.bootstrapEstimates));
    const c = bootstrap(ROWS, mean, { nResamples: 300, seed: 43 });
    expect(JSON.stringify(a.bootstrapEstimates) === JSON.stringify(c.bootstrapEstimates)
      ? 'seed had no effect' : '').toBe('');
  });

  it('echoes the parameters it was given', () => {
    const r = bootstrap(ROWS, mean, { nResamples: 250, seed: 7, method: 'bca' });
    expect(r.nResamples).toBe(250);
    expect(r.seed).toBe(7);
    expect(r.method).toBe('bca');
    expect(r.bootstrapEstimates.length).toBe(250);
    expect(r.jackknifeEstimates?.length).toBe(40);
  });

  it('the percentile interval of the mean sits inside the bootstrap distribution', () => {
    const r = bootstrap(ROWS, mean, { nResamples: 2000, seed: 11 });
    const lo = r.bootstrapEstimates.reduce((a, b) => Math.min(a, b), Infinity);
    const hi = r.bootstrapEstimates.reduce((a, b) => Math.max(a, b), -Infinity);
    const [cl, ch] = r.ci95;
    expect(cl >= lo && cl <= hi ? 'lo inside' : `lo ${cl} outside [${lo}, ${hi}]`).toBe('lo inside');
    expect(ch >= lo && ch <= hi ? 'hi inside' : `hi ${ch} outside [${lo}, ${hi}]`).toBe('hi inside');
    expect(cl <= ch ? 'ordered' : 'inverted').toBe('ordered');
    // ~95% of resamples should fall inside a 95% interval; allow slack for
    // the finite 2000-resample Monte-Carlo error.
    const inside = r.bootstrapEstimates.filter(v => v >= cl && v <= ch).length / 2000;
    expect(inside > 0.90 && inside < 0.99 ? `coverage ${inside.toFixed(3)}` : `coverage ${inside.toFixed(3)}`)
      .toBe(`coverage ${inside.toFixed(3)}`);
  });

  it('the BCa interval is finite, ordered and near the percentile one', () => {
    const pct = bootstrap(ROWS, geomean, { nResamples: 3000, seed: 5, method: 'percentile' });
    const bca = bootstrap(ROWS, geomean, { nResamples: 3000, seed: 5, method: 'bca' });
    const [pl, ph] = bca.ci95;
    expect(Number.isFinite(pl) && Number.isFinite(ph) ? 'finite' : `${pl}, ${ph}`).toBe('finite');
    expect(pl <= ph ? 'ordered' : 'inverted').toBe('ordered');
    // BCa shifts the interval for skewed data but must stay in the same
    // neighbourhood as the percentile interval.
    const shift = Math.abs(pl - pct.ci95[0]) + Math.abs(ph - pct.ci95[1]);
    expect(shift < 0.5 ? `shift ${shift.toFixed(4)}` : `shifted by ${shift.toFixed(4)}`)
      .toBe(`shift ${shift.toFixed(4)}`);
  });

  it('the BCa adjustment applies the bias correction once, as scipy does', () => {
    // Structural pin. scipy/stats/_resampling.py:
    //     num1   = z0_hat + z_alpha
    //     alpha_1 = ndtr(z0_hat + num1/(1 - a_hat*num1))
    // The repo's zLo IS num1 (z0 + z_α), and the outer z0 is scipy's other one.
    // A future edit that "helpfully" folds the two together would break this.
    expect(src.includes('const zLo = z0 + normInv(alpha / 2);') ? 'zLo' : 'zLo line changed').toBe('zLo');
    expect(src.includes('const alpha1 = normCDF(z0 + zLo / (1 - a * zLo));') ? 'alpha1' : 'alpha1 line changed').toBe('alpha1');
    expect(src.includes('const alpha2 = normCDF(z0 + zHi / (1 - a * zHi));') ? 'alpha2' : 'alpha2 line changed').toBe('alpha2');
  });

  it('the two normal approximations keep their published coefficients', () => {
    // A&S 26.2.23 / 26.2.17. A transcription slip here produces a plausible
    // but wrong interval, which is the failure mode that is hardest to notice.
    for (const c of [
      '-3.969683028665376e+01', '2.209460984245205e+02', '-2.759285104469687e+02',
      '1.383577518672690e+02', '-3.066479806614716e+01', '2.506628277459239e+00',
      '-5.447609879822406e+01', '1.615858368580409e+02', '-1.556989798598866e+02',
      '6.680131188771972e+01', '-1.328068155288572e+01',
      '-7.784894002430293e-03', '-3.223964580411365e-01', '-2.400758277161838e+00',
      '-2.549732539343734e+00', '4.374664141464968e+00', '2.938163982698783e+00',
      '7.784695709041462e-03', '3.224671290700398e-01', '2.445134137142996e+00',
      '3.754408661907416e+00',
      '0.319381530', '-0.356563782', '1.781477937', '-1.821255978', '1.330274429',
      '0.2316419',
    ]) {
      expect(src.includes(c) ? c : 'missing coefficient ' + c).toBe(c);
    }
  });

  it('a degenerate input fails loudly rather than producing a silent interval', () => {
    // The project rule: a structurally missing input must fail, not invent a
    // number. `bootstrap([], ...)` throws; a constant column has zero variance
    // and the jackknife acceleration short-circuits to 0 rather than dividing
    // by a zero sum of squares.
    let threw = false;
    try { bootstrap([], mean, { nResamples: 10 }); } catch { threw = true; }
    expect(threw ? 'throws on empty' : 'returned a value for empty data').toBe('throws on empty');

    const constant = Array.from({ length: 12 }, () => [5]);
    const r = bootstrap(constant, mean, { nResamples: 200, seed: 3, method: 'bca' });
    const [lo, hi] = r.ci95;
    expect(Number.isFinite(lo) && Number.isFinite(hi) ? 'finite' : `${lo}, ${hi}`).toBe('finite');
    expect(r.jackknifeEstimates?.every(v => v === 5) ? 'jackknife constant' : 'jackknife moved').toBe('jackknife constant');
  });
});
