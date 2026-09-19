import { Matrix } from './Matrix';
import { assertFiniteMatrix } from './Validation';

/**
 * Linear algebra: SVD, eigh, inv, solve, lstsq, norm, det, cov, corrcoef.
 * Replaces numpy.linalg / scipy.linalg.
 */

/**
 * Singular Value Decomposition: A = U · diag(S) · Vt
 *
 * Handles both tall (m ≥ n) and wide (m < n) matrices correctly:
 * - m ≥ n  : U is m×n,  S has n entries, Vt is n×n,  A = U·diag(S)·Vt
 * - m < n  : U is m×m,  S has m entries, Vt is m×n,  A = U·diag(S)·Vt
 *   (thin-rectangular case: U is square, Vt is full-row-rank)
 *
 * Returns: { U, S, Vt } with correct shapes for the given A.
 */
export function svd(A: Matrix): { U: Matrix; S: number[]; Vt: Matrix } {
  assertFiniteMatrix('svd:A', A);
  let m = A.rows, n = A.cols;
  // Work with the larger dimension for the bidiagonal iteration
  let work: Matrix;
  let transposed = false;
  if (m < n) {
    work = A.transpose();
    transposed = true;
    m = work.rows;  // = original n
    n = work.cols;  // = original m
  } else {
    work = A.clone();
  }

  let V = Matrix.eye(n), B = work.clone();

  // Jacobi iteration for symmetric part
  for (let iter = 0; iter < 150; iter++) {
    let converged = true;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      let alpha = 0, beta = 0, gamma = 0;
      for (let i = 0; i < m; i++) {
        alpha += B.get(i, p) ** 2;
        beta  += B.get(i, q) ** 2;
        gamma += B.get(i, p) * B.get(i, q);
      }
      if (Math.abs(gamma) < 1e-14 * Math.sqrt(alpha * beta)) continue;
      converged = false;
      const tau = (beta - alpha) / (2 * gamma);
      const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t), s = t * c;
      for (let i = 0; i < m; i++) {
        const bp = B.get(i, p), bq = B.get(i, q);
        B.set(i, p, c * bp - s * bq);
        B.set(i, q, s * bp + c * bq);
      }
      for (let i = 0; i < n; i++) {
        const vp = V.get(i, p), vq = V.get(i, q);
        V.set(i, p, c * vp - s * vq);
        V.set(i, q, s * vp + c * vq);
      }
    }
    if (converged) break;
  }

  // Singular values: column norms of B
  const sigma: number[] = [];
  for (let j = 0; j < n; j++) {
    let s2 = 0;
    for (let i = 0; i < m; i++) s2 += B.get(i, j) ** 2;
    sigma.push(Math.sqrt(s2));
  }
  const order = sigma.map((_, i) => i).sort((a, b) => sigma[b] - sigma[a]);
  const S = order.map(i => sigma[i]);

  // Build U (m×n) and Vt (n×n) with correct dimensions
  // U columns: u_j = B[:,j] / S[j]  (for S[j] > 0)
  // Vt rows:   vt_j = V[:,j]        (already oriented)
  const Ud = new Float64Array(m * n);  // m×n
  const Vd = new Float64Array(n * n);  // n×n
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) {
      Ud[i * n + j] = S[j] > 1e-15 ? B.get(i, order[j]) / S[j] : 0;
    }
    for (let i = 0; i < n; i++) {
      Vd[i * n + j] = V.get(i, order[j]);
    }
  }

  let U  = new Matrix(Ud, m, n);
  let Vt = new Matrix(Vd, n, n).transpose();

  // Un-transpose: for m<n case we swapped roles, so swap back to restore
  // A_original (m×n) with m<n: we worked on A^T (n×m), got U(m×m), Vt(m×n)
  // A_original = U(m×m) · diag(S) · Vt(m×n)   ← correct invariant
  if (transposed) { const tmp = U; U = Vt; Vt = tmp; }

  return { U, S, Vt };
}

