/**
 * Regression tests for the linear-algebra defects found while reviewing
 * core/math (Matrix.ts, linalg.ts) on 2026-10-19.
 *
 * Per AGENTS.md and docs/code-style.md, every test name STATES THE OLD
 * BEHAVIOUR so a future reader can tell what was broken without git
 * history.  Every "correct" value below comes from numpy 2.2.6 run in the
 * conda `dev` environment (or from the algebraic identity the fix has to
 * satisfy), never from a hand calculation.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { svd, lstsq, det, inv, solve } from '../entry/src/main/core/math/linalg.ts';

const M = (rows: number[][]) => Matrix.from2D(rows);

const X5x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [2, 9, 1], [5, 3, 8]];

/** Frobenius norm of the residual A - U·diag(S)·Vt. */
function reconstructionResidual(A: Matrix, U: Matrix, S: number[], Vt: Matrix): number {
  const recon = U.matmul(Matrix.diag(S)).matmul(Vt);
  let r = 0;
  for (let i = 0; i < A.length; i++) {
    const d = recon.data[i] - A.data[i];
    r += d * d;
  }
  return Math.sqrt(r);
}

/** Message of the error `fn` throws ('' when it throws nothing). */
function errorMessage(fn: () => void): string {
  try { fn(); } catch (e) { return (e as Error).message; }
  return '';
}

describe('fix2026: Matrix element-wise ops indexed a 1 x p operand by the flat index', () => {
  it('sub(a 1 x p mean) centres every column instead of NaN-ing from row 2 on', () => {
    // The operand was indexed with the receiver's flat index, so
    // o.data[3..14] were undefined and every cell from the second row on
    // came back NaN.  `X.sub(X.meanAxis(0))` returned only the first row
    // correctly centred.
    const X = M(X5x3);
    const centred = X.sub(X.meanAxis(0));
    expect(centred.anyNaN()).toBe(false);
    // Centring by the COLUMN means makes the column sums vanish (the row
    // sums do not: they keep the original row total minus the sum of the
    // means).  numpy: X - X.mean(axis=0) has all-zero column sums.
    const mu = X.meanAxis(0);
    for (let j = 0; j < X.cols; j++) {
      let colSum = 0;
      for (let i = 0; i < X.rows; i++) colSum += centred.get(i, j);
      expect(colSum).toBeWithin(0, 1e-12);
    }
    // Element-wise identity: centred[i][j] === X[i][j] - mean[j].
    for (let i = 0; i < X.rows; i++) {
      for (let j = 0; j < X.cols; j++) {
        expect(centred.get(i, j)).toBeWithin(X.get(i, j) - mu.get(0, j), 1e-12);
      }
    }
  });

  it('add / mul / div broadcast a 1 x p row vector the same way sub does', () => {
    const X = M(X5x3);
    const ones = M([[1, 1, 1]]);
    const twos = M([[2, 2, 2]]);
    expect(X.add(ones).anyNaN()).toBe(false);
    for (let i = 0; i < X.rows; i++) {
      for (let j = 0; j < X.cols; j++) {
        expect(X.add(ones).get(i, j)).toBeWithin(X.get(i, j) + 1, 1e-12);
        expect(X.mul(twos).get(i, j)).toBeWithin(X.get(i, j) * 2, 1e-12);
        expect(X.div(twos).get(i, j)).toBeWithin(X.get(i, j) / 2, 1e-12);
      }
    }
  });

  it('an n x 1 column vector broadcasts across the columns', () => {
    const X = M(X5x3);
    const colv = M([[1], [2], [3], [4], [5]]);
    const scaled = X.mul(colv);
    expect(scaled.anyNaN()).toBe(false);
    for (let i = 0; i < X.rows; i++) {
      for (let j = 0; j < X.cols; j++) {
        expect(scaled.get(i, j)).toBeWithin(X.get(i, j) * (i + 1), 1e-12);
      }
    }
  });

  it('two operands of the same shape are combined element-wise', () => {
    const A = M([[1, 2, 3], [4, 5, 6]]);
    const B = M([[10, 20, 30], [40, 50, 60]]);
    expect(A.add(B).get(1, 2)).toBeWithin(66, 1e-12);
    expect(A.sub(B).get(1, 2)).toBeWithin(-54, 1e-12);
    expect(A.mul(B).get(0, 1)).toBeWithin(40, 1e-12);
    expect(A.div(B).get(0, 1)).toBeWithin(0.1, 1e-12);
  });

  it('an operand of an incompatible shape throws instead of degrading to NaN', () => {
    const A = M(X5x3);
    const bad = M([[1, 2]]);            // 1 x 2 — neither equal nor broadcastable
    const msg = errorMessage(() => A.sub(bad));
    expect(msg).toContain('cannot broadcast');
    expect(msg).toContain('5x3');
  });
});

