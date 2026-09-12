import { Matrix } from '../../math/Matrix';
import { svd, eigh, inv } from '../../math/linalg';
// p-value paths use the verified CDF/quantile functions from math/stats
// (pt/pF/pchisq/pnorm/qnorm/qt/gammainc); the local *_approx helpers below are
// kept only because core/math is frozen (they must not gain new call sites).
import { mean, std, rankdata, skewness, kurtosis, pt, qt, pF, pchisq, pnorm, qchisq } from '../../math/stats';
import { randnArray } from '../../math/random';
import { seed, randint, shuffle as rngShuffle } from '../../math/random';
import { tukeyHsd, type TukeyPairResult } from './Tukey';

/**
 * PCA Result — mirrors Python PCAResult.
 */
export interface PCAResult {
  scores: Matrix;
  loadings: Matrix;
  eigenvalues: number[];
  explainedVariance: number[];
  cumulativeVariance: number[];
  eigenvaluesRaw: number[];
  meanVector: number[];
  nComponents: number;
  method: string;
}

/**
 * PCA via SVD — replaces statistics/pca.py.
 *
 * @param data         - data matrix (n samples × p variables)
 * @param nComponents  - number of components to extract (default: min(n-1, p))
 * @param scale        - if true, use correlation matrix (standardize columns to unit variance);
 *                       if false (default), use covariance matrix.
 *                       Equivalent to R's prcomp(scale=TRUE) / Python's sklearn PCA.
 * @param method       - 'covariance' (default) or 'correlation';
 *                       deprecated: use `scale` parameter instead.
 * @param imputeMissing- if true (default, matching Python pca.py
 *                       `impute_missing=True`), NaN cells are replaced with
 *                       the column mean (computed over non-NaN entries)
 *                       before the SVD. If false, NaNs propagate.
 */
export function pca(
  data: Matrix,
  nComponents?: number,
  scale: boolean = false,
  method?: 'covariance' | 'correlation',
  imputeMissing: boolean = true,
): PCAResult {
  const n = data.rows, p = data.cols;
  const maxComp = Math.min(n - 1, p);
  const nc = Math.min(nComponents ?? maxComp, maxComp);

  // Determine matrix type: explicit method overrides scale flag for backward compat
  const matrixType: 'covariance' | 'correlation' =
    method ?? (scale ? 'correlation' : 'covariance');

  // Column means ignoring NaN (used for centering and, when imputeMissing,
  // for NaN imputation — Python pca.py uses np.nanmean).
  const meanVec: number[] = [];
  const nanCounts: number[] = [];
  for (let j = 0; j < p; j++) {
    let s = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const v = data.get(i, j);
      if (!isNaN(v)) { s += v; cnt++; }
    }
    meanVec.push(cnt > 0 ? s / cnt : 0);
    nanCounts.push(n - cnt);
  }

  // Column SDs (ignoring NaN when imputing) — precomputed once for the
  // correlation branch, matching Python np.nanstd(ddof=1) semantics.
  const stdVec: number[] = new Array(p).fill(1);
  if (matrixType === 'correlation') {
    for (let j = 0; j < p; j++) {
      let ss = 0;
      for (let r = 0; r < n; r++) {
        const rv = data.get(r, j);
        if (isNaN(rv) && imputeMissing) continue; // imputed value = mean, dev 0
        ss += (rv - meanVec[j]) ** 2;
      }
      stdVec[j] = Math.sqrt(ss / Math.max(n - nanCounts[j] - 1, 1)) || 1;
    }
  }

  // Work on a copy so the caller's matrix is never mutated by imputation.
  const Zdata = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      let val = data.get(i, j);
      if (imputeMissing && isNaN(val)) val = meanVec[j]; // NaN -> column mean
      val -= meanVec[j];
      if (matrixType === 'correlation') val /= stdVec[j];
      Zdata[i * p + j] = val;
    }
  }
  const Z = new Matrix(Zdata, n, p);

  // SVD — call once, reuse S, U, Vt
  const { S, Vt } = svd(Z);
  const eigenvaluesRaw = S.map(s => (s * s) / (n - 1));

  const eigenvalues = eigenvaluesRaw.slice(0, nc);
  const totalVar = eigenvaluesRaw.reduce((a, b) => a + b, 0);
  const explainedVar = eigenvalues.map(e => totalVar > 0 ? (e / totalVar) * 100 : 0);
  const cumVar: number[] = [];
  let cum = 0;
  for (const v of explainedVar) { cum += v; cumVar.push(cum); }

  // Scores: T = Z @ V (V = Vt^T, take first nc columns)
  const V = Vt.transpose();
  const scores = Z.matmul(V.sliceCols(0, nc));

  // Loadings: P = V * sqrt(Λ) — shape (p, nc) to match Python
  const loadingsD = new Float64Array(p * nc);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < nc; j++) {
      const sq = Math.sqrt(Math.max(eigenvalues[j], 0));
      loadingsD[i * nc + j] = V.get(i, j) * sq;
    }
  }
  const loadings = new Matrix(loadingsD, p, nc);

  return {
    scores, loadings, eigenvalues,
    explainedVariance: explainedVar, cumulativeVariance: cumVar,
    eigenvaluesRaw, meanVector: meanVec, nComponents: nc, method: matrixType,
  };
}

/**
 * PCoA Result — mirrors Python PCoAResult.
 */
export interface PCoAResult {
  coordinates: Matrix;
  eigenvalues: number[];
  proportionExplained: number[];
  cumulativeProportion: number[];
  nComponents: number;
}

/**
 * PCoA — replaces statistics/pcoa.py.
 */
export function pcoa(distMatrix: Matrix, nComponents?: number): PCoAResult {
  const n = distMatrix.rows;
  const nc = Math.min(nComponents ?? Math.min(n - 1, 20), n - 1);

  // Double centering: B = -0.5 * J * D^2 * J
  const D2 = distMatrix.mul(distMatrix);
  const rowMeans: number[] = [];
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += D2.get(i, j); rowMeans.push(s / n); }
  const grandMean = D2.sum() / (n * n);

  const Bdata = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      Bdata[i * n + j] = -0.5 * (D2.get(i, j) - rowMeans[i] - rowMeans[j] + grandMean);
  const B = new Matrix(Bdata, n, n);

  const { eigenvalues: allEigs, eigenvectors: allVecs } = eigh(B);
  // Sort descending
  const sortedIdx = allEigs.map((_, i) => i).sort((a, b) => allEigs[b] - allEigs[a]);
  const eigs = sortedIdx.map(i => Math.max(allEigs[i], 0));
  const vecs = sortedIdx.map(i => allVecs.col(i));

  const eigenvalues = eigs.slice(0, nc);
  const totalEig = eigs.reduce((a, b) => a + b, 0);
  const proportion = eigenvalues.map(e => totalEig > 0 ? (e / totalEig) * 100 : 0);
  const cumProp: number[] = [];
  let cum = 0;
  for (const p of proportion) { cum += p; cumProp.push(cum); }

  // Coordinates = eigenvectors * sqrt(eigenvalues)
  const coordData = new Float64Array(n * nc);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < nc; j++)
      coordData[i * nc + j] = vecs[j][i] * Math.sqrt(eigenvalues[j]);

  return {
    coordinates: new Matrix(coordData, n, nc),
    eigenvalues, proportionExplained: proportion,
    cumulativeProportion: cumProp, nComponents: nc,
  };
}

/**
 * NMDS Result.
 */
export interface NMDSResult {
  coordinates: Matrix;
  stress: number;
  nIterations: number;
  converged: boolean;
  /** Which stress formula was optimized (see nmds `method`). */
  stressFormula?: string;
  /** Original dissimilarity matrix (for Shepard diagrams). */
  distanceMatrix?: Matrix;
  /** Per-iteration stress of the best restart. */
  stressHistory?: number[];
  /** Distance metric name (for reference). */
  metric?: string;
  /** Number of random restarts performed. */
  nRestarts?: number;
}

/**
 * NMDS via SMACOF + isotonic regression — replaces statistics/nmds.py.
 *
 * @param method stress formula:
 *  - 'raw_stress' (default, matches Python v1.0.0 algorithm):
 *    sqrt(sum((d_hat - d_tilde)^2) / sum(d_target^2)) — denominator uses the
 *    original dissimilarities (Kruskal 1964 / Borg & Groenen 1997 normalized
 *    stress).
 *  - 'stress_1' (Kruskal 1964 canonical, R vegan::monoMDS):
 *    sqrt(sum((d_hat - d_tilde)^2) / sum(d_hat^2)) — denominator uses the
 *    configuration distances.
 */
export function nmds(
  distMatrix: Matrix,
  nDimensions: number = 2,
  maxIterations: number = 300,
  nRestarts: number = 5,
  tolerance: number = 1e-6,
  rngSeed?: number,
  method: 'stress_1' | 'raw_stress' = 'raw_stress',
): NMDSResult {
  if (method !== 'stress_1' && method !== 'raw_stress') {
    throw new Error(`Unknown NMDS stress method '${method}'. Use 'raw_stress' (default) or 'stress_1'.`);
  }
  if (rngSeed !== undefined) seed(rngSeed);
  const n = distMatrix.rows;
  const iu: number[] = [], ju: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { iu.push(i); ju.push(j); }
  const nPairs = iu.length;
  const dTarget = iu.map((_, k) => distMatrix.get(iu[k], ju[k]));
  // Denominator fixed by the stress formula choice ('raw_stress': original
  // distances; 'stress_1': configuration distances, computed per iteration).
  const denomTarget = dTarget.reduce((s, d) => s + d * d, 0);

  let bestStress = Infinity, bestCoords: Matrix | null = null, bestIter = 0;
  let bestHistory: number[] = [];

  for (let restart = 0; restart < nRestarts; restart++) {
    // Random initialization
    const initD = new Float64Array(n * nDimensions);
    for (let i = 0; i < initD.length; i++) initD[i] = randnArray(1)[0] * 0.01;
    let X = new Matrix(initD, n, nDimensions);

    const history: number[] = [];
    let prevStress = Infinity;
    for (let iter = 0; iter < maxIterations; iter++) {
      // Compute current distances
      const Dhat = computeDistMatrix(X);
      const dHat = iu.map((_, k) => Dhat.get(iu[k], ju[k]));

      // Isotonic regression (pool-adjacent-violators, ties averaged)
      const dTilde = isotonicRegression(dTarget, dHat);

      // Stress formula selection (see docstring; Python nmds.py _smacof).
      let num = 0, den = 0;
      for (let k = 0; k < nPairs; k++) num += (dHat[k] - dTilde[k]) ** 2;
      den = method === 'raw_stress' ? denomTarget : dHat.reduce((s, d) => s + d * d, 0);
      const stress = den > 0 ? Math.sqrt(num / den) : 0;
      history.push(stress);

      // Track the best configuration across all iterations/restarts
      // (including the final, converged iteration).
      if (stress < bestStress) {
        bestStress = stress; bestCoords = X.clone(); bestIter = iter + 1; bestHistory = [...history];
      }

      // SMACOF convergence: absolute stress change < tolerance
      // Ref: Borg & Groenen (2005), Modern Multidimensional Scaling, 2nd ed. Ch. 9
      if (iter > 0 && Math.abs(stress - prevStress) < tolerance) { bestIter = iter + 1; break; }
      prevStress = stress;

      // Build disparity matrix
      const Dtilde = Matrix.zeros(n, n);
      for (let k = 0; k < nPairs; k++) { Dtilde.set(iu[k], ju[k], dTilde[k]); Dtilde.set(ju[k], iu[k], dTilde[k]); }

      // Guttman transform
      const B = Matrix.zeros(n, n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dhat = Dhat.get(i, j);
        B.set(i, j, dhat > 0 ? -Dtilde.get(i, j) / dhat : 0);
      }
      for (let i = 0; i < n; i++) {
        let s = 0; for (let j = 0; j < n; j++) s += B.get(i, j);
        B.set(i, i, -s);
      }
      X = B.matmul(X).div(n);
    }
  }

  return {
    coordinates: bestCoords!, stress: bestStress, nIterations: bestIter,
    converged: bestStress < 0.05,
    stressFormula: method, distanceMatrix: distMatrix.clone(),
    stressHistory: bestHistory, metric: 'nmds', nRestarts,
  };
}

/**
 * Shepard-diagram data for an NMDS result — port of Python nmds.py
 * `get_shepard_data`.
 *
 * Returns, for every upper-triangular pair (i < j):
 *  - `dissimilarity`: the original dissimilarity d_ij (x axis);
 *  - `shepardDistances`: the ordination distance d̂_ij of the final
 *    configuration (y axis, scatter points);
 *  - `originalDisparity`: the isotonic-regression disparity d̃_ij, i.e. the
 *    monotone fit through the Shepard diagram (step line);
 *  - `stress`: the result stress value.
 */
export function getShepardData(result: NMDSResult): {
  dissimilarity: number[];
  shepardDistances: number[];
  originalDisparity: number[];
  stress: number;
} {
  const D = result.distanceMatrix ?? null;
  if (D === null) throw new Error('No NMDS result available (distanceMatrix missing)');
  const n = D.rows;
  const iu: number[] = [], ju: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { iu.push(i); ju.push(j); }
  const dissimilarity = iu.map((_, k) => D.get(iu[k], ju[k]));
  const Dord = computeDistMatrix(result.coordinates);
  const shepardDistances = iu.map((_, k) => Dord.get(iu[k], ju[k]));
  // Disparities of the final configuration: monotone (isotonic) fit of d̂ on D.
  const originalDisparity = isotonicRegression(dissimilarity, shepardDistances);
  return { dissimilarity, shepardDistances, originalDisparity, stress: result.stress };
}

function computeDistMatrix(X: Matrix): Matrix {
  const n = X.rows, D = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let s = 0; for (let k = 0; k < X.cols; k++) s += (X.get(i, k) - X.get(j, k)) ** 2;
    const d = Math.sqrt(s); D.set(i, j, d); D.set(j, i, d);
  }
  return D;
}

function isotonicRegression(target: number[], weights: number[]): number[] {
  // Pool-adjacent-violators algorithm (O(n) with backtracking).
  // Ties handling: observations with EQUAL target values must receive the
  // SAME fitted value (sklearn IsotonicRegression aggregates tied x before
  // fitting; without this the NMDS disparities for tied dissimilarities
  // would differ, violating the definition of the monotone fit).
  const n = target.length;
  if (n === 0) return [];

  // ── Step 1: aggregate by unique target value ──
  const order = target.map((_, i) => i).sort((a, b) => target[a] - target[b]);
  const uniqVals: number[] = [];
  const uniqSums: number[] = [];   // sum of weights within the tie group
  const uniqCounts: number[] = []; // tie group size
  const groupOf: number[] = new Array(n); // original index -> unique group
  for (const idx of order) {
    const t = target[idx];
    let g = uniqVals.length - 1;
    if (g >= 0 && uniqVals[g] === t) {
      uniqSums[g] += weights[idx];
      uniqCounts[g] += 1;
    } else {
      uniqVals.push(t); uniqSums.push(weights[idx]); uniqCounts.push(1);
      g = uniqVals.length - 1;
    }
    groupOf[idx] = g;
  }
  const m = uniqVals.length;

  // ── Step 2: stack-based PAV on the aggregated (unique) values ──
  const blockSums: number[] = [uniqSums[0]];
  const blockCounts: number[] = [uniqCounts[0]];
  const blockSize: number[] = [1]; // number of unique groups merged in the block

  for (let i = 1; i < m; i++) {
    blockSums.push(uniqSums[i]);
    blockCounts.push(uniqCounts[i]);
    blockSize.push(1);
    // Merge while violating monotonicity
    while (blockSums.length >= 2) {
      const last = blockSums.length - 1;
      const meanLast = blockSums[last] / blockCounts[last];
      const meanPrev = blockSums[last - 1] / blockCounts[last - 1];
      if (meanLast < meanPrev) {
        blockSums[last - 1] += blockSums[last];
        blockCounts[last - 1] += blockCounts[last];
        blockSize[last - 1] += blockSize[last];
        blockSums.pop(); blockCounts.pop(); blockSize.pop();
      } else {
        break;
      }
    }
  }

  // ── Step 3: expand block means back to unique groups, then to indices ──
  const groupFitted = new Array<number>(m);
  let b = 0;
  for (const size of blockSize) {
    const blockMean = blockSums[b] / blockCounts[b];
    for (let k = 0; k < size; k++) groupFitted[b + k] = blockMean;
    b += size;
  }

  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) result[i] = groupFitted[groupOf[i]];
  return result;
}