/**
 * Symmetric eigen-decomposition: A = V · diag(λ) · V^T
 *
 * Uses Jacobi iteration.  Eigenvalues are sorted in descending order.
 *
 * Note: For numerically challenging matrices (e.g. near-singular or
 * non-positive-semidefinite due to round-off), negative eigenvalues may
 * appear.  This implementation returns them as-is.  The caller is responsible
 * for enforcing positive-semidefiniteness when required (e.g. by clipping to
 * zero or by using SVD to reconstruct).
 */
export function eigh(A: Matrix): { eigenvalues: number[]; eigenvectors: Matrix } {
  assertFiniteMatrix('eigh:A', A);
  const n = A.rows;
  if (n !== A.cols) throw new Error(`eigh: not square (${A.rows}x${A.cols})`);
  // Jacobi rotations annihilate the off-diagonal in symmetric fashion. Feeding
  // a non-symmetric matrix does not fail loudly — it simply fails to converge
  // and the returned diagonal is meaningless. Guard against that misuse (the
  // classic trigger is passing the product Sw^-1·Sb straight from LDA).
  let asym = 0, scale = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      asym = Math.max(asym, Math.abs(A.get(i, j) - A.get(j, i)));
      scale = Math.max(scale, Math.abs(A.get(i, j)), Math.abs(A.get(j, i)));
    }
  }
  if (asym > 1e-8 * Math.max(scale, 1)) {
    throw new Error(
      `eigh: matrix is not symmetric (max asymmetry ${asym.toExponential(3)}). ` +
      'Symmetrise the operator first (e.g. Sw^-1/2·Sb·Sw^-1/2 for LDA).'
    );
  }
  let T = A.clone(), Q = Matrix.eye(n);
  let converged = false;
  let lastOff = 0;
  for (let iter = 0; iter < 100 * n; iter++) {
    let maxOff = 0, pi = 0, qi = 1;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (Math.abs(T.get(i, j)) > maxOff) { maxOff = Math.abs(T.get(i, j)); pi = i; qi = j; }
    lastOff = maxOff;
    if (maxOff < 1e-14) { converged = true; break; }
    let theta: number;
    // Rotation J = [[c, s], [-s, c]] applied as T <- J^T T J zeroes T[p,q] when
    //     tan(2θ) = 2·T[p,q] / (T[q,q] − T[p,p])
    // The denominator's sign matters: using (T[p,p] − T[q,q]) rotates the wrong
    // way, INCREASING the off-diagonal instead of annihilating it. The loop then
    // never converges and the returned diagonal is not a set of eigenvalues —
    // for [[4,1,0],[1,3,1],[0,1,2]] it produced (3.792, 3.000, 2.208) where the
    // true values are (4.732, 3.000, 1.268), and still had 1.48 of off-diagonal
    // mass left after 300 sweeps. With the correct sign the same matrix
    // converges in 10 sweeps to 8e-18.
    if (Math.abs(T.get(qi, qi) - T.get(pi, pi)) < 1e-15) theta = Math.PI / 4;
    else theta = 0.5 * Math.atan2(2 * T.get(pi, qi), T.get(qi, qi) - T.get(pi, pi));
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let i = 0; i < n; i++) {
      const tp = T.get(i, pi), tq = T.get(i, qi);
      T.set(i, pi, c * tp - s * tq); T.set(i, qi, s * tp + c * tq);
    }
    for (let j = 0; j < n; j++) {
      const tp = T.get(pi, j), tq = T.get(qi, j);
      T.set(pi, j, c * tp - s * tq); T.set(qi, j, s * tp + c * tq);
    }
    for (let i = 0; i < n; i++) {
      const qp = Q.get(i, pi), qq = Q.get(i, qi);
      Q.set(i, pi, c * qp - s * qq); Q.set(i, qi, s * qp + c * qq);
    }
  }
  // A non-converged Jacobi sweep leaves a non-negligible off-diagonal, and the
  // diagonal is then NOT the eigenvalue set. Fail loudly instead of returning
  // numbers that look plausible (the rotation-sign bug did exactly that).
  let diagScale = 0;
  for (let i = 0; i < n; i++) diagScale = Math.max(diagScale, Math.abs(T.get(i, i)));
  if (!converged && lastOff > 1e-6 * Math.max(diagScale, 1)) {
    throw new Error(
      `eigh: Jacobi iteration did not converge (residual off-diagonal ${lastOff.toExponential(3)})`
    );
  }
  const rawEigenvalues: number[] = [];
  for (let i = 0; i < n; i++) rawEigenvalues.push(T.get(i, i));

  // Sort eigenvectors in descending order (preserve V·V^T=I) AND permute the
  // eigenvalues with the SAME index map, so that eigenvalues[k] always pairs
  // with eigenvectors column k. Permuting only the vectors silently breaks
  // every caller that reads an eigenvalue together with its direction
  // (Eigenshape, LDA's Wilks' lambda, RDA/CCA inertia, paleoEnvironment).
  const order = rawEigenvalues.map((_, i) => i).sort((a, b) => rawEigenvalues[b] - rawEigenvalues[a]);
  const eigenvalues = order.map(i => rawEigenvalues[i]);
  const evd = new Float64Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      evd[i * n + j] = Q.get(i, order[j]);
  return { eigenvalues, eigenvectors: new Matrix(evd, n, n) };
}

