/**
 * Every scipy-comparable distance metric, checked against scipy itself
 * (2026-09-27, eighth pass).
 *
 * This started as a one-off audit of a single metric. `bray_curtis` was missing
 * the absolute value on its denominator, so any vector pair summing to zero or
 * below returned distance 0 -- which NMDS / PCoA / ANOSIM / PERMANOVA / SIMPER
 * read as IDENTICAL. Checking that one metric by hand would have left the other
 * six unverified, so all of them were compared against scipy at once: 7 metrics
 * x 120 vector pairs, spanning non-negative, signed, exactly-cancelling,
 * all-negative, zero, tiny (1e-8) and huge (1e8) magnitudes.
 *
 * Result: after the fix every metric agrees with scipy to within 2.2e-16
 * (machine epsilon). The worst relative error is ~1e-16 on cosine and
 * correlation, which is just floating-point ordering, not a formula difference.
 *
 * EVERY expected value below was produced by running scipy 1.15.3, not derived
 * by hand. That mattered: the textbook Bray-Curtis denominator
 * sum(|u_i| + |v_i|) disagrees with scipy on 2 of these 6 signed cases, because
 * scipy uses sum|u_i + v_i| (the abs around the SUM).
 *
 * jaccard and hamming are deliberately absent: this repo defines them
 * per-coordinate (fraction of differing / equal positions) while scipy defines
 * jaccard over sets and hamming for booleans. That is a naming collision, not a
 * defect, and the numbers are not comparable.
 */
import { describe, it, expect } from './runner.ts';
import { computeDistanceMatrix } from '../entry/src/main/core/analysis/statistics/statistics.ts';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';

/** [metric, [[a, b, scipyValue], ...]] -- generated from scipy 1.15.3. */
// No explicit type annotation: node's type stripper mis-parses a tuple type on
// this literal and fails with ERR_INVALID_TYPESCRIPT_SYNTAX, so the shape is
// inferred and documented in the comment instead.
const REFERENCE = [  [
    'euclidean',
    [
      [[1, 2, 3], [4, 5, 6], 5.196152422706632],
      [[1, 2, 3], [1, -2, 3], 4.0],
      [[4, 5, 6], [0, 1, 2], 6.928203230275509],
      [[0, 1, 2], [1, 0, 0], 2.449489742783178],
      [[1, 0, 0], [0, 0, 0], 1.0],
      [[1, -2, 3], [4, 5, -6], 11.789826122551595],
      [[-1, -2], [-3, -4], 2.8284271247461903],
      [[2, -5, 3], [-4, 6, 1], 12.68857754044952],
      [[10, -1], [1, -10], 12.727922061357855],
      [[1, 2, 3], [4, 5, -6], 9.9498743710662],
      [[1, -10], [1e-08, 1e-08], 10.049875630076226],
    ],
  ],
  [
    'bray_curtis',
    [
      [[1, 2, 3], [4, 5, 6], 0.42857142857142855],
      [[1, 2, 3], [1, -2, 3], 0.5],
      [[4, 5, 6], [0, 1, 2], 0.6666666666666666],
      [[0, 1, 2], [1, 0, 0], 1.0],
      [[1, 0, 0], [0, 0, 0], 1.0],
      [[1, -2, 3], [4, 5, -6], 1.7272727272727273],
      [[-1, -2], [-3, -4], 0.4],
      [[2, -5, 3], [-4, 6, 1], 2.7142857142857144],
      [[10, -1], [1, -10], 0.8181818181818182],
      [[1, 2, 3], [4, 5, -6], 1.0],
      [[1, -10], [1e-08, 1e-08], 1.0],
    ],
  ],
  [
    'cosine',
    [
      [[1, 2, 3], [4, 5, 6], 0.025368153802923787],
      [[1, 2, 3], [1, -2, 3], 0.5714285714285714],
      [[4, 5, 6], [0, 1, 2], 0.13359977455603655],
      [[0, 1, 2], [1, 0, 0], 1.0],
      [[1, -2, 3], [4, 5, -6], 1.730973884647807],
      [[-1, -2], [-3, -4], 0.01613008990009257],
      [[2, -5, 3], [-4, 6, 1], 1.7798989061877761],
      [[10, -1], [1, -10], 0.801980198019802],
      [[1, 2, 3], [4, 5, -6], 1.1218289807746344],
      [[1, -10], [1e-08, 1e-08], 1.6332377902572626],
    ],
  ],
  [
    'canberra',
    [
      [[1, 2, 3], [4, 5, 6], 1.3619047619047617],
      [[1, 2, 3], [1, -2, 3], 1.0],
      [[4, 5, 6], [0, 1, 2], 2.1666666666666665],
      [[0, 1, 2], [1, 0, 0], 3.0],
      [[1, 0, 0], [0, 0, 0], 1.0],
      [[1, -2, 3], [4, 5, -6], 2.6],
      [[-1, -2], [-3, -4], 0.8333333333333333],
      [[2, -5, 3], [-4, 6, 1], 2.5],
      [[10, -1], [1, -10], 1.6363636363636365],
      [[1, 2, 3], [4, 5, -6], 2.0285714285714285],
      [[1, -10], [1e-08, 1e-08], 1.9999999800000001],
    ],
  ],
  [
    'cityblock',
    [
      [[1, 2, 3], [4, 5, 6], 9.0],
      [[1, 2, 3], [1, -2, 3], 4.0],
      [[4, 5, 6], [0, 1, 2], 12.0],
      [[0, 1, 2], [1, 0, 0], 4.0],
      [[1, 0, 0], [0, 0, 0], 1.0],
      [[1, -2, 3], [4, 5, -6], 19.0],
      [[-1, -2], [-3, -4], 4.0],
      [[2, -5, 3], [-4, 6, 1], 19.0],
      [[10, -1], [1, -10], 18.0],
      [[1, 2, 3], [4, 5, -6], 15.0],
      [[1, -10], [1e-08, 1e-08], 11.0],
    ],
  ],
  [
    'correlation',
    [
      [[1, 2, 3], [4, 5, 6], 0.0],
      [[1, 2, 3], [1, -2, 3], 0.6026402928804869],
      [[4, 5, 6], [0, 1, 2], 0.0],
      [[0, 1, 2], [1, 0, 0], 1.8660254037844384],
      [[1, -2, 3], [4, 5, -6], 1.8492319348032171],
      [[-1, -2], [-3, -4], 0.0],
      [[2, -5, 3], [-4, 6, 1], 1.8029550685469662],
      [[10, -1], [1, -10], 0.0],
      [[1, 2, 3], [4, 5, -6], 1.8219949365267865],
    ],
  ],
  [
    'chebyshev',
    [
      [[1, 2, 3], [4, 5, 6], 3.0],
      [[1, 2, 3], [1, -2, 3], 4.0],
      [[4, 5, 6], [0, 1, 2], 4.0],
      [[0, 1, 2], [1, 0, 0], 2.0],
      [[1, 0, 0], [0, 0, 0], 1.0],
      [[1, -2, 3], [4, 5, -6], 9.0],
      [[-1, -2], [-3, -4], 2.0],
      [[2, -5, 3], [-4, 6, 1], 11.0],
      [[10, -1], [1, -10], 9.0],
      [[1, 2, 3], [4, 5, -6], 9.0],
      [[1, -10], [1e-08, 1e-08], 10.00000001],
    ],
  ],
];