/**
 * Univariate summary statistics for each column.
 */
export interface ColumnStats {
  name: string;
  n: number;
  mean: number;
  std: number;
  variance: number;
  min: number;
  max: number;
  median: number;
  skewness: number;
  kurtosis: number;
  se: number;
  ci95: [number, number];
}

export function univariateSummary(data: Matrix, colNames: string[]): ColumnStats[] {
  const results: ColumnStats[] = [];
  for (let j = 0; j < data.cols; j++) {
    const vals = data.col(j).filter(v => !isNaN(v));
    if (vals.length === 0) { results.push({ name: colNames[j] || `Var${j}`, n: 0, mean: 0, std: 0, variance: 0, min: 0, max: 0, median: 0, skewness: 0, kurtosis: 0, se: 0, ci95: [0, 0] }); continue; }
    const m = mean(vals), s = std(vals), v = s * s, med = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    const se_val = s / Math.sqrt(vals.length);
    // Fixed: compute actual skewness and kurtosis instead of hardcoding to 0
    const skew_val = skewness(vals);
    const kurt_val = kurtosis(vals);
    // 95% CI via the t quantile (Python uses sp_stats.t.ppf(0.975, n-1));
    // the normal approximation (1.96) is only asymptotically correct.
    const tCrit = qt(0.975, Math.max(vals.length - 1, 1));
    results.push({
      name: colNames[j] || `Var${j}`, n: vals.length,
      mean: m, std: s, variance: v, min: Math.min(...vals), max: Math.max(...vals),
      median: med, skewness: skew_val, kurtosis: kurt_val, se: se_val,
      ci95: [m - tCrit * se_val, m + tCrit * se_val],
    });
  }
  return results;
}

/**
 * t-test — port of Python univariate.py `t_test`.
 */
export interface TTestResult {
  statistic: number;
  pValue: number;
  df: number;
  meanDiff: number;
  /** 'independent' (Welch) or 'paired'. */
  testType?: string;
  n1?: number;
  n2?: number;
  mean1?: number;
  mean2?: number;
}

/**
 * Two-sample t-test.
 *
 * Independent samples (paired=false, default): Welch's unequal-variance
 * t-test — the previous implementation mixed a Welch standard error with
 * the pooled df = n1+n2-2, which is inconsistent; the df is now the
 * Welch–Satterthwaite approximation and the p-value uses the exact t
 * distribution (math/stats pt) instead of a normal approximation.
 *
 * Paired samples (paired=true): port of the Python `ttest_rel` branch —
 * d_i = x1_i - x2_i, t = mean(d) / (sd(d)/sqrt(n_d)), df = n_d - 1;
 * requires equal sample sizes.
 *
 * @param paired if true, perform the paired t-test (requires n1 == n2)
 */
export function tTest(group1: number[], group2: number[], paired: boolean = false): TTestResult {
  const n1 = group1.length, n2 = group2.length;
  const m1 = mean(group1), m2 = mean(group2);

  if (paired) {
    // Python: sp_stats.ttest_rel — differences within pairs
    if (n1 !== n2) throw new Error('Paired t-test requires equal sample sizes');
    const d = group1.map((v, i) => v - group2[i]);
    const nd = n1;
    const md = mean(d);
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - md) ** 2, 0) / (nd - 1));
    const se = sd / Math.sqrt(nd);
    const t = se > 0 ? md / se : 0;
    const df = nd - 1;
    const p = 2 * (1 - pt(Math.abs(t), Math.max(df, 1)));
    return { statistic: t, pValue: p, df, meanDiff: md, testType: 'paired', n1, n2, mean1: m1, mean2: m2 };
  }

  // Welch independent-samples t-test
  const v1 = group1.reduce((s, x) => s + (x - m1) ** 2, 0) / (n1 - 1);
  const v2 = group2.reduce((s, x) => s + (x - m2) ** 2, 0) / (n2 - 1);
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = se > 0 ? (m1 - m2) / se : 0;
  // Welch–Satterthwaite degrees of freedom
  const num = (v1 / n1 + v2 / n2) ** 2;
  const denom = (v1 / n1) ** 2 / Math.max(n1 - 1, 1) + (v2 / n2) ** 2 / Math.max(n2 - 1, 1);
  const df = denom > 0 ? num / denom : Math.max(n1 + n2 - 2, 1);
  const p = 2 * (1 - pt(Math.abs(t), Math.max(df, 1)));
  return { statistic: t, pValue: p, df, meanDiff: m1 - m2, testType: 'independent', n1, n2, mean1: m1, mean2: m2 };
}

function normCDF_approx(x: number): number {
  return 0.5 * (1 + erf_approx(x / Math.SQRT2));
}

function erf_approx(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  return sign * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

/**
 * ANOVA (one-way).
 */
export interface ANOVAResult {
  fStatistic: number;
  pValue: number;
  dfBetween: number;
  dfWithin: number;
  ssBetween: number;
  ssWithin: number;
  msBetween?: number;
  msWithin?: number;
  nGroups?: number;
  significant?: boolean;
  /** Tukey HSD post-hoc comparisons (only when significant, mirrors Python). */
  tukeyResults?: TukeyPairResult[];
}

/**
 * One-way ANOVA — port of Python univariate.py `one_way_anova`.
 * p-value from the exact F CDF (math/stats pF); when `tukey` is true and
 * the ANOVA is significant, Tukey HSD post-hoc comparisons are attached
 * (identical to scipy.stats.tukey_hsd / the Python fallback path).
 */
export function anova(groups: number[][], tukey: boolean = true): ANOVAResult {
  const allVals = groups.flat();
  const grandMean = mean(allVals);
  const k = groups.length;
  const N = allVals.length;

  let ssb = 0, ssw = 0;
  for (const g of groups) {
    const gm = mean(g);
    ssb += g.length * (gm - grandMean) ** 2;
    for (const v of g) ssw += (v - gm) ** 2;
  }

  const dfb = k - 1, dfw = N - k;
  const msb = dfb > 0 ? ssb / dfb : 0;
  const msw = dfw > 0 ? ssw / dfw : 0;
  const f = msw > 0 ? msb / msw : 0;

  // Exact F-distribution upper-tail probability (replaces the local
  // series-expansion approximation of the incomplete beta).
  const p = 1 - pF(f, dfb, dfw);

  // Tukey HSD post-hoc on significant results (Python: tukey=True branch)
  let tukeyResults: TukeyPairResult[] | undefined = undefined;
  if (tukey && p < 0.05 && k >= 2 && msw > 0) {
    tukeyResults = tukeyHsd(groups);
  }

  return {
    fStatistic: f, pValue: p, dfBetween: dfb, dfWithin: dfw, ssBetween: ssb, ssWithin: ssw,
    msBetween: msb, msWithin: msw, nGroups: k, significant: p < 0.05, tukeyResults,
  };
}

function fCDF_approx(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  const a = d1 / 2, b = d2 / 2;
  const z = d1 * x / (d1 * x + d2);
  // Approximate incomplete beta
  return betainc_approx(a, b, z);
}

function betainc_approx(a: number, b: number, x: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  // Simple series expansion
  let sum = 0, term = 1;
  for (let n = 0; n < 100; n++) {
    if (n > 0) term *= (a + n - 1) * x / (a + b + n - 1);
    const coeff = term / (a + n);
    sum += coeff;
    if (Math.abs(coeff) < 1e-12) break;
  }
  const lbeta = lgamma_approx(a) + lgamma_approx(b) - lgamma_approx(a + b);
  return sum * Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta);
}

function lgamma_approx(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma_approx(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * ANOSIM — replaces statistics/anosim.py.
 */
export interface ANOSIMResult {
  statistic: number;
  pValue: number;
  nPermutations: number;
}

export function anosim(distMatrix: Matrix, groups: number[], nPermutations: number = 999, rngSeed?: number): ANOSIMResult {
  if (rngSeed !== undefined) seed(rngSeed);
  const n = distMatrix.rows;
  const R_obs = computeR(distMatrix, groups, n);

  let count = 0;
  for (let perm = 0; perm < nPermutations; perm++) {
    const shuffled = [...groups];
    for (let i = n - 1; i > 0; i--) { const j = randint(0, i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const R_perm = computeR(distMatrix, shuffled, n);
    if (R_perm >= R_obs) count++;
  }

  return { statistic: R_obs, pValue: (count + 1) / (nPermutations + 1), nPermutations };
}

function computeR(D: Matrix, groups: number[], n: number): number {
  // Convert to similarities and rank with TIE AVERAGING — port of Python
  // anosim.py `_compute_R_statistic`, which assigns the average rank to all
  // tied similarity values (the previous implementation assigned sequential
  // ranks 1..N, biasing R whenever the distance matrix contains ties).
  const simVals: { val: number; i: number; j: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    simVals.push({ val: 1 - D.get(i, j), i, j });
  }
  // Stable sort from largest to smallest similarity
  const order = simVals.map((_, k) => k).sort((a, b) => {
    if (simVals[b].val !== simVals[a].val) return simVals[b].val - simVals[a].val;
    return a - b;
  });
  const ranks = new Map<string, number>();
  let k = 0;
  while (k < order.length) {
    let m = k;
    while (m + 1 < order.length && simVals[order[m + 1]].val === simVals[order[k]].val) m++;
    // Ties span positions k..m (1-based ranks k+1..m+1): average rank
    const avgRank = (k + 1 + (m + 1)) / 2;
    for (let t = k; t <= m; t++) {
      const pair = simVals[order[t]];
      ranks.set(`${pair.i},${pair.j}`, avgRank);
    }
    k = m + 1;
  }

  const rB: number[] = [], rW: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const rank = ranks.get(`${i},${j}`) ?? 0;
    if (groups[i] !== groups[j]) rB.push(rank); else rW.push(rank);
  }

  const meanB = rB.length > 0 ? mean(rB) : 0;
  const meanW = rW.length > 0 ? mean(rW) : 0;
  const N = n * (n - 1) / 2;
  return N > 0 ? (meanB - meanW) / (N / 2) : 0;
}

// ═══════════════════════════════════════════════════════════════════
// LDA / CVA
// ═══════════════════════════════════════════════════════════════════

export interface LDAResult {
  scores: Matrix;
  loadings: Matrix;
  explainedVarianceRatio: number[];
  eigenvalues: number[];
  wilksLambda: number[];
  confusionMatrix: number[][];
  accuracy: number;
  nClasses: number;
  nSamples: number;
  classLabels: number[];
  means: Matrix;
  groups: number[];
}

/**
 * Fit LDA on a data matrix and return the top-nc discriminant loadings plus
 * the class centroids in LD space. Used by `lda` (full fit) and by the
 * k-fold cross-validation branch (refit on each training split, so the
 * held-out folds are classified without data leakage).
 */
function ldaFit(data: Matrix, groups: number[], uniqueGroups: number[], nc: number): { loadings: Matrix; centroidsLD: Matrix } {
  const p = data.cols;
  const k = uniqueGroups.length;

  const grandMean = data.meanAxis(0);
  const classMeans: Matrix[] = [];
  for (const g of uniqueGroups) {
    const idx = groups.map((v, i) => v === g ? i : -1).filter(i => i >= 0);
    const d = new Float64Array(p);
    for (const i of idx) for (let j = 0; j < p; j++) d[j] += data.get(i, j);
    for (let j = 0; j < p; j++) d[j] /= idx.length;
    classMeans.push(new Matrix(d, 1, p));
  }

  // Within-class scatter Sw
  const Sw = Matrix.zeros(p, p);
  for (let ci = 0; ci < k; ci++) {
    const idx = groups.map((v, i) => v === uniqueGroups[ci] ? i : -1).filter(i => i >= 0);
    for (const i of idx) {
      const diff = data.row(i).map((v, j) => v - classMeans[ci].get(0, j));
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
        Sw.set(a, b, Sw.get(a, b) + diff[a] * diff[b]);
      }
    }
  }

  // Between-class scatter Sb
  const Sb = Matrix.zeros(p, p);
  for (let ci = 0; ci < k; ci++) {
    const diff = classMeans[ci].row(0).map((v, j) => v - grandMean.get(0, j));
    const ni = groups.filter(v => v === uniqueGroups[ci]).length;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
      Sb.set(a, b, Sb.get(a, b) + ni * diff[a] * diff[b]);
    }
  }

  // Solve Sw^-1 * Sb via the SVD of Sw (pseudo-inverse with threshold)
  const { S: swS, Vt: swVt } = svd(Sw);
  const swInvD = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    const invS = swS[i] > 1e-10 ? 1 / swS[i] : 0;
    for (let j = 0; j < p; j++) swInvD[i * p + j] = swVt.get(i, j) * invS;
  }
  const swInv = swVt.transpose().matmul(new Matrix(swInvD, p, p).transpose());
  const M = swInv.matmul(Sb);
  const { eigenvectors: eVecs } = eigh(M);
  const loadings = eVecs.sliceCols(0, nc);

  const centroidsLD = Matrix.zeros(k, nc);
  for (let ci = 0; ci < k; ci++) {
    const cm = classMeans[ci].matmul(loadings);
    for (let j = 0; j < nc; j++) centroidsLD.set(ci, j, cm.get(0, j));
  }
  return { loadings, centroidsLD };
}

/** Classify a sample (in LD space) by nearest class centroid. */
function ldaPredict1LD(sampleLD: number[], centroidsLD: Matrix, k: number, nc: number): number {
  let bestDist = Infinity, bestClass = 0;
  for (let ci = 0; ci < k; ci++) {
    let dist = 0;
    for (let j = 0; j < nc; j++) dist += (sampleLD[j] - centroidsLD.get(ci, j)) ** 2;
    if (dist < bestDist) { bestDist = dist; bestClass = ci; }
  }
  return bestClass;
}

/**
 * LDA / CVA — replaces statistics/lda.py.
 *
 * @param nComponents number of LD axes (default min(k-1, p))
 * @param cvFolds     cross-validation scheme for the reported accuracy and
 *                    confusion matrix:
 *   - 0/1 (default): Leave-One-Out CV — retained for backward compatibility.
 *     NOTE (documented data leakage): the LOOCV path projects ALL samples
 *     with loadings computed from the FULL data, and only the centroids are
 *     recomputed excluding the held-out sample. The projection directions
 *     therefore saw the held-out sample during fitting; LOOCV accuracy here
 *     is mildly optimistic. Kept as-is for compatibility with the v1
 *     behaviour; use `cvFolds >= 2` for a strictly leakage-free estimate
 *     (the k-fold path refits the full LDA on each training split).
 *   - f >= 2: stratified-free random f-fold CV (indices shuffled with the
 *     seeded RNG from math/random for reproducibility); each fold is
 *     classified by an LDA refit on the remaining f-1 folds — port of
 *     Python lda.py `cv_folds` via sklearn cross_val_predict.
 */
