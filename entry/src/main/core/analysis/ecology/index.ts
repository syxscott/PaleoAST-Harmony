/**
 * Ecology analysis modules — replaces ecology/*.py
 */

/**
 * Diversity indices for a single sample.
 */
export interface DiversityResult {
  sampleName: string;
  richness: number;
  shannon: number;
  simpson: number;
  pielou: number;
  margalef: number;
  evenness: number;
  totalIndividuals: number;
  abundances: Record<string, number>;
}

export function computeDiversity(abundances: number[], sampleName: string = 'Sample'): DiversityResult {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  const N = counts.reduce((a, b) => a + b, 0);
  const S = counts.length;
  if (N === 0 || S === 0) {
    return { sampleName, richness: 0, shannon: 0, simpson: 0, pielou: 0, margalef: 0, evenness: 0, totalIndividuals: 0, abundances: {} };
  }

  // Shannon H' = -sum(p_i * ln(p_i))
  let H = 0;
  for (const n of counts) { const p = n / N; if (p > 0) H -= p * Math.log(p); }

  // Simpson 1-D = 1 - sum(p_i^2)
  let D = 0;
  for (const n of counts) { const p = n / N; D += p * p; }
  const simpson = 1 - D;

  // Pielou J = H / ln(S)
  const pielou = S > 1 ? H / Math.log(S) : 0;

  // Margalef = (S - 1) / ln(N)
  const margalef = N > 1 ? (S - 1) / Math.log(N) : 0;

  const abundancesMap: Record<string, number> = {};
  for (let i = 0; i < counts.length; i++) abundancesMap[`Species_${i + 1}`] = counts[i];

  return { sampleName, richness: S, shannon: H, simpson, pielou, margalef, evenness: pielou, totalIndividuals: N, abundances: abundancesMap };
}

/**
 * Rarefaction curve — replaces ecology/rarefaction.py.
 */
export interface RarefactionResult {
  sampleName: string;
  sampleSizes: number[];
  expectedTaxa: number[];
}

export function computeRarefaction(abundances: number[], maxN?: number, nPoints: number = 50): RarefactionResult {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  const N = counts.reduce((a, b) => a + b, 0);
  const S = counts.length;
  if (N === 0) return { sampleName: '', sampleSizes: [], expectedTaxa: [] };

  const maxSample = maxN ?? Math.floor(N / 2);
  const step = Math.max(1, Math.floor(maxSample / nPoints));
  const sizes: number[] = [];
  for (let n = 1; n <= maxSample && n < N; n += step) sizes.push(n);

  const expected: number[] = [];
  for (const n of sizes) {
    let E = 0;
    for (const ni of counts) {
      if (N - ni < n) { E += 1; continue; }
      // P(species excluded) = C(N-ni, n) / C(N, n) using log
      let logP = 0;
      for (let k = 0; k < n; k++) logP += Math.log(N - ni - k) - Math.log(N - k);
      E += 1 - Math.exp(logP);
    }
    expected.push(E);
  }

  return { sampleName: '', sampleSizes: sizes, expectedTaxa: expected };
}

/**
 * Shannon entropy: H = -sum(p_i * ln(p_i))
 */
export function shannon(abundances: number[]): number {
  const total = abundances.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let H = 0;
  for (const a of abundances) { if (a > 0) { const p = a / total; H -= p * Math.log(p); } }
  return H;
}

/**
 * Simpson index: 1 - sum(p_i^2)
 */
export function simpson(abundances: number[]): number {
  const total = abundances.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let D = 0;
  for (const a of abundances) { const p = a / total; D += p * p; }
  return 1 - D;
}

// ═══════════════════════════════════════════════════════════════════
// Beta Diversity Decomposition (Baselga 2010/2012)
// ═══════════════════════════════════════════════════════════════════

export interface BetaDiversityResult {
  totalBeta: number[][];
  turnover: number[][];
  nestedness: number[][];
  decompositionType: string;
  nSamples: number;
}

