/**
 * Morphological Integration (Two-Block Partial Least Squares) — replaces
 * morphometrics/allometry.py::IntegrationAnalyzer.analyze_pls.
 *
 * 2B-PLS finds pairs of singular vectors (LV_a, LV_b) that maximise the
 * cross-covariance between two blocks of variables (Rohlf & Corti 2000):
 *
 *     C_AB = (1/(n-1)) · X_A' · X_B,   C_AB = U·S·V'
 *     scores_A = X_A·U,  scores_B = X_B·V
 *
 * Integration index = mean |corr(score_i, score'_i)| over PLS components
 * (the Python definition); the overall Escoufier (1973) RV coefficient is
 * also reported for reference:
 *   RV = tr(Σ_{ab} Σ_{ba}) / sqrt(tr(Σ_{aa}²) · tr(Σ_{bb}²))
 */
import { Matrix } from '../../math/Matrix';
import * as linalg from '../../math/linalg';
import { seed, randint } from '../../math/random';

export interface PLSResult {
  singularValues: number[];
  LVa: Matrix;          // (n_obs, n_components) for block A
  LVb: Matrix;          // (n_obs, n_components) for block B
  /** Mean absolute per-component score correlation (Python integration_index). */
  integrationIndex: number;
  pValue: number;                // permutation p-value
  correlation: number[];         // correlation of each LV pair
  nPermutations: number;
  alternative: 'two-sided' | 'greater' | 'less';
  /** Percentage of total cross-block covariance per component. */
  covarianceExplained: number[];
  /** Cumulative covariance explained (%). */
  cumulativeCovariance: number[];
  /** PLS loadings (singular vectors) of block A (n_vars_a × k). */
  plsLoadingsLeft: Matrix;
  /** PLS loadings (singular vectors) of block B (n_vars_b × k). */
  plsLoadingsRight: Matrix;
  /** Overall Escoufier RV coefficient (kept in addition to the index). */
  rvCoefficient: number;
}

/**
 * Compute 2-block PLS integration between two blocks of variables.
 *
 * @param blockA         (n_obs, p) block A
 * @param blockB         (n_obs, q) block B
 * @param nComponents    number of LV pairs (default min(p, q, n_obs-1))
 * @param nPermutations  permutation iterations for p-value
 * @param alternative    'two-sided' (default), 'greater', or 'less' for p-value
 * @param rngSeed        seed for reproducible permutations (default 42)
 */
