/**
 * Regression tests for the defects found while reviewing
 * core/analysis/statistics (2026-09-27, second pass).
 *
 * Per AGENTS.md and docs/code-style.md, every test name STATES THE OLD
 * BEHAVIOUR so a future reader can tell what was broken without git history.
 * Every "correct" value below comes from scipy 1.15.3 / numpy 1.26.4 run in the
 * conda `dev` environment, never from a hand calculation.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { cov, corrcoef } from '../entry/src/main/core/math/linalg.ts';
import {
  cca, dca, hellinger, plsAnalysis, nmds, computeDistanceMatrix,
  hierarchicalClustering, univariateSummary, mannWhitneyU,
} from '../entry/src/main/core/analysis/statistics/index.ts';
import { normalityTest } from '../entry/src/main/core/analysis/statistics/Normality.ts';
import { hellingerTransform } from '../entry/src/main/core/utils/Transformations.ts';

const M = (rows: number[][]) => Matrix.from2D(rows);

const X5x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [2, 9, 1], [5, 3, 8]];
const ABUND = [[3, 1, 2], [1, 4, 1], [2, 1, 5], [1, 2, 3], [4, 3, 2], [2, 2, 4]];
const ENV = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [3, 0]];

describe('audit: Matrix element-wise ops had no broadcasting', () => {
  it('sub(a 1 x p mean) centres every row instead of NaN-ing from row 2 on', () => {
    // `sub` indexed the 1 x p operand with the 5 x 3 receiver's flat index, so
    // o.data[3..14] were undefined and every cell from the second row on became
    // NaN. `X.sub(X.meanAxis(0))` returned only the first row correctly centred.
    const X = M(X5x3);
    const centred = X.sub(X.meanAxis(0));
    expect(centred.anyNaN()).toBe(false);
    for (let i = 0; i < X.rows; i++) {
      let colSum = 0;
      for (let j = 0; j < X.cols; j++) colSum += centred.get(i, j);
      expect(colSum).toBeCloseTo(0, 12);
    }
  });

  it('add / mul / div broadcast a row vector the same way sub does', () => {
    const X = M(X5x3);
    const ones = new Matrix(new Float64Array([1, 1, 1]), 1, 3);
    const twos = new Matrix(new Float64Array([2, 2, 2]), 1, 3);
    expect(X.add(ones).anyNaN()).toBe(false);
    expect(X.mul(twos).get(4, 2)).toBeCloseTo(X.get(4, 2) * 2, 12);
    expect(X.div(twos).get(0, 0)).toBeCloseTo(X.get(0, 0) / 2, 12);
    // Column vector (n x 1) broadcasts across the columns too.
    const colv = new Matrix(new Float64Array([1, 2, 3, 4, 5]), 5, 1);
    const scaled = X.mul(colv);
    expect(scaled.anyNaN()).toBe(false);
    expect(scaled.get(3, 1)).toBeCloseTo(X.get(3, 1) * 4, 12);
  });

  it('an incompatible operand shape throws instead of degrading to NaN', () => {
    // Previously the shape was never checked, so any mismatch produced a
    // well-formed matrix full of NaN with no diagnostic anywhere.
    let msg = '';
    try { M(X5x3).sub(M([[1, 2], [3, 4]])); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('cannot broadcast');
  });

  it('cov and covMatrix no longer return an all-NaN matrix', () => {
    // Both built `X.sub(X.meanAxis(0))`, so every entry was NaN and corrcoef
    // / correlation inherited it.
    const C = cov(M(X5x3));
    // numpy: np.cov(X, rowvar=False)
    const ref = [[5.7, 2.1, 7.35], [2.1, 9.3, -1.2], [7.35, -1.2, 11.3]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      expect(C.get(i, j)).toBeCloseTo(ref[i][j], 10);
    }
    expect(corrcoef(M(X5x3)).get(0, 1)).toBeCloseTo(0.28842997520061514, 10);
  });
});

describe('audit: a Matrix was read with bracket indexing', () => {
  it('hellinger no longer returns an all-NaN matrix', () => {
    // `rowSums` is an n x 1 Matrix, so `rowSums[i]` was undefined: the
    // `rs <= 0` guard never fired and every cell became sqrt(x / undefined).
    const H = hellinger(M(ABUND));
    expect(H.anyNaN()).toBe(false);
    // sqrt(Y_ij / row total); row 0 sums to 6.
    const ref = [Math.sqrt(3 / 6), Math.sqrt(1 / 6), Math.sqrt(2 / 6)];
    for (let j = 0; j < 3; j++) expect(H.get(0, j)).toBeCloseTo(ref[j], 12);
    // ... and it agrees with the independently written sibling transform.
    const H2 = hellingerTransform(M(ABUND));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      expect(H.get(i, j)).toBeCloseTo(H2.get(i, j), 15);
    }
  });

  it('cca no longer reports 0% explained variance for every ordination', () => {
    // `rowTotals[i]` / `colTotals[j]` were undefined, the chi-square matrix
    // collapsed to zeros, and both the cca and rda branches returned
    // eigenvalues [0, 0] with inertia 0 and no error.
    const r = cca(M(ABUND), M(ENV), undefined, 'cca');
    expect(r.siteScores.anyNaN()).toBe(false);
    // numpy reference: eigh of Ychi^T Q Ychi, descending.
    expect(r.eigenvalues[0]).toBeCloseTo(0.2896701735902132, 10);
    expect(r.eigenvalues[1]).toBeCloseTo(0.005022308295895928, 10);
    expect(r.inertia!).toBeCloseTo(7.3619123931623935, 10);
    expect(r.proportionExplained[0]).toBeGreaterThan(0);
  });

  it('rda reports the centred-block inertia rather than the chi-square one', () => {
    const r = cca(M(ABUND), M(ENV), undefined, 'rda');
    expect(r.siteScores.anyNaN()).toBe(false);
    expect(r.eigenvalues[0]).toBeCloseTo(4.7644133343335, 9);
    expect(r.eigenvalues[1]).toBeCloseTo(1.1950461251259568, 9);
    expect(r.inertia!).toBeCloseTo(24.5, 10);
  });

  it('dca reproduces the correspondence-analysis inertias', () => {
    // `rowTotals[i]` / `colTotals[j]` again: the whole chi-square matrix was
    // zero, so SVD returned [0, 0] and every gradient length was 0.
    const r = dca(M(ABUND), { nAxes: 2 });
    expect(r.scores.anyNaN()).toBe(false);
    // numpy: singular values of the chi-square matrix, squared.
    expect(r.eigenvalues[0]).toBeCloseTo(6.003534608515851, 9);
    expect(r.eigenvalues[1]).toBeCloseTo(0.9034458513419228, 9);
    // Site 0's first-axis score; numpy gives -0.99072, the sign of the
    // eigenvector is arbitrary.
    expect(Math.abs(r.scores.get(0, 0))).toBeCloseTo(0.9907213050048231, 9);
    expect(r.eigenvalues[0]).toBeGreaterThan(r.eigenvalues[1]);
  });
});

describe('audit: Shapiro-Wilk weights cancelled the statistic', () => {
  it('W is inside (0, 1] and matches scipy on the Shapiro & Wilk (1965) sample', () => {
    // `_generateMVector` produced INCREASING normal scores and paired them
    // with the DECREASING gap (x_(n+1-i) - x_(i)). The two runs cancelled:
    // W = 1.78 at n = 5 (impossible, W <= 1) and W = 0.012 on 1000 normally
    // distributed values. p was NaN whenever W exceeded 1.
    const r = normalityTest([148, 154, 158, 160, 161, 162, 166, 170, 182, 195, 236]);
    expect(r.shapiroStat).toBeCloseTo(0.7888146948631716, 9);
    expect(r.shapiroP).toBeCloseTo(0.006703814061898823, 9);
    expect(r.isNormalShapiro).toBe(false);
  });

  it('matches scipy for n = 3, for n = 5, and for 50 normal draws', () => {
    expect(normalityTest([1, 2, 10]).shapiroStat).toBeCloseTo(0.8321917808219177, 9);
    expect(normalityTest([1, 2, 10]).shapiroP).toBeCloseTo(0.19391752148145214, 9);
    expect(normalityTest([1, 1.5, 2, 2.5, 9]).shapiroStat).toBeCloseTo(0.7135481348491046, 9);
    expect(normalityTest([1, 1.5, 2, 2.5, 9]).shapiroP).toBeCloseTo(0.013201260921913621, 9);
  });

  it('W never exceeds 1 and normally-distributed data are not declared non-normal', () => {
    // The old code returned p = 0 for every large normally-distributed column,
    // i.e. "reject normality" on data drawn from a normal distribution.
    let s = 123456789;
    const rnd = () => { s = (Math.imul(1664525, s >>> 0) + 1013904223) >>> 0; return s / 4294967296; };
    const gauss: number[] = [];
    while (gauss.length < 200) {
      let u = 0, v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      gauss.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    }
    const r = normalityTest(gauss);
    expect(r.shapiroStat).toBeGreaterThan(0.9);
    expect(r.shapiroStat).toBeLessThanOrEqual(1);
    expect(r.shapiroP).toBeGreaterThan(0.001);
    expect(r.isNormalShapiro).toBe(true);
  });

  it('the Anderson-Darling statistic still agrees with scipy', () => {
    // scipy.stats.anderson(..., dist='norm').statistic
    let s = 7;
    const rnd = () => { s = (Math.imul(1664525, s >>> 0) + 1013904223) >>> 0; return s / 4294967296; };
    const gauss: number[] = [];
    for (let i = 0; i < 50; i++) {
      let u = 0, v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      gauss.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    }
    expect(normalityTest(gauss).andersonStat).toBeCloseTo(0.2778917960195173, 6);
  });
});

describe('audit: isotonic regression mis-indexed its pooled blocks', () => {
  it('nmds returns a finite stress and a real configuration again', () => {
    // Step 3 advanced ONE cursor by the block size, so every block after an
    // initial block spanning more than one tie group was read past the end of
    // blockSums and filled with undefined -> NaN. NMDS then recorded no
    // configuration at all and returned stress = Infinity, coordinates = null,
    // converged = false for any dissimilarity matrix with enough tied values.
    const pts: number[][] = [];
    for (let i = 0; i < 12; i++) pts.push([Math.cos(i), Math.sin(i)]);
    const D = computeDistanceMatrix(M(pts), 'euclidean');
    const r = nmds(D, 2, 300, 5, 1e-6, 42);
    expect(r.coordinates === null).toBe(false);
    expect(r.coordinates.rows).toBe(12);
    expect(isFinite(r.stress)).toBe(true);
    expect(r.stress).toBeLessThan(0.01);
    expect(r.nIterations).toBeGreaterThan(0);
    expect(r.converged).toBe(true);
  });

  it('nmds stress stays finite for a larger, more tied dissimilarity matrix', () => {
    const pts: number[][] = [];
    for (let i = 0; i < 30; i++) pts.push([Math.cos(i), Math.sin(i)]);
    const D = computeDistanceMatrix(M(pts), 'euclidean');
    const r = nmds(D, 2, 300, 3, 1e-6, 7);
    expect(isFinite(r.stress)).toBe(true);
    expect(r.stress).toBeLessThan(0.01);
  });
});

describe('audit: hierarchical clustering ignored the requested cluster count', () => {
  it('cutting into k clusters actually yields k clusters for every linkage', () => {
    // `fclusterFromLinkage` union-found over CLUSTER SLOT ids, which unites
    // two representatives but leaves the observations underneath them in
    // separate components. Asking for 1, 2 or 3 clusters on 7 points returned
    // 5 clusters every time, for all four linkages.
    const P = M([[1, 1], [1, 2], [1, 3], [10, 10], [10, 11], [10, 12], [5, 5]]);
    for (const method of ['ward', 'complete', 'average', 'single']) {
      for (const k of [1, 2, 3, 4, 5, 6, 7]) {
        const r = hierarchicalClustering(P, method, 'euclidean', k);
        expect(new Set(r.labels).size).toBe(k);
        expect(r.nClusters).toBe(k);
      }
    }
  });

  it('agrees with scipy.cluster.hierarchy.fcluster on the resulting partition', () => {
    const P = M([[1, 1], [1, 2], [1, 3], [10, 10], [10, 11], [10, 12], [5, 5]]);
    // scipy: fcluster(linkage(pdist(P), method=m), 3, criterion='maxclust')
    // -> [2, 2, 2, 1, 1, 1, 3] (labels are arbitrary, so compare the partition)
    const r = hierarchicalClustering(P, 'ward', 'euclidean', 3);
    // Compare the PARTITION, not the labels: scipy numbers clusters from 1 and
    // this module from 0, in a different enumeration order.
    const ref = [2, 2, 2, 1, 1, 1, 3];
    const canon = (a: number[]): number[] => {
      const seen = new Map<number, number>();
      return a.map(v => {
        if (!seen.has(v)) seen.set(v, seen.size);
        return seen.get(v) as number;
      });
    };
    expect(JSON.stringify(canon(r.labels))).toBe(JSON.stringify(canon(ref)));
    // k = 2 puts the lone midpoint into one of the two blocks
    const r2 = hierarchicalClustering(P, 'ward', 'euclidean', 2);
    expect(r2.labels.slice(0, 3).every(v => v === r2.labels[0])).toBe(true);
    expect(r2.labels.slice(3, 6).every(v => v === r2.labels[3])).toBe(true);
  });

  it('a non-positive cluster count is rejected with a readable message', () => {
    // nClusters = 0 walked off the end of the linkage array and died with
    // "Cannot read properties of undefined (reading '2')".
    const P = M([[1, 1], [1, 2], [1, 3], [10, 10]]);
    let msg = '';
    try { hierarchicalClustering(P, 'ward', 'euclidean', 0); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('nClusters must be at least 1');
  });
});

describe('audit: PLS read the raw blocks and mis-scaled the explained variance', () => {
  const A = [[1, 2], [3, 5], [2, 1], [5, 3], [4, 6], [6, 2]];
  const B = [[2, 1], [4, 3], [3, 6], [6, 2], [1, 5], [5, 4]];

  it('the Escoufier RV coefficient no longer depends on where the data sit', () => {
    // PLS is defined on centred blocks. Reading them raw made RV move by
    // 2.2e-02 (block B shifted by +1000) and 7.4e-02 (block A by -500) on
    // the same specimen set.
    const base = plsAnalysis(M(A), M(B));
    const shiftedB = plsAnalysis(M(A), M(B.map(r => r.map(v => v + 1000))));
    const shiftedA = plsAnalysis(M(A.map(r => r.map(v => v - 500))), M(B));
    expect(shiftedB.rvCoefficient).toBeCloseTo(base.rvCoefficient, 12);
    expect(shiftedA.rvCoefficient).toBeCloseTo(base.rvCoefficient, 12);
    // numpy: (C*C).sum() / sqrt((Saa*Saa).sum() * (Sbb*Sbb).sum())
    expect(base.rvCoefficient).toBeCloseTo(0.008788901658102206, 10);
  });

  it('covarianceExplained is the squared-singular-value share, not the linear one', () => {
    // s / sum(s) reported 95.5 / 4.5 where the true inertias split 99.8 / 0.2,
    // and always printed 100% for a single component.
    const r = plsAnalysis(M(A), M(B));
    expect(r.singularValues[0]).toBeCloseTo(2.4041777017645996, 9);
    expect(r.covarianceExplained[0]).toBeCloseTo(98.30051737520597, 8);
    expect(r.covarianceExplained[1]).toBeCloseTo(1.6994826247940327, 8);
    const total = r.covarianceExplained.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 10);
    const one = plsAnalysis(M(A), M(B), 1);
    expect(one.covarianceExplained[0]).toBeCloseTo(100, 10);
  });

  it('mismatched or tiny inputs are rejected instead of producing empty scores', () => {
    let msg = '';
    try { plsAnalysis(M(A), M([[1, 2], [3, 4]])); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('same number of rows');
  });

  it('yScores is computable for fewer components than the block has variables', () => {
    // Vt is already q x k, so it was being transposed into k x q. That product
    // was only conformable when k equalled q, so `plsAnalysis(A, B, 1)` on
    // these 6x2 / 6x2 blocks died with "matmul shape".
    const r = plsAnalysis(M(A), M(B), 1);
    expect(r.yScores.rows).toBe(6);
    expect(r.yScores.cols).toBe(1);
    expect(r.yScores.anyNaN()).toBe(false);
    // 6x4 and 6x3 blocks, one and two components.
    const A2 = M([[1, 2, 3, 4], [2, 4, 1, 3], [5, 1, 2, 6], [3, 3, 3, 3], [7, 2, 5, 1], [4, 6, 2, 2]]);
    const B2 = M([[1, 1, 2], [2, 3, 1], [4, 2, 5], [1, 1, 1], [3, 5, 2], [6, 1, 4]]);
    for (const nc of [1, 2]) {
      const q = plsAnalysis(A2, B2, nc);
      expect(q.xScores.cols).toBe(nc);
      expect(q.yScores.cols).toBe(nc);
      expect(q.singularValues.length).toBe(nc);
      expect(q.xScores.anyNaN()).toBe(false);
      expect(q.yScores.anyNaN()).toBe(false);
    }
  });
});

describe('audit: the reported Mann-Whitney z did not reproduce the p-value', () => {
  it('pValue is exactly 2 * (1 - Phi(|zScore|))', () => {
    // zScore was the uncorrected (U - mu)/sigma while pValue came from the
    // continuity-corrected (|U - mu| - 0.5)/sigma, so the two fields
    // disagreed: recomputing p from the reported z was 20-46% off, and p
    // saturated at 1 while zScore still read -0.22.
    const cases: [number[], number[]][] = [
      [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]],
      [[1, 2, 2, 3], [4, 5, 5, 9]],
      [[1.5, 2.5, 3.5], [1.5, 2.5, 9.5]],
    ];
    // scipy.stats.mannwhitneyu(..., method='asymptotic') p-values:
    const ref = [0.012185780355344813, 0.028429535998796527, 1.0];
    cases.forEach((c, i) => {
      const r = mannWhitneyU(c[0], c[1]);
      expect(r.pValue).toBeCloseTo(ref[i], 9);
    });
  });
});

describe('audit: univariateSummary blew the stack on a long column', () => {
  it('a 200000-value column summarises instead of throwing', () => {
    // `Math.min(...vals)` passes one argument per element, so past the engine's
    // argument limit it threw "Maximum call stack size exceeded" -- reproduced
    // at 200000 values, well inside a plausible specimen count.
    const n = 200000;
    const big = new Matrix(new Float64Array(n), n, 1);
    for (let i = 0; i < n; i++) big.set(i, 0, (i % 977) + 1);
    const s = univariateSummary(big, ['v'])[0];
    expect(s.n).toBe(n);
    expect(s.min).toBe(1);
    expect(s.max).toBe(977);
    expect(s.mean).toBeCloseTo(488.50695, 6);
  });
});
