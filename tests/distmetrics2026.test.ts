/**
 * Distance-metric regression tests.
 *
 * Found by a cross-cutting review: `computeDistanceMatrix` declared nine metrics
 * in its `Metric` type but only implemented seven of them correctly. Two
 * silently returned the Euclidean matrix, so a PCoA / NMDS / ANOSIM / PERMANOVA
 * run produced a well-formed ordination of the WRONG geometry with no error.
 */
import { describe, it, expect } from './runner.ts';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { computeDistanceMatrix, pcoa, nmds } from '../entry/src/main/core/analysis/statistics/index.ts';

// dx = 3, dy = 4, so euclidean = 5 and chebyshev = 4: any confusion between
// them is immediately visible.
const P = Matrix.from2D([[1, 2], [4, 6], [7, 8], [2, 9]]);

describe('audit: distance metrics silently fell back to euclidean', () => {
  it("chebyshev no longer returns the euclidean matrix (the case was misspelled 'chebychev')", () => {
    const E = computeDistanceMatrix(P, 'euclidean');
    const C = computeDistanceMatrix(P, 'chebyshev');
    // Reference: Chebyshev is max_k |x_ik - x_jk|, so 4 for the 3-4 pair.
    expect(C.get(0, 1)).toBeCloseTo(4, 12);
    // The two matrices must differ somewhere in general (the Assertion helper
    // has no negated matcher, so compare the absolute gap directly).
    let differsSomewhere = false;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (Math.abs(C.get(i, j) - E.get(i, j)) > 1e-12) differsSomewhere = true;
    }
    expect(differsSomewhere).toBe(true);
  });

  it("correlation no longer returns the euclidean matrix (it had no case at all)", () => {
    const E = computeDistanceMatrix(P, 'euclidean');
    const Co = computeDistanceMatrix(P, 'correlation');
    let differs = false;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (Math.abs(Co.get(i, j) - E.get(i, j)) > 1e-12) differs = true;
    }
    expect(differs).toBe(true);
    // Points 0 = (1,2) and 1 = (4,6) are perfectly positively correlated, so
    // the correlation distance 1 - r must be exactly 0, not 5.
    expect(Co.get(0, 1)).toBeCloseTo(0, 12);
  });

  it('an unknown or misspelled metric now throws instead of returning some matrix', () => {
    // The silent `default` branch is what hid both defects: a typo produced a
    // perfectly well-formed distance matrix of the wrong kind.
    for (const bad of ['chebychev', 'euclidian', 'mnahattan', 'typo']) {
      expect(() => computeDistanceMatrix(P, bad as never)).toThrow();
    }
  });

  it('every metric in the union type has a case and produces a symmetric zero-diagonal matrix', () => {
    const metrics = ['euclidean', 'bray_curtis', 'cosine', 'jaccard', 'canberra',
      'cityblock', 'correlation', 'hamming', 'chebyshev'];
    for (const m of metrics) {
      const D = computeDistanceMatrix(P, m as never);
      expect(D.get(0, 0)).toBe(0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        expect(D.get(i, j)).toBeCloseTo(D.get(j, i), 12);
        expect(isFinite(D.get(i, j))).toBe(true);
        expect(D.get(i, j)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('jaccard is the Jaccard dissimilarity on presence/absence data (matches scipy.spatial)', () => {
    // Pinned because the implementation computes a mismatched-proportion over the
    // union, which equals 1 - |A∩B|/|A∪B| ONLY for binary vectors. It is
    // correct for the presence/absence matrices it is meant for, but feeding it
    // continuous abundances silently yields a different quantity from
    // scipy's jaccard — so the contract is recorded here rather than left
    // implicit. Verified against scipy 1.15.3 on a binary matrix.
    const B = Matrix.from2D([[1, 1, 0, 0], [1, 1, 0, 0], [1, 0, 1, 0], [0, 0, 0, 1]]);
    const D = computeDistanceMatrix(B, 'jaccard');
    const ref = [[0, 0, 2 / 3, 1], [0, 0, 2 / 3, 1], [2 / 3, 2 / 3, 0, 1], [1, 1, 1, 0]];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      expect(D.get(i, j)).toBeCloseTo(ref[i][j], 9);
    }
  });

  it('each metric reaches PCoA with its own geometry instead of a substituted one', () => {
    // End-to-end: the point of fixing the switch is that these analyses can no
    // longer be run against a silently substituted geometry. Note pcoa() takes a
    // DISTANCE MATRIX, so the metric is applied by computeDistanceMatrix first.
    const X = Matrix.from2D([[1, 2], [2, 1], [5, 6], [6, 5], [9, 2]]);
    const shapes: number[] = [];
    for (const m of ['euclidean', 'chebyshev', 'correlation', 'bray_curtis'] as const) {
      const D = computeDistanceMatrix(X, m);
      expect(isFinite(D.get(0, 1))).toBe(true);
      const r = pcoa(D, 2);
      expect(isFinite(r.coordinates.get(0, 0))).toBe(true);
      shapes.push(Math.round(r.coordinates.get(0, 0) * 1e6) / 1e6);
    }
    // Chebyshev and correlation must place the first point somewhere different
    // from euclidean; before the fix both were literally the euclidean run.
    expect(shapes[1] === shapes[0]).toBe(false);
    expect(shapes[2] === shapes[0]).toBe(false);
  });

  it('an unknown metric is rejected before it can reach the analysis', () => {
    expect(() => computeDistanceMatrix(P, 'chebychev' as never)).toThrow();
    // pcoa itself requires a square distance matrix; feeding raw data should not
    // silently produce coordinates.
    let threw = false;
    try { pcoa(Matrix.from2D([[1, 2], [2, 1], [5, 6]]), 2); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

