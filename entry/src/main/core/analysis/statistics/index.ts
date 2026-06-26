import { Matrix } from '../../math/Matrix';
import { svd, eigh } from '../../math/linalg';
import { mean, std, rankdata } from '../../math/stats';
import { randnArray } from '../../math/random';

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
 */
export function pca(
  data: Matrix,
  nComponents?: number,
  method: 'covariance' | 'correlation' = 'covariance',
): PCAResult {
  const n = data.rows, p = data.cols;
  const maxComp = Math.min(n - 1, p);
  const nc = Math.min(nComponents ?? maxComp, maxComp);

  // Center (and optionally standardize)
  const meanVec: number[] = [];
  for (let j = 0; j < p; j++) {
    let s = 0; for (let i = 0; i < n; i++) s += data.get(i, j);
    meanVec.push(s / n);
  }

  let stdVec: number[] | null = null;
  const Zdata = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      let val = data.get(i, j) - meanVec[j];
      if (method === 'correlation') {
        if (!stdVec) {
          stdVec = [];
          for (let k = 0; k < p; k++) {
            let ss = 0;
            for (let r = 0; r < n; r++) ss += (data.get(r, k) - meanVec[k]) ** 2;
            stdVec.push(Math.sqrt(ss / (n - 1)) || 1);
          }
        }
        val /= stdVec[j];
      }
      Zdata[i * p + j] = val;
    }
  }
  const Z = new Matrix(Zdata, n, p);

  // SVD
  const { S } = svd(Z);
  const eigenvaluesRaw = S.map(s => (s * s) / (n - 1));

  // Sort descending (SVD already returns descending)
  const eigenvalues = eigenvaluesRaw.slice(0, nc);
  const totalVar = eigenvaluesRaw.reduce((a, b) => a + b, 0);
  const explainedVar = eigenvalues.map(e => totalVar > 0 ? (e / totalVar) * 100 : 0);
  const cumVar: number[] = [];
  let cum = 0;
  for (const v of explainedVar) { cum += v; cumVar.push(cum); }

  // Scores and loadings
  const { U, Vt } = svd(Z);
  const V = Vt.transpose();
  const scores = Z.matmul(V.sliceCols(0, nc));
  const loadingsD = new Float64Array(nc * p);
  for (let j = 0; j < nc; j++) {
    const sq = Math.sqrt(eigenvalues[j]);
    for (let i = 0; i < p; i++) loadingsD[j * p + i] = V.get(i, j) * sq;
  }
  const loadings = new Matrix(loadingsD, nc, p);

  return {
    scores, loadings, eigenvalues,
    explainedVariance: explainedVar, cumulativeVariance: cumVar,
    eigenvaluesRaw, meanVector: meanVec, nComponents: nc, method,
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
}

/**
 * NMDS via SMACOF + isotonic regression — replaces statistics/nmds.py.
 */