describe('fix2026: svd returned a transposed Vt for a wide matrix', () => {
  it('svd of a wide matrix hands back U (m x m) and Vt (m x n), not a transposed pair', () => {
    // The roles of U and Vt were exchanged WITHOUT transposing them, so a
    // 2 x 3 input came back with Vt of 3 x 2: U·diag(S)·Vt did not even
    // have conformable shapes (it threw "matmul shape"), and the file
    // header's own contract (m < n => U is m x m, Vt is m x n) was broken.
    const A = M([[1, 2, 3], [4, 5, 6]]);
    const { U, S, Vt } = svd(A);
    expect(U.rows).toBe(2);
    expect(U.cols).toBe(2);
    expect(S.length).toBe(2);
    expect(Vt.rows).toBe(2);
    expect(Vt.cols).toBe(3);
  });

  it('U * diag(S) * Vt reproduces a wide matrix', () => {
    const A = M([[1, 2, 3], [4, 5, 6]]);
    const { U, S, Vt } = svd(A);
    const recon = U.matmul(Matrix.diag(S)).matmul(Vt);
    expect(recon.rows).toBe(A.rows);
    expect(recon.cols).toBe(A.cols);
    expect(reconstructionResidual(A, U, S, Vt)).toBeWithin(0, 1e-12);
    for (let i = 0; i < A.rows; i++) {
      for (let j = 0; j < A.cols; j++) {
        expect(recon.get(i, j)).toBeWithin(A.get(i, j), 1e-12);
      }
    }
  });

  it('the singular values of a wide matrix agree with numpy', () => {
    // numpy 2.2.6: np.linalg.svd([[1,2,3],[4,5,6]]) -> s = [9.5080320007,
    // 0.772869635673]; the tall and square cases likewise.
    const wide = svd(M([[1, 2, 3], [4, 5, 6]]));
    expect(wide.S[0]).toBeWithin(9.508032000695724, 1e-10);
    expect(wide.S[1]).toBeWithin(0.7728696356734844, 1e-10);
    const tall = svd(M([[1, 2], [3, 4], [5, 6]]));
    expect(tall.S[0]).toBeWithin(9.525518091565106, 1e-10);
    expect(tall.S[1]).toBeWithin(0.5143005806586443, 1e-10);
    const square = svd(M([[2, 1, 0], [1, 3, 1], [0, 1, 4]]));
    expect(square.S[0]).toBeWithin(4.732050807568877, 1e-10);
    expect(square.S[1]).toBeWithin(3, 1e-10);
    expect(square.S[2]).toBeWithin(1.2679491924311228, 1e-10);
  });

  it('a tall matrix and a square matrix still reproduce their input', () => {
    const tall = M([[1, 2], [3, 4], [5, 6]]);
    const rT = svd(tall);
    expect(rT.U.rows).toBe(3);
    expect(rT.U.cols).toBe(2);
    expect(rT.Vt.rows).toBe(2);
    expect(rT.Vt.cols).toBe(2);
    expect(reconstructionResidual(tall, rT.U, rT.S, rT.Vt)).toBeWithin(0, 1e-12);

    const square = M([[2, 1, 0], [1, 3, 1], [0, 1, 4]]);
    const rS = svd(square);
    expect(rS.U.rows).toBe(3);
    expect(rS.U.cols).toBe(3);
    expect(rS.Vt.rows).toBe(3);
    expect(rS.Vt.cols).toBe(3);
    expect(reconstructionResidual(square, rS.U, rS.S, rS.Vt)).toBeWithin(0, 1e-12);
  });

  it('lstsq of a wide matrix solves for the full width instead of returning a short vector', () => {
    // With the transposed Vt, the solution came back with m rows instead of
    // n, so it could not even be multiplied back by A.
    const A = M([[1, 2, 3], [4, 5, 6]]);
    const b = M([[14], [32]]);
    const x = lstsq(A, b);
    expect(x.rows).toBe(3);
    expect(x.cols).toBe(1);
    expect(x.anyNaN()).toBe(false);
    const ax = A.matmul(x);
    expect(ax.get(0, 0)).toBeWithin(14, 1e-9);
    expect(ax.get(1, 0)).toBeWithin(32, 1e-9);
  });
});