export function lda(data: Matrix, groups: number[], nComponents?: number, cvFolds: number = 0): LDAResult {
  const n = data.rows, p = data.cols;
  const uniqueGroups = [...new Set(groups)].sort((a, b) => a - b);
  const k = uniqueGroups.length;
  const nc = Math.min(nComponents ?? k - 1, k - 1, p);

  // Grand mean
  const grandMean = data.meanAxis(0);

  // Class means and sizes
  const classMeans: Matrix[] = [];
  const classSizes: number[] = [];
  for (const g of uniqueGroups) {
    const idx = groups.map((v, i) => v === g ? i : -1).filter(i => i >= 0);
    classSizes.push(idx.length);
    const d = new Float64Array(p);
    for (const i of idx) for (let j = 0; j < p; j++) d[j] += data.get(i, j);
    for (let j = 0; j < p; j++) d[j] /= idx.length;
    classMeans.push(new Matrix(d, 1, p));
  }

  // Within-class scatter Sw
  const Sw = Matrix.zeros(p, p);
  for (let ci = 0; ci < k; ci++) {
    const idx = groups.map((v, i) => v === uniqueGroups[ci] ? i : -1).filter(i => i >= 0);
    for (const i of idx) {
      const diff = data.row(i).map((v, j) => v - classMeans[ci].get(0, j));
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
        Sw.set(a, b, Sw.get(a, b) + diff[a] * diff[b]);
      }
    }
  }

  // Between-class scatter Sb
  const Sb = Matrix.zeros(p, p);
  for (let ci = 0; ci < k; ci++) {
    const diff = classMeans[ci].row(0).map((v, j) => v - grandMean.get(0, j));
    const ni = classSizes[ci];
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
      Sb.set(a, b, Sb.get(a, b) + ni * diff[a] * diff[b]);
    }
  }

  // Solve generalized eigenvalue problem: Sw^-1 * Sb
  // Use SVD of Sw for regularization
  const { S: swS, Vt: swVt } = svd(Sw);
  // Regularize: invert with threshold
  const swInvD = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    const invS = swS[i] > 1e-10 ? 1 / swS[i] : 0;
    for (let j = 0; j < p; j++) swInvD[i * p + j] = swVt.get(i, j) * invS;
  }
  const swInv = swVt.transpose().matmul(new Matrix(swInvD, p, p).transpose());

  // Sw^-1 * Sb
  const M = swInv.matmul(Sb);
  const { eigenvalues: eigs, eigenvectors: eVecs } = eigh(M);

  // Wilks' Lambda: Λ = |Sw| / |Sw + Sb|
  // Ref: Wilks S.S. (1932) Biometrika 24: 471-494.
  //      Anderson T.W. (2003) An Introduction to Multivariate Statistical Analysis, 3rd ed. Ch. 12.
  // Wilks' Lambda for each canonical variate = Π (1 / (1 + λ_i)) where λ_i are
  // the generalized eigenvalues of Sw^-1 * Sb.
  // Λ_cumulative = |Sw| / |Sw + Sb| = Π_i (1 / (1 + λ_i))
  const wilksLambdaVals: number[] = [];
  const posGenEigs = eigs.filter(e => e > 1e-12);
  let cumLambda = 1;
  for (const lambda of posGenEigs) {
    cumLambda *= 1 / (1 + lambda);
    wilksLambdaVals.push(cumLambda);
  }
  // Extend to nc components (pad with last value if needed)
  while (wilksLambdaVals.length < nc) wilksLambdaVals.push(wilksLambdaVals[wilksLambdaVals.length - 1] ?? 1);

  // Take top nc eigenvectors (sorted descending by eigh)
  const loadings = eVecs.sliceCols(0, nc);
  const eigTop = eigs.slice(0, nc);
  const totalEig = eigs.reduce((a, b) => a + Math.max(0, b), 0);
  const explainedRatio = eigTop.map(e => totalEig > 0 ? Math.max(0, e) / totalEig : 0);

  // Project data
  const scores = data.matmul(loadings);

  // Class means in LD space
  const classMeansLD = Matrix.zeros(k, nc);
  for (let ci = 0; ci < k; ci++) {
    const cm = classMeans[ci].matmul(loadings);
    for (let j = 0; j < nc; j++) classMeansLD.set(ci, j, cm.get(0, j));
  }

  // Confusion matrix + accuracy via cross-validation.
  // Ref: Ripley (1996) Pattern Recognition and Neural Networks, Sec 4.5
  //
  // cvFolds >= 2 → k-fold CV (leakage-free: LDA refit on each training split).
  // cvFolds 0/1 (default) → LOOCV:
  //   WARNING — known data leakage (documented, kept for v1 compatibility):
  //   `scores` below were produced with loadings fitted on the FULL data, so
  //   every held-out sample influenced the projection directions; only the
  //   centroids are recomputed excluding it. The LOOCV accuracy is therefore
  //   mildly optimistic. Callers wanting an unbiased estimate must pass
  //   cvFolds >= 2.
  const cm = Array.from({ length: k }, () => new Array(k).fill(0));
  let correct = 0;
  if (cvFolds >= 2) {
    // ── k-fold cross-validation (Python lda.py cv_folds) ──
    // Shuffle sample indices with the seeded RNG (reproducible), then split
    // into cvFolds near-equal folds. For each fold: refit LDA on the rest,
    // classify the held-out fold by nearest refit centroid in LD space.
    const indices = Array.from({ length: n }, (_, i) => i);
    rngShuffle(indices);
    const folds: number[][] = Array.from({ length: cvFolds }, () => []);
    for (let i = 0; i < n; i++) folds[i % cvFolds].push(indices[i]);
    for (let f = 0; f < cvFolds; f++) {
      const testIdx = new Set(folds[f]);
      const trainIdx = indices.filter(i => !testIdx.has(i));
      if (trainIdx.length === 0 || folds[f].length === 0) continue;
      const trainData = new Matrix(
        (() => { const d = new Float64Array(trainIdx.length * p); trainIdx.forEach((r, i) => { const row = data.row(r); for (let j = 0; j < p; j++) d[i * p + j] = row[j]; }); return d; })(),
        trainIdx.length, p,
      );
      const trainGroups = trainIdx.map(i => groups[i]);
      const fit = ldaFit(trainData, trainGroups, uniqueGroups, nc);
      for (const i of folds[f]) {
        const row = data.row(i);
        const ld = new Array<number>(nc);
        for (let j = 0; j < nc; j++) { let s = 0; for (let a = 0; a < p; a++) s += row[a] * fit.loadings.get(a, j); ld[j] = s; }
        const predClass = ldaPredict1LD(ld, fit.centroidsLD, k, nc);
        const trueClass = uniqueGroups.indexOf(groups[i]);
        cm[trueClass][predClass]++;
        if (trueClass === predClass) correct++;
      }
    }
  } else {
    // ── LOOCV path (leaky projection, see warning above) ──
    for (let i = 0; i < n; i++) {
      // Compute LOOCV centroid: mean of all OTHER samples in each class
      const looCentroids = Matrix.zeros(k, nc);
      for (let ci = 0; ci < k; ci++) {
        const idx = groups.map((v, j) => v === uniqueGroups[ci] ? j : -1).filter(j => j >= 0 && j !== i);
        if (idx.length === 0) continue;
        for (const j of idx) {
          const row = scores.row(j);
          for (let d = 0; d < nc; d++) looCentroids.set(ci, d, looCentroids.get(ci, d) + row[d]);
        }
        for (let d = 0; d < nc; d++) looCentroids.set(ci, d, looCentroids.get(ci, d) / idx.length);
      }
      const sampleScore = scores.row(i);
      const bestClass = ldaPredict1LD(sampleScore, looCentroids, k, nc);
      const trueClass = uniqueGroups.indexOf(groups[i]);
      cm[trueClass][bestClass]++;
      if (trueClass === bestClass) correct++;
    }
  }

  return {
    scores, loadings, explainedVarianceRatio: explainedRatio, eigenvalues: eigTop,
    wilksLambda: wilksLambdaVals.slice(0, nc),
    confusionMatrix: cm, accuracy: correct / n, nClasses: k, nSamples: n,
    classLabels: uniqueGroups, means: classMeansLD, groups,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CCA / RDA
// ═══════════════════════════════════════════════════════════════════

export interface CCAResult {
  siteScores: Matrix;
  speciesScores: Matrix;
  biplotScores: Matrix;
  eigenvalues: number[];
  proportionExplained: number[];
  cumulativeProportion: number[];
  constrainedVariance: number;
  method: string;
  nComponents: number;
  /** Total inertia: chi-square inertia (cca) or total SS of centered Y (rda),
   *  mirroring Python cca.py `inertia`. */
  inertia?: number;
  /** Names of species/variables (columns of Y). */
  speciesNames?: string[];
  /** Names of environmental variables (columns of X). */
  envNames?: string[];
}

export function cca(
  Y: Matrix,
  X: Matrix,
  nComponents?: number,
  method: 'cca' | 'rda' = 'cca',
  speciesNames?: string[],
  envNames?: string[],
): CCAResult {
  const n = Y.rows, p = Y.cols, q = X.cols;
  const nc = Math.min(nComponents ?? Math.min(n - 1, p, q), n - 1, p, q);
  const spNames = speciesNames ?? Array.from({ length: p }, (_, i) => `Species_${i + 1}`);
  const envNms = envNames ?? Array.from({ length: q }, (_, i) => `Env_${i + 1}`);

  if (method === 'rda') {
    // RDA: center Y and X, project Y onto X
    const Yc = Y.sub(Y.meanAxis(0));
    const Xc = X.sub(X.meanAxis(0));
    const XtX = Xc.transpose().matmul(Xc);
    const XtXinv = inv(XtX);
    const Q = Xc.matmul(XtXinv).matmul(Xc.transpose()); // Hat matrix
    const M = Yc.transpose().matmul(Q).matmul(Yc);
    const { eigenvalues: eigs, eigenvectors: eVecs } = eigh(M);
    const eigTop = eigs.slice(0, nc);
    const totalInertia = Yc.mul(Yc).sum();
    const prop = eigTop.map(e => totalInertia > 0 ? Math.max(0, e) / totalInertia * 100 : 0);
    const cumProp: number[] = []; let cum = 0; for (const v of prop) { cum += v; cumProp.push(cum); }
    const siteScores = Yc.matmul(eVecs.sliceCols(0, nc));
    const speciesScores = eVecs.sliceCols(0, nc);
    const biplotScores = Xc.transpose().matmul(siteScores);
    return {
      siteScores, speciesScores, biplotScores, eigenvalues: eigTop, proportionExplained: prop,
      cumulativeProportion: cumProp, constrainedVariance: cumProp[cumProp.length - 1] || 0,
      method: 'rda', nComponents: nc,
      inertia: totalInertia, speciesNames: spNames, envNames: envNms,
    };
  } else {
    // CCA: chi-square standardization via Legendre & Gallagher (2001) formula.
    // Ref: Legendre P., Gallagher E.D. (2001). Ecological Bioinformatics, Table 1.
    // chi-square transform: y*_ij = (y_ij / y_i+) / sqrt(y+_j / y++)
    // which satisfies that the chi-square distance between sites equals
    // the Euclidean distance in the transformed space (vegan::decostand 'chi.square').
    const rowTotals = Y.sumAxis(1);       // y_i+ (site totals)
    const colTotals = Y.sumAxis(0);       // y+_j (species totals)
    const grandTotal = Y.sum();            // y++
    // Transform: Y_chi = (Y ./ rowTotals) ./ sqrt(colTotals / grandTotal)
    // Row-normalize then weight by inverse sqrt of column margins
    const rowNorm = Matrix.zeros(n, p);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) {
      const ri = rowTotals[i] > 0 ? 1 / rowTotals[i] : 0;
      rowNorm.set(i, j, Y.get(i, j) * ri);
    }
    for (let j = 0; j < p; j++) {
      const sqrtCol = Math.sqrt(colTotals[j] / grandTotal);
      for (let i = 0; i < n; i++) rowNorm.set(i, j, rowNorm.get(i, j) / (sqrtCol > 0 ? sqrtCol : 1));
    }
    const Ychi = rowNorm;
    const Xc = X.sub(X.meanAxis(0));
    const XtX = Xc.transpose().matmul(Xc);
    const XtXinv = inv(XtX);
    const Q = Xc.matmul(XtXinv).matmul(Xc.transpose());
    const M = Ychi.transpose().matmul(Q).matmul(Ychi);
    const { eigenvalues: eigs, eigenvectors: eVecs } = eigh(M);
    const eigTop = eigs.slice(0, nc);
    const totalInertia = Ychi.mul(Ychi).sum();
    const prop = eigTop.map(e => totalInertia > 0 ? Math.max(0, e) / totalInertia * 100 : 0);
    const cumProp: number[] = []; let cum = 0; for (const v of prop) { cum += v; cumProp.push(cum); }
    const siteScores = Ychi.matmul(eVecs.sliceCols(0, nc));
    const speciesScores = eVecs.sliceCols(0, nc);
    const biplotScores = Xc.transpose().matmul(siteScores);
    return {
      siteScores, speciesScores, biplotScores, eigenvalues: eigTop, proportionExplained: prop,
      cumulativeProportion: cumProp, constrainedVariance: cumProp[cumProp.length - 1] || 0,
      method: 'cca', nComponents: nc,
      inertia: totalInertia, speciesNames: spNames, envNames: envNms,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PERMANOVA
// ═══════════════════════════════════════════════════════════════════

export interface PERMANOVAResult {
  fStatistic: number;
  pValue: number;
  ssBetween: number;
  ssWithin: number;
  dfBetween: number;
  dfWithin: number;
  nPermutations: number;
}

export function permanova(distMatrix: Matrix, groups: number[], nPermutations: number = 999, rngSeed?: number): PERMANOVAResult {
  if (rngSeed !== undefined) seed(rngSeed);
  const n = distMatrix.rows;
  const uniqueGroups = [...new Set(groups)];
  const k = uniqueGroups.length;
  const D2 = distMatrix.mul(distMatrix);

  const computeF = (grp: number[]): number => {
    const ssTotal = D2.sum() / n;
    let ssWithin = 0;
    for (const g of uniqueGroups) {
      const idx = grp.map((v, i) => v === g ? i : -1).filter(i => i >= 0);
      const ng = idx.length;
      if (ng < 2) continue;
      let grpSum = 0;
      for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) grpSum += D2.get(idx[a], idx[b]);
      ssWithin += (2 / ng) * grpSum;
    }
    const ssBetween = ssTotal - ssWithin;
    const dfb = k - 1, dfw = n - k;
    const msb = dfb > 0 ? ssBetween / dfb : 0;
    const msw = dfw > 0 ? ssWithin / dfw : 0;
    return msw > 0 ? msb / msw : 0;
  };

  const F_obs = computeF(groups);
  let count = 0;
  for (let perm = 0; perm < nPermutations; perm++) {
    const shuffled = [...groups];
    for (let i = n - 1; i > 0; i--) { const j = randint(0, i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    if (computeF(shuffled) >= F_obs) count++;
  }

  // Recompute SS for result
  const ssTotal = D2.sum() / n;
  let ssWithin = 0;
  for (const g of uniqueGroups) {
    const idx = groups.map((v, i) => v === g ? i : -1).filter(i => i >= 0);
    const ng = idx.length;
    if (ng < 2) continue;
    let grpSum = 0;
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) grpSum += D2.get(idx[a], idx[b]);
    ssWithin += (2 / ng) * grpSum;
  }

  return {
    fStatistic: F_obs, pValue: (count + 1) / (nPermutations + 1),
    ssBetween: ssTotal - ssWithin, ssWithin, dfBetween: k - 1, dfWithin: n - k,
    nPermutations,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SIMPER (standard Clarke 1993 formulation)
// ═══════════════════════════════════════════════════════════════════

export interface SIMPERContribution {
  name: string;
  index: number;
  /** mean per-variable contribution delta_k over the between-group pairs */
  average: number;
  /** SD of delta_k across individual (i, j) pairs (ddof=1; 0 if one pair) */
  std: number;
  /** cumulative contribution share within the group pair (0..1) */
  cumulative: number;
  /** consistency ratio average / std (higher = more consistent) */
  ratio: number;
  /** group means of the variable for the pair (mean of group A / group B) */
  meanA?: number;
  meanB?: number;
}

/** Per-group-pair SIMPER result — Python SimperResult per pair. */
export interface SIMPERPairResult {
  groupA: number;
  groupB: number;
  /** average between-group Bray-Curtis dissimilarity of the pair */
  overallDissimilarity: number;
  /** per-variable contributions, sorted by `average` descending */
  contributions: SIMPERContribution[];
}

export interface SIMPERResult {
  /** Average overall between-group dissimilarity across all pairs. */
  overallDissimilarity: number;
  /** Pooled contributions across all group pairs (sorted, cumulative). */
  contributions: SIMPERContribution[];
  /** One entry per group pair (Python `group_pairs`). */
  groupPairResults: SIMPERPairResult[];
  metric: string;
  nGroups: number;
  nVariables: number;
}

/**
 * SIMPER (Similarity Percentages) — rewritten port of Python simper.py
 * (Clarke 1993).
 *
 * For each pair of samples (i in group A, j in group B) the per-variable
 * contribution is Bray-Curtis-normalized:
 *
 *     delta_k(ij) = |x_ik - x_jk| / Sum_l (x_il + x_jl)
 *
 * Because |a-b| = (a+b) - 2 min(a,b), the delta_k over variables sum to the
 * pairwise Bray-Curtis dissimilarity delta_ij exactly, so the per-variable
 * averages sum to the overall dissimilarity and the cumulative percentages
 * reach 100%.
 *
 * Reported per group pair (and pooled overall): per-variable mean delta,
 * SD across individual pairs (Clarke's Av/SD consistency measure), the
 * ratio avg/SD and the cumulative contribution.
 *
 * @param metric 'bray_curtis' (default; the standard normalized SIMPER) or
 *               'euclidean' (unnormalized |x_ik - x_jk| contributions; the
 *               overall dissimilarity is the mean Euclidean distance).
 */
export function simper(
  data: Matrix,
  groups: number[],
  variableNames?: string[],
  metric: string = 'bray_curtis',
): SIMPERResult {
  const nVars = data.cols;
  const names = variableNames ?? Array.from({ length: nVars }, (_, i) => `Var_${i + 1}`);
  const uniqueGroups = [...new Set(groups)].sort((a, b) => a - b);
  const nGroups = uniqueGroups.length;
  if (nGroups < 2) {
    return { overallDissimilarity: 0, contributions: [], groupPairResults: [], metric, nGroups, nVariables: nVars };
  }

  const groupPairResults: SIMPERPairResult[] = [];
  // Pooled accumulators across all group pairs
  const pooledRows: number[][] = []; // one delta_k vector per (i,j) pair
  const pooledDissim: number[] = [];

  for (let gi = 0; gi < nGroups; gi++) {
    for (let gj = gi + 1; gj < nGroups; gj++) {
      const ga = uniqueGroups[gi], gb = uniqueGroups[gj];
      const idxA = groups.map((v, i) => v === ga ? i : -1).filter(i => i >= 0);
      const idxB = groups.map((v, i) => v === gb ? i : -1).filter(i => i >= 0);

      // Group means of each variable (reported per contribution)
      const meanA = new Array<number>(nVars).fill(0);
      const meanB = new Array<number>(nVars).fill(0);
      for (const ia of idxA) for (let k = 0; k < nVars; k++) meanA[k] += data.get(ia, k) / idxA.length;
      for (const ib of idxB) for (let k = 0; k < nVars; k++) meanB[k] += data.get(ib, k) / idxB.length;

      // Single pass over all cross-group pairs:
      // delta_k(ij) = |x_ik - x_jk| / Sum_l (x_il + x_jl)   (Bray-Curtis)
      const deltaRows: number[][] = [];
      const pairDissim: number[] = [];
      for (const ia of idxA) {
        for (const ib of idxB) {
          const rowA = data.row(ia), rowB = data.row(ib);
          let den = 0, num = 0, numSq = 0;
          for (let k = 0; k < nVars; k++) { den += rowA[k] + rowB[k]; num += Math.abs(rowA[k] - rowB[k]); numSq += (rowA[k] - rowB[k]) ** 2; }
          if (metric === 'bray_curtis' && den <= 0) continue; // no information in either sample
          const row: number[] = new Array(nVars);
          for (let k = 0; k < nVars; k++) {
            row[k] = metric === 'bray_curtis' ? Math.abs(rowA[k] - rowB[k]) / den : Math.abs(rowA[k] - rowB[k]);
          }
          deltaRows.push(row);
          const dij = metric === 'bray_curtis' ? num / den : Math.sqrt(numSq);
          pairDissim.push(dij);
          pooledRows.push(row);
          pooledDissim.push(dij);
        }
      }

      // Per-variable stats across individual (i, j) pairs — SD with ddof=1
      // (with the standard 2-group design a group-pair-level SD would
      // collapse to 0; Python simper.py uses the same pairwise SD).
      const nPairs = deltaRows.length;
      const avg = new Array<number>(nVars).fill(0);
      const sdv = new Array<number>(nVars).fill(0);
      if (nPairs > 0) {
        for (const row of deltaRows) for (let k = 0; k < nVars; k++) avg[k] += row[k] / nPairs;
        if (nPairs > 1) {
          for (let k = 0; k < nVars; k++) {
            let s = 0;
            for (const row of deltaRows) s += (row[k] - avg[k]) ** 2;
            sdv[k] = Math.sqrt(s / (nPairs - 1));
          }
        }
      }

      // Sort by average contribution descending; cumulative shares
      const order = Array.from({ length: nVars }, (_, i) => i).sort((a, b) => avg[b] - avg[a]);
      const total = avg.reduce((s, v) => s + v, 0);
      const contributions: SIMPERContribution[] = [];
      let cum = 0;
      for (const k of order) {
        cum += avg[k];
        contributions.push({
          name: names[k], index: k, average: avg[k], std: sdv[k],
          cumulative: total > 0 ? cum / total : 0,
          ratio: sdv[k] > 0 ? avg[k] / sdv[k] : (avg[k] > 0 ? Infinity : 0),
          meanA: meanA[k], meanB: meanB[k],
        });
      }

      groupPairResults.push({
        groupA: ga, groupB: gb,
        overallDissimilarity: pairDissim.length > 0 ? mean(pairDissim) : 0,
        contributions,
      });
    }
  }

  // Pooled result across all group pairs
  const overallDissimilarity = pooledDissim.length > 0 ? mean(pooledDissim) : 0;
  const nPooled = pooledRows.length;
  const pooledAvg = new Array<number>(nVars).fill(0);
  const pooledSd = new Array<number>(nVars).fill(0);
  if (nPooled > 0) {
    for (const row of pooledRows) for (let k = 0; k < nVars; k++) pooledAvg[k] += row[k] / nPooled;
    if (nPooled > 1) {
      for (let k = 0; k < nVars; k++) {
        let s = 0;
        for (const row of pooledRows) s += (row[k] - pooledAvg[k]) ** 2;
        pooledSd[k] = Math.sqrt(s / (nPooled - 1));
      }
    }
  }
  const pooledOrder = Array.from({ length: nVars }, (_, i) => i).sort((a, b) => pooledAvg[b] - pooledAvg[a]);
  const pooledTotal = pooledAvg.reduce((s, v) => s + v, 0);
  const contributions: SIMPERContribution[] = [];
  let cum = 0;
  for (const k of pooledOrder) {
    cum += pooledAvg[k];
    contributions.push({
      name: names[k], index: k, average: pooledAvg[k], std: pooledSd[k],
      cumulative: pooledTotal > 0 ? cum / pooledTotal : 0,
      ratio: pooledSd[k] > 0 ? pooledAvg[k] / pooledSd[k] : (pooledAvg[k] > 0 ? Infinity : 0),
    });
  }

  return { overallDissimilarity, contributions, groupPairResults, metric, nGroups, nVariables: nVars };
}

// ═══════════════════════════════════════════════════════════════════
// Kruskal-Wallis
// ═══════════════════════════════════════════════════════════════════

export interface KruskalResult {
  statistic: number;
  pValue: number;
  df: number;
}

export function kruskalWallis(groups: number[][]): KruskalResult {
  const allVals = groups.flat();
  const N = allVals.length;
  const ranks = rankdata(allVals); // average ranks (math/stats rankdata)

  let offset = 0;
  const k = groups.length;
  let H = 0;
  for (const g of groups) {
    const n = g.length;
    let rankSum = 0;
    for (let i = 0; i < n; i++) rankSum += ranks[offset + i];
    H += (rankSum ** 2) / n;
    offset += n;
  }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);

  // Tie correction (scipy.stats.kruskal / R kruskal.test):
  //   H_corrected = H / (1 - Sum_t (t^3 - t) / (N^3 - N))
  // where t is the size of each group of tied observations.
  const counts = new Map<string, number>();
  for (const v of allVals) {
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let tieSum = 0;
  for (const t of counts.values()) {
    if (t > 1) tieSum += (t ** 3 - t);
  }
  const tieCorr = 1 - tieSum / (N ** 3 - N);
  if (tieCorr > 0) H = H / tieCorr;

  // Chi-squared upper-tail p-value via the verified regularized gamma
  // (math/stats pchisq; replaces the local series approximation).
  const df = k - 1;
  const p = 1 - pchisq(H, df);
  return { statistic: H, pValue: p, df };
}

function chi2CDF_local(x: number, k: number): number {
  if (x <= 0) return 0;
  return gammainc_local(k / 2, x / 2);
}

function gammainc_local(a: number, x: number): number {
  if (x <= 0) return 0;
  let sum = 1 / a, term = 1 / a;
  for (let n = 1; n < 200; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < 1e-14 * Math.abs(sum)) break; }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma_local(a));
}

function lgamma_local(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma_local(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ═══════════════════════════════════════════════════════════════════
// Distance Matrix (full implementation)
// ═══════════════════════════════════════════════════════════════════

export type Metric = 'euclidean' | 'bray_curtis' | 'cosine' | 'jaccard' | 'canberra' | 'cityblock' | 'correlation' | 'hamming' | 'chebychev';

export function computeDistanceMatrix(data: Matrix, metric: Metric = 'euclidean'): Matrix {
  const n = data.rows, D = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let d: number;
    const a = data.row(i), b = data.row(j);
    switch (metric) {
      case 'bray_curtis': { let num = 0, den = 0; for (let k = 0; k < a.length; k++) { num += Math.abs(a[k] - b[k]); den += a[k] + b[k]; } d = den > 0 ? num / den : 0; break; }
      case 'cosine': { let dot = 0, na = 0, nb = 0; for (let k = 0; k < a.length; k++) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2; } d = (na > 0 && nb > 0) ? 1 - dot / (Math.sqrt(na) * Math.sqrt(nb)) : 1; break; }
      case 'jaccard': { let num = 0, den = 0; for (let k = 0; k < a.length; k++) { if (a[k] !== 0 || b[k] !== 0) { den++; if (a[k] !== b[k]) num++; } } d = den > 0 ? num / den : 0; break; }
      case 'canberra': { let s = 0; for (let k = 0; k < a.length; k++) { const denom = Math.abs(a[k]) + Math.abs(b[k]); s += denom > 0 ? Math.abs(a[k] - b[k]) / denom : 0; } d = s; break; }
      case 'cityblock': { let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); d = s; break; }
      case 'hamming': { let s = 0; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) s++; d = s / a.length; break; }
      // Chebychev (L-infinity) distance — port of Python distance_metrics.py
      // 'chebychev' metric: d = max_k |x_ik - x_jk|
      case 'chebychev': { let mx = 0; for (let k = 0; k < a.length; k++) mx = Math.max(mx, Math.abs(a[k] - b[k])); d = mx; break; }
      default: { let s = 0; for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2; d = Math.sqrt(s); }
    }
    D.set(i, j, d); D.set(j, i, d);
  }
  return D;
}

// ═══════════════════════════════════════════════════════════════════
// Clustering (complete)
// ═══════════════════════════════════════════════════════════════════

export interface ClusteringResult {
  linkageMatrix: number[][];
  copheneticCorr: number;
  labels: number[];
  nClusters: number;
  method: string;
  metric: string;
}

/**
 * Hierarchical (agglomerative) clustering — replaces statistics/clustering.py
 * `analyze`.
 *
 * Linkage via the Lance-Williams (1967) update formulas on the cluster-level
 * distance matrix, so all four methods work from an ARBITRARY precomputed
 * distance matrix (not only from coordinates):
 *   single   : d(i∪j,k) = min(d_ik, d_jk)
 *   complete : d(i∪j,k) = max(d_ik, d_jk)
 *   average  : d(i∪j,k) = (n_i d_ik + n_j d_jk) / (n_i + n_j)
 *   ward     : d(i∪j,k) = sqrt( ((n_i+n_k) d_ik^2 + (n_j+n_k) d_jk^2 - n_k d_ij^2)
 *                               / (n_i + n_j + n_k) )
 * The Ward formula is the Ward.D2 update (identical to scipy
 * linkage(method='ward') and R hclust ward.D2); on Euclidean data it
 * agrees with the previous centroid-based implementation.
 *
 * @param data        (n_samples x n_variables) data matrix, OR a square
 *                    symmetric zero-diagonal distance matrix when
 *                    `precomputed` is true.
 * @param method      'ward' | 'complete' | 'average' | 'single'
 * @param metric      distance metric for coordinates (ignored when
 *                    precomputed)
 * @param nClusters   number of clusters to cut the dendrogram into
 *                    (default 3). Ignored when `threshold` is given.
 * @param threshold   cut the dendrogram by merge-height threshold instead of
 *                    a fixed cluster count (Python fcluster criterion=
 *                    'distance'); takes precedence over `nClusters` when
 *                    defined (the two are mutually exclusive — 二选一).
 * @param precomputed treat `data` as a precomputed distance matrix.
 */
export function hierarchicalClustering(
  data: Matrix,
  method: string = 'ward',
  metric: string = 'euclidean',
  nClusters: number = 3,
  threshold?: number,
  precomputed: boolean = false,
): ClusteringResult {
  let D: Matrix;
  if (precomputed) {
    // Validate precomputed distance matrix (Python _is_distance_matrix)
    if (data.rows !== data.cols) {
      throw new Error('Precomputed distance matrix must be square');
    }
    let symmetric = true, zeroDiag = true;
    for (let i = 0; i < data.rows && (symmetric || zeroDiag); i++) {
      if (Math.abs(data.get(i, i)) > 1e-10) zeroDiag = false;
      for (let j = i + 1; j < data.cols; j++) {
        if (Math.abs(data.get(i, j) - data.get(j, i)) > 1e-10) { symmetric = false; break; }
      }
    }
    if (!symmetric || !zeroDiag) {
      throw new Error('Precomputed distance matrix must be symmetric with a zero diagonal');
    }
    D = data;
  } else {
    D = computeDistanceMatrix(data, metric as Metric);
  }
  const n = D.rows;

  // Cluster-level distance matrix over "active" cluster slots. Slot 0..n-1
  // are singletons; merged slots append. dist[i][j] = current linkage dist.
  const clusterSize: number[] = new Array(n).fill(1);
  let dist: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? Infinity : D.get(i, j))));
  const alive: boolean[] = new Array(n).fill(true);

  const linkage: number[][] = [];
  let nextId = n;

  for (let step = 0; step < n - 1; step++) {
    // Find the closest pair of active clusters
    let minDist = Infinity, mi = -1, mj = -1;
    const active: number[] = [];
    for (let i = 0; i < dist.length; i++) if (alive[i]) active.push(i);
    for (let a = 0; a < active.length; a++) {
      for (let b = a + 1; b < active.length; b++) {
        const di = dist[active[a]][active[b]];
        if (di < minDist) { minDist = di; mi = active[a]; mj = active[b]; }
      }
    }
    if (mi < 0) break;

    // Record the merge: linkage row [id1, id2, height, size]
    const mergedSize = clusterSize[mi] + clusterSize[mj];
    linkage.push([mi, mj, Math.max(minDist, 0), mergedSize]);

    // Create the merged cluster slot and apply the Lance-Williams update
    const newId = nextId++;
    clusterSize.push(mergedSize);
    dist.push(new Array<number>(newId).fill(Infinity)); // col for newId added below
    for (let row of dist) row.push(Infinity);
    alive.push(true);

    for (let k = 0; k < newId; k++) {
      if (!alive[k] || k === mi || k === mj) continue;
      const dik = dist[mi][k], djk = dist[mj][k], dij = dist[mi][mj];
      const ni = clusterSize[mi], nj = clusterSize[mj], nk = clusterSize[k];
      let dk: number;
      if (method === 'single') dk = Math.min(dik, djk);
      else if (method === 'complete') dk = Math.max(dik, djk);
      else if (method === 'average') dk = (ni * dik + nj * djk) / (ni + nj);
      else { // ward (Ward.D2, Lance-Williams on squared distances)
        dk = Math.sqrt(Math.max(
          ((ni + nk) * dik * dik + (nj + nk) * djk * djk - nk * dij * dij) / (ni + nj + nk), 0));
      }
      dist[newId][k] = dk;
      dist[k][newId] = dk;
    }
    alive[mi] = false;
    alive[mj] = false;
  }

  // Cut the dendrogram. `threshold` (merge-height criterion, 二选一) takes
  // precedence; otherwise cut into exactly `nClusters` clusters
  // (scipy fcluster criterion='maxclust').
  const finalLabels = threshold !== undefined
    ? fclusterByHeight(linkage, n, threshold)
    : fclusterFromLinkage(linkage, nClusters);
  const clusterIds = [...new Set(finalLabels)];
  const nFound = clusterIds.length;

  // Cophenetic distance matrix: height at which i,j first in same cluster.
  // Ref: Fionn Murtagh & Pierre Legendre (2014) Stat. & Prob. Letters, Eq. (1).
  // scipy.cluster.hierarchy.cophenet implementation.
  const cophDistMatrix = copheneticFromLinkage(linkage, n);

  // Cophenetic correlation
  const cophDist: number[] = [];
  const origDist: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    origDist.push(D.get(i, j));
    cophDist.push(cophDistMatrix[i][j]);
  }
  const cophCorr = origDist.length > 0 ? pearsonCorr(origDist, cophDist) : 0;

  return {
    linkageMatrix: linkage, copheneticCorr: cophCorr, labels: finalLabels,
    nClusters: nFound, method, metric: precomputed ? 'precomputed' : metric,
  };
}