export function plsIntegration(
  blockA: Matrix | number[][],
  blockB: Matrix | number[][],
  nComponents?: number,
  nPermutations: number = 999,
  alternative: 'two-sided' | 'greater' | 'less' = 'two-sided',
  rngSeed: number = 42
): PLSResult {
  const A = blockA instanceof Matrix ? blockA : _matrixFromArray(blockA);
  const B = blockB instanceof Matrix ? blockB : _matrixFromArray(blockB);
  if (A.rows !== B.rows) throw new Error('blockA and blockB must have same number of rows');
  if (A.rows < 3) throw new Error('Need at least 3 specimens for PLS analysis');

  const Ac = A.sub(A.meanAxis(0));
  const Bc = B.sub(B.meanAxis(0));

  // Cross-block covariance:  C = A^T B / (n-1)
  const C = Ac.transpose().matmul(Bc).div(Math.max(1, A.rows - 1));

  // SVD of C via linalg
  const svd = linalg.svd(C);
  const maxComp = Math.min(svd.S.length, A.cols, B.cols, A.rows - 1);
  const k = Math.min(nComponents ?? maxComp, maxComp);
  // Ur columns = svd.U[:, :k]   |   Vr = Vt[:k].T (q × k)
  const Ur = _sliceColumns(svd.U, k);
  const Vr = _sliceVTColumns(svd.Vt, k);
  const sv = svd.S.slice(0, k);

  const LVa = Ac.matmul(Ur);
  const LVb = Bc.matmul(Vr);

  // Per-component RV: correlation of each score pair (Python analyze_pls)
  const corr: number[] = [];
  for (let i = 0; i < k; i++) {
    const a = LVa.col(i), b = LVb.col(i);
    const am = a.reduce((s, v) => s + v, 0) / a.length;
    const bm = b.reduce((s, v) => s + v, 0) / b.length;
    let num = 0, da = 0, db = 0;
    for (let i2 = 0; i2 < a.length; i2++) { const x = a[i2] - am, y = b[i2] - bm; num += x * y; da += x * x; db += y * y; }
    const denom = Math.sqrt(da * db);
    corr.push(da > 0 && db > 0 ? num / denom : 0);
  }

  // Overall integration index: mean absolute RV over components
  const integrationIndex = corr.reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, corr.length);

  // Overall Escoufier RV coefficient (kept for reference)
  const Saa = Ac.transpose().matmul(Ac);
  const Sbb = Bc.transpose().matmul(Bc);
  const trSaaSq = _traceSquare(Saa);
  const trSbbSq = _traceSquare(Sbb);
  let trCabCba = 0;
  for (let i = 0; i < C.rows; i++) for (let j = 0; j < C.cols; j++) trCabCba += C.get(i, j) * C.get(i, j);
  const denom = Math.sqrt(Math.max(1e-300, trSaaSq * trSbbSq));
  const RV = trCabCba / denom;

  // Covariance explained (against the full singular spectrum)
  const totalVariance = svd.S.reduce((s, v) => s + v * v, 0);
  const covarianceExplained = totalVariance > 0
    ? sv.map(v => (v * v) / totalVariance * 100)
    : new Array<number>(k).fill(0);
  const cumulativeCovariance: number[] = [];
  let acc = 0;
  for (const v of covarianceExplained) { acc += v; cumulativeCovariance.push(acc); }

  // Permutation test — only block B's rows are permuted.  (The previous
  // implementation applied the same permutation to BOTH blocks, which left
  // the pairing intact and drove every p-value to 1.)
  let countGreater = 0, countLess = 0;
  seed(rngSeed);
  for (let p = 0; p < nPermutations; p++) {
    const perm = new Array(Ac.rows).fill(0).map((_, i) => i);
    for (let i = perm.length - 1; i > 0; i--) {
      const j = randint(0, i + 1);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const Bp = new Matrix(new Float64Array(Ac.rows * B.cols), Ac.rows, B.cols);
    for (let i = 0; i < Ac.rows; i++) {
      for (let j = 0; j < B.cols; j++) Bp.data[i * B.cols + j] = Bc.data[perm[i] * B.cols + j];
    }
    const Cp = Ac.transpose().matmul(Bp).div(Math.max(1, A.rows - 1));
    let tr = 0;
    for (let ii = 0; ii < Cp.rows; ii++) for (let jj = 0; jj < Cp.cols; jj++) tr += Cp.get(ii, jj) * Cp.get(ii, jj);
    if (tr >= trCabCba) countGreater++;
    if (tr <= trCabCba) countLess++;
  }
  // Compute p-value per alternative hypothesis
  let pValue: number;
  if (alternative === 'greater') pValue = (countGreater + 1) / (nPermutations + 1);
  else if (alternative === 'less') pValue = (countLess + 1) / (nPermutations + 1);
  else {
    // Two-sided: count deviations as extreme in either tail
    const twoSidedCount = Math.min(countGreater, countLess);
    pValue = (twoSidedCount * 2 + 1) / (nPermutations + 1);
  }

  return {
    singularValues: sv, LVa, LVb,
    integrationIndex, pValue, correlation: corr, nPermutations, alternative,
    covarianceExplained, cumulativeCovariance,
    plsLoadingsLeft: Ur, plsLoadingsRight: Vr,
    rvCoefficient: RV,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────────
function _matrixFromArray(arr: number[][]): Matrix {
  const rows = arr.length, cols = arr[0]?.length ?? 0;
  const d = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) d[i * cols + j] = arr[i][j];
  return new Matrix(d, rows, cols);
}

function _traceSquare(M: Matrix): number {
  // tr(M · M) = sum over i,j of M_ij² ... actually tr(MM) = sum_k (M M^T)_kk = sum_i sum_j M_ij M_ij = Frobenius²
  let s = 0;
  for (let i = 0; i < M.length; i++) s += M.data[i] * M.data[i];
  return s;
}

function _sliceColumns(M: Matrix, k: number): Matrix {
  const cols = Math.min(k, M.cols);
  const d = new Float64Array(M.rows * cols);
  for (let i = 0; i < M.rows; i++)
    for (let j = 0; j < cols; j++)
      d[i * cols + j] = M.data[i * M.cols + j];
  return new Matrix(d, M.rows, cols);
}

function _sliceVTColumns(Vt: Matrix, k: number): Matrix {
  const rows = Math.min(k, Vt.rows);
  const d = new Float64Array(Vt.cols * rows);
  for (let i = 0; i < Vt.cols; i++)
    for (let j = 0; j < rows; j++)
      d[i * rows + j] = Vt.data[j * Vt.cols + i];
  return new Matrix(d, Vt.cols, rows);
}