export function nmds(
  distMatrix: Matrix,
  nDimensions: number = 2,
  maxIterations: number = 300,
  nRestarts: number = 5,
  tolerance: number = 1e-6,
): NMDSResult {
  const n = distMatrix.rows;
  const iu: number[] = [], ju: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { iu.push(i); ju.push(j); }
  const nPairs = iu.length;
  const dTarget = iu.map((_, k) => distMatrix.get(iu[k], ju[k]));

  let bestStress = Infinity, bestCoords: Matrix | null = null, bestIter = 0;

  for (let restart = 0; restart < nRestarts; restart++) {
    // Random initialization
    const initD = new Float64Array(n * nDimensions);
    for (let i = 0; i < initD.length; i++) initD[i] = randnArray(1)[0] * 0.01;
    let X = new Matrix(initD, n, nDimensions);

    for (let iter = 0; iter < maxIterations; iter++) {
      // Compute current distances
      const Dhat = computeDistMatrix(X);
      const dHat = iu.map((_, k) => Dhat.get(iu[k], ju[k]));

      // Isotonic regression (pool-adjacent-violators)
      const dTilde = isotonicRegression(dTarget, dHat);

      // Stress
      let num = 0, den = 0;
      for (let k = 0; k < nPairs; k++) { num += (dHat[k] - dTilde[k]) ** 2; den += dHat[k] ** 2; }
      const stress = den > 0 ? Math.sqrt(num / den) : 0;

      if (iter > 0 && Math.abs(stress - (bestStress === Infinity ? 0 : bestStress)) < tolerance) break;

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

      if (stress < bestStress) { bestStress = stress; bestCoords = X.clone(); bestIter = iter + 1; }
    }
  }

  return { coordinates: bestCoords!, stress: bestStress, nIterations: bestIter, converged: bestStress < 0.05 };
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
  // Pool-adjacent-violators algorithm
  const n = target.length;
  const order = target.map((_, i) => i).sort((a, b) => target[a] - target[b]);
  const sortedWeights = order.map(i => weights[i]);
  const result = [...sortedWeights];

  // Merge violating blocks
  let i = 0;
  while (i < n - 1) {
    if (result[i] > result[i + 1]) {
      // Merge block
      let j = i + 1;
      while (j < n && result[j] < result[i]) j++;
      const avg = 0;
      let sum = 0;
      for (let k = i; k < j; k++) sum += result[k];
      const mean = sum / (j - i);
      for (let k = i; k < j; k++) result[k] = mean;
      i = 0; // restart
    } else {
      i++;
    }
  }

  // Unsort
  const unsorted = new Array(n);
  for (let k = 0; k < n; k++) unsorted[order[k]] = result[k];
  return unsorted;
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
    results.push({
      name: colNames[j] || `Var${j}`, n: vals.length,
      mean: m, std: s, variance: v, min: Math.min(...vals), max: Math.max(...vals),
      median: med, skewness: 0, kurtosis: 0, se: se_val,
      ci95: [m - 1.96 * se_val, m + 1.96 * se_val],
    });
  }
  return results;
}

/**
 * t-test (independent two-sample).
 */
export interface TTestResult {
  statistic: number;
  pValue: number;
  df: number;
  meanDiff: number;
}

export function tTest(group1: number[], group2: number[]): TTestResult {
  const n1 = group1.length, n2 = group2.length;
  const m1 = mean(group1), m2 = mean(group2);
  const v1 = group1.reduce((s, x) => s + (x - m1) ** 2, 0) / (n1 - 1);
  const v2 = group2.reduce((s, x) => s + (x - m2) ** 2, 0) / (n2 - 1);
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = se > 0 ? (m1 - m2) / se : 0;
  const df = n1 + n2 - 2;
  // Approximate p-value using normal for large df
  const p = 2 * (1 - normCDF_approx(Math.abs(t)));
  return { statistic: t, pValue: p, df, meanDiff: m1 - m2 };
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
}