/**
 * fcluster(Z, t, criterion='distance'): cut the dendrogram at merge height
 * `threshold` — all merges with height <= threshold are applied, the
 * remaining connected components become flat clusters.
 */
function fclusterByHeight(linkage: number[][], n: number, threshold: number): number[] {
  const parent = new Array(2 * n - 1);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  for (const [id1, id2, h] of linkage) {
    if (h <= threshold) {
      const r1 = find(id1), r2 = find(id2);
      if (r1 !== r2) parent[r1] = r2;
    } else {
      break; // linkage heights are non-decreasing
    }
  }
  const labels = new Array(n).fill(0);
  const rootMap = new Map<number, number>();
  let labelIdx = 0;
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!rootMap.has(root)) rootMap.set(root, labelIdx++);
    labels[i] = rootMap.get(root)!;
  }
  return labels;
}

function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length; if (n === 0) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : 0;
}

/**
 * fcluster from linkage matrix — cut dendrogram to form nClusters.
 * Ref: scipy.cluster.hierarchy.fcluster(Z, t), specifically the 'inconsistent'
 *      method with threshold = the height at which to cut.
 */
function fclusterFromLinkage(linkage: number[][], nClusters: number): number[] {
  const n = linkage.length + 1;
  if (nClusters >= n) return Array.from({ length: n }, (_, i) => i);
  // scipy.cluster.hierarchy.fcluster: cut dendrogram so we get exactly nClusters.
  // We process merges from smallest height to largest; after (n-1 - nClusters) merges
  // we have nClusters clusters remaining.
  const nMergesBeforeCut = n - nClusters;
  const cutHeight = nMergesBeforeCut > 0 ? linkage[nMergesBeforeCut - 1][2] : 0;

  // Build cluster membership: clusterId -> Set of original observation indices
  // Original observations: 0..n-1, internal nodes: n..n+(n-2)
  const members: Map<number, Set<number>> = new Map();
  for (let i = 0; i < n; i++) members.set(i, new Set([i]));

  for (let m = 0; m < nMergesBeforeCut; m++) {
    const [id1, id2, h] = linkage[m];
    const set1 = members.get(id1) ?? new Set();
    const set2 = members.get(id2) ?? new Set();
    const merged = new Set([...set1, ...set2]);
    // Create new internal node with the merged set
    const newId = n + m;
    members.set(newId, merged);
  }

  // The root of the remaining clusters is at linkage[nMergesBeforeCut - 1] (or last merge if cut at root)
  // The nClusters clusters correspond to the members of the "active" nodes after nMergesBeforeCut merges.
  // These are: for each merge m >= nMergesBeforeCut, the two children of that merge
  // (if they weren't already merged in a later step).
  // Actually simpler: find all "top-level" clusters after stopping.
  const activeNodes = new Set<number>();
  for (let m = nMergesBeforeCut - 1; m >= 0; m--) {
    const [id1, id2] = linkage[m];
    if (m === nMergesBeforeCut - 1) {
      activeNodes.add(id1);
      activeNodes.add(id2);
    }
  }

  // Actually the simplest fcluster algorithm: after applying nMergesBeforeCut unions,
  // the remaining clusters are the equivalence classes of original observations.
  // Use union-find with full parent array (size 2n-1 to handle internal node IDs)
  const parent = new Array(2 * n - 1).fill(0);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  for (let m = 0; m < nMergesBeforeCut; m++) {
    const [id1, id2] = linkage[m];
    const r1 = find(id1), r2 = find(id2);
    if (r1 !== r2) parent[r1] = r2;
  }

  // Assign cluster labels based on final equivalence classes
  const labels = new Array(n).fill(0);
  const rootMap = new Map<number, number>();
  let labelIdx = 0;
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!rootMap.has(root)) rootMap.set(root, labelIdx++);
    labels[i] = rootMap.get(root)!;
  }
  return labels;
}