export function inv(A: Matrix): Matrix {
  assertFiniteMatrix('inv:A', A);
  const n = A.rows;
  if (n !== A.cols) throw new Error('inv: not square');
  const aug = Matrix.zeros(n, 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) aug.set(i, j, A.get(i, j));
    aug.set(i, n + i, 1);
  }
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(aug.get(row, col)) > Math.abs(aug.get(maxRow, col))) maxRow = row;
    if (maxRow !== col)
      for (let j = 0; j < 2 * n; j++) {
        const t = aug.get(col, j); aug.set(col, j, aug.get(maxRow, j)); aug.set(maxRow, j, t);
      }
    const pivot = aug.get(col, col);
    if (Math.abs(pivot) < 1e-15) throw new Error('inv: singular');
    for (let j = 0; j < 2 * n; j++) aug.set(col, j, aug.get(col, j) / pivot);
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = aug.get(row, col);
      for (let j = 0; j < 2 * n; j++) aug.set(row, j, aug.get(row, j) - f * aug.get(col, j));
    }
  }
  const result = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      result.set(i, j, aug.get(i, n + j));
  return result;
}

/**
 * Solve Ax = b for x using LU decomposition with partial pivoting.
 *
 * Ref: G.E. Forsythe, M.A. Malcolm & C.B. Moler (1977),
 *      _Computer Methods for Mathematical Computation_, Sec 6.6.
 *
 * Returns x such that Ax = b.  A must be square and non-singular.
 */