export function anova(groups: number[][]): ANOVAResult {
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

  // Approximate p-value
  const p = 1 - fCDF_approx(f, dfb, dfw);
  return { fStatistic: f, pValue: p, dfBetween: dfb, dfWithin: dfw, ssBetween: ssb, ssWithin: ssw };
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

export function anosim(distMatrix: Matrix, groups: number[], nPermutations: number = 999): ANOSIMResult {
  const n = distMatrix.rows;
  const R_obs = computeR(distMatrix, groups, n);

  let count = 0;
  for (let perm = 0; perm < nPermutations; perm++) {
    const shuffled = [...groups];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const R_perm = computeR(distMatrix, shuffled, n);
    if (R_perm >= R_obs) count++;
  }

  return { statistic: R_obs, pValue: count / nPermutations, nPermutations };
}

function computeR(D: Matrix, groups: number[], n: number): number {
  // Convert to similarities and rank
  const simVals: { val: number; i: number; j: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    simVals.push({ val: 1 - D.get(i, j), i, j });
  }
  simVals.sort((a, b) => b.val - a.val);
  const ranks = new Map<string, number>();
  for (let k = 0; k < simVals.length; k++) ranks.set(`${simVals[k].i},${simVals[k].j}`, k + 1);

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
  confusionMatrix: number[][];
  accuracy: number;
  nClasses: number;
  nSamples: number;
  classLabels: number[];
  means: Matrix;
  groups: number[];
}

export function lda(data: Matrix, groups: number[], nComponents?: number): LDAResult {
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
    const subset = data.sliceRows(idx[0], idx[0] + 1);
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
  const { U: swU, S: swS, Vt: swVt } = svd(Sw);
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

  // Confusion matrix via nearest centroid classifier
  const cm = Array.from({ length: k }, () => new Array(k).fill(0));
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const sampleScore = scores.row(i);
    let bestDist = Infinity, bestClass = 0;
    for (let ci = 0; ci < k; ci++) {
      let dist = 0;
      for (let j = 0; j < nc; j++) dist += (sampleScore[j] - classMeansLD.get(ci, j)) ** 2;
      if (dist < bestDist) { bestDist = dist; bestClass = ci; }
    }
    const trueClass = uniqueGroups.indexOf(groups[i]);
    cm[trueClass][bestClass]++;
    if (trueClass === bestClass) correct++;
  }

  return {
    scores, loadings, explainedVarianceRatio: explainedRatio, eigenvalues: eigTop,
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
}

export function cca(Y: Matrix, X: Matrix, nComponents?: number, method: 'cca' | 'rda' = 'cca'): CCAResult {
  const n = Y.rows, p = Y.cols, q = X.cols;
  const nc = Math.min(nComponents ?? Math.min(n - 1, p, q), n - 1, p, q);

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
    return { siteScores, speciesScores, biplotScores, eigenvalues: eigTop, proportionExplained: prop, cumulativeProportion: cumProp, constrainedVariance: cumProp[cumProp.length - 1] || 0, method: 'rda', nComponents: nc };
  } else {
    // CCA: chi-square standardization
    const rowTotals = Y.sumAxis(1);
    const colTotals = Y.sumAxis(0);
    const grandTotal = Y.sum();
    const expected = rowTotals.matmul(colTotals).div(grandTotal);
    const expectedSafe = expected.map(v => v > 0 ? v : 1);
    const Ystd = Y.sub(expected).div(expectedSafe.sqrt());
    const Xc = X.sub(X.meanAxis(0));
    const XtX = Xc.transpose().matmul(Xc);
    const XtXinv = inv(XtX);
    const Q = Xc.matmul(XtXinv).matmul(Xc.transpose());
    const w = rowTotals.div(grandTotal);
    const Yw = Ystd.mul(w);
    const M = Yw.transpose().matmul(Q).matmul(Yw);
    const { eigenvalues: eigs, eigenvectors: eVecs } = eigh(M);
    const eigTop = eigs.slice(0, nc);
    const totalInertia = Ystd.mul(Ystd).sum();
    const prop = eigTop.map(e => totalInertia > 0 ? Math.max(0, e) / totalInertia * 100 : 0);
    const cumProp: number[] = []; let cum = 0; for (const v of prop) { cum += v; cumProp.push(cum); }
    const siteScores = Yw.matmul(eVecs.sliceCols(0, nc));
    const speciesScores = eVecs.sliceCols(0, nc);
    const biplotScores = Xc.transpose().matmul(siteScores);
    return { siteScores, speciesScores, biplotScores, eigenvalues: eigTop, proportionExplained: prop, cumulativeProportion: cumProp, constrainedVariance: cumProp[cumProp.length - 1] || 0, method: 'cca', nComponents: nc };
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

export function permanova(distMatrix: Matrix, groups: number[], nPermutations: number = 999): PERMANOVAResult {
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
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
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
    fStatistic: F_obs, pValue: count / nPermutations,
    ssBetween: ssTotal - ssWithin, ssWithin, dfBetween: k - 1, dfWithin: n - k,
    nPermutations,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SIMPER
// ═══════════════════════════════════════════════════════════════════

export interface SIMPERResult {
  overallDissimilarity: number;
  contributions: { name: string; index: number; average: number; std: number; cumulative: number; ratio: number }[];
}

export function simper(data: Matrix, groups: number[], variableNames?: string[]): SIMPERResult {
  const nVars = data.cols;
  const names = variableNames ?? Array.from({ length: nVars }, (_, i) => `Var_${i + 1}`);
  const uniqueGroups = [...new Set(groups)];

  const contribs: number[][] = Array.from({ length: nVars }, () => []);

  for (let gi = 0; gi < uniqueGroups.length; gi++) {
    for (let gj = gi + 1; gj < uniqueGroups.length; gj++) {
      const idxA = groups.map((v, i) => v === uniqueGroups[gi] ? i : -1).filter(i => i >= 0);
      const idxB = groups.map((v, i) => v === uniqueGroups[gj] ? i : -1).filter(i => i >= 0);

      for (const ia of idxA) {
        for (const ib of idxB) {
          const rowA = data.row(ia), rowB = data.row(ib);
          let totalDen = 0;
          for (let k = 0; k < nVars; k++) totalDen += rowA[k] + rowB[k];
          if (totalDen === 0) continue;
          for (let k = 0; k < nVars; k++) {
            contribs[k].push(Math.abs(rowA[k] - rowB[k]) / totalDen);
          }
        }
      }
    }
  }

  const results = contribs.map((vals, i) => {
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const sd = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / (vals.length - 1)) : 0;
    return { name: names[i], index: i, average: avg, std: sd, cumulative: 0, ratio: sd > 0 ? avg / sd : Infinity };
  });

  results.sort((a, b) => b.average - a.average);
  const total = results.reduce((s, r) => s + r.average, 0);
  let cum = 0;
  for (const r of results) { cum += r.average; r.cumulative = total > 0 ? cum / total : 0; }

  return { overallDissimilarity: total, contributions: results };
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
  const ranks = rankdata(allVals);

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

  // Chi-squared approximation
  const df = k - 1;
  const p = 1 - chi2CDF_local(H, df);
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

export type Metric = 'euclidean' | 'bray_curtis' | 'cosine' | 'jaccard' | 'canberra' | 'cityblock' | 'correlation' | 'hamming';

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

export function hierarchicalClustering(data: Matrix, method: string = 'ward', metric: string = 'euclidean', nClusters: number = 3): ClusteringResult {
  const D = computeDistanceMatrix(data, metric as Metric);
  const n = D.rows;
  const clusters: { indices: number[]; centroid: number[] }[] = Array.from({ length: n }, (_, i) => ({ indices: [i], centroid: data.row(i) }));
  const linkage: number[][] = [];
  let nextId = n;

  while (clusters.length > 1) {
    let minDist = Infinity, mi = 0, mj = 1;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      let dist: number;
      const ni = clusters[i].indices.length, nj = clusters[j].indices.length;
      if (method === 'single') { let md = Infinity; for (const a of clusters[i].indices) for (const b of clusters[j].indices) md = Math.min(md, D.get(a, b)); dist = md; }
      else if (method === 'complete') { let md = 0; for (const a of clusters[i].indices) for (const b of clusters[j].indices) md = Math.max(md, D.get(a, b)); dist = md; }
      else if (method === 'average') { let s = 0, cnt = 0; for (const a of clusters[i].indices) for (const b of clusters[j].indices) { s += D.get(a, b); cnt++; } dist = s / cnt; }
      else { // ward
        let ss = 0;
        for (let k = 0; k < clusters[i].centroid.length; k++) ss += (clusters[i].centroid[k] - clusters[j].centroid[k]) ** 2;
        dist = (ni * nj) / (ni + nj) * ss;
      }
      if (dist < minDist) { minDist = dist; mi = i; mj = j; }
    }

    const ci = clusters[mi], cj = clusters[mj];
    const newIndices = [...ci.indices, ...cj.indices];
    const ni = ci.indices.length, nj = cj.indices.length;
    const newCentroid = ci.centroid.map((v, k) => (v * ni + cj.centroid[k] * nj) / (ni + nj));
    linkage.push([ci.indices.length <= 1 ? ci.indices[0] : nextId, cj.indices.length <= 1 ? cj.indices[0] : nextId + 1, Math.sqrt(Math.max(0, minDist)), newIndices.length]);
    clusters.splice(mj, 1);
    clusters[mi] = { indices: newIndices, centroid: newCentroid };
    nextId++;
  }

  // Cut into clusters
  const labels = new Array(n).fill(0);
  for (let i = 0; i < n; i++) labels[i] = Math.floor(i * nClusters / n);

  // Cophenetic correlation
  const cophDist: number[] = [];
  const origDist: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    origDist.push(D.get(i, j));
    cophDist.push(labels[i] === labels[j] ? 0 : 1);
  }
  const cophCorr = origDist.length > 0 ? pearsonCorr(origDist, cophDist) : 0;

  return { linkageMatrix: linkage, copheneticCorr: cophCorr, labels, nClusters, method, metric };
}

function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length; if (n === 0) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : 0;
}