/**
 * Compute cophenetic distance matrix from linkage matrix.
 * cophenetic(i,j) = height at which i and j first appear in same cluster.
 * Ref: Fionn Murtagh & Pierre Legendre (2014) Stat. & Prob. Letters 84: 178-184.
 *      scipy.cluster.hierarchy.cophenet.
 */
function copheneticFromLinkage(linkage: number[][], n: number): number[][] {
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  // clusterMembers: cluster_id -> list of original observation indices
  const clusterMembers: Map<number, number[]> = new Map();
  for (let i = 0; i < n; i++) clusterMembers.set(i, [i]);

  let mergeIdx = 0;
  for (const [id1, id2, h] of linkage) {
    const members1 = clusterMembers.get(id1) ?? [];
    const members2 = clusterMembers.get(id2) ?? [];
    const merged = [...members1, ...members2];
    // All pairs within merged set have cophenetic distance = h
    for (const i of merged) {
      for (const j of merged) {
        if (i < j) dist[i][j] = h;
        else if (i > j) dist[j][i] = h;
      }
    }
    // New cluster gets ID = n + mergeIdx (the order in the linkage array)
    clusterMembers.set(n + mergeIdx, merged);
    mergeIdx++;
  }
  return dist;
}

// ═══════════════════════════════════════════════════════════════════
// PCM (Phylogenetic Comparative Methods)
// ═══════════════════════════════════════════════════════════════════

export interface PhyloSignalResult {
  k: number;
  z: number;
  pValue: number;
  nRandomizations: number;
  /** Tip names — rows/cols of `vcvMatrix` (Python tip_names). */
  tipNames?: string[];
  /** ape-convention Brownian VCV used for the canonical K. */
  vcvMatrix?: number[][];
}

/**
 * Phylogenetic signal via the CANONICAL, scale-invariant Blomberg K —
 * port of Python pcm.py `compute_phylogenetic_signal` +
 * phylogenetics/signal.py `_blomberg_k_from_vcv`.
 *
 *     K = s²_ord / (σ̂²_GLS · tr(V) / n)
 *
 * where s²_ord = Σ(yᵢ−ȳ)²/(n−1) is the ordinary mean square and
 * σ̂²_GLS = (y−1â)ᵀV⁻¹(y−1â)/(n−1) is the Brownian-rate estimate with the
 * GLS intercept â = (1ᵀV⁻¹1)⁻¹ 1ᵀV⁻¹y, evaluated on the ape-convention VCV
 * (diagonal = root-to-tip distance, off-diagonal = shared path length).
 * Under BM, K ≈ 1; K is invariant to linear rescaling of the trait.
 *
 * The previous ΣIC²/Σv ratio is the BM RATE estimate σ̂² — it scales with
 * the trait units² and is not a signal statistic; it has been replaced.
 *
 * References: Blomberg, Garland & Ives (2003) Evolution 57(4):717-745;
 * add-one corrected permutation p-value.
 */
export function phylogeneticSignal(root: any, traitValues: Record<string, number>, nRandomizations: number = 999, rngSeed?: number): PhyloSignalResult {
  if (rngSeed !== undefined) seed(rngSeed);
  const leaves = getLeaves(root);
  const tipNames = leaves.map(l => l.name);
  const n = tipNames.length;
  if (n < 3) return { k: 0, z: 0, pValue: 1, nRandomizations: 0, tipNames, vcvMatrix: [] };

  const y = tipNames.map(nm => traitValues[nm] ?? NaN);
  const V = buildVCV(root, tipNames);

  const K = blombergKFromVcv(y, V);

  // Permutation test: shuffle the trait values across tips (groups/VCV fixed)
  let count = 0;
  const permKs: number[] = [];
  for (let perm = 0; perm < nRandomizations; perm++) {
    const shuffled = [...y];
    rngShuffle(shuffled);
    const permK = blombergKFromVcv(shuffled, V);
    permKs.push(permK);
    if (permK >= K) count++;
  }

  const meanPK = permKs.length > 0 ? permKs.reduce((a, b) => a + b, 0) / permKs.length : 0;
  const stdPK = permKs.length > 0 ? Math.sqrt(permKs.reduce((s, v) => s + (v - meanPK) ** 2, 0) / permKs.length) : 0;
  const z = stdPK > 0 ? (K - meanPK) / stdPK : 0;

  return {
    k: K, z, pValue: (count + 1) / (nRandomizations + 1), nRandomizations,
    tipNames, vcvMatrix: V.map(row => [...row]),
  };
}

/**
 * Canonical Blomberg et al. (2003) K from a trait vector and an
 * ape-convention VCV — exact port of Python `_blomberg_k_from_vcv`:
 *
 *     K = s²_ord / (σ̂²_GLS · tr(V)/n)
 *
 * Returns 0.0 when the computation is degenerate (singular VCV, zero
 * variance, or n < 3).
 */
function blombergKFromVcv(y: number[], V: number[][]): number {
  const n = y.length;
  if (n < 3) return 0;
  if (y.some(v => isNaN(v))) return 0;
  // Tiny ridge for numerical stability (Python adds 1e-10 on the diagonal)
  const Vr: number[][] = V.map((row, i) => row.map((v, j) => (i === j ? v + 1e-10 : v)));
  let Vinv: Matrix;
  try {
    Vinv = inv(new Matrix(new Float64Array(Vr.flat()), n, n));
  } catch {
    return 0;
  }

  const ones = new Array<number>(n).fill(1);
  const oneViOne = quadForm(Vinv, ones, ones);
  if (!(oneViOne > 0)) return 0;

  const oneViY = quadForm(Vinv, ones, y);
  const aHat = oneViY / oneViOne;
  const resid = y.map(v => v - aHat);
  const sigma2Gls = quadForm(Vinv, resid, resid) / (n - 1);

  const yMean = mean(y);
  const s2Ord = y.reduce((s, v) => s + (v - yMean) ** 2, 0) / (n - 1);

  let trace = 0;
  for (let i = 0; i < n; i++) trace += Vr[i][i];
  const denom = sigma2Gls * trace / n;
  if (!(denom > 0)) return 0;
  return s2Ord / denom;
}

/** uᵀ A v for symmetric A held as a Matrix. */
function quadForm(A: Matrix, u: number[], v: number[]): number {
  let s = 0;
  for (let i = 0; i < u.length; i++) {
    let rowDot = 0;
    for (let j = 0; j < v.length; j++) rowDot += A.get(i, j) * v[j];
    s += u[i] * rowDot;
  }
  return s;
}

/**
 * Brownian variance-covariance matrix in the ape convention — port of
 * Python pcm.py `_compute_vcv_matrix`:
 *
 *     V_ii = total branch length from root to tip i
 *     V_ij = shared path length from root to LCA(i, j)   (i ≠ j)
 *
 * (A patristic-distance matrix with a zero diagonal would be singular and
 * unusable for GLS.)
 */
function buildVCV(root: any, tipNames: string[]): number[][] {
  const n = tipNames.length;
  const nameToIdx = new Map<string, number>();
  tipNames.forEach((nm, i) => nameToIdx.set(nm, i));

  // Distance from root for every node (DFS over children)
  const distToRoot = new Map<any, number>();
  (function walk(node: any, d: number): void {
    distToRoot.set(node, d);
    for (const c of node.children) walk(c, d + (c.branchLength || 0));
  })(root, 0);

  const V: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const leafI = findLeafByname(root, tipNames[i]);
    if (leafI) V[i][i] = distToRoot.get(leafI) ?? 0;
  }
  // Shared path lengths: for each internal node, every pair of tips under
  // DIFFERENT children has its LCA at that node.
  (function shared(node: any): string[] {
    if (node.isLeaf) return node.name ? [node.name] : [];
    const childTips = node.children.map((c: any) => shared(c));
    const d = distToRoot.get(node) ?? 0;
    for (let a = 0; a < childTips.length; a++) {
      for (let b = a + 1; b < childTips.length; b++) {
        for (const ta of childTips[a]) {
          for (const tb of childTips[b]) {
            const ia = nameToIdx.get(ta), ib = nameToIdx.get(tb);
            if (ia !== undefined && ib !== undefined) { V[ia][ib] = d; V[ib][ia] = d; }
          }
        }
      }
    }
    return childTips.reduce((acc: string[], cur: string[]) => acc.concat(cur), []);
  })(root);
  return V;
}

function findLeafByname(root: any, name: string): any | null {
  if (root.isLeaf) return root.name === name ? root : null;
  for (const c of root.children) {
    const r = findLeafByname(c, name);
    if (r !== null) return r;
  }
  return null;
}

/**
 * Phylogenetic independent contrasts (Felsenstein 1985) — post-order
 * recursion matching the CORRECTED Python pcm.py
 * `_compute_contrasts_recursive`:
 *
 *  - leaves return cumVar = 0 (a leaf has no descendants); every parent
 *    adds the child's branch_length explicitly: v_i = cumVar(child_i) +
 *    branch(child_i). The old version made leaves return branch_length and
 *    double-counted leaf edges while missing internal ones, biasing the IC
 *    standardization on deep trees.
 *  - standardized contrast IC = (x_A - x_B) / sqrt(v_A + v_B), se =
 *    sqrt(v_A + v_B);
 *  - the variance of the node's reconstruction (excluding its own branch)
 *    is v_A·v_B/(v_A+v_B) — the variance of the inverse-variance weighted
 *    mean, NOT v_A+v_B (the variance of the contrast);
 *  - polytomies are reduced iteratively exactly as in Python.
 */
function computePIC(root: any, traitValues: Record<string, number>): { contrasts: number[]; standardErrors: number[] } {
  const contrasts: number[] = [], seList: number[] = [];

  function compute(node: any): { value: number | null; cumVar: number } {
    if (node.isLeaf) {
      const v = traitValues[node.name];
      return { value: v === undefined ? null : v, cumVar: 0 };
    }
    // Process children first
    const childResults: { node: any; value: number; cumVar: number }[] = [];
    for (const c of node.children) {
      const r = compute(c);
      if (r.value !== null) childResults.push({ node: c, value: r.value, cumVar: r.cumVar });
    }
    if (childResults.length === 0) return { value: null, cumVar: 0 };
    if (childResults.length === 1) {
      const c = childResults[0];
      return { value: c.value, cumVar: c.cumVar + (c.node.branchLength || 0) };
    }

    // Reduce children pairwise/iteratively (Felsenstein 1985)
    type Entry = { value: number; cumVar: number; branch: number };
    let active: Entry[] = childResults.map(cr => ({
      value: cr.value, cumVar: cr.cumVar, branch: cr.node.branchLength || 0,
    }));

    while (active.length > 1) {
      const e1 = active[0], e2 = active[1];
      const v1 = e1.cumVar + e1.branch;
      const v2 = e2.cumVar + e2.branch;
      const contrast = (e1.value - e2.value) / Math.sqrt(v1 + v2);
      contrasts.push(contrast);
      seList.push(Math.sqrt(v1 + v2));
      // Combined subtree: inverse-variance weighted mean; combined
      // descendant variance v1*v2/(v1+v2); the pseudo-child's edge to this
      // node has length 0 (the parent adds this node's branch length).
      const combinedCvar = v1 + v2 > 0 ? (v1 * v2) / (v1 + v2) : 0;
      const combinedVal = v1 > 0 && v2 > 0
        ? (e1.value / v1 + e2.value / v2) / (1 / v1 + 1 / v2)
        : (e1.value + e2.value) / 2;
      active = [{ value: combinedVal, cumVar: combinedCvar, branch: 0 }, ...active.slice(2)];
    }

    // Final reconstruction at this node: inverse-variance weighted mean of
    // the immediate child reconstructions; node variance = 1/Σ(1/v_i)
    // excluding this node's own branch length.
    let totalW = 0, weightedSum = 0, invSum = 0;
    for (const cr of childResults) {
      const v = cr.cumVar + (cr.node.branchLength || 0);
      const vv = v > 0 ? v : 1e-10;
      totalW += 1 / vv;
      weightedSum += cr.value / vv;
      if (v > 0) invSum += 1 / v;
    }
    const recon = totalW > 0 ? weightedSum / totalW : active[0].value;
    const cumVar = invSum > 0 ? 1 / invSum : 0;
    return { value: recon, cumVar };
  }

  compute(root);
  return { contrasts, standardErrors: seList };
}