export function betaDiversityDecomposition(abundanceMatrix: number[][], metric: 'jaccard' | 'sorensen' = 'jaccard'): BetaDiversityResult {
  const n = abundanceMatrix.length;
  const presence = abundanceMatrix.map(row => row.map(v => v > 0));
  const totalBeta: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const turnover: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const nestedness: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let a = 0, b = 0, c = 0;
      for (let k = 0; k < presence[i].length; k++) {
        if (presence[i][k] && presence[j][k]) a++;
        else if (presence[i][k] && !presence[j][k]) b++;
        else if (!presence[i][k] && presence[j][k]) c++;
      }
      const total = a + b + c;
      if (total === 0) continue;

      let totalVal: number, turnVal: number, nestVal: number;
      if (metric === 'jaccard') {
        totalVal = (b + c) / total;
        const minBC = Math.min(b, c);
        const denomTurn = a + 2 * minBC;
        turnVal = denomTurn > 0 ? (2 * minBC) / denomTurn : 0;
        nestVal = denomTurn > 0 ? (a * Math.abs(b - c)) / (total * denomTurn) : 0;
      } else {
        const denom = 2 * a + b + c;
        totalVal = denom > 0 ? (b + c) / denom : 0;
        const minBC = Math.min(b, c);
        const denomTurn = 2 * a + minBC;
        turnVal = denomTurn > 0 ? minBC / denomTurn : 0;
        nestVal = (denom > 0 && denomTurn > 0) ? (a * Math.abs(b - c)) / (denom * denomTurn) : 0;
      }

      totalBeta[i][j] = totalBeta[j][i] = totalVal;
      turnover[i][j] = turnover[j][i] = turnVal;
      nestedness[i][j] = nestedness[j][i] = nestVal;
    }
  }

  return { totalBeta, turnover, nestedness, decompositionType: metric, nSamples: n };
}

// ═══════════════════════════════════════════════════════════════════
// Null Model Analysis
// ═══════════════════════════════════════════════════════════════════

export interface NullModelResult {
  observedScore: number;
  simulatedScores: number[];
  meanSimulated: number;
  stdSimulated: number;
  ses: number;
  pValue: number;
  nPermutations: number;
  metric: string;
}

export function nullModel(presenceMatrix: number[][], metric: 'c_score' | 'checkerboard' = 'c_score', nPermutations: number = 999): NullModelResult {
  const nSpecies = presenceMatrix.length, nSites = presenceMatrix[0].length;
  const presence = presenceMatrix.map(row => row.map(v => v > 0 ? 1 : 0));
  const rowSums = presence.map(row => row.reduce((a, b) => a + b, 0));

  const computeCScore = (mat: number[][]): number => {
    const rs = mat.map(row => row.reduce((a, b) => a + b, 0));
    const scores: number[] = [];
    for (let i = 0; i < mat.length; i++) for (let j = i + 1; j < mat.length; j++) {
      let sij = 0;
      for (let k = 0; k < mat[i].length; k++) if (mat[i][k] === 1 && mat[j][k] === 1) sij++;
      scores.push((rs[i] - sij) * (rs[j] - sij));
    }
    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  };

  const computeCheckerboard = (mat: number[][]): number => {
    let count = 0;
    for (let i = 0; i < mat.length; i++) for (let j = i + 1; j < mat.length; j++) {
      for (let k = 0; k < mat[i].length; k++) for (let l = k + 1; l < mat[i].length; l++) {
        if ((mat[i][k] === 1 && mat[i][l] === 0 && mat[j][k] === 0 && mat[j][l] === 1) ||
            (mat[i][k] === 0 && mat[i][l] === 1 && mat[j][k] === 1 && mat[j][l] === 0)) count++;
      }
    }
    return count;
  };

  const computeScore = metric === 'checkerboard' ? computeCheckerboard : computeCScore;
  const observed = computeScore(presence);

  const simulated: number[] = [];
  for (let perm = 0; perm < nPermutations; perm++) {
    // Swap algorithm
    const mat = presence.map(row => [...row]);
    const nSwaps = Math.floor(nSpecies * nSites * 0.1);
    for (let s = 0; s < nSwaps; s++) {
      const r1 = Math.floor(Math.random() * nSpecies), r2 = Math.floor(Math.random() * nSpecies);
      const c1 = Math.floor(Math.random() * nSites), c2 = Math.floor(Math.random() * nSites);
      if (r1 !== r2 && c1 !== c2) {
        const tmp = mat[r1][c1]; mat[r1][c1] = mat[r2][c2]; mat[r2][c2] = tmp;
      }
    }
    simulated.push(computeScore(mat));
  }

  const meanSim = simulated.reduce((a, b) => a + b, 0) / simulated.length;
  const stdSim = Math.sqrt(simulated.reduce((s, v) => s + (v - meanSim) ** 2, 0) / simulated.length);
  const ses = stdSim > 0 ? (observed - meanSim) / stdSim : 0;
  const pValue = simulated.filter(s => s >= observed).length / nPermutations;

  return { observedScore: observed, simulatedScores: simulated, meanSimulated: meanSim, stdSimulated: stdSim, ses, pValue, nPermutations, metric };
}

