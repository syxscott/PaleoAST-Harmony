/**
 * Regression tests for the macroevolution defects found in the 2026-10-19
 * audit.
 *
 * Every test name states the OLD behaviour that is being pinned down, so a
 * regression reads as "the old bug is back" rather than as a number that
 * moved. Expected values are either hand calculations (written out in the
 * comment) or recomputed inside the test from the returned parameters.
 */
import { describe, it, expect } from './runner.ts';
import {
  coxPH, logRankTest, fitOU, fitEarlyBurst, simulateFBD, extinctionCI,
  summarizeSurvival, kaplanMeier, testEquilibrium, evolutionRate,
  fbdLogLikelihood,
} from '../entry/src/main/core/analysis/macroevolution/index.ts';
import { parseNewick } from '../entry/src/main/core/analysis/phylogenetics/index.ts';

describe('macroevolution fixes 2026-10-19', () => {
  // ── fitEarlyBurst ────────────────────────────────────────────────────────

  it('fitEarlyBurst responds to the data instead of returning the first grid point', () => {
    // The old implementation built the diagonal of the covariance matrix
    // from `tips[i].distanceToAncestor(computeLCA(tips[i], tips[i]))`, and
    // the LCA of a tip with itself is the tip, so the diagonal was 0. The
    // Cholesky then failed and every parameter combination returned the
    // sentinel 1e10: {A:1,B:2,C:3}, {A:10,B:20,C:30} and {A:100,B:1,C:50}
    // all produced the bit-identical r = -2, sigma2 = 0.01, logLik = -1e10,
    // aic = 20000000004.
    const tree = parseNewick('((A:0.5,B:0.5):0.5,C:0.5);');
    const a = fitEarlyBurst(tree, { A: 1, B: 2, C: 3 });
    const b = fitEarlyBurst(tree, { A: 10, B: 20, C: 30 });
    const c = fitEarlyBurst(tree, { A: 100, B: 1, C: 50 });

    expect(isFinite(a.logLik)).toBe(true);
    expect(a.logLik > -1e9).toBe(true);
    expect(isFinite(a.sigma2)).toBe(true);
    expect(a.sigma2 > 0).toBe(true);
    expect(isFinite(a.r)).toBe(true);

    // different data -> a different fit
    expect(a.sigma2 !== c.sigma2).toBe(true);
    expect(a.r !== c.r).toBe(true);
    expect(a.logLik !== c.logLik).toBe(true);

    // a pure rescaling of the traits must scale sigma2 by 100 (the
    // covariance is proportional to sigma2, so the estimate has to follow)
    expect(b.sigma2 / a.sigma2).toBeWithin(100, 1e-4);
    expect(b.r / a.r).toBeWithin(1, 1e-6);
  });

  it('fitEarlyBurst reports the diffusion coefficient under an honest field name', () => {
    // The old `r0` field was documented as "initial rate r0" but held
    // sqrt(sigma2), the diffusion coefficient. It is now called `sigma`.
    const tree = parseNewick('((A:0.5,B:0.5):0.5,C:0.5);');
    const eb = fitEarlyBurst(tree, { A: 1, B: 2, C: 3 });
    expect(eb.sigma).toBeWithin(Math.sqrt(eb.sigma2), 1e-12);
    expect((eb as unknown as Record<string, unknown>)['r0']).toBeUndefined();
  });

  // ── fitOU ───────────────────────────────────────────────────────────────

  it('fitOU scales sigma2 with the trait scale instead of ignoring the diagonal', () => {
    // The old implementation kept the raw root-to-tip path on the diagonal
    // (a length) while the off-diagonal entries were variances, so sigma2
    // could not follow the trait scale: multiplying every trait by 10 left
    // sigma2 bit-for-bit unchanged (9.533363325644017e-7 ->
    // 9.533363325644017e-7) instead of scaling it by 100.
    const tree = parseNewick('((A:0.1,B:0.1):0.2,(C:0.1,D:0.2):0.3);');
    const a = fitOU(tree, { A: 1, B: 1.2, C: 2.4, D: 2.6 });
    const b = fitOU(tree, { A: 10, B: 12, C: 24, D: 26 });

    expect(isFinite(a.sigma2)).toBe(true);
    expect(a.sigma2 > 0).toBe(true);
    expect(isFinite(a.alpha)).toBe(true);
    expect(a.alpha > 0).toBe(true);

    // sigma2 scales with the square of the trait scale (1e-6 relative),
    // theta with the trait scale, and alpha is a rate: it must not move.
    expect(b.sigma2 / a.sigma2).toBeWithin(100, 1e-4);
    expect(b.theta / a.theta).toBeWithin(10, 1e-4);
    expect(b.alpha / a.alpha).toBeWithin(1, 1e-6);
  });

  // ── logRankTest ─────────────────────────────────────────────────────────

  it('logRankTest removes a censored observation from the risk set at its own time', () => {
    // The old implementation only walked the EVENT times, so the censored
    // observation at t = 0.5 stayed in the risk set until the next event
    // and the statistic came out as 0.16155 (p = 0.6877).
    //
    // Hand calculation with the standard convention (a subject censored at
    // t leaves the risk set right after t):
    //   t = 1: risk set 2 + 2, d = 2, d1 = 1
    //         O1 = 1,  E1 += 2*(2/4) = 1
    //         V  += 2*(1/2)(1/2)*(4-2)/(4-1) = 1/3
    //   t = 2: risk set 1 + 1, d = 1, d1 = 1
    //         O1 = 2,  E1 += 1*(1/2) = 0.5
    //         V  += 1*(1/2)(1/2)*(2-1)/(2-1) = 1/4
    //   t = 3: no event in group 1
    // => O1 = 2, E1 = 1.5, V = 7/12, chi2 = (2 - 1.5)^2 / (7/12) = 3/7
    const g1 = [{ time: 0.5, event: 0 }, { time: 1, event: 1 }, { time: 2, event: 1 }];
    const g2 = [{ time: 1, event: 1 }, { time: 3, event: 1 }];
    const r = logRankTest(g1, g2);
    expect(r.statistic).toBeWithin(3 / 7, 1e-12);
    expect(r.pValue).toBeWithin(0.5126907602619233, 1e-9);
    expect(r.df).toBe(1);
  });

  // ── coxPH ───────────────────────────────────────────────────────────────

  it('coxPH reports the Cox partial log-likelihood, not one inflated by censored rows', () => {
    // The old code added `events[i] * lp - log(riskSum)` for EVERY row, so
    // each censored observation removed a term it never contributed to:
    // logLik = -4.7616 and AIC = 11.523 for this fixture.
    //
    // The correct partial log-likelihood is
    //   logL = sum over EVENT rows of [ beta.x_i - log(sum_{j in R_i} e^{beta.x_j}) ]
    // with the covariates centred, which gives -3.633690845816824 and
    // AIC = 2*1 - 2*logL = 9.267381691633648.
    const dur = [5, 3, 6, 2, 4], ev = [1, 1, 0, 1, 0], x = [[1], [2], [3], [4], [5]];
    const r = coxPH(dur, ev, x);

    // recompute the partial log-likelihood independently from the fitted beta
    const beta = r.coefficients[0];
    const X = x.map(row => [row[0] - 3]);
    let expected = 0;
    for (let i = 0; i < dur.length; i++) {
      if (ev[i] !== 1) continue;
      const risk: number[] = [];
      for (let j = 0; j < dur.length; j++) if (dur[j] >= dur[i]) risk.push(j);
      let riskSum = 0;
      for (const j of risk) riskSum += Math.exp(beta * X[j][0]);
      expected += beta * X[i][0] - Math.log(riskSum);
    }
    expect(expected).toBeWithin(-3.633690845816824, 1e-9);
    expect(r.logLikelihood).toBeWithin(expected, 1e-9);
    expect(r.aic).toBeWithin(2 * 1 - 2 * expected, 1e-9);
  });

  it('coxPH reports standard errors instead of collapsing them to zero', () => {
    // The accumulated Hessian is the Hessian of the NEGATIVE log-likelihood
    // (-I); inverting it gave negative variances, and `sqrt(max(0, .))`
    // turned every standard error into 0 -> z = 0 and p = 1 for every
    // input, including this fit with beta = -0.1488.
    const r = coxPH([5, 3, 6, 2, 4], [1, 1, 0, 1, 0], [[1], [2], [3], [4], [5]]);
    expect(r.standardErrors[0]).toBeWithin(0.4540450094180605, 1e-9);
    expect(r.standardErrors[0] > 0).toBe(true);
    expect(r.zScores[0]).toBeWithin(-0.32779828666084704, 1e-9);
    expect(r.pValues[0]).toBeWithin(0.7430643196348445, 1e-9);
  });

  it('coxPH refuses to fit a data set that contains no event at all', () => {
    // The old code happily "fitted" an all-censored data set: logLik =
    // -1.7918, SE = 1, z = 0, p = 1 - the un-normalised augmented matrix
    // of a singular Hessian was returned as the inverse.
    expect(() => coxPH([5, 3, 6, 2, 4], [0, 0, 0, 0, 0], [[1], [2], [3], [4], [5]])).toThrow();
  });

  // ── simulateFBD ─────────────────────────────────────────────────────────

  it('simulateFBD builds the diversity curve from the birth/death events', () => {
    // The old expression mapped over the FILTERED event list (fossils
    // removed) but sliced the UNFILTERED one with the filtered index, so
    // every event after the first fossil was read at the wrong position.
    const fbd = simulateFBD(0.5, 0.2, 0.8, 5, 1, 1);

    // rebuild the curve from the lineages themselves
    const events: { time: number; delta: number }[] = [];
    for (const l of fbd.lineages) {
      if (l.birthTime > 0) events.push({ time: l.birthTime, delta: 1 });
      if (l.deathTime !== null) events.push({ time: l.deathTime, delta: -1 });
    }
    events.sort((a, b) => a.time - b.time);
    let alive = fbd.lineages.filter(l => l.birthTime === 0).length;
    const expected = events.map(e => { alive += e.delta; return alive; });

    expect(fbd.diversityCurve).toEqual(expected);
    expect(fbd.diversityCurve.length).toBe(events.length);
    // the seed-1 run has two births and no death
    expect(fbd.diversityCurve).toEqual([2, 3]);
  });

  it('simulateFBD is reproducible when no seed is given', () => {
    // The old signature took `randomSeed?: number` and only seeded the
    // PRNG when a seed was passed, so the controller's
    // `simulateFBD(lambda, mu, psi, dur)` call inherited whatever state
    // the module-level PRNG happened to be in: the same input gave a
    // different simulation on every run.
    const a = simulateFBD(0.5, 0.2, 0.8, 5, 1);
    const b = simulateFBD(0.5, 0.2, 0.8, 5, 1);
    expect(a.diversityCurve).toEqual(b.diversityCurve);
    expect(a.fossilCount).toBe(b.fossilCount);
    expect(a.extantSpecies).toBe(b.extantSpecies);
  });

  // ── extinctionCI ────────────────────────────────────────────────────────

  it('extinctionCI honours the requested confidence level', () => {
    // The old code hard-coded z = 1.96, so 0.90, 0.95 and 0.99 produced
    // bit-identical intervals.
    const a = extinctionCI(10, 5, 5, 1, 0.90);
    const b = extinctionCI(10, 5, 5, 1, 0.95);
    const c = extinctionCI(10, 5, 5, 1, 0.99);
    expect(a.ciLower).toBeGreaterThan(b.ciLower);
    expect(b.ciLower).toBeGreaterThan(c.ciLower);
    expect(a.ciUpper).toBeLessThan(b.ciUpper);
    expect(b.ciUpper).toBeLessThan(c.ciUpper);
    expect(b.ciLower).toBeWithin(0.11225223519705257, 1e-9);
    expect(b.ciUpper).toBeWithin(1.963802123677427, 1e-9);
  });

  it('extinctionCI no longer reports an upper limit of ~100 for a record without occurrences', () => {
    // The old code asked for the chi-square quantile with 0 degrees of
    // freedom (2*nOccurrences with nOccurrences = 0), which is not a
    // number: the bisection ran to its artificial bound of 1000 and the
    // reported upper limit was 99.99999995343. The Poisson upper limit
    // for 0 occurrences over 5 time units is chi2(0.975, 2)/2/5 = 0.7378.
    const r = extinctionCI(10, 5, 0, 1, 0.95, 'none');
    expect(r.ciUpper).toBeWithin(0.7377758908227876, 1e-9);
    expect(r.ciLower).toBe(0);
  });

  // ── summarizeSurvival / kaplanMeier ─────────────────────────────────────

  it('summarizeSurvival reports "median not reached" instead of throwing on a null median', () => {
    // `median !== undefined` is true for null, and kaplanMeier returns null
    // when the median is never reached - the most common case for a
    // censored curve. The old code called null.toFixed(2) and threw
    // "TypeError: Cannot read properties of null (reading 'toFixed')".
    const km = kaplanMeier([1, 2, 3], [0, 0, 0]);
    expect(km.medianSurvival).toBeNull();
    const text = summarizeSurvival(km.times, km.survivalProb, km.medianSurvival);
    expect(text).toContain('median not reached');
  });

  it('kaplanMeier returns the event flags in the same order as timesFull', () => {
    // The old version returned the event flags in INPUT order next to a
    // sorted timesFull: kaplanMeier([5,1,3],[0,1,1]) gave events = [0,1,1]
    // and timesFull = [1,3,5].
    const km = kaplanMeier([5, 1, 3], [0, 1, 1]);
    expect(km.timesFull).toEqual([1, 3, 5]);
    expect(km.events).toEqual([1, 1, 0]);
  });

  it('kaplanMeier returns arrays of equal length when every observation is censored', () => {
    // The old version returned times with one entry per observed time but
    // survivalProb (and the rest) with a single entry.
    const km = kaplanMeier([1, 2, 3], [0, 0, 0]);
    expect(km.times.length).toBe(3);
    expect(km.survivalProb.length).toBe(km.times.length);
    expect(km.stdError.length).toBe(km.times.length);
    expect(km.lowerCI.length).toBe(km.times.length);
    expect(km.upperCI.length).toBe(km.times.length);
    expect(km.nAtRisk.length).toBe(km.times.length);
    expect(km.nEvents.length).toBe(km.times.length);
    expect(km.survivalProb).toEqual([1, 1, 1]);
  });

  // ── testEquilibrium ─────────────────────────────────────────────────────

  it('testEquilibrium computes z and p even when the extinction rate is zero', () => {
    // The old early return for extinctionRate <= 0 threw away a perfectly
    // computable statistic: testEquilibrium(0.5, 0) reported z = 0 and
    // p = 0 instead of z = (0.5-0)/sqrt(0.25) = 1 and p = 0.3173.
    const r = testEquilibrium(0.5, 0);
    expect(r.zStatistic).toBeWithin(1, 1e-12);
    expect(r.pValue).toBeWithin(0.31731052766472745, 1e-9);
    // two identical rates must not be reported as a significant difference
    // (the normal CDF uses the Abramowitz-Stegun 7.1.26 approximation,
    // whose constant error is 1e-9, so p lands on 0.999999999)
    const zero = testEquilibrium(0, 0);
    expect(zero.pValue).toBeWithin(1, 1e-8);
    expect(zero.isEquilibrium).toBe(true);
  });

  // ── evolutionRate ───────────────────────────────────────────────────────

  it('evolutionRate reports no AIC for the models that have no likelihood', () => {
    // The old PIC and BM branches returned logLik = 0 and aic = 0, which a
    // model-comparison table reads as "a perfect fit".
    const tree = parseNewick('((A:0.1,B:0.1):0.2,(C:0.1,D:0.2):0.3);');
    const traits = { A: 1, B: 1.2, C: 2.4, D: 2.6 };
    expect(evolutionRate(tree, traits, 'pic').aic).toBeNull();
    expect(evolutionRate(tree, traits, 'pic').logLik).toBeNull();
    expect(evolutionRate(tree, traits, 'bm').aic).toBeNull();
    expect(evolutionRate(tree, traits, 'bm').logLik).toBeNull();
  });

  // ── fbdLogLikelihood ────────────────────────────────────────────────────

  it('fbdLogLikelihood conditions every branch on the child ages', () => {
    // The old version ignored the child ages completely (they were not even
    // part of the input), conditioned the three tip branches
    // inconsistently - dividing by (1 - E(t)) for fossils, multiplying by
    // (1 - E(t)) for internal nodes, doing neither for extant tips - and
    // added a global -(lambda+mu+psi)*age term on top of that.
    const base = {
      nodeAges: [10, 8, 6, 4, 2],
      isExtant: [true, false, true, false, false],
      isFossil: [false, true, false, true, false],
    };
    const withChildren = fbdLogLikelihood(0.5, 0.1, 0.2, {
      ...base, childAges: [[6, 4], [4, 2], [], [], []],
    }, 0.5);
    const withoutChildren = fbdLogLikelihood(0.5, 0.1, 0.2, base, 0.5);

    expect(isFinite(withChildren)).toBe(true);
    expect(isFinite(withoutChildren)).toBe(true);
    // the branch conditioning has to depend on the child ages
    expect(withChildren !== withoutChildren).toBe(true);
  });
});