function getLeaves(node: any): any[] {
  if (node.isLeaf) return [node];
  const leaves: any[] = [];
  for (const c of node.children) leaves.push(...getLeaves(c));
  return leaves;
}

// ═══════════════════════════════════════════════════════════════════
// Phylogenetic ANOVA
// ═══════════════════════════════════════════════════════════════════

export interface PhyloANOVAResult {
  fStatistic: number;
  pValue: number;
  ssBetween: number;
  ssWithin: number;
  nPermutations: number;
  /** Group names (sorted). */
  groups?: string[];
  nGroups?: number;
  nTips?: number;
  msBetween?: number;
  msWithin?: number;
  /** Standardized contrast values used in the test. */
  contrastValues?: number[];
  /** Group assignment per labelled tip (Python group_labels). */
  groupLabels?: Record<string, string>;
}

/**
 * Phylogenetic ANOVA — port of Python pcm.py `phylogenetic_anova`
 * (Garland 1993 rule-classification scheme).
 *
 * Each PIC contrast at node P is labelled by the DOMINANT group (most
 * common group label among P's descendant tips). The test statistic is the
 * classic ONE-WAY ANOVA F computed on the standardized contrasts grouped by
 * those labels:
 *
 *     SS_between = Σ_g n_g (mean_g - grand_mean)²
 *     SS_within  = Σ_g Σ_i (ic_i - mean_g)²
 *     F = MS_between / MS_within
 *
 * The observed statistic and every permuted statistic use the IDENTICAL
 * labelling rule and the IDENTICAL F formula — the previous implementation
 * compared a "two-child-dominant-group" observed F against a permuted
 * classic ANOVA F of a different quantity, which invalidates the p-value.
 * p = mean(F_perm >= F_obs) over group-fixed trait permutations.
 */
export function phyloANOVA(root: any, traitValues: Record<string, number>, groupLabels: Record<string, string>, nPermutations: number = 999, rngSeed?: number): PhyloANOVAResult {
  if (rngSeed !== undefined) seed(rngSeed);

  // Valid labelled tips (intersection of trait and group keys)
  const tipsWithGroups: Record<string, string> = {};
  for (const tip of Object.keys(groupLabels)) {
    if (tip in traitValues) tipsWithGroups[tip] = groupLabels[tip];
  }
  const groups = [...new Set(Object.values(tipsWithGroups))].sort();
  const nGroups = groups.length;
  const tipNamesList = getLeaves(root).map(l => l.name);
  if (nGroups < 2) {
    return { fStatistic: 0, pValue: 1, ssBetween: 0, ssWithin: 0, nPermutations, groups, nGroups, nTips: tipNamesList.length, contrastValues: [], groupLabels: tipsWithGroups };
  }

  // Dominant group = most common labelled group among a subtree's tips
  // (ties broken by group order; null when no labelled tip is present).
  const subtreeTipsCache = new Map<any, string[]>();
  function subtreeTips(node: any): string[] {
    const cached = subtreeTipsCache.get(node);
    if (cached) return cached;
    let tips: string[];
    if (node.isLeaf) tips = node.name ? [node.name] : [];
    else {
      tips = [];
      for (const c of node.children) tips = tips.concat(subtreeTips(c));
    }
    subtreeTipsCache.set(node, tips);
    return tips;
  }
  function dominantGroup(node: any): string | null {
    const counts: Record<string, number> = {};
    for (const tip of subtreeTips(node)) {
      const g = tipsWithGroups[tip];
      if (g) counts[g] = (counts[g] || 0) + 1;
    }
    let best: string | null = null, bestCount = 0;
    for (const g of groups) {
      if ((counts[g] || 0) > bestCount) { best = g; bestCount = counts[g]; }
    }
    return best;
  }

  // Contrasts with their node identity: each contrast is labelled by the
  // dominant group of the subtree at the node where it was computed.
  function computeLabeled(node: any): { value: number | null; cumVar: number } | null {
    if (node.isLeaf) {
      const v = traitValues[node.name];
      return v === undefined ? null : { value: v, cumVar: 0 };
    }
    const childResults: { node: any; value: number; cumVar: number }[] = [];
    for (const c of node.children) {
      const r = computeLabeled(c);
      if (r !== null && r.value !== null) childResults.push({ node: c, value: r.value, cumVar: r.cumVar });
    }
    if (childResults.length === 0) return null;
    if (childResults.length === 1) {
      const c = childResults[0];
      return { value: c.value, cumVar: c.cumVar + (c.node.branchLength || 0) };
    }

    type Entry = { value: number; cumVar: number; branch: number };
    let active: Entry[] = childResults.map(cr => ({
      value: cr.value, cumVar: cr.cumVar, branch: cr.node.branchLength || 0,
    }));
    while (active.length > 1) {
      const e1 = active[0], e2 = active[1];
      const v1 = e1.cumVar + e1.branch, v2 = e2.cumVar + e2.branch;
      const contrast = (e1.value - e2.value) / Math.sqrt(v1 + v2);
      const dg = dominantGroup(node);
      icValues.push(contrast);
      icLabels.push(dg ?? groups[0]); // unclassifiable -> groups[0] (Python)
      const combinedCvar = v1 + v2 > 0 ? (v1 * v2) / (v1 + v2) : 0;
      const combinedVal = v1 > 0 && v2 > 0
        ? (e1.value / v1 + e2.value / v2) / (1 / v1 + 1 / v2)
        : (e1.value + e2.value) / 2;
      active = [{ value: combinedVal, cumVar: combinedCvar, branch: 0 }, ...active.slice(2)];
    }
    let totalW = 0, weightedSum = 0, invSum = 0;
    for (const cr of childResults) {
      const v = cr.cumVar + (cr.node.branchLength || 0);
      const vv = v > 0 ? v : 1e-10;
      totalW += 1 / vv;
      weightedSum += cr.value / vv;
      if (v > 0) invSum += 1 / v;
    }
    return { value: totalW > 0 ? weightedSum / totalW : active[0].value, cumVar: invSum > 0 ? 1 / invSum : 0 };
  }

  let icValues: number[] = [];
  let icLabels: string[] = [];

  /** Classic one-way ANOVA F on the contrasts grouped by labels. */
  function oneWayF(ic: number[], labels: string[]): [number, number, number, number, number] {
    const nIc = ic.length;
    if (nIc === 0) return [0, 0, 0, 0, 0];
    const dfB = Math.max(nGroups - 1, 1);
    const dfW = Math.max(nIc - nGroups, 1);
    const grandMean = mean(ic);
    let ssB = 0, ssW = 0;
    for (const g of groups) {
      const vals = ic.filter((_, i) => labels[i] === g);
      if (vals.length === 0) continue;
      const gm = mean(vals);
      ssB += vals.length * (gm - grandMean) ** 2;
      for (const v of vals) ssW += (v - gm) ** 2;
    }
    const msB = ssB / dfB;
    const msW = ssW / dfW;
    const F = msW > 0 ? msB / msW : 0;
    return [F, ssB, ssW, msB, msW];
  }

  // Observed statistic
  icValues = []; icLabels = [];
  computeLabeled(root);
  const [F, ssBetween, ssWithin, msBetween, msWithin] = oneWayF(icValues, icLabels);

  // Permutation test: shuffle trait values across tips, keep groups fixed;
  // identical labelling rule + identical F formula as the observed statistic.
  let count = 0;
  let nValidPerms = 0;
  const tipArray = tipNamesList.map(nm => traitValues[nm] ?? NaN);
  for (let perm = 0; perm < nPermutations; perm++) {
    const shuffled = [...tipArray];
    rngShuffle(shuffled);
    const permDict: Record<string, number> = {};
    for (let i = 0; i < tipNamesList.length; i++) permDict[tipNamesList[i]] = shuffled[i];
    // Same recursion code path as the observed contrasts (see
    // runComputeWithTraits) so observed and permuted F are directly comparable.
    const permIc = runComputeWithTraits(root, permDict, dominantGroup, groups);
    if (permIc.values.length >= 2) {
      const permF = oneWayF(permIc.values, permIc.labels)[0];
      if (permF >= F) count++;
      nValidPerms++;
    }
  }
  const pValue = nValidPerms > 0 ? count / nValidPerms : 1.0;

  return {
    fStatistic: F, pValue, ssBetween, ssWithin, nPermutations,
    groups, nGroups, nTips: tipNamesList.length,
    msBetween, msWithin, contrastValues: icValues, groupLabels: tipsWithGroups,
  };
}

/** Run the labeled-PIC recursion with an explicit trait dictionary
 *  (used by the phyloANOVA permutation loop to keep the observed and
 *  permuted contrasts produced by the exact same code path). */
function runComputeWithTraits(
  root: any,
  traitValues: Record<string, number>,
  dominantGroup: (node: any) => string | null,
  groups: string[],
): { values: number[]; labels: string[] } {
  const values: number[] = [];
  const labels: string[] = [];
  function compute(node: any): { value: number | null; cumVar: number } | null {
    if (node.isLeaf) {
      const v = traitValues[node.name];
      return v === undefined ? null : { value: v, cumVar: 0 };
    }
    const childResults: { node: any; value: number; cumVar: number }[] = [];
    for (const c of node.children) {
      const r = compute(c);
      if (r !== null && r.value !== null) childResults.push({ node: c, value: r.value, cumVar: r.cumVar });
    }
    if (childResults.length === 0) return null;
    if (childResults.length === 1) {
      const c = childResults[0];
      return { value: c.value, cumVar: c.cumVar + (c.node.branchLength || 0) };
    }
    type Entry = { value: number; cumVar: number; branch: number };
    let active: Entry[] = childResults.map(cr => ({
      value: cr.value, cumVar: cr.cumVar, branch: cr.node.branchLength || 0,
    }));
    while (active.length > 1) {
      const e1 = active[0], e2 = active[1];
      const v1 = e1.cumVar + e1.branch, v2 = e2.cumVar + e2.branch;
      values.push((e1.value - e2.value) / Math.sqrt(v1 + v2));
      labels.push(dominantGroup(node) ?? groups[0]);
      const combinedCvar = v1 + v2 > 0 ? (v1 * v2) / (v1 + v2) : 0;
      const combinedVal = v1 > 0 && v2 > 0
        ? (e1.value / v1 + e2.value / v2) / (1 / v1 + 1 / v2)
        : (e1.value + e2.value) / 2;
      active = [{ value: combinedVal, cumVar: combinedCvar, branch: 0 }, ...active.slice(2)];
    }
    let totalW = 0, weightedSum = 0, invSum = 0;
    for (const cr of childResults) {
      const v = cr.cumVar + (cr.node.branchLength || 0);
      const vv = v > 0 ? v : 1e-10;
      totalW += 1 / vv;
      weightedSum += cr.value / vv;
      if (v > 0) invSum += 1 / v;
    }
    return { value: totalW > 0 ? weightedSum / totalW : active[0].value, cumVar: invSum > 0 ? 1 / invSum : 0 };
  }
  compute(root);
  return { values, labels };
}

// ═══════════════════════════════════════════════════════════════════
// Mann-Whitney U Test
// ═══════════════════════════════════════════════════════════════════

export interface MannWhitneyResult {
  uStatistic: number;
  pValue: number;
  zScore: number;
}

export function mannWhitneyU(group1: number[], group2: number[]): MannWhitneyResult {
  const n1 = group1.length, n2 = group2.length;
  const combined = [...group1.map(v => ({ v, g: 0 })), ...group2.map(v => ({ v, g: 1 }))];
  combined.sort((a, b) => a.v - b.v);

  // Assign ranks with tie averaging (average rank for equal values)
  const ranks = new Array(combined.length);
  let i = 0;
  const tieSizes: number[] = []; // sizes t of tied groups (t >= 2)
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + j + 1) / 2;
    if (j - i > 1) tieSizes.push(j - i);
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  let R1 = 0;
  for (let k = 0; k < combined.length; k++) { if (combined[k].g === 0) R1 += ranks[k]; }

  const U1 = R1 - n1 * (n1 + 1) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  // Normal approximation with CONTINUITY CORRECTION and TIE VARIANCE
  // correction (scipy.stats.mannwhitneyu, method='asymptotic'):
  //   sigma^2 = n1 n2 / 12 * ((N + 1) - Sum_t (t^3 - t) / (N (N - 1)))
  //   z = (|U - mu| - 0.5) / sigma
  const N = n1 + n2;
  const muU = n1 * n2 / 2;
  let tieCorr = 0;
  for (const t of tieSizes) tieCorr += (t ** 3 - t) / (N * (N - 1));
  const sigmaU = Math.sqrt(Math.max(n1 * n2 / 12 * ((N + 1) - tieCorr), 1e-12));
  const z = sigmaU > 0 ? (Math.abs(U - muU) - 0.5) / sigmaU : 0;
  // Exact normal CDF from math/stats (replaces the local erf approximation)
  const p = 2 * (1 - pnorm(Math.abs(z)));

  return { uStatistic: U, pValue: p, zScore: (U - muU) / sigmaU };
}

function normCDF_mw(x: number): number {
  return 0.5 * (1 + erf_mw(x / Math.SQRT2));
}

function erf_mw(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  return sign * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

// ═══════════════════════════════════════════════════════════════════
// Convex Hull Volume (hypervolume)
// ═══════════════════════════════════════════════════════════════════

export function convexHullVolume(points: number[][]): number {
  const n = points.length, p = points[0]?.length ?? 0;
  if (n < p + 1) return 0;

  // For 2D: use shoelace formula (Graham scan — already correct)
  if (p === 2) {
    const hull = convexHull2D(points);
    if (hull.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      area += hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1];
    }
    return Math.abs(area) / 2;
  }

  // For 3D: implement QuickHull + cone decomposition.
  // Ref: Barber C.B., Dobkin D.P., Huhdanpaa H. (1996) ACM Trans. Math. Soft. 22(4): 469-483.
  //      "The Quickhull algorithm for convex hulls" — qhull library.
  if (p === 3) return convexHullVolume3D(points);

  // For ND (nDim > 3): use bounding-box volume as a loose upper bound.
  // A proper ND QuickHull (Barber et al. 1996) requires triangulating into
  // n-simplices, which is beyond scope. Users should project to 3D or use
  // scipy.spatial.ConvexHull (qhull) for ND volumes.
  const mins = new Array(p).fill(Infinity);
  const maxs = new Array(p).fill(-Infinity);
  for (const pt of points) {
    for (let d = 0; d < p; d++) {
      mins[d] = Math.min(mins[d], pt[d]);
      maxs[d] = Math.max(maxs[d], pt[d]);
    }
  }
  let vol = 1;
  for (let d = 0; d < p; d++) vol *= (maxs[d] - mins[d]);
  return vol;
}