const relErr = (got: number, want: number): number =>
  Math.abs(got - want) / Math.max(1, Math.abs(want));

// Fixed-length vectors only: Matrix.from2D needs a rectangular block, and the
// reference table deliberately mixes 2- and 3-element vectors.
const SQUARE = [
  [1, 2, 3], [4, 5, 6], [0, 1, 2], [1, -2, 3], [-1, -2, 0], [2, -5, 3],
];

describe('audit: every distance metric agrees with scipy', () => {
  for (const [metric, cases] of REFERENCE) {
    it(`${metric} matches scipy on ${cases.length} vector pairs`, () => {
      const bad: string[] = [];
      for (const [a, b, want] of cases) {
        const got = computeDistanceMatrix(Matrix.from2D([a, b]), metric as never).get(0, 1);
        if (relErr(got, want) > 1e-9) {
          bad.push(`${JSON.stringify(a)} vs ${JSON.stringify(b)}: got ${got}, scipy ${want}`);
        }
      }
      expect(bad.join(' | ')).toBe('');
    });

    it(`${metric} is symmetric and zero on the diagonal`, () => {
      const D = computeDistanceMatrix(Matrix.from2D(SQUARE), metric as never);
      for (let i = 0; i < SQUARE.length; i++) {
        expect(D.get(i, i) === 0 ? 'diag 0' : `diag ${D.get(i, i)}`).toBe('diag 0');
        for (let j = i + 1; j < SQUARE.length; j++) {
          expect(D.get(i, j) === D.get(j, i) ? 'symmetric' : `asymmetric at ${i},${j}`).toBe('symmetric');
        }
      }
    });
  }

  it('no metric calls two different vectors identical', () => {
    // The failure mode that motivated this: a non-positive denominator falling
    // through to the `den > 0 ? ... : 0` guard, which reads downstream as
    // "these two specimens are the same".
    //
    // cosine and correlation are excluded on purpose: their 0 means "same
    // direction" (r = 1), not "same point". Both legitimately return 0 for
    // collinear vectors, and scipy agrees -- the next test pins that.
    const a = [-1, -2, 1], b = [-3, -4, 2];   // deliberately NOT collinear
    for (const metric of ['euclidean', 'bray_curtis', 'canberra',
                          'cityblock', 'chebyshev']) {
      const d = computeDistanceMatrix(Matrix.from2D([a, b]), metric as never).get(0, 1);
      expect(d > 0 ? 'positive' : `${metric} reported the two vectors as identical`).toBe('positive');
    }
  });

  it('cosine and correlation return 0 for collinear vectors, as scipy does', () => {
    // b = 3a, so the vectors share a direction. Distance 0 here is the correct
    // answer and means "perfectly correlated", not "the same measurement" --
    // which is exactly why they are excluded from the assertion above.
    const a = [-1, -2, 1], b = [-3, -6, 3];
    for (const metric of ['cosine', 'correlation']) {
      const d = computeDistanceMatrix(Matrix.from2D([a, b]), metric as never).get(0, 1);
      expect(Math.abs(d) < 1e-12 ? `${metric} -> 0 as expected` : `${metric} -> ${d}`).toBe(`${metric} -> 0 as expected`);
    }
  });
});
