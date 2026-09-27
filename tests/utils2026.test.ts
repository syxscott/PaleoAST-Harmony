/**
 * Regression tests for the defects found while reviewing
 * core/utils + core/controllers (2026-09-27, fourth pass).
 *
 * Per AGENTS.md every test name STATES THE OLD BEHAVIOUR; every "correct" value
 * comes from numpy 1.26.4 / scipy 1.15.3 (conda `dev`) or from the verified
 * math/linalg implementation.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { cov } from '../entry/src/main/core/math/linalg.ts';
import {
  covarianceMatrix, correlationMatrix, pairwiseDistance, mantelTest,
  computeDistanceMatrix, standardizeMatrix,
} from '../entry/src/main/core/utils/MatrixOps.ts';
import { validateDistanceMetric } from '../entry/src/main/core/utils/Validators.ts';
import { efa } from '../entry/src/main/core/analysis/morphometrics/morphometrics.ts';
import { StatisticsController } from '../entry/src/main/core/controllers/StatisticsController.ts';
import { DataMatrix, StateManager } from '../entry/src/main/core/models/index.ts';

const Y = Matrix.from2D([[1, 2, 3], [2, 4.5, 1], [3, 1, 2], [4, 8, 7], [5, 2, 3]]);

describe('audit: covarianceMatrix centred the wrong axis and divided by the wrong n', () => {
  it('rowvar=true returns the variable covariance matrix, matching linalg.cov', () => {
    // It transposed unconditionally, then called centerMatrix(data, 0), which
    // removes each OBSERVATION's across-variable mean rather than each
    // variable's across-observation mean, and divided by nVars - ddof. For this
    // 5 x 3 input the 3 x 3 leading block came out [1.00, -0.50, -0.50; ...].
    // numpy: np.cov(Y, rowvar=True)
    const C = covarianceMatrix(Y, true);
    expect(C.rows).toBe(3);
    expect(C.cols).toBe(3);
    const ref = [[2.5, 0.875, 1.5], [0.875, 8.0, 4.625], [1.5, 4.625, 5.2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      expect(C.get(i, j)).toBeCloseTo(ref[i][j], 12);
    }
  });

  it('it is literally the verified linalg.cov for the default ddof', () => {
    const a = covarianceMatrix(Y, true);
    const b = cov(Y);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      expect(a.get(i, j)).toBeCloseTo(b.get(i, j), 15);
    }
  });

  it('ddof=0 gives the population covariance', () => {
    // numpy: np.cov(Y, rowvar=True, ddof=0)[0][0] = 2.0
    expect(covarianceMatrix(Y, true, 0).get(0, 0)).toBeCloseTo(2.0, 12);
  });

  it('rowvar=false keeps the np.cov shape (nRows x nRows) and says so', () => {
    // The 5 x 5 shape is not itself the bug -- it is what np.cov(rowvar=False)
    // returns. What matters is that it is now the right 5 x 5, and that no
    // caller mistakes it for a variable x variable matrix.
    const C = covarianceMatrix(Y, false);
    expect(C.rows).toBe(5);
    expect(C.cols).toBe(5);
    expect(cov(Y.transpose()).rows).toBe(5);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      expect(C.get(i, j)).toBeCloseTo(cov(Y.transpose()).get(i, j), 12);
    }
  });

  it('a too-small sample is refused rather than dividing by a clamp', () => {
    let msg = '';
    try { covarianceMatrix(Matrix.from2D([[1, 2], [3, 4]]), true, 0); } catch (e) { msg = (e as Error).message; }
    expect(msg).toBe('');
    // nObs=2, ddof=0 is legal; ddof=2 is not
    let msg2 = '';
    try { covarianceMatrix(Matrix.from2D([[1, 2], [3, 4]]), true, 2); } catch (e) { msg2 = (e as Error).message; }
    expect(msg2).toContain('need nObs > ddof');
  });
});

describe('audit: correlationMatrix returned an observation-by-observation matrix', () => {
  it('is variable x variable, symmetric, with a unit diagonal', () => {
    // It asked covarianceMatrix for rowvar=false, so for a 5 x 3 table it got a
    // 5 x 5 observation-by-observation "correlation" matrix back.
    const R = correlationMatrix(Y);
    expect(R.rows).toBe(3);
    expect(R.cols).toBe(3);
    for (let i = 0; i < 3; i++) expect(R.get(i, i)).toBeCloseTo(1, 12);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      expect(R.get(i, j)).toBeCloseTo(R.get(j, i), 12);
    }
  });

  it('each entry is cov / (sd * sd)', () => {
    const C = covarianceMatrix(Y, true);
    const R = correlationMatrix(Y);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      expect(R.get(i, j)).toBeCloseTo(C.get(i, j) / Math.sqrt(C.get(i, i) * C.get(j, j)), 12);
    }
  });

  it('spearman returns the same shape with average ranks', () => {
    const Rs = correlationMatrix(Y, 'spearman');
    expect(Rs.rows).toBe(3);
    for (let i = 0; i < 3; i++) expect(Rs.get(i, i)).toBeCloseTo(1, 12);
    // strictly monotonic in the first variable -> positive rank correlation
    expect(Rs.get(0, 1)).toBeGreaterThan(0);
  });
});

describe('audit: validateDistanceMetric approved names the code rejected', () => {
  it('the validator and the implementation agree on every name', () => {
    // It used to list braycurtis / manhattan / chebychev / chebyshev, none of
    // which are in the DistanceMetric union, so validation passed and
    // pairwiseDistance then threw "Unknown metric" far from the cause.
    const impl: string[] = ['euclidean', 'bray_curtis', 'cosine', 'jaccard', 'canberra',
      'cityblock', 'correlation', 'hamming'];
    for (const m of impl) {
      let vOk = true, iOk = true;
      try { validateDistanceMetric(m); } catch { vOk = false; }
      try { pairwiseDistance([1, 0], [0, 1], m as never); } catch { iOk = false; }
      expect(vOk).toBe(true);
      expect(iOk).toBe(true);
    }
    for (const m of ['braycurtis', 'manhattan', 'chebychev', 'chebyshev', 'nonsense']) {
      let vOk = true, iOk = true;
      try { validateDistanceMetric(m); } catch { vOk = false; }
      try { pairwiseDistance([1, 0], [0, 1], m as never); } catch { iOk = false; }
      expect(vOk).toBe(false);
      expect(iOk).toBe(false);
    }
  });
});

describe('audit: the EFA resampling resolution was collected and then dropped', () => {
  const contour: number[][] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * 2 * Math.PI;
    contour.push([Math.cos(a) * 2, Math.sin(a) * 3]);
  }

  it('efa honours nPoints', () => {
    expect(efa(contour, 5, 40).nPoints).toBe(40);
    expect(efa(contour, 5, 400).nPoints).toBe(400);
    expect(efa(contour, 5, 60).reconstructed.length).toBe(60);
  });

  it('the controller forwards the dialog value', () => {
    // EFADialog collects "Resample points" (20..1000), Index.ets passes it as
    // n_points, runEFA(nh, np) accepted it -- and then called efa(contour, nh)
    // without it, so the number the user typed had no effect while the
    // exported analysis script recorded it as if it did.
    const ctrl = new StatisticsController();
    StateManager.getInstance().setData(new DataMatrix(
      Matrix.from2D([[1, 2, 3, 4, 5, 6, 0.5, 0.2, 0, 1, 1, 1, 0, 0.1, 0, 1]]),
      ['c1'],
      ['x1', 'x2', 'x3', 'x4', 'x5', 'y1', 'y2', 'y3', 'y4', 'y5'],
    ));
    expect(ctrl.runEFA(5, 60).nPoints).toBe(60);
    expect(ctrl.runEFA(5, 350).nPoints).toBe(350);
  });
});

describe('audit: things that turned out to be correct', () => {
  it('mantelTest r matches the textbook statistic even though u2 is centred on u1', () => {
    // The observed numerator uses (u2[i] - mean(u1)) rather than
    // (u2[i] - mean(u2)). Those are algebraically identical because
    // sum(u1[i] - mean(u1)) = 0, so the suspicion was wrong -- verified here
    // rather than "fixed".
    const X = Matrix.from2D([[1, 10], [2, 20], [3, 30], [9, 90], [8, 80], [9.5, 95], [2.5, 25]]);
    const D = computeDistanceMatrix(X, 'euclidean');
    expect(mantelTest(D, D, 199, 42).r).toBe(1);
    const E = computeDistanceMatrix(Matrix.from2D([[5, 2], [1, 8], [9, 1], [2, 2], [7, 7], [3, 3], [4, 4]]), 'euclidean');
    expect(mantelTest(D, E, 199, 42).r).toBeCloseTo(-0.252852713155, 10);
  });

  it('standardizeMatrix is unaffected by the broadcasting change', () => {
    // z-score over columns: every column mean ~0 and every column sd 1
    const Z = standardizeMatrix(Y);
    for (let j = 0; j < 3; j++) {
      const col = Z.col(j);
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const ss = col.reduce((a, b) => a + (b - m) ** 2, 0);
      expect(m).toBeCloseTo(0, 12);
      expect(Math.sqrt(ss / (col.length - 1))).toBeCloseTo(1, 12);
    }
  });
});