/**
 * 3D Convex Hull Volume — incremental hull + cone decomposition.
 *
 * Algorithm:
 * 1. Centroid-shift so the origin is inside the convex hull. This
 *    guarantees every hull face is visible from the origin, enabling
 *    reliable cone decomposition V = Σ V_tet(origin, face_vertices).
 * 2. Build the 3D convex hull with the INCREMENTAL algorithm
 *    (initialize from a non-degenerate tetrahedron, then insert each
 *    remaining point: delete the faces visible from the point, re-triangulate
 *    along the horizon). The previous gift-wrapping (Jarvis march) version
 *    was NOT a correct 3D hull — its azimuth-angle edge walk silently
 *    dropped or mis-oriented faces on general point sets.
 * 3. Decompose the hull into tetrahedra: each triangular face + origin.
 *
 * Ref: Preparata & Shamos (1985) Computational Geometry, Springer, Sec 3.4.
 *      de Berg et al. (2008) Computational Geometry: Algorithms and
 *      Applications, 3rd ed., Ch. 11 (incremental hull).
 *
 * For the unit cube [0,1]^3: centroid = (0.5,0.5,0.5), after shift the hull
 * is the centered cube [-0.5,0.5]^3 with volume 1.0.
 */
function convexHullVolume3D(points: number[][]): number {
  const n = points.length;
  if (n < 4) return 0;

  // Centroid-shift: ensures origin lies inside the convex hull.
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  const cz = points.reduce((s, p) => s + p[2], 0) / n;
  const pts = points.map(p => [p[0] - cx, p[1] - cy, p[2] - cz]);

  // Scale-based tolerance for planarity/visibility decisions
  let scale = 0;
  for (const p of pts) for (const v of p) scale = Math.max(scale, Math.abs(v));
  const eps = 1e-9 * Math.max(scale, 1);

  const faces = convexHull3DIncremental(pts, eps);
  if (faces.length === 0) return 0;

  // Cone decomposition: each triangular face + origin forms a tetrahedron.
  // Volume of tetrahedron (0, a, b, c) = |det([a b c])| / 6
  let vol = 0;
  for (const [ai, bi, ci] of faces) {
    const a = pts[ai], b = pts[bi], c = pts[ci];
    vol += Math.abs(
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
  return vol;
}

interface HullFace {
  a: number; b: number; c: number;   // vertex indices (outward CCW)
  normal: [number, number, number];  // unit outward normal
  d: number;                         // plane offset: normal·x = d
}

/**
 * Incremental 3D convex hull.
 * Returns the list of triangular faces as vertex-index triples, oriented
 * counterclockwise seen from outside. Returns [] for degenerate input
 * (< 4 non-coplanar points).
 */
function convexHull3DIncremental(pts: number[][], eps: number): number[][] {
  const n = pts.length;
  if (n < 4) return [];

  const sub = (a: number[], b: number[]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: number[], b: number[]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm3 = (a: number[]): number => Math.sqrt(dot(a, a));

  function makeFace(a: number, b: number, c: number): HullFace | null {
    const ab = sub(pts[b], pts[a]), ac = sub(pts[c], pts[a]);
    const nrm = cross(ab, ac);
    const len = norm3(nrm);
    if (len < eps) return null; // degenerate triangle
    const normal: [number, number, number] = [nrm[0] / len, nrm[1] / len, nrm[2] / len];
    return { a, b, c, normal, d: dot(normal, pts[a]) };
  }

  // ── Step 1: find an initial non-degenerate tetrahedron ──
  // First two distinct points
  let i0 = 0;
  let i1 = -1;
  for (let i = 1; i < n; i++) {
    if (norm3(sub(pts[i], pts[i0])) > eps) { i1 = i; break; }
  }
  if (i1 < 0) return []; // all points identical
  // Third point not collinear with (i0, i1)
  let i2 = -1;
  const dir01 = sub(pts[i1], pts[i0]);
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    if (norm3(cross(dir01, sub(pts[i], pts[i0]))) > eps) { i2 = i; break; }
  }
  if (i2 < 0) return []; // all points collinear
  // Fourth point not coplanar with (i0, i1, i2)
  const n012 = cross(sub(pts[i1], pts[i0]), sub(pts[i2], pts[i0]));
  let i3 = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    if (Math.abs(dot(n012, sub(pts[i], pts[i0]))) > eps) { i3 = i; break; }
  }
  if (i3 < 0) return []; // all points coplanar (flat hull: zero volume)

  // Orient the initial tetrahedron so all faces have OUTWARD normals
  // (relative to the tetrahedron's centroid).
  const centroid: [number, number, number] = [
    (pts[i0][0] + pts[i1][0] + pts[i2][0] + pts[i3][0]) / 4,
    (pts[i0][1] + pts[i1][1] + pts[i2][1] + pts[i3][1]) / 4,
    (pts[i0][2] + pts[i1][2] + pts[i2][2] + pts[i3][2]) / 4,
  ];
  let faces: HullFace[] = [];
  const rawTetra: [number, number, number][] = [[i0, i1, i2], [i0, i3, i1], [i0, i2, i3], [i1, i3, i2]];
  for (const [a, b, c] of rawTetra) {
    let f = makeFace(a, b, c);
    if (f === null) return [];
    // Flip if the tetra centroid is on the positive side of the plane
    if (dot(f.normal, centroid) - f.d > 0) f = makeFace(a, c, b);
    if (f === null) return [];
    faces.push(f);
  }

  // ── Step 2: insert remaining points ──
  for (let pi = 0; pi < n; pi++) {
    if (pi === i0 || pi === i1 || pi === i2 || pi === i3) continue;
    const p = pts[pi];

    // Faces visible from p (outward side, beyond tolerance)
    const visible: boolean[] = faces.map(f => dot(f.normal, p) - f.d > eps);
    let nVisible = 0;
    for (const v of visible) if (v) nVisible++;
    if (nVisible === 0) continue; // inside (or on) the hull

    // Horizon = directed edges of visible faces whose reverse directed edge
    // is NOT an edge of another visible face. New faces keep orientation by
    // reusing the horizon edge direction.
    const edgeSet = new Set<string>();
    for (let fi = 0; fi < faces.length; fi++) {
      if (!visible[fi]) continue;
      const f = faces[fi];
      edgeSet.add(`${f.a},${f.b}`);
      edgeSet.add(`${f.b},${f.c}`);
      edgeSet.add(`${f.c},${f.a}`);
    }
    const horizon: [number, number][] = [];
    for (const key of edgeSet) {
      const [u, v] = key.split(',');
      if (!edgeSet.has(`${v},${u}`)) horizon.push([Number(u), Number(v)]);
    }

    // Remove visible faces and add the cone from the horizon to p
    faces = faces.filter((_, fi) => !visible[fi]);
    for (const [u, v] of horizon) {
      const f = makeFace(u, v, pi);
      if (f !== null) faces.push(f);
    }
    if (faces.length === 0) return [];
  }

  return faces.map(f => [f.a, f.b, f.c]);
}


function convexHull2D(points: number[][]): number[][] {
  // Graham scan
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (O: number[], A: number[], B: number[]) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);

  const lower: number[][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }

  const upper: number[][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

// ═══════════════════════════════════════════════════════════════════
// Morphospace Disparity
// ═══════════════════════════════════════════════════════════════════

export interface DisparityResult {
  /** Mean pairwise distance D = (2/n(n-1)) Σ_{i<j} d_ij (Foote 1993). */
  dispersion?: number;
  /** Maximum pairwise distance R = max_{i<j} d_ij (Foote 1993). */
  range?: number;
  /** Variance of the pairwise distances. */
  variance: number;
  /** Median of the pairwise distances (Foote 1993 summary). */
  median?: number;
  /** Mean squared distance from the centroid (legacy field, kept for
   *  backward compatibility). */
  meanSquaredDistance: number;
  /** Per-dimension ranges (legacy field, kept for backward compatibility). */
  ranges: number[];
  nSpecimens: number;
}

/**
 * Morphospace disparity — Foote (1993) definitions.
 *
 * The primary metrics are computed from the PAIRWISE DISTANCES of the
 * specimens (Python geometry.py `morphospace_disparity`):
 *
 *     Dispersion (mean pairwise distance):
 *         D = (2/n(n-1)) Σ_{i<j} ||x_i - x_j||
 *     Range (maximum pairwise distance):
 *         R = max_{i<j} ||x_i - x_j||
 *
 * `variance` (variance of the pairwise distances) and `median` are reported
 * alongside, and the legacy `meanSquaredDistance` (mean squared distance to
 * the centroid) and per-dimension `ranges` fields are kept for backward
 * compatibility.
 *
 * Reference: Foote, M. (1993). Contribution of the fossil record to the
 * study of morphological evolution. Science, 260, 971-974.
 */
export function morphospaceDisparity(configurations: Matrix): DisparityResult {
  const n = configurations.rows, p = configurations.cols;
  const mean = configurations.meanAxis(0);

  // Mean squared distance from centroid (legacy metric)
  let msd = 0;
  const ranges: number[] = new Array(p).fill(0);
  const mins = new Array(p).fill(Infinity);
  const maxs = new Array(p).fill(-Infinity);

  for (let i = 0; i < n; i++) {
    let dist = 0;
    for (let j = 0; j < p; j++) {
      const diff = configurations.get(i, j) - mean.get(0, j);
      dist += diff * diff;
      mins[j] = Math.min(mins[j], configurations.get(i, j));
      maxs[j] = Math.max(maxs[j], configurations.get(i, j));
    }
    msd += dist;
  }
  msd /= n;

  for (let j = 0; j < p; j++) ranges[j] = maxs[j] - mins[j];

  // Pairwise distances (upper triangle)
  const distances: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let d = 0;
    for (let k = 0; k < p; k++) d += (configurations.get(i, k) - configurations.get(j, k)) ** 2;
    distances.push(Math.sqrt(d));
  }
  const meanDist = distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
  const variance = distances.length > 0 ? distances.reduce((s, d) => s + (d - meanDist) ** 2, 0) / distances.length : 0;
  const maxDist = distances.length > 0 ? distances.reduce((a, b) => Math.max(a, b), 0) : 0;
  const sortedDist = [...distances].sort((a, b) => a - b);
  const median = sortedDist.length > 0
    ? (sortedDist.length % 2 === 1
        ? sortedDist[(sortedDist.length - 1) / 2]
        : 0.5 * (sortedDist[sortedDist.length / 2 - 1] + sortedDist[sortedDist.length / 2]))
    : 0;

  return {
    // Foote (1993) primary metrics
    dispersion: meanDist, range: maxDist, variance, median,
    // Legacy fields (backward compatibility)
    meanSquaredDistance: msd, ranges, nSpecimens: n,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PLS (Partial Least Squares) — Two-Block
// ═══════════════════════════════════════════════════════════════════

export interface PLSResult {
  xScores: Matrix;
  yScores: Matrix;
  singularValues: number[];
  covarianceExplained: number[];
  rvCoefficient: number;
  nComponents: number;
}

export function plsAnalysis(blockA: Matrix, blockB: Matrix, nComponents?: number): PLSResult {
  const n = blockA.rows;
  const nc = Math.min(nComponents ?? Math.min(blockA.cols, blockB.cols), n - 1);

  // Cross-block covariance
  const C = blockA.transpose().matmul(blockB).div(n - 1);

  // SVD of cross-covariance
  const { U, S, Vt } = svd(C);
  const eigTop = S.slice(0, nc);
  const totalCov = S.reduce((a, b) => a + b, 0);
  const covExplained = eigTop.map(s => totalCov > 0 ? s / totalCov * 100 : 0);

  // PLS scores
  const xScores = blockA.matmul(U.sliceCols(0, nc));
  const yScores = blockB.matmul(Vt.sliceCols(0, nc).transpose());

  // RV coefficient (Escoufier 1973)
  const C2 = C.mul(C);
  const normC = Math.sqrt(C2.sum());
  const A2 = blockA.transpose().matmul(blockA).div(n - 1);
  const B2 = blockB.transpose().matmul(blockB).div(n - 1);
  const normA = Math.sqrt(A2.mul(A2).sum());
  const normB = Math.sqrt(B2.mul(B2).sum());
  const rv = (normA > 0 && normB > 0) ? (normC * normC) / (normA * normB) : 0;

  return { xScores, yScores, singularValues: eigTop, covarianceExplained: covExplained, rvCoefficient: rv, nComponents: nc };
}

// ═══════════════════════════════════════════════════════════════════
// Minimum Spanning Tree (Prim's algorithm)
// ═══════════════════════════════════════════════════════════════════

export interface MSTResult {
  edges: [number, number, number][]; // [node_i, node_j, weight]
  totalWeight: number;
  nEdges: number;
}

/**
 * Minimum Spanning Tree (Prim's algorithm) — port of Python geometry.py
 * `minimum_spanning_tree`.
 *
 * Accepts EITHER:
 *  - a precomputed distance Matrix (n x n), or
 *  - point coordinates as number[][] (n points x n dims) or as a Matrix of
 *    shape (n_points x n_dims) — the Python coordinate overload — in which
 *    case the Euclidean distance matrix is computed internally.
 */
export function minimumSpanningTree(distMatrix: Matrix | number[][]): MSTResult {
  let D: Matrix;
  if (distMatrix instanceof Matrix && distMatrix.rows === distMatrix.cols && distMatrix.cols !== 1) {
    D = distMatrix;
  } else {
    // Coordinate input: compute the pairwise Euclidean distances
    const nPts = distMatrix instanceof Matrix
      ? Array.from({ length: distMatrix.rows }, (_, i) => distMatrix.row(i))
      : distMatrix;
    const n = nPts.length;
    D = Matrix.zeros(n, n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let k = 0; k < nPts[i].length; k++) s += (nPts[i][k] - nPts[j][k]) ** 2;
      const d = Math.sqrt(s);
      D.set(i, j, d); D.set(j, i, d);
    }
  }
  const n = D.rows;
  const inMST = new Array(n).fill(false);
  const minEdge = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  const edges: [number, number, number][] = [];

  minEdge[0] = 0;
  let totalWeight = 0;

  for (let iter = 0; iter < n; iter++) {
    // Find vertex with minimum edge weight not yet in MST
    let u = -1;
    for (let v = 0; v < n; v++) {
      if (!inMST[v] && (u === -1 || minEdge[v] < minEdge[u])) u = v;
    }
    if (u === -1) break;
    inMST[u] = true;
    totalWeight += minEdge[u];
    if (parent[u] >= 0) edges.push([parent[u], u, D.get(parent[u], u)]);

    // Update edge weights
    for (let v = 0; v < n; v++) {
      if (!inMST[v] && D.get(u, v) < minEdge[v]) {
        minEdge[v] = D.get(u, v);
        parent[v] = u;
      }
    }
  }

  return { edges, totalWeight, nEdges: edges.length };
}

// ═══════════════════════════════════════════════════════════════════
// Ancestral State Reconstruction (weighted squared-change parsimony / ML)
// ═══════════════════════════════════════════════════════════════════

export interface ASRResult {
  nodeStates: Map<string, number>;
  nodeNames: string[];
  tipValues: Record<string, number>;
  model: string;
  /** OU alpha used when model = 'ou' (transformed-branch ASR). */
  ouAlpha?: number;
}

/**
 * Ancestral State Reconstruction — port of Python pcm.py
 * `reconstruct_ancestral_states` (corrected version).
 *
 * BM (model='bm', default): post-order recursion where each node's state is
 * the ML/BM inverse-VARIANCE weighted mean of its child reconstructions,
 * with weight w = 1/(subtree cumulative variance + child branch length).
 * The old implementation used w = 1/max(branchLength, 0.001), which ignores
 * the descendant variance (over-weighting deep nodes) and mistook a genuine
 * 0 branch length for a missing value; it has been replaced. The variance
 * accumulated below each node is pooled = 1/Σ(1/v_i) (variance of the
 * inverse-variance weighted mean); leaves return cumVar = 0 and the parent
 * adds the child's own branch length (Felsenstein 1985 convention).
 *
 * OU (model='ou'): Brownian branch lengths are replaced by the
 * Ornstein-Uhlenbeck accumulated variances v(b) = (1 - e^(-2αb))/(2α)
 * (limit b as α→0; Garland et al. 1993 transformed branch lengths,
 * Martins & Hansen 1997). The root state is refined by generalized least
 * squares on the OU VCV matrix (Hansen 1997):
 *     â = (1ᵀ V⁻¹ 1)⁻¹ 1ᵀ V⁻¹ y,
 * which is the ML estimate of the optimum under a single-peak OU model.
 * This realizes the VCV-GLS approach documented (but left unimplemented)
 * in Python pcm.py; α defaults to `ouAlpha` = 1.
 *
 * @param model   'bm' (default) or 'ou'
 * @param ouAlpha OU alpha parameter (used only when model='ou')
 */
export function reconstructAncestralStates(
  root: any,
  traitValues: Record<string, number>,
  model: string = 'bm',
  ouAlpha: number = 1.0,
): ASRResult {
  const nodeStates = new Map<string, number>();
  const nodeNames: string[] = [];
  const alpha = Math.max(ouAlpha, 1e-12);

  // OU variance accumulated along a branch of length b
  const branchVar = (b: number): number => {
    const bl = b || 0;
    if (model === 'ou') {
      return (1 - Math.exp(-2 * alpha * bl)) / (2 * alpha);
    }
    return bl;
  };

  // Returns [reconstructed value, subtree cumulative variance (excluding the
  // node's own branch length)] or null when the subtree has no trait data.
  function assignStates(node: any): [number, number] | null {
    if (node.isLeaf) {
      const val = traitValues[node.name];
      return val === undefined ? null : [val, 0];
    }

    const childRes: { node: any; val: number; cvar: number }[] = [];
    for (const child of node.children) {
      const res = assignStates(child);
      if (res !== null) childRes.push({ node: child, val: res[0], cvar: res[1] });
    }
    if (childRes.length === 0) return null;
    if (childRes.length === 1) {
      const c = childRes[0];
      return [c.val, c.cvar + branchVar(c.node.branchLength)];
    }

    // ML/BM weights: inverse variance 1/(subtree cumVar + child branch var).
    let totalW = 0, weightedSum = 0, invSum = 0;
    for (const c of childRes) {
      let v = c.cvar + branchVar(c.node.branchLength);
      if (v <= 0) v = 1e-10;
      totalW += 1 / v;
      weightedSum += c.val / v;
      invSum += 1 / v;
    }
    const recon = totalW > 0 ? weightedSum / totalW : mean(childRes.map(c => c.val));
    const pooled = totalW > 0 ? 1 / totalW : (invSum > 0 ? 1 / invSum : 0);

    const nodeName = node.name || `node_${nodeNames.length}`;
    nodeStates.set(nodeName, recon);
    nodeNames.push(nodeName);
    return [recon, pooled];
  }

  assignStates(root);

  // OU: refine the root state by GLS on the OU VCV (Hansen 1997):
  // â = (1ᵀV⁻¹1)⁻¹ 1ᵀV⁻¹y with V_ij = e^{-α d_ij} (1 - e^{-2α h_ij})/(2α),
  // V_ii = (1 - e^{-2α t_i})/(2α); d_ij = t_i + t_j - 2 h_ij.
  if (model === 'ou' && nodeNames.length > 0) {
    try {
      const leaves = getLeaves(root);
      const tipNames = leaves.map(l => l.name);
      const n = tipNames.length;
      if (n >= 3) {
        const bmV = buildVCV(root, tipNames); // t_i on diagonal, h_ij off-diagonal
        const V: number[][] = bmV.map((row, i) => row.map((v, j) => {
          if (i === j) return (1 - Math.exp(-2 * alpha * v)) / (2 * alpha);
          const h = v; // shared path root->LCA
          const ti = bmV[i][i], tj = bmV[j][j];
          const d = ti + tj - 2 * h;
          return Math.exp(-alpha * d) * (1 - Math.exp(-2 * alpha * h)) / (2 * alpha);
        }));
        const y = tipNames.map(nm => traitValues[nm] ?? NaN);
        if (!y.some(v => isNaN(v))) {
          const Vinv = inv(new Matrix(new Float64Array(V.flat()), n, n));
          const ones = new Array<number>(n).fill(1);
          const oneViOne = quadForm(Vinv, ones, ones);
          const oneViY = quadForm(Vinv, ones, y);
          if (oneViOne > 0) {
            const rootGls = oneViY / oneViOne;
            // Overwrite the root entry (first recorded node at the root name)
            const rootName = root.name || nodeNames[0];
            if (nodeStates.has(rootName)) nodeStates.set(rootName, rootGls);
          }
        }
      }
    } catch {
      // Singular OU VCV: keep the recursion-based root estimate
    }
  }

  return {
    nodeStates, nodeNames, tipValues: traitValues, model,
    ouAlpha: model === 'ou' ? alpha : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// DCA — Detrended Correspondence Analysis
// ═══════════════════════════════════════════════════════════════════

export interface DCAResult {
  scores: Matrix;
  eigenvalues: number[];
  lengths: number[];   // gradient lengths (in SD units)
  nAxes: number;
  method: string;
}

/**
 * Detrended Correspondence Analysis — Hill & Gauch (1980).
 *
 * Algorithm (mirrors vegan::decorana):
 * 1. Center & chi-square weight the abundance matrix (Correspondence Analysis step).
 * 2. Extract the first nAxes axes via SVD of the chi-square matrix.
 * 3. Detrend each axis ≥ 2 by segmentwise linear regression on axis 1:
 *    for each segment, fit y = a + b*x, then replace y with y - (a + b*x).
 *    This removes the arch effect (ten Bosch & ter Braak 1992).
 *
 * References:
 * - Hill, M.O. & Gauch, H.G. (1980). "Detrended correspondence analysis:
 *   an improved ordination technique." Vegetatio 42: 47-58.
 * - ter Braak, C.J.F. & Šmilauer, P. (2012). CANOCO 5 reference manual.
 *   Sect. 6.3.2 "Detrending".  [segmentwise detrending algorithm]
 * - vegan::decorana — R implementation of DECORANA.
 */
export function dca(
  speciesAbundance: Matrix,
  options: { nAxes?: number; segmentLength?: number } = {},
): DCAResult {
  const { nAxes = 4, segmentLength = 0 } = options;
  const n = speciesAbundance.rows, p = speciesAbundance.cols;
  const segLen = segmentLength > 0 ? segmentLength : Math.max(10, Math.floor(n / 4));

  // ── Step 1: Chi-square standardization (CA preprocessing) ────────────────────
  const rowTotals = speciesAbundance.sumAxis(1);
  const colTotals = speciesAbundance.sumAxis(0);
  const grandTotal = rowTotals.sum();

  // Y_chi[i,j] = (Y_ij / rowTotals[i]) / sqrt(colTotals[j] / grandTotal)
  // i.e. row-normalize then weight by inverse sqrt of column totals
  const Ydata = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      const ri = rowTotals[i] > 0 ? 1 / rowTotals[i] : 0;
      const sqrtCol = Math.sqrt(colTotals[j] / grandTotal);
      Ydata[i * p + j] = (speciesAbundance.get(i, j) * ri) / (sqrtCol > 0 ? sqrtCol : 1);
    }
  }
  const Ychi = new Matrix(Ydata, n, p);

  // ── Step 2: SVD of the chi-square matrix ───────────────────────────────────
  // CA scores = U * S, species loadings = Vt^T * S  (standard biplot scaling)
  // Here we use the site scores (U * S) as ordination coordinates.
  const { U, S, Vt } = svd(Ychi);
  const nRet = Math.min(nAxes, S.length);

  // Axis eigenvalues (inertia)
  const eigenvalues = S.map(s => s * s);

  // Scores = U * diag(S)  (each column j: score_ij = U_ij * S_j)
  const scoresData = new Float64Array(n * nRet);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < nRet; j++) {
      scoresData[i * nRet + j] = U.get(i, j) * S[j];
    }
  }
  const scores = new Matrix(scoresData, n, nRet);

  // Gradient lengths (Hill 1979, Gauch 1982): 4 / sqrt(lambda)
  // These are in standard-deviation (SD) units of species turnover.
  const lengths = eigenvalues.slice(0, nRet).map(e => (e > 0 ? 4 / Math.sqrt(e) : 0));

  // ── Step 3: Detrending (segmentwise polynomial regression) ───────────────
  // Detrend axes 2+ by removing the linear relationship with axis 1 within
  // each segment.  This is the "second-order polynomial detrending" variant
  // used by DECORANA (Hill & Gauch 1980; ten Bosch & ter Braak 1992).
  const detrended = scores.clone();

  for (let ax = 1; ax < nRet; ax++) {
    // Sort by axis-1 score to form segments
    const order = Array.from({ length: n }, (_, i) => i);
    order.sort((a, b) => scores.get(a, 0) - scores.get(b, 0));

    // Segment boundaries
    const nSeg = Math.max(1, Math.floor(n / segLen));
    const segSize = Math.ceil(n / nSeg);

    for (let s = 0; s < nSeg; s++) {
      const start = s * segSize;
      const end = Math.min(start + segSize, n);
      if (end - start < 2) continue;

      // Gather segment points
      const segIdx = order.slice(start, end);
      const x = segIdx.map(i => scores.get(i, 0));
      const y = segIdx.map(i => detrended.get(i, ax));

      // Linear regression y = a + b*x within this segment
      const xMean = x.reduce((a, b) => a + b, 0) / x.length;
      const yMean = y.reduce((a, b) => a + b, 0) / y.length;
      let num = 0, den = 0;
      for (let k = 0; k < x.length; k++) {
        num += (x[k] - xMean) * (y[k] - yMean);
        den += (x[k] - xMean) ** 2;
      }
      const b = den > 0 ? num / den : 0;
      const a = yMean - b * xMean;

      // Subtract the regression line from the detrended scores
      for (const idx of segIdx) {
        const xVal = scores.get(idx, 0);
        detrended.set(idx, ax, detrended.get(idx, ax) - (a + b * xVal));
      }
    }
  }

  return {
    scores: detrended,
    eigenvalues: eigenvalues.slice(0, nRet),
    lengths: lengths,
    nAxes: nRet,
    method: 'DCA (Hill & Gauch 1980, vegan::decorana)',
  };
}

