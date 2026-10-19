/**
 * Regression tests for the defects found while reviewing
 * core/analysis/statistics on 2026-10-19.
 *
 * Per AGENTS.md and docs/code-style.md, every test name STATES THE OLD
 * BEHAVIOUR so a future reader can tell what was broken without git history.
 * Every "correct" value comes from scipy 1.15.3 / numpy 2.2.6 in the conda
 * `dev` environment, or from an algebraic identity the fix has to satisfy.
 *
 * Assertion style: `toBeWithin(expected, absDelta)` for absolute tolerances;
 * `toBeCloseTo(expected, numDigits)` means "numDigits DECIMAL PLACES" (Jest
 * semantics) since the 2026-10-19 fix to tests/runner.ts.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import {
  tTest, anova, kruskalWallis, mannWhitneyU, permanova, simper,
  plsAnalysis, nmds, anosim, phylogeneticSignal, phyloANOVA, lda,
  minimumSpanningTree, computeDistanceMatrix, hierarchicalClustering,
  type PCAResult, type PERMANOVAResult,
} from '../entry/src/main/core/analysis/statistics/statistics.ts';
import { normalityTest } from '../entry/src/main/core/analysis/statistics/Normality.ts';
import { ripleyK } from '../entry/src/main/core/analysis/statistics/Spatial.ts';
import { pt, qt, pnorm, pnormUpper, ptUpper } from '../entry/src/main/core/math/stats.ts';
import { parseNewick } from '../entry/src/main/core/analysis/phylogenetics/phylogenetics.ts';

const M = (rows: number[][]) => Matrix.from2D(rows);

/** Message of the error `fn` throws ('' when it throws nothing). */
function errorMessage(fn: () => void): string {
  try { fn(); } catch (e) { return (e as Error).message; }
  return '';
}

/** A tree with three well-separated pairs, plus a small trait set. */
function tree() {
  return parseNewick('((A:1,B:1):1,(C:1,D:1):1,(E:1,F:1):1);');
}

describe('fix2026: the t / F / chi-square quantiles inverted their own CDFs', () => {
  it('a quantile still inverts its CDF after the rewrite', () => {
    // pt(qt(p, df), df) must return p. The old `qt` ran out of iterations
    // and silently returned the last iterate.
    expect(pt(qt(0.975, 10), 10)).toBeWithin(0.975, 1e-9);
    expect(pt(qt(0.05, 30), 30)).toBeWithin(0.05, 1e-9);
  });

  it('pt reports the t-distribution CDF, not the normal one', () => {
    // 1.959963985 is the NORMAL 0.975 quantile; with df = 10 the t
    // distribution has heavier tails, so P(T <= 1.96) is 0.9608, NOT 0.975.
    // The old expectation of 0.975 only survived because the runner treated
    // the tolerance as an absolute 6.
    expect(pt(1.959963985, 10)).toBeWithin(0.9607795354229467, 1e-12);
  });

  it('the upper tail is evaluated directly instead of as 1 - CDF', () => {
    // With df = 1000 and t = 9 the true p is 1.11e-18. `2 * (1 - pt(...))`
    // cancels to exactly 0 there, which is what used to reach the paper.
    const p = 2 * (1 - pt(9, 1000));
    expect(p).toBe(0);
    expect(2 * ptUpper(9, 1000)).toBeWithin(1.1129077171871438e-18, 1e-30);
  });

  it('the normal upper tail is not the complement of the normal CDF', () => {
    expect(pnorm(-8)).toBeWithin(6.220960574271834e-16, 1e-24);
    expect(pnormUpper(-8)).toBeWithin(1 - 6.220960574271834e-16, 1e-15);
  });
});