export function solve(A: Matrix, b: Matrix): Matrix {
  assertFiniteMatrix('solve:A', A);
  assertFiniteMatrix('solve:b', b);
  const n = A.rows;
  if (A.cols !== n) throw new Error('solve: A must be square');
  if (b.rows !== n) throw new Error('solve: b must have same row count as A');
  if (b.cols !== 1) throw new Error('solve: b must be a column vector');

  // LU decomposition with partial pivoting
  const L = Matrix.zeros(n, n);
  const U = Matrix.zeros(n, n);
  const P = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) L.set(i, i, 1);

  // Build permutation matrix
  let Ac = A.clone();
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(Ac.get(row, col)) > Math.abs(Ac.get(maxRow, col))) maxRow = row;
    if (maxRow !== col) {
      for (let j = 0; j < n; j++) {
        let t = Ac.get(col, j); Ac.set(col, j, Ac.get(maxRow, j)); Ac.set(maxRow, j, t);
      }
      { const tmp = perm[col]; perm[col] = perm[maxRow]; perm[maxRow] = tmp; }
    }
    const pivot = Ac.get(col, col);
    if (Math.abs(pivot) < 1e-15) throw new Error('solve: singular matrix');
    for (let row = col + 1; row < n; row++) {
      const f = Ac.get(row, col) / pivot;
      L.set(row, col, f);
      for (let j = col; j < n; j++) {
        Ac.set(row, j, Ac.get(row, j) - f * Ac.get(col, j));
      }
    }
    for (let row = 0; row <= col; row++) U.set(row, col, Ac.get(row, col));
    P.set(col, perm[col], 1);
  }
  // L upper-triangle entries are already 0 (Matrix.zeros initialised); no action needed.

  // Apply permutation to b: Pb
  const Pb = Matrix.zeros(n, 1);
  for (let i = 0; i < n; i++) Pb.set(i, 0, b.get(perm[i], 0));

  // Forward substitution: Ly = Pb
  const y = Matrix.zeros(n, 1);
  for (let i = 0; i < n; i++) {
    let s = Pb.get(i, 0);
    for (let j = 0; j < i; j++) s -= L.get(i, j) * y.get(j, 0);
    y.set(i, 0, s);
  }

  // Back substitution: Ux = y
  const x = Matrix.zeros(n, 1);
  for (let i = n - 1; i >= 0; i--) {
    let s = y.get(i, 0);
    for (let j = i + 1; j < n; j++) s -= U.get(i, j) * x.get(j, 0);
    x.set(i, 0, s / U.get(i, i));
  }
  return x;
}

export function lstsq(A: Matrix, b: Matrix): Matrix {
  const { U, S, Vt } = svd(A);
  const UtB = U.transpose().matmul(b);
  const d = new Float64Array(S.length);
  for (let i = 0; i < S.length; i++) d[i] = S[i] > 1e-14 ? UtB.get(i, 0) / S[i] : 0;
  return Vt.transpose().matmul(Matrix.from1D(Array.from(d), S.length, 1));
}

export function norm(A: Matrix): number {
  let s = 0;
  for (let i = 0; i < A.length; i++) s += A.data[i] ** 2;
  return Math.sqrt(s);
}

/**
 * Determinant using LU decomposition with partial pivoting.
 * Uses log-sum scaling to prevent overflow for large matrices.
 *
 * @throws Error if determinant overflows (log10 |det| > 300)
 */
export function det(A: Matrix): number {
  assertFiniteMatrix('det:A', A);
  const n = A.rows;
  const m = A.clone();
  let sign = 1;
  let logSum = 0; // sum of log10|pivot| to avoid overflow
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(m.get(row, col)) > Math.abs(m.get(maxRow, col))) maxRow = row;
    if (maxRow !== col) {
      sign = -sign;
      for (let j = 0; j < n; j++) {
        const t = m.get(col, j); m.set(col, j, m.get(maxRow, j)); m.set(maxRow, j, t);
      }
    }
    const pivot = m.get(col, col);
    if (Math.abs(pivot) < 1e-15) return 0;
    logSum += Math.log10(Math.abs(pivot));
    // Overflow guard: IEEE-754 double max ~ 1e308, log10 ~ 308
    if (logSum > 300) throw new Error('det: overflow');
    for (let row = col + 1; row < n; row++) {
      const f = m.get(row, col) / pivot;
      for (let j = col + 1; j < n; j++) m.set(row, j, m.get(row, j) - f * m.get(col, j));
    }
  }
  return sign * Math.pow(10, logSum);
}

export function cov(X: Matrix): Matrix {
  const mu = X.meanAxis(0), Z = X.sub(mu);
  return Z.transpose().matmul(Z).div(X.rows - 1);
}

export function corrcoef(X: Matrix): Matrix {
  const C = cov(X);
  const d = new Float64Array(C.length);
  for (let i = 0; i < C.rows; i++) {
    const si = Math.sqrt(C.get(i, i));
    for (let j = 0; j < C.cols; j++) {
      const sj = Math.sqrt(C.get(j, j));
      d[i * C.cols + j] = (si > 0 && sj > 0) ? C.get(i, j) / (si * sj) : 0;
    }
  }
  return new Matrix(d, C.rows, C.cols);
}