// ═══════════════════════════════════════════════════════════════════
// DTW (Dynamic Time Warping)
// ═══════════════════════════════════════════════════════════════════

export interface DTWResult {
  distance: number;
  path: [number, number][];
}

export function dtw(seq1: number[], seq2: number[], window?: number): DTWResult {
  const n1 = seq1.length, n2 = seq2.length;
  const D = Array.from({ length: n1 }, () => new Array(n2).fill(Infinity));
  D[0][0] = Math.abs(seq1[0] - seq2[0]);

  for (let i = 1; i < n1; i++) D[i][0] = D[i - 1][0] + Math.abs(seq1[i] - seq2[0]);
  for (let j = 1; j < n2; j++) D[0][j] = D[0][j - 1] + Math.abs(seq1[0] - seq2[j]);

  for (let i = 1; i < n1; i++) for (let j = 1; j < n2; j++) {
    if (window !== undefined && Math.abs(i - j) > window) continue;
    D[i][j] = Math.abs(seq1[i] - seq2[j]) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
  }

  // Backtrack
  const path: [number, number][] = [];
  let i = n1 - 1, j = n2 - 1;
  path.push([i, j]);
  while (i > 0 || j > 0) {
    if (i === 0) j--;
    else if (j === 0) i--;
    else {
      const minVal = Math.min(D[i - 1][j - 1], D[i - 1][j], D[i][j - 1]);
      if (minVal === D[i - 1][j - 1]) { i--; j--; }
      else if (minVal === D[i - 1][j]) i--;
      else j--;
    }
    path.push([i, j]);
  }
  path.reverse();

  return { distance: D[n1 - 1][n2 - 1], path };
}

// ═══════════════════════════════════════════════════════════════════
// Abundance Models
// ═══════════════════════════════════════════════════════════════════

export interface AbundanceModelFit {
  name: string;
  params: Record<string, number>;
  rSquared: number;
  aic: number;
}

export function fitAbundanceModels(abundances: number[]): AbundanceModelFit[] {
  const sorted = [...abundances].filter(v => v > 0).sort((a, b) => b - a);
  const S = sorted.length;
  const N = sorted.reduce((a, b) => a + b, 0);
  const results: AbundanceModelFit[] = [];

  // Log-normal: fit to log(rank) vs log(abundance)
  const logRanks = sorted.map((_, i) => Math.log(i + 1));
  const logAbund = sorted.map(v => Math.log(v));
  const lrResult = linearRegression(logRanks, logAbund);
  results.push({ name: 'Log-Normal', params: { slope: lrResult.slope, intercept: lrResult.intercept }, rSquared: lrResult.r2, aic: S * Math.log(lrResult.mse || 1) + 4 });

  // Geometric series: p_i = p_1 * (1-k)^(i-1)
  const k = 1 - sorted[sorted.length - 1] / sorted[0];
  const expected = sorted.map((_, i) => sorted[0] * Math.pow(1 - Math.max(0, Math.min(1, k)), i));
  const ssRes = sorted.reduce((s, v, i) => s + (v - expected[i]) ** 2, 0);
  const ssTot = sorted.reduce((s, v) => s + (v - N / S) ** 2, 0);
  results.push({ name: 'Geometric', params: { k: Math.max(0, Math.min(1, k)) }, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0, aic: S * Math.log(ssRes / S + 1e-10) + 4 });

  // Broken stick: E[n_i] = (N/S) * sum(1/j, j=i..S)
  const brokenStick = sorted.map((_, i) => {
    let s = 0; for (let j = i + 1; j <= S; j++) s += 1 / j; return (N / S) * s;
  });
  const ssResBS = sorted.reduce((s, v, i) => s + (v - brokenStick[i]) ** 2, 0);
  results.push({ name: 'Broken Stick', params: {}, rSquared: ssTot > 0 ? 1 - ssResBS / ssTot : 0, aic: S * Math.log(ssResBS / S + 1e-10) + 2 });

  return results;
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number; mse: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (y[i] - (slope * x[i] + intercept)) ** 2; ssTot += (y[i] - my) ** 2; }
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, mse: ssRes / n };
}

// ═══════════════════════════════════════════════════════════════════
// SHE Analysis
// ═══════════════════════════════════════════════════════════════════