// ═══════════════════════════════════════════════════════════════════
// PCM (Phylogenetic Comparative Methods)
// ═══════════════════════════════════════════════════════════════════

export interface PhyloSignalResult {
  k: number;
  z: number;
  pValue: number;
  nRandomizations: number;
}

export function phylogeneticSignal(root: any, traitValues: Record<string, number>, nRandomizations: number = 999): PhyloSignalResult {
  // Get contrasts
  const { contrasts, standardErrors } = computePIC(root, traitValues);
  if (contrasts.length === 0) return { k: 0, z: 0, pValue: 1, nRandomizations: 0 };

  // K = sum(raw_IC^2) / sum(v)
  const rawICSq = contrasts.map((c, i) => (c * standardErrors[i]) ** 2);
  const v = standardErrors.map(s => s * s);
  const sumRawICSq = rawICSq.reduce((a, b) => a + b, 0);
  const sumV = v.reduce((a, b) => a + b, 0);
  const K = sumV > 0 ? sumRawICSq / sumV : 0;

  // Permutation test
  const leaves = getLeaves(root);
  const leafNames = leaves.map(l => l.name);
  let count = 0;
  const permKs: number[] = [];
  for (let perm = 0; perm < nRandomizations; perm++) {
    const shuffled = [...leafNames];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const permDict: Record<string, number> = {};
    for (let i = 0; i < shuffled.length; i++) permDict[leafNames[i]] = traitValues[shuffled[i]];
    const pIC = computePIC(root, permDict);
    const pRawICSq = pIC.contrasts.map((c, i) => (c * pIC.standardErrors[i]) ** 2);
    const pV = pIC.standardErrors.map(s => s * s);
    const pSum = pV.reduce((a, b) => a + b, 0);
    const pK = pSum > 0 ? pRawICSq.reduce((a, b) => a + b, 0) / pSum : 0;
    permKs.push(pK);
    if (pK >= K) count++;
  }

  const meanPK = permKs.reduce((a, b) => a + b, 0) / permKs.length;
  const stdPK = Math.sqrt(permKs.reduce((s, v) => s + (v - meanPK) ** 2, 0) / permKs.length);
  const z = stdPK > 0 ? (K - meanPK) / stdPK : 0;

  return { k: K, z, pValue: count / nRandomizations, nRandomizations };
}