// ─── Re-exports of new sub-modules (Ripley K, Normality test) ─────────────────
export { ripleyK, type SpatialResult } from './Spatial';
export { normalityTest, type NormalityResult } from './Normality';

// ─── Re-exports: univariate extensions & Tukey HSD (Python univariate.py) ────
export {
  computeAicc, compareModels, cohensD, etaSquared, omegaSquared, partialEtaSquared,
  type AiccModelSpec, type AiccModelResult, type AiccComparison,
} from './Univariate';
export { ptukeyCdf, ptukeySf, tukeyHsd, type TukeyPairResult } from './Tukey';

// ═══════════════════════════════════════════════════════════════════
// Hellinger Transformation
// ═══════════════════════════════════════════════════════════════════

/**
 * Hellinger transformation for community composition data.
 * Transforms a raw species abundance matrix Y (n × p) to Hellinger space:
 *   H_ij = sqrt(Y_ij / Y_i+)
 * i.e., each row is first divided by its row sum (relative abundance),
 * then the square root is taken.
 *
 * This is the standard pre-processing for Hellinger-PcoA (Legendre & Gallagher 2001)
 * and ensures that the resulting distance matrix approximates the Hellinger distance:
 *   d_Hellinger(x,y) = sqrt(Σ (sqrt(x_i/sum(x)) - sqrt(y_i/sum(y)))²)
 *
 * Ref: Legendre P., Gallagher E.D. (2001) Ecology 82(1): 29-44, Eq. (1).
 *      Also vegan::decostand(method="hellinger").
 */
export function hellinger(Y: Matrix): Matrix {
  const n = Y.rows, p = Y.cols;
  const rowSums = Y.sumAxis(1);
  const result = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const rs = rowSums[i];
    if (rs <= 0) continue; // Guard against zero row sums
    for (let j = 0; j < p; j++) {
      result[i * p + j] = Math.sqrt(Y.get(i, j) / rs);
    }
  }
  return new Matrix(result, n, p);
}

// ═══════════════════════════════════════════════════════════════════
// Confidence Ellipse
// ═══════════════════════════════════════════════════════════════════

export interface ConfidenceEllipseResult {
  /** Semi-major axis length (a) */
  semiMajor: number;
  /** Semi-minor axis length (b) */
  semiMinor: number;
  /** Rotation angle in radians (from x-axis to major axis) */
  angle: number;
  /** Center (mean) of the ellipse */
  center: [number, number];
  /** Chi-squared critical value used */
  chi2Critical: number;
  /** Confidence level */
  level: number;
}

/**
 * Compute a confidence ellipse for bivariate data.
 *
 * Algorithm:
 * 1. Compute the 2×2 covariance matrix of the scores.
 * 2. Perform eigendecomposition to obtain axes and orientation.
 * 3. Scale each semi-axis by sqrt(χ²_{2,α}) where χ² has 2 df
 *    (the distribution of Mahalanobis distances under the normal assumption).
 * 4. Return semi-major (a), semi-minor (b), and rotation angle θ.
 *
 * Ref: Johnson R.A. & Wichern D.W. (2007) Applied Multivariate Statistical
 *      Analysis, 6th ed. Pearson, Sec. 4.5 "Ellipses and the RMSE".
 *      Also: Ritz J.M. & Strehmel A. (1996) J. R. Statist. Soc. B 58: 655-666.
 *
 * @param scores  - matrix with n rows and 2 columns (bivariate scores)
 * @param level   - confidence level (default 0.95 for 95% CI)
 * @returns ellipse parameters: semi-major, semi-minor, angle, center
 */
export function confidenceEllipse(
  scores: Matrix,
  level: number = 0.95,
): ConfidenceEllipseResult {
  if (scores.cols !== 2) {
    throw new Error(`confidenceEllipse requires 2 columns (got ${scores.cols})`);
  }
  const n = scores.rows;
  if (n < 3) {
    throw new Error(`confidenceEllipse requires at least 3 samples (got ${n})`);
  }

  // Compute mean
  const meanX = scores.col(0).reduce((a, b) => a + b, 0) / n;
  const meanY = scores.col(1).reduce((a, b) => a + b, 0) / n;

  // Covariance matrix (2×2)
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = scores.get(i, 0) - meanX;
    const dy = scores.get(i, 1) - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= (n - 1);
  sxy /= (n - 1);
  syy /= (n - 1);

  // Eigendecomposition of covariance matrix (analytical for 2×2)
  // Ref: Johnson & Wichern (2007), Applied Multivariate Statistical Analysis, Sec. 4.5
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + discriminant;
  const lambda2 = trace / 2 - discriminant;

  // Semi-axes (unscaled)
  const a0 = Math.sqrt(Math.max(0, lambda1));
  const b0 = Math.sqrt(Math.max(0, lambda2));

  // Angle of major axis (from x-axis, counterclockwise)
  // eigenvector for lambda1: [sxy, lambda1 - sxx]
  const theta = Math.atan2(lambda1 - sxx, sxy);

  // Chi-squared critical value for 2 df at confidence level
  // Ref: Johnson & Wichern (2007), Eq. 4.42: ellipse equation uses χ²_{2,α}
  // Uses the verified chi-square quantile from math/stats (Newton iteration
  // on the regularized gamma CDF); the local bisection approximation
  // chi2Inverse_approx is retained below but no longer on the p-value path.
  const chi2Crit = qchisq(level, 2);

  const semiMajor = a0 * Math.sqrt(chi2Crit);
  const semiMinor = b0 * Math.sqrt(chi2Crit);

  return {
    semiMajor,
    semiMinor,
    angle: theta,
    center: [meanX, meanY],
    chi2Critical: chi2Crit,
    level,
  };
}

/**
 * Inverse chi-squared CDF (lower-tail) via regularized incomplete gamma.
 * Uses binary search on the gamma CDF for accuracy.
 */
function chi2Inverse_approx(p: number, df: number): number {
  // Newton-bisection hybrid to solve gammainc(df/2, x/2) = p * Gamma(df/2)
  // We instead use the closed-form inverse for df=2 and bisection otherwise.
  const a = df / 2;
  let lo = 0.001, hi = 1000;
  if (df === 2) {
    // Closed form: x = -2 * ln(1 - p)
    return -2 * Math.log(1 - Math.min(0.9999, Math.max(0.0001, p)));
  }
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const cdf = gammainc_local(a, mid / 2);
    if (Math.abs(cdf - p) < 1e-10 || (hi - lo) < 1e-12) break;
    if (cdf < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── Re-exports of new sub-modules (Ripley K, Normality test) ─────────────────