export interface SHEResult {
  logS: number[];
  logH: number[];
  logE: number[];
  sampleNames: string[];
}

export function sheAnalysis(abundanceMatrix: number[][], sampleNames?: string[]): SHEResult {
  const n = abundanceMatrix.length;
  const names = sampleNames ?? Array.from({ length: n }, (_, i) => `Sample_${i + 1}`);
  const logS: number[] = [], logH: number[] = [], logE: number[] = [];

  // Sort samples by total abundance (ascending)
  const totals = abundanceMatrix.map((row, i) => ({ total: row.reduce((a, b) => a + b, 0), idx: i }));
  totals.sort((a, b) => a.total - b.total);

  for (let i = 0; i < n; i++) {
    const row = abundanceMatrix[totals[i].idx];
    const counts = row.filter(v => v > 0);
    const S = counts.length;
    const N = counts.reduce((a, b) => a + b, 0);
    let H = 0;
    for (const c of counts) { const p = c / N; if (p > 0) H -= p * Math.log(p); }
    const E = S > 1 ? H / Math.log(S) : 0;
    logS.push(Math.log(S + 1));
    logH.push(Math.log(H + 0.001));
    logE.push(Math.log(E + 0.001));
  }

  return { logS, logH, logE, sampleNames: names.map(i => names[totals[i]?.idx ?? 0]) };
}

// ═══════════════════════════════════════════════════════════════════
// Paleo-environmental Reconstruction
// ═══════════════════════════════════════════════════════════════════

export interface PaleoEnvResult {
  axis1Scores: number[];
  heights: number[];
  explainedInertia: number;
  pearsonCorr: number;
  wasFlipped: boolean;
}

export function paleoEnvironment(abundanceMatrix: number[][], heights: number[]): PaleoEnvResult {
  const n = abundanceMatrix.length;
  // Correspondence Analysis on abundance matrix
  const rowTotals = abundanceMatrix.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals: number[] = new Array(abundanceMatrix[0].length).fill(0);
  for (const row of abundanceMatrix) for (let j = 0; j < row.length; j++) colTotals[j] += row[j];
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  // Chi-square standardized matrix
  const expected = abundanceMatrix.map((row, i) => row.map((v, j) => rowTotals[i] * colTotals[j] / grandTotal));
  const Ystd = abundanceMatrix.map((row, i) => row.map((v, j) => expected[i][j] > 0 ? (v - expected[i][j]) / Math.sqrt(expected[i][j]) : 0));

  // SVD of Ystd
  const Ymat = Matrix.from2D(Ystd);
  const { eigenvalues, eigenvectors } = eigh_from_matrix(Ymat.transpose().matmul(Ymat));
  const axis1 = Ymat.matmul(eigenvectors.sliceCols(0, 1)).col(0);

  // Correlation with heights
  const pearson = pearsonCorr(heights, axis1);
  let wasFlipped = false;
  const scores = [...axis1];
  if (pearson < 0) { for (let i = 0; i < scores.length; i++) scores[i] = -scores[i]; wasFlipped = true; }

  const totalInertia = eigenvalues.reduce((a, b) => a + Math.max(0, b), 0);
  const explained = totalInertia > 0 ? Math.max(0, eigenvalues[0]) / totalInertia : 0;

  return { axis1Scores: scores, heights: [...heights], explainedInertia: explained, pearsonCorr: Math.abs(pearson), wasFlipped };
}

function eigh_from_matrix(M: Matrix): { eigenvalues: number[]; eigenvectors: Matrix } {
  // Simple power iteration for top eigenvector
  const n = M.rows;
  let v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.random();
  let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  for (let i = 0; i < n; i++) v[i] /= norm;

  for (let iter = 0; iter < 100; iter++) {
    const vNew = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += M.get(i, j) * v[j]; vNew[i] = s; }
    norm = Math.sqrt(vNew.reduce((s, x) => s + x * x, 0));
    if (norm < 1e-15) break;
    for (let i = 0; i < n; i++) vNew[i] /= norm;
    v = vNew;
  }

  let eigenvalue = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += M.get(i, j) * v[j]; eigenvalue += v[i] * s; }

  const eigenvalues = [eigenvalue];
  const eigenvectors = Matrix.from1D(Array.from(v), n, 1);
  return { eigenvalues, eigenvectors };
}

// ═══════════════════════════════════════════════════════════════════
// Log-series distribution fit (Fisher 1943)
// ═══════════════════════════════════════════════════════════════════