describe('fix2026: six permutation tests seeded themselves only when asked to', () => {
  it('the same input gives the same p value twice (no seed was passed)', () => {
    const D = M([[1, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6], [5, 6, 7], [6, 7, 8]]);
    const groups = [0, 0, 0, 1, 1, 1];
    // The old signature was `rngSeed?: number` and the body only seeded when
    // it was not undefined, so the global PRNG state leaked in: the same
    // analysis gave a different p on every click.
    const a = permanova(D, groups, 99);
    const b = permanova(D, groups, 99);
    expect(a.pValue).toBe(b.pValue);
    expect(a.fStatistic).toBe(b.fStatistic);
  });

  it('ANOSIM is reproducible too', () => {
    const D = M([[1, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6], [5, 6, 7], [6, 7, 8]]);
    const groups = [0, 0, 0, 1, 1, 1];
    expect(anosim(D, groups, 99).pValue).toBe(anosim(D, groups, 99).pValue);
  });

  it('NMDS is reproducible (the shuffling is now seeded)', () => {
    const D = M([[1, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6], [5, 6, 7], [6, 7, 8]]);
    const a = nmds(D, 2, 50);
    const b = nmds(D, 2, 50);
    expect(a.stress).toBe(b.stress);
  });

  it('the phylogenetic signal p value no longer jumps across 0.05', () => {
    const t = tree();
    const traits = { A: 1, B: 2, C: 5, D: 6, E: 9, F: 10 };
    const p1 = phylogeneticSignal(t, traits, 199).pValue;
    const p2 = phylogeneticSignal(t, traits, 199).pValue;
    expect(p1).toBe(p2);
  });

  it('LDA cross-validation is reproducible (the fold shuffle is now seeded)', () => {
    const X = M([[1, 2], [2, 1], [3, 4], [4, 3], [5, 6], [6, 5], [7, 8], [8, 7]]);
    const y = [0, 0, 0, 0, 1, 1, 1, 1];
    const a = lda(X, y, undefined, undefined, 4, 5);
    const b = lda(X, y, undefined, undefined, 4, 5);
    expect(a.accuracy).toBe(b.accuracy);
  });
});

describe('fix2026: PERMANOVA reported sums of squares on a different scale from its F', () => {
  it('ssBetween / ssWithin follow the Anderson (2001) / adonis2 convention', () => {
    // The Python original (stats/permanova.py::_compute_F_statistic) uses,
    // and cross-validates against vegan::adonis2:
    //     SS_T = (1/n)   * sum_{i<j}   d2_ij
    //     SS_W = sum_g (1/n_g) * sum_{i<j in g} d2_ij
    //   upper triangle: 1,4,1,4,1,4,1,4,1,1 -> sum 22 ; SS_T = 22/5 = 4.4
    //   group {0,1,2}: 1+4+1 = 6   -> 6/3 = 2
    //   group {3,4}:   1          -> 1/2 = 0.5
    //   SS_W = 2.5, SS_B = 4.4 - 2.5 = 1.9
    const D = M([[0, 1, 2, 1, 2], [1, 0, 1, 2, 1], [2, 1, 0, 1, 2], [1, 2, 1, 0, 1], [2, 1, 2, 1, 0]]);
    const r = permanova(D, [0, 0, 0, 1, 1], 0) as PERMANOVAResult;
    expect(r.ssBetween).toBeWithin(1.9, 1e-9);
    expect(r.ssWithin).toBeWithin(2.5, 1e-9);
  });

  it('the reported F is derivable from the reported sums of squares', () => {
    // The old code reported the group term with a 1/(2*n_g) divisor (half of
    // the original) while computing F from the original's values, so the F
    // printed next to the sums could not be recomputed from them.
    const D = M([[0, 1, 2, 1, 2], [1, 0, 1, 2, 1], [2, 1, 0, 1, 2], [1, 2, 1, 0, 1], [2, 1, 2, 1, 0]]);
    const r = permanova(D, [0, 0, 0, 1, 1], 0) as PERMANOVAResult;
    const fromSS = (r.ssBetween / r.dfBetween) / (r.ssWithin / r.dfWithin);
    expect(r.fStatistic).toBeWithin(fromSS, 1e-9);
    expect(r.fStatistic).toBeWithin(2.28, 1e-9);
  });

  it('the F on the 6-specimen reference dataset is the value the Python original gives', () => {
    // tests/models2026.test.ts pins 193.6545 for this dataset; the Python
    // original's formula reproduces it exactly (and is cross-validated
    // against vegan::adonis2 there).
    const X = M([[1, 10, 5], [2, 20, 6], [1.5, 15, 5.5], [9, 90, 1], [8, 80, 1.2], [9.5, 95, 0.8]]);
    const D = computeDistanceMatrix(X, 'euclidean');
    const r = permanova(D, [0, 0, 0, 1, 1, 1], 99, 42) as PERMANOVAResult;
    expect(r.fStatistic).toBeWithin(193.6545, 1e-3);
  });
});

