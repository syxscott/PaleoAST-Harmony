/**
 * Regression tests for the ecology defects found in the 2026-10-19 review.
 *
 * Per AGENTS.md and docs/code-style.md, every test name STATES THE OLD
 * BEHAVIOUR so a future reader can tell what was broken without git history.
 * Where a test states a "correct" value it comes from the definition of the
 * estimator (normal quantile, Hurlbert expectation, CA column principal
 * coordinates), never from a hand-tuned constant of the old implementation.
 */
import { describe, it, expect } from './runner.ts';

import {
  chao1ConfidenceInterval, coverageRarefaction, fitAbundanceModels, nullModel,
  paleoEnvironment, dtw, rarefaction, sheAnalysis,
} from '../entry/src/main/core/analysis/ecology/index.ts';
import { sqs } from '../entry/src/main/core/analysis/ecology/SQS.ts';

/** Chao1 = 16.25 on this sample; used by the confidence-interval tests. */
const ABUND = [5, 3, 3, 2, 2, 1, 1, 1, 1, 1];

/** Ordinary least squares of y on x (kept local so the test does not reuse the
 *  implementation it is checking). */
function ols(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

describe('fix: Chao1 confidence interval used a fake z multiplier', () => {
  it('no longer widens the 90% interval and narrows the 99% one', () => {
    // The old code scaled z95 by sqrt(cl/0.95): z = 1.908 at 90% (wider than
    // the true 90% interval) and z = 2.001 at 99% (narrower than the true
    // 99% interval). The correct multipliers are the normal quantiles
    // Φ⁻¹(0.95) = 1.6449 and Φ⁻¹(0.995) = 2.5758.
    const r90 = chao1ConfidenceInterval(ABUND, 0.90);
    expect(r90.chao1).toBeWithin(16.25, 1e-12);
    expect(r90.ciLower).toBeWithin(14.8221, 1e-3);
    expect(r90.ciUpper).toBeWithin(17.8154, 1e-3);

    const r95 = chao1ConfidenceInterval(ABUND, 0.95);
    expect(r95.ciLower).toBeWithin(14.5632, 1e-3);
    expect(r95.ciUpper).toBeWithin(18.1321, 1e-3);

    const r99 = chao1ConfidenceInterval(ABUND, 0.99);
    expect(r99.ciLower).toBeWithin(14.0703, 1e-3);
    expect(r99.ciUpper).toBeWithin(18.7674, 1e-3);
  });

  it('widens the interval monotonically with the confidence level', () => {
    const width = (cl: number): number => {
      const r = chao1ConfidenceInterval(ABUND, cl);
      return r.ciUpper - r.ciLower;
    };
    expect(width(0.90)).toBeLessThan(width(0.95));
    expect(width(0.95)).toBeLessThan(width(0.99));
  });

  it('scales the interval with the normal quantile, not with a confidence ratio', () => {
    // The log-half-width is z(cl)·sqrt(log(1 + var/ĉ²)) — the same factor for
    // every level, so log(K) / z must be constant.
    const logK = (cl: number): number => {
      const r = chao1ConfidenceInterval(ABUND, cl);
      return Math.log(r.ciUpper / r.chao1);
    };
    const z90 = 1.6448536269514722;  // Φ⁻¹(0.95)
    const z99 = 2.5758293035489004;  // Φ⁻¹(0.995)
    expect(logK(0.90) / z90).toBeWithin(logK(0.99) / z99, 1e-9);
  });

  it('rejects a confidence level outside (0, 1) instead of returning a garbage interval', () => {
    let msg = '';
    try { chao1ConfidenceInterval(ABUND, 1.5); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain('confidenceLevel');
  });
});

describe('fix: coverageRarefaction ignored nIterations entirely', () => {
  it('no longer returns bit-identical numbers for 1 and 1000 iterations', () => {
    // The old implementation drew ONE random sub-sample per (coverage, sample)
    // pair and then took the mean / percentiles ACROSS SAMPLES, so the number
    // of iterations had no effect whatsoever.
    const one = coverageRarefaction([ABUND], [0.5], 1);
    const many = coverageRarefaction([ABUND], [0.5], 1000);
    expect(one.expectedRichness[0] === many.expectedRichness[0]).toBe(false);
    expect(one.confidenceLower[0] === many.confidenceLower[0]).toBe(false);
    expect(one.confidenceUpper[0] === many.confidenceUpper[0]).toBe(false);
  });

  it('no longer gives a single sample a zero-width 95% CI', () => {
    const r = coverageRarefaction([ABUND], [0.5], 200);
    expect(r.confidenceUpper[0] - r.confidenceLower[0]).toBeGreaterThan(0);
    expect(r.confidenceLower[0]).toBeLessThan(r.expectedRichness[0]);
    expect(r.confidenceUpper[0]).toBeGreaterThan(r.expectedRichness[0]);
  });

  it('converges to the exact Hurlbert expectation instead of a single random draw', () => {
    // E[S(m)] = Σ_i [1 − C(N−n_i, m)/C(N, m)] with m = floor(0.5·20) = 10.
    const exact = rarefaction(ABUND, 10);
    expect(exact).toBeWithin(6.7995, 1e-3);
    const r = coverageRarefaction([ABUND], [0.5], 2000);
    expect(r.expectedRichness[0]).toBeWithin(exact, 0.1);
  });
});

describe('fix: the Log-Normal AIC was computed on a different scale', () => {
  it('computes the Preston residual against the octave COUNTS, not against their logs', () => {
    const data = [100, 40, 20, 8, 4, 2, 1, 1, 1, 1, 1, 1];
    const fits = fitAbundanceModels(data);
    const logNormal = fits.find(f => f.name === 'Log-Normal (Preston)');
    expect(logNormal === undefined).toBe(false);

    // Rebuild the fit independently: bin into log2 octaves, regress ln(S_R)
    // on R², then take the residual of the COUNT prediction against the
    // observed octave count.
    const sorted = [...data].sort((a, b) => b - a);
    const logAbund = sorted.map(v => Math.log2(v + 1));
    const maxOctave = Math.ceil(Math.max(...logAbund));
    const hist: number[] = new Array(maxOctave + 1).fill(0);
    for (const v of logAbund) hist[Math.min(Math.floor(v), maxOctave)]++;
    const rIdx: number[] = [], lnS: number[] = [];
    for (let r = 0; r < hist.length; r++) if (hist[r] > 0) { rIdx.push(r); lnS.push(Math.log(hist[r])); }
    const reg = ols(rIdx.map(r => r * r), lnS);
    const a = -reg.slope, S0 = Math.exp(reg.intercept);
    let ssRes = 0;
    for (let i = 0; i < rIdx.length; i++) {
      ssRes += (hist[rIdx[i]] - S0 * Math.exp(-a * rIdx[i] * rIdx[i])) ** 2;
    }
    const expectedAic = sorted.length * Math.log(ssRes / sorted.length + 1e-10) + 4;
    expect(logNormal!.aic).toBeWithin(expectedAic, 1e-6);
  });

  it('no longer wins the model ranking with the worst r² of all models', () => {
    // The old scale error gave the Log-Normal AIC 1.85 against the Log-Series
    // 6.92 although its r² (0.269) was the worst of the four models.
    const fits = fitAbundanceModels([100, 40, 20, 8, 4, 2, 1, 1, 1, 1, 1, 1]);
    const logNormal = fits.find(f => f.name === 'Log-Normal (Preston)')!;
    expect(fits[0].name).toBe('Log-Series');
    expect(logNormal.aic).toBeGreaterThan(fits[0].aic);
    expect(logNormal.rSquared).toBeLessThan(fits[0].rSquared);
  });
});

describe('fix: the two SQS methods defined the quorum differently', () => {
  const ONE_EVENT = [[10, 10, 10, 10]];
  const FOUR_EVENTS = [
    [10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10],
  ];

  it('no longer scales the random method\'s quorum with the number of events', () => {
    // The per-individual share was 1/N_i, so the shares summed to the NUMBER
    // OF EVENTS: quorum 0.5 consumed 50% of a one-event sample but only
    // 12.5% of a four-event sample of the same per-event size.
    const one = sqs(ONE_EVENT, [0.5], 1, { method: 'random' });
    const four = sqs(FOUR_EVENTS, [0.5], 1, { method: 'random' });
    expect(one.sampledFraction![0]).toBeWithin(0.5, 1e-9);
    expect(four.sampledFraction![0]).toBeWithin(0.5, 1e-9);
  });

  it('consumes the same fraction of the sample in both methods', () => {
    const occ = [[3, 2, 1, 1], [2, 3, 1, 1], [1, 2, 3, 1], [2, 1, 2, 2]];
    const random = sqs(occ, [0.5, 0.9], 2, { method: 'random' });
    const rarefaction = sqs(occ, [0.5, 0.9], 2, { method: 'rarefaction' });
    for (let i = 0; i < 2; i++) {
      expect(random.sampledFraction![i]).toBeWithin(rarefaction.sampledFraction![i], 0.05);
      expect(random.sampledFraction![i]).toBeWithin([0.5, 0.9][i], 0.05);
      expect(rarefaction.sampledFraction![i]).toBeWithin([0.5, 0.9][i], 0.05);
    }
  });

  it('no longer produces a NaN quorum level for a single point', () => {
    const r = sqs([[3, 2, 1, 1], [2, 3, 1, 1]], [0.3, 0.95], 1);
    expect(r.quorumLevels.length).toBe(1);
    expect(isNaN(r.quorumLevels[0])).toBe(false);
    expect(r.quorumLevels[0]).toBeWithin(0.3, 1e-12);
  });
});

describe('fix: paleoEnvironment returned the site scores as species scores', () => {
  it('no longer copies axis1Scores into columnSpeciesAxis', () => {
    const r = paleoEnvironment([[3, 1, 2], [2, 4, 1], [1, 2, 5], [5, 3, 1]], [1, 2, 3, 4]);
    // One score per SITE and one per SPECIES — the two can no longer be the
    // same array.
    expect(r.axis1Scores.length).toBe(4);
    expect(r.columnSpeciesAxis.length).toBe(3);
    const identical = r.columnSpeciesAxis.length === r.axis1Scores.length
      && r.columnSpeciesAxis.every((v, i) => v === r.axis1Scores[i]);
    expect(identical).toBe(false);
  });

  it('keeps the species scores on the same axis as the site scores', () => {
    // The CA column principal coordinates are v₁·√λ₁; the site scores are
    // Y·v₁. Both are projections onto the same eigenvector, so a positive
    // linear relation is expected.
    const r = paleoEnvironment([[3, 1, 2], [2, 4, 1], [1, 2, 5], [5, 3, 1]], [1, 2, 3, 4]);
    for (const v of r.columnSpeciesAxis) expect(isFinite(v)).toBe(true);
    expect(r.explainedInertia).toBeGreaterThan(0);
  });
});

describe('fix: nullModel degenerated on small presence matrices', () => {
  it('no longer answers "no structure" (p = 1) for every 3×3 matrix', () => {
    // With floor(3·3·0.1) = 0 swaps every "permuted" matrix WAS the observed
    // matrix, so std = 0 and p = 1 for any small table.
    const r = nullModel([[1, 1, 1], [1, 0, 0], [0, 1, 0]], 'c_score', 99, 42);
    expect(r.pValue).toBeLessThan(1);
    expect(r.stdSimulated).toBeGreaterThan(0);
    expect(new Set(r.simulatedScores).size).toBeGreaterThan(1);
  });

  it('fails loudly when the null distribution has no spread at all', () => {
    // Every one-swap neighbour of this perfectly symmetric table has the
    // same C-score, so std = 7.8e-16 and the old code reported a SES of
    // 4.3e13 — a number that would have gone straight into a paper.
    let msg = '';
    try { nullModel([[1, 1, 0], [1, 0, 1], [0, 1, 1]], 'c_score', 99, 42); }
    catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain('no spread');
  });

  it('rejects a presence matrix whose rows are all constant', () => {
    let msg = '';
    try { nullModel([[1, 1], [1, 1]], 'c_score', 99, 42); }
    catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain('constant');
  });
});

describe('fix: dtw fabricated a distance for an unreachable band', () => {
  it('no longer returns 100000 when the band cannot reach the end cell', () => {
    let msg = '';
    try { dtw([1, 2, 3], [1, 2, 3, 4, 5, 6], 1); }
    catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain('band');
  });

  it('still returns the real distance when no band is given', () => {
    expect(dtw([1, 2, 3], [1, 2, 3, 4, 5, 6]).distance).toBeWithin(3.7417, 1e-3);
  });
});

describe('fix: rarefaction returned NaN for a dominant species', () => {
  it('no longer returns NaN when the dominant species cannot be missed', () => {
    // N = 10, the dominant species has n_i = 8, so N − n_i = 2 < m = 5 and
    // the species is present in every sub-sample.
    const v = rarefaction([8, 1, 1], 5);
    expect(isNaN(v)).toBe(false);
    expect(v).toBeWithin(2, 1e-9);
  });
});

describe('fix: sheAnalysis used two sentinels for the same empty sample', () => {
  it('encodes an empty sample with one sentinel in all three arrays', () => {
    const r = sheAnalysis([[0, 0, 0], [1, 2, 3]]);
    expect(r.logS[0]).toBe(-999);
    expect(r.logH[0]).toBe(-999);
    expect(r.logE[0]).toBe(-999);
    expect(isFinite(r.logS[0])).toBe(true);
    // The populated sample keeps its real values.
    expect(r.logS[1]).toBeWithin(Math.log(3), 1e-12);
  });
});