describe('fix2026: det and inv judged singularity with an absolute threshold', () => {
  it('det of a non-square matrix throws instead of returning the determinant of its top-left block', () => {
    // det([[1,2,3],[4,5,6]]) answered -3 — the determinant of the 2 x 2
    // top-left block — where numpy raises LinAlgError.
    const msg = errorMessage(() => det(M([[1, 2, 3], [4, 5, 6]])));
    expect(msg).toContain('must be square');
    expect(msg).toContain('2x3');
  });

  it('det of a small-magnitude matrix is no longer silently 0', () => {
    // The absolute 1e-15 pivot test called every pivot of a 1e-20 matrix
    // zero, so det(diag(1e-20, 1e-20)) came back 0 instead of 1e-40.
    const d = det(Matrix.diag([1e-20, 1e-20]));
    expect(d).toBeWithin(1e-40, 1e-50);
    // Relative check as well: the ratio to the true value is 1.
    expect(d / 1e-40).toBeWithin(1, 1e-9);
  });

  it('det of an ordinary matrix is unchanged', () => {
    // numpy: det([[2,0],[0,3]]) = 6, det([[1,2],[2,4]]) = 0.
    expect(det(M([[2, 0], [0, 3]]))).toBeWithin(6, 1e-9);
    expect(det(M([[1, 2], [2, 4]]))).toBeWithin(0, 1e-9);
    expect(det(Matrix.eye(4))).toBeWithin(1, 1e-12);
  });

  it('inv / solve no longer call a 1e-20 I matrix singular', () => {
    // The absolute 1e-15 pivot test rejected a perfectly invertible matrix
    // whose entries are not of order 1.
    const A = Matrix.diag([1e-20, 2e-20]);
    const inverse = inv(A);
    expect(inverse.get(0, 0)).toBeWithin(1e20, 1e8);
    expect(inverse.get(1, 1)).toBeWithin(5e19, 1e7);
    const product = A.matmul(inverse);
    expect(product.get(0, 0)).toBeWithin(1, 1e-12);
    expect(product.get(1, 1)).toBeWithin(1, 1e-12);
    expect(product.get(0, 1)).toBeWithin(0, 1e-12);

    const x = solve(A, M([[1e-20], [2e-20]]));
    expect(x.rows).toBe(2);
    expect(x.get(0, 0)).toBeWithin(1, 1e-12);
    expect(x.get(1, 0)).toBeWithin(1, 1e-12);
  });

  it('inv / solve of a genuinely singular matrix still throw', () => {
    const singular = M([[1, 2], [2, 4]]);
    expect(errorMessage(() => inv(singular))).toContain('singular');
    expect(errorMessage(() => solve(singular, M([[1], [2]]))).length).toBeGreaterThan(0);
    expect(errorMessage(() => solve(singular, M([[1], [2]])))).toContain('singular');
  });
});