export interface LogSeriesResult {
  alpha: number;
  x: number;
  expected: number[];
  observed: number[];
  rSquared: number;
}

export function fitLogSeries(abundances: number[]): LogSeriesResult {
  const sorted = [...abundances].filter(v => v > 0).sort((a, b) => b - a);
  const S = sorted.length;
  const N = sorted.reduce((a, b) => a + b, 0);

  // Frequency counts: f(1), f(2), f(3), ...
  const maxAbund = Math.max(...sorted);
  const freq: number[] = new Array(maxAbund).fill(0);
  for (const a of sorted) freq[a - 1]++;

  // Fisher's alpha via Newton iteration: S = -alpha * ln(1 - x), N = alpha * x / (1 - x)
  let alpha = S / 5; // initial guess
  let x = 0.99;
  for (let iter = 0; iter < 100; iter++) {
    const S_pred = -alpha * Math.log(1 - x);
    const N_pred = alpha * x / (1 - x);
    const dS = -Math.log(1 - x);
    const dN = alpha / (1 - x) ** 2;
    const err_S = S - S_pred, err_N = N - N_pred;
    const delta_alpha = (err_S * dN - err_N * dS) / (dS * dN - dN * dS || 1);
    alpha += delta_alpha * 0.1;
    if (alpha < 0.1) alpha = 0.1;
    x = N / (alpha + N); // update x from N = alpha*x/(1-x)
    if (Math.abs(delta_alpha) < 1e-8) break;
  }

  // Expected frequencies
  const expected: number[] = [];
  for (let i = 1; i <= maxAbund; i++) expected.push(alpha * Math.pow(x, i) / i);

  // R-squared
  let ssRes = 0, ssTot = 0;
  const meanFreq = freq.reduce((a, b) => a + b, 0) / freq.length;
  for (let i = 0; i < freq.length; i++) {
    ssRes += (freq[i] - expected[i]) ** 2;
    ssTot += (freq[i] - meanFreq) ** 2;
  }

  return { alpha, x, expected, observed: freq, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

// ═══════════════════════════════════════════════════════════════════
// LB_Keogh lower bound for DTW
// ═══════════════════════════════════════════════════════════════════

export function lbKeogh(query: number[], reference: number[], window: number = 5): number {
  const nR = reference.length;
  const U: number[] = new Array(nR).fill(0);
  const L: number[] = new Array(nR).fill(0);

  for (let j = 0; j < nR; j++) {
    const lo = Math.max(0, j - window);
    const hi = Math.min(nR - 1, j + window);
    let maxV = -Infinity, minV = Infinity;
    for (let k = lo; k <= hi; k++) { maxV = Math.max(maxV, reference[k]); minV = Math.min(minV, reference[k]); }
    U[j] = maxV; L[j] = minV;
  }

  let lb = 0;
  for (let i = 0; i < query.length; i++) {
    const j = Math.min(i, nR - 1);
    if (query[i] > U[j]) lb += (query[i] - U[j]) ** 2;
    else if (query[i] < L[j]) lb += (L[j] - query[i]) ** 2;
  }
  return Math.sqrt(lb);
}


// Sample-based rarefaction (Scheiner 2003)
export interface SampleBasedRarefactionResult {
  sampleSizes: number[];
  expectedRichness: number[];
  observedRichness: number;
}

export function sampleBasedRarefaction(
  abundanceMatrix: number[][],
  nPoints: number = 50,
): SampleBasedRarefactionResult {
  const nSamples = abundanceMatrix.length;
  const allSpecies = new Set<number>();
  for (const row of abundanceMatrix)
    for (let j = 0; j < row.length; j++)
      if (row[j] > 0) allSpecies.add(j);

  const totalSpecies = allSpecies.size;
  const sampleSizes: number[] = [];
  const expected: number[] = [];

  for (let k = 1; k <= nSamples; k += Math.max(1, Math.floor(nSamples / nPoints))) {
    sampleSizes.push(k);
    // Expected richness when drawing k samples
    let E = 0;
    for (const sp of allSpecies) {
      // Probability species sp is present in at least one of k random samples
      let absent = 1;
      for (let s = 0; s < k; s++) {
        const hasSp = abundanceMatrix[s % nSamples][sp] > 0;
        if (hasSp) { absent = 0; break; }
      }
      if (absent === 0) E += 1;
    }
    expected.push(E);
  }
  return { sampleSizes, expectedRichness: expected, observedRichness: totalSpecies };
}