describe('fix2026: plsAnalysis read the raw blocks and mis-scaled the explained variance', () => {
  const A = [[1, 2], [3, 5], [2, 1], [5, 3], [4, 6], [6, 2]];
  const B = [[2, 1], [4, 3], [3, 6], [6, 2], [1, 5], [5, 4]];

  it('the Escoufier RV coefficient matches the numpy reference', () => {
    // numpy: (C*C).sum() / sqrt((Saa*Saa).sum() * (Sbb*Sbb).sum())
    const r = plsAnalysis(M(A), M(B));
    expect(r.rvCoefficient).toBeWithin(0.008788901658102206, 1e-9);
  });

  it('the RV coefficient no longer depends on where the data sit', () => {
    // The old implementation read the RAW blocks, so shifting block B by
    // +1000 moved RV by 2.2e-2 on the very same specimen set.
    const base = plsAnalysis(M(A), M(B)).rvCoefficient;
    const shiftedB = plsAnalysis(M(A), M(B.map((row) => row.map((v) => v + 1000)))).rvCoefficient;
    const shiftedA = plsAnalysis(M(A.map((row) => row.map((v) => v - 500))), M(B)).rvCoefficient;
    expect(shiftedB).toBeWithin(base, 1e-9);
    expect(shiftedA).toBeWithin(base, 1e-9);
  });

  it('covarianceExplained is the squared-singular-value share', () => {
    // s / sum(s) reported 95.5 / 4.5 where the true inertias split 99.8 / 0.2.
    const r = plsAnalysis(M(A), M(B));
    expect(r.covarianceExplained[0]).toBeWithin(98.30051737520597, 1e-8);
    expect(r.covarianceExplained[1]).toBeWithin(1.6994826247940327, 1e-8);
    const total = r.covarianceExplained.reduce((s, v) => s + v, 0);
    expect(total).toBeWithin(100, 1e-8);
    // A one-component fit reports the first axis' share of the WHOLE
    // spectrum, not 100% of the kept part.
    const one = plsAnalysis(M(A), M(B), 1);
    expect(one.covarianceExplained[0]).toBeWithin(98.30051737520597, 1e-8);
  });

  it('yScores is still computable for fewer components than the block has variables', () => {
    // Vt is q x k, so it was being transposed into k x q and the product was
    // only conformable when k equalled q.
    const r = plsAnalysis(M(A), M(B), 1);
    expect(r.yScores.rows).toBe(6);
    expect(r.yScores.anyNaN()).toBe(false);
  });
});

describe('fix2026: a degenerate group was answered with "no significant difference"', () => {
  it('tTest rejects a group with a single observation', () => {
    // n1 = 1 made the variance 0/0, so t became 0 and p became 1 -- the
    // analysis reported "no significant difference" for data it could not
    // analyse at all.
    const msg = errorMessage(() => { tTest([5], [9]); });
    expect(msg).toContain('at least 2 observations');
  });

  it('mannWhitneyU rejects an empty or one-element group', () => {
    // The old code reported uStatistic 0, pValue 0 ("highly significant")
    // and zScore -500000 for an empty group.
    expect(errorMessage(() => { mannWhitneyU([], [1, 2, 3]); })).toContain('at least 2 observations');
    expect(errorMessage(() => { mannWhitneyU([1], [1, 2, 3]); })).toContain('at least 2 observations');
  });

  it('kruskalWallis rejects an empty group instead of returning NaN', () => {
    const msg = errorMessage(() => { kruskalWallis([[1, 2, 3], []]); });
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.includes('NaN')).toBe(false);
  });

  it('the permutation tests reject a group vector with fewer than two groups', () => {
    const D = M([[1, 2, 3], [2, 3, 4], [3, 4, 5]]);
    expect(errorMessage(() => { permanova(D, [0, 0, 0], 9); })).toContain('at least 2 distinct groups');
  });
});

describe('fix2026: minimumSpanningTree read a 2-point coordinate matrix as a distance matrix', () => {
  it('a square matrix that is not a distance matrix is treated as coordinates', () => {
    // 2 points x 2 dimensions: the old `rows === cols` test accepted it as a
    // distance matrix, so the total length came out 0 instead of sqrt(2).
    const asMatrix = minimumSpanningTree(M([[0, 0], [1, 1]]));
    expect(asMatrix.totalWeight).toBeWithin(Math.SQRT2, 1e-12);
  });

  it('a genuine square distance matrix still works', () => {
    const asDistance = minimumSpanningTree(M([[0, Math.SQRT2], [Math.SQRT2, 0]]));
    expect(asDistance.totalWeight).toBeWithin(Math.SQRT2, 1e-12);
  });
});