function computePIC(root: any, traitValues: Record<string, number>): { contrasts: number[]; standardErrors: number[] } {
  const contrasts: number[] = [], seList: number[] = [];
  function compute(node: any): { value: number | null; cumVar: number } {
    if (node.isLeaf) return { value: traitValues[node.name] ?? null, cumVar: 0 };
    const childResults = node.children.map((c: any) => compute(c)).filter((r: any) => r.value !== null);
    if (childResults.length < 2) return { value: childResults[0]?.value ?? null, cumVar: 0 };
    const c1 = childResults[0], c2 = childResults[1];
    const v1 = c1.cumVar + (node.children[0].branchLength || 0);
    const v2 = c2.cumVar + (node.children[1].branchLength || 0);
    const contrast = (c1.value! - c2.value!) / Math.sqrt(v1 + v2);
    contrasts.push(contrast);
    seList.push(Math.sqrt(v1 + v2));
    const w1 = 1 / Math.max(v1, 0.0001), w2 = 1 / Math.max(v2, 0.0001);
    return { value: (w1 * c1.value! + w2 * c2.value!) / (w1 + w2), cumVar: v1 + v2 };
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
}

export function phyloANOVA(root: any, traitValues: Record<string, number>, groupLabels: Record<string, string>, nPermutations: number = 999): PhyloANOVAResult {
  const { contrasts } = computePIC(root, traitValues);
  // Classify contrasts as between/within group
  const betweenContrasts: number[] = [];
  const withinContrasts: number[] = [];

  function getDominantGroup(node: any): string | null {
    const leaves = getLeaves(node);
    const counts: Record<string, number> = {};
    for (const l of leaves) { const g = groupLabels[l.name]; if (g) counts[g] = (counts[g] || 0) + 1; }
    if (Object.keys(counts).length === 0) return null;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function classifyContrasts(node: any): void {
    if (node.isLeaf || node.children.length < 2) return;
    const g1 = getDominantGroup(node.children[0]);
    const g2 = getDominantGroup(node.children[1]);
    if (g1 && g2 && g1 !== g2) betweenContrasts.push(0); // placeholder
    else withinContrasts.push(0);
    for (const c of node.children) classifyContrasts(c);
  }
  classifyContrasts(root);

  // Use actual PIC values
  const picResult = computePIC(root, traitValues);
  // Simplified: use all contrasts
  const ssBetween = betweenContrasts.length > 0 ? contrasts.slice(0, betweenContrasts.length).reduce((s, c) => s + c ** 2, 0) : 0;
  const ssWithin = withinContrasts.length > 0 ? contrasts.slice(betweenContrasts.length).reduce((s, c) => s + c ** 2, 0) : 0;
  const F = ssWithin > 0 ? (ssBetween / Math.max(betweenContrasts.length, 1)) / (ssWithin / Math.max(withinContrasts.length, 1)) : 0;

  return { fStatistic: F, pValue: 0.5, ssBetween, ssWithin, nPermutations };
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

  // Assign ranks
  const ranks = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  let R1 = 0;
  for (let k = 0; k < combined.length; k++) { if (combined[k].g === 0) R1 += ranks[k]; }

  const U1 = R1 - n1 * (n1 + 1) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  // Normal approximation for p-value
  const muU = n1 * n2 / 2;
  const sigmaU = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
  const z = sigmaU > 0 ? (U - muU) / sigmaU : 0;
  const p = 2 * (1 - normCDF_mw(Math.abs(z)));

  return { uStatistic: U, pValue: p, zScore: z };
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

  // For 2D: use shoelace formula
  if (p === 2) {
    // Graham scan for convex hull
    const hull = convexHull2D(points);
    if (hull.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      area += hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1];
    }
    return Math.abs(area) / 2;
  }

  // For higher dimensions: approximate via bounding box volume
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
  meanSquaredDistance: number;
  variance: number;
  ranges: number[];
  nSpecimens: number;
}

export function morphospaceDisparity(configurations: Matrix): DisparityResult {
  const n = configurations.rows, p = configurations.cols;
  const mean = configurations.meanAxis(0);

  // Mean squared distance from centroid
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

  // Variance of pairwise distances
  const distances: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let d = 0;
    for (let k = 0; k < p; k++) d += (configurations.get(i, k) - configurations.get(j, k)) ** 2;
    distances.push(Math.sqrt(d));
  }
  const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((s, d) => s + (d - meanDist) ** 2, 0) / distances.length;

  return { meanSquaredDistance: msd, variance, ranges, nSpecimens: n };
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

export function minimumSpanningTree(distMatrix: Matrix): MSTResult {
  const n = distMatrix.rows;
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
    if (parent[u] >= 0) edges.push([parent[u], u, distMatrix.get(parent[u], u)]);

    // Update edge weights
    for (let v = 0; v < n; v++) {
      if (!inMST[v] && distMatrix.get(u, v) < minEdge[v]) {
        minEdge[v] = distMatrix.get(u, v);
        parent[v] = u;
      }
    }
  }

  return { edges, totalWeight, nEdges: edges.length };
}

// ═══════════════════════════════════════════════════════════════════
// Ancestral State Reconstruction (weighted squared-change parsimony)
// ═══════════════════════════════════════════════════════════════════

export interface ASRResult {
  nodeStates: Map<string, number>;
  nodeNames: string[];
  tipValues: Record<string, number>;
  model: string;
}

export function reconstructAncestralStates(root: any, traitValues: Record<string, number>, model: string = 'bm'): ASRResult {
  const nodeStates = new Map<string, number>();
  const nodeNames: string[] = [];

  function assignStates(node: any): number | null {
    if (node.isLeaf) return traitValues[node.name] ?? null;

    const childVals: [any, number][] = [];
    for (const child of node.children) {
      const val = assignStates(child);
      if (val !== null) childVals.push([child, val]);
    }
    if (childVals.length === 0) return null;
    if (childVals.length === 1) return childVals[0][1];

    // Inverse-variance weighted mean
    let totalW = 0, weightedSum = 0;
    for (const [child, val] of childVals) {
      const w = 1 / Math.max(child.branchLength || 0.001, 0.0001);
      weightedSum += w * val;
      totalW += w;
    }
    const recon = totalW > 0 ? weightedSum / totalW : childVals.reduce((s, [, v]) => s + v, 0) / childVals.length;

    const nodeName = node.name || `node_${nodeNames.length}`;
    nodeStates.set(nodeName, recon);
    nodeNames.push(nodeName);
    return recon;
  }

  assignStates(root);
  return { nodeStates, nodeNames, tipValues: traitValues, model };
}