describe('fix2026: ripleyK produced undefined envelopes and NaN axes for degenerate parameters', () => {
  it('a single radius is rejected instead of dividing by zero', () => {
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2]];
    const msg = errorMessage(() => { ripleyK(pts, undefined, 1, 5); });
    expect(msg.length).toBeGreaterThan(0);
  });

  it('zero simulations is rejected instead of yielding undefined envelopes', () => {
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2]];
    const msg = errorMessage(() => { ripleyK(pts, undefined, 50, 0); });
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('fix2026: the Anderson-Darling statistic and its critical values did not match scipy', () => {
  it('the AD statistic agrees with scipy on a normal sample', () => {
    // scipy.stats.anderson(..., dist='norm').statistic on THIS sample.
    // (The value 0.2778917960195173 that used to be asserted here was
    // computed on a different sample; scipy on the values below gives
    // 0.2180047214032399.)
    let s = 7;
    const rnd = () => { s = (Math.imul(1664525, s >>> 0) + 1013904223) >>> 0; return s / 4294967296; };
    const gauss: number[] = [];
    for (let i = 0; i < 50; i++) {
      let u = 0, v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      gauss.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    }
    expect(normalityTest(gauss).andersonStat).toBeWithin(0.2180047214032399, 1e-9);
  });

  it('the critical values follow the sample size', () => {
    // The old critMap was a FIXED table and the verdict always compared
    // against critMap[5] = 0.752, whatever n was. scipy/R use the
    // N-dependent Stephens (1974) values A / (1 + 4/N - 25/N^2) with
    // A = 0.787 for the 5% level:
    //   n = 12 -> 0.787 / (1 + 4/12 - 25/144) = 0.6786
    //   n =  5 -> 0.787 / (1 + 4/5  - 25/25 ) = 0.9838
    const small = normalityTest([1, 2, 3, 4, 5]);
    const mid = normalityTest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(mid.andersonCritical[5]).toBeWithin(0.6786, 1e-3);
    expect(small.andersonCritical[5]).toBeWithin(0.9838, 1e-3);
    // The two must NOT be the same constant any more.
    expect(Math.abs(mid.andersonCritical[5] - small.andersonCritical[5])).toBeGreaterThan(0.05);
  });

  it('a constant sample is refused rather than reported as normal', () => {
    // Shapiro-Wilk already refused a zero-range sample; the AD statistic
    // must not be computed from a sample with no variation at all.
    const msg = errorMessage(() => { normalityTest([5, 5, 5, 5, 5]); });
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('fix2026: the distance metrics and the clustering guards still hold', () => {
  it('the supported metrics are all present and an unknown one throws', () => {
    const D = M([[0, 1, 2], [1, 0, 1], [2, 1, 0]]);
    for (const m of ['euclidean', 'cityblock', 'chebyshev', 'correlation', 'bray_curtis', 'canberra', 'cosine']) {
      const out = computeDistanceMatrix(D, m);
      expect(out.rows).toBe(3);
      expect(out.cols).toBe(3);
    }
    // An unknown metric used to fall back to the euclidean silently.
    const msg = errorMessage(() => { computeDistanceMatrix(D, 'not-a-metric' as never); });
    expect(msg.length).toBeGreaterThan(0);
  });

  it('a non-positive cluster count is rejected with a readable message', () => {
    const P = M([[1, 1], [1, 2], [1, 3], [10, 10]]);
    expect(errorMessage(() => { hierarchicalClustering(P, 'ward', 'euclidean', 0); }))
      .toContain('nClusters must be at least 1');
  });

  it('SIMPER still reports the Bray-Curtis dissimilarity it is asked for', () => {
    const data = M([[1, 2, 3], [2, 3, 4], [3, 4, 5], [10, 11, 12], [11, 12, 13], [12, 13, 14]]);
    const groups = [0, 0, 0, 1, 1, 1];
    const r = simper(data, groups);
    expect(r.overallDissimilarity).toBeGreaterThan(0);
  });
});
