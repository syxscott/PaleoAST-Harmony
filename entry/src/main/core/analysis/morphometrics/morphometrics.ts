import { Matrix } from '../../math/Matrix';
import { svd } from '../../math/linalg';

/**
 * GPA (Generalized Procrustes Analysis) — replaces morphometrics/gpa.py.
 */
export interface GPAResult {
  alignedConfigurations: Matrix;
  meanShape: Matrix;
  centroidSizes: number[];
  procrustesDistances: number[];
  nIterations: number;
}

export function gpa(configurations: Matrix, maxIter: number = 100, tol: number = 1e-8): GPAResult {
  // configurations: (n_specimens, n_landmarks * n_dims)
  const nSpec = configurations.rows;
  const nCols = configurations.cols;

  // Center and scale each specimen
  const centered: Matrix[] = [];
  const cs: number[] = [];
  for (let i = 0; i < nSpec; i++) {
    const row = configurations.row(i);
    const nLM = nCols / 2;
    let cx = 0, cy = 0;
    for (let j = 0; j < nLM; j++) { cx += row[j]; cy += row[nLM + j]; }
    cx /= nLM; cy /= nLM;
    const centeredRow: number[] = [];
    let size = 0;
    for (let j = 0; j < nLM; j++) { centeredRow.push(row[j] - cx); size += (row[j] - cx) ** 2; }
    for (let j = 0; j < nLM; j++) { centeredRow.push(row[nLM + j] - cy); size += (row[nLM + j] - cy) ** 2; }
    size = Math.sqrt(size);
    cs.push(size);
    const scaled = centeredRow.map(v => v / (size || 1));
    centered.push(Matrix.from1D(scaled, 1, nCols));
  }

  // Iterative alignment
  let meanShape = centered[0].clone();
  const procDists: number[] = new Array(nSpec).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Align all to current mean
    const aligned: Matrix[] = [];
    for (let i = 0; i < nSpec; i++) {
      const alignedSpec = procrustesAlign(centered[i], meanShape);
      aligned.push(alignedSpec);
    }

    // Compute new mean
    const newMeanData = new Float64Array(nCols);
    for (const spec of aligned) for (let j = 0; j < nCols; j++) newMeanData[j] += spec.get(0, j);
    for (let j = 0; j < nCols; j++) newMeanData[j] /= nSpec;
    const newMean = new Matrix(newMeanData, 1, nCols);

    // Scale mean to unit centroid size
    let meanSize = 0;
    for (let j = 0; j < nCols; j++) meanSize += newMeanData[j] ** 2;
    meanSize = Math.sqrt(meanSize);
    const scaledMean = newMean.div(meanSize || 1);

    // Check convergence
    let change = 0;
    for (let j = 0; j < nCols; j++) change += (scaledMean.get(0, j) - meanShape.get(0, j)) ** 2;
    change = Math.sqrt(change);

    meanShape = scaledMean;
    if (change < tol) break;
  }

  // Final alignment and Procrustes distances
  const finalAligned: Matrix[] = [];
  for (let i = 0; i < nSpec; i++) {
    const aligned = procrustesAlign(centered[i], meanShape);
    finalAligned.push(aligned);
    let dist = 0;
    for (let j = 0; j < nCols; j++) dist += (aligned.get(0, j) - meanShape.get(0, j)) ** 2;
    procDists[i] = Math.sqrt(dist);
  }

  // Stack aligned configurations
  const alignedData = new Float64Array(nSpec * nCols);
  for (let i = 0; i < nSpec; i++) for (let j = 0; j < nCols; j++) alignedData[i * nCols + j] = finalAligned[i].get(0, j);

  return {
    alignedConfigurations: new Matrix(alignedData, nSpec, nCols),
    meanShape, centroidSizes: cs, procrustesDistances: procDists, nIterations: maxIter,
  };
}

function procrustesAlign(source: Matrix, target: Matrix): Matrix {
  // Optimal rotation via SVD of cross-covariance
  const n = source.cols / 2;
  const srcX = source.row(0).slice(0, n), srcY = source.row(0).slice(n);
  const tgtX = target.row(0).slice(0, n), tgtY = target.row(0).slice(n);

  // Cross-covariance matrix H = src^T * tgt (2x2)
  let h00 = 0, h01 = 0, h10 = 0, h11 = 0;
  for (let i = 0; i < n; i++) {
    h00 += srcX[i] * tgtX[i]; h01 += srcX[i] * tgtY[i];
    h10 += srcY[i] * tgtX[i]; h11 += srcY[i] * tgtY[i];
  }

  // 2x2 SVD for optimal rotation angle
  const angle = Math.atan2(h01 - h10, h00 + h11);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  const rotated: number[] = [];
  for (let i = 0; i < n; i++) rotated.push(cos * srcX[i] - sin * srcY[i]);
  for (let i = 0; i < n; i++) rotated.push(sin * srcX[i] + cos * srcY[i]);

  return Matrix.from1D(rotated, 1, source.cols);
}

/**
 * EFA (Elliptic Fourier Analysis) — replaces morphometrics/efa.py.
 */
export interface EFAResult {
  harmonics: { n: number; a: number; b: number; c: number; d: number }[];
  coefficients: number[][];
  nHarmonics: number;
  nPoints: number;
}

export function efa(contour: number[][], nHarmonics: number = 10): EFAResult {
  // contour: array of [x, y] points (closed)
  const pts = contour;
  if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
    pts.push([pts[0][0], pts[0][1]]);
  }
  const nPts = pts.length;

  // Cumulative chord length
  const t = [0];
  for (let i = 1; i < nPts; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    t.push(t[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const T = t[nPts - 1];
  if (T === 0) return { harmonics: [], coefficients: [], nHarmonics: 0, nPoints: nPts };

  const dx = [], dy = [];
  for (let i = 1; i < nPts; i++) { dx.push(pts[i][0] - pts[i - 1][0]); dy.push(pts[i][1] - pts[i - 1][1]); }

  const harmonics: { n: number; a: number; b: number; c: number; d: number }[] = [];
  const coefficients: number[][] = [];

  for (let n = 1; n <= nHarmonics; n++) {
    const omega = 2 * Math.PI * n / T;
    const factor = T / (2 * Math.PI * Math.PI * n * n);

    let a = 0, b = 0, c = 0, d = 0;
    for (let k = 0; k < nPts - 1; k++) {
      const dt = t[k + 1] - t[k];
      if (dt === 0) continue;
      const slopeX = dx[k] / dt, slopeY = dy[k] / dt;
      const dcos = Math.cos(omega * t[k + 1]) - Math.cos(omega * t[k]);
      const dsin = Math.sin(omega * t[k + 1]) - Math.sin(omega * t[k]);
      a += slopeX * dcos; b += slopeX * dsin;
      c += slopeY * dcos; d += slopeY * dsin;
    }
    a *= factor; b *= factor; c *= factor; d *= factor;
    harmonics.push({ n, a, b, c, d });
    coefficients.push([a, b, c, d]);
  }

  return { harmonics, coefficients, nHarmonics, nPoints: nPts };
}

// ═══════════════════════════════════════════════════════════════════
// Allometry (Size-Shape Relationship)
// ═══════════════════════════════════════════════════════════════════

export interface AllometryResult {
  centroidSizes: number[];
  logCentroidSizes: number[];
  regressionCoefficients: number[];
  regressionIntercept: number[];
  rSquared: number;
  fStatistic: number;
  isometryPValue: number;
  residuals: Matrix;
  predictedShapes: Matrix;
  nSpecimens: number;
  nLandmarks: number;
}

export function allometry(configurations: Matrix): AllometryResult {
  const n = configurations.rows;
  const p = configurations.cols;
  const nLM = p / 2;

  // Compute centroid sizes
  const cs: number[] = [];
  const logCS: number[] = [];
  for (let i = 0; i < n; i++) {
    let size = 0;
    for (let j = 0; j < p; j++) size += configurations.get(i, j) ** 2;
    const s = Math.sqrt(size);
    cs.push(s);
    logCS.push(Math.log(s));
  }

  // Design matrix X = [1, log(CS)]
  const X = Matrix.zeros(n, 2);
  for (let i = 0; i < n; i++) { X.set(i, 0, 1); X.set(i, 1, logCS[i]); }

  // Multivariate regression: Y = X * B + E
  const Y = configurations;
  const XtX = X.transpose().matmul(X);
  const XtXinv = inv(XtX);
  const B = XtXinv.matmul(X.transpose()).matmul(Y); // (2, p)

  const intercept: number[] = B.row(0);
  const coefficients: number[] = B.row(1);

  // Predicted shapes and residuals
  const predicted = X.matmul(B);
  const residuals = Y.sub(predicted);

  // R-squared
  const ssTot = Y.sub(Y.meanAxis(0)).mul(Y.sub(Y.meanAxis(0))).sum();
  const ssRes = residuals.mul(residuals).sum();
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // F-test for isometry (H0: all allometric coefficients = 0)
  const ssModel = ssTot - ssRes;
  const dfModel = 1; // single predictor (log CS)
  const dfRes = n - 2;
  const msModel = dfModel > 0 ? ssModel / dfModel : 0;
  const msRes = dfRes > 0 ? ssRes / dfRes : 0;
  const F = msRes > 0 ? msModel / msRes : 0;
  const pVal = 1 - fCDF_local(F, dfModel, dfRes);

  return {
    centroidSizes: cs, logCentroidSizes: logCS,
    regressionCoefficients: coefficients, regressionIntercept: intercept,
    rSquared: r2, fStatistic: F, isometryPValue: pVal,
    residuals, predictedShapes: predicted,
    nSpecimens: n, nLandmarks: nLM,
  };
}

function fCDF_local(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  const z = d1 * x / (d1 * x + d2);
  return betainc_local(d1 / 2, d2 / 2, z);
}

function betainc_local(a: number, b: number, x: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  let sum = 0, term = 1;
  for (let n = 0; n < 100; n++) {
    if (n > 0) term *= (a + n - 1) * x / (a + b + n - 1);
    sum += term / (a + n);
    if (Math.abs(term / (a + n)) < 1e-12) break;
  }
  const lbeta = lgamma_m(a) + lgamma_m(b) - lgamma_m(a + b);
  return sum * Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta);
}

function lgamma_m(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma_m(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ═══════════════════════════════════════════════════════════════════
// Evolution Rate Analysis
// ═══════════════════════════════════════════════════════════════════

export interface EvolutionRateResult {
  bestModel: string;
  rateEstimate: number;
  trendEstimate: number;
  aicWeights: Record<string, number>;
  modelFits: { name: string; aic: number; params: Record<string, number> }[];
}

export function evolutionRate(traitSeries: number[], timeIntervals: number[]): EvolutionRateResult {
  const n = traitSeries.length;
  if (n < 3) return { bestModel: 'unknown', rateEstimate: 0, trendEstimate: 0, aicWeights: {}, modelFits: [] };

  // Compute increments
  const increments: number[] = [];
  for (let i = 1; i < n; i++) increments.push(traitSeries[i] - traitSeries[i - 1]);

  // Model 1: Random Walk (BM)
  const rwVariance = increments.reduce((s, v) => s + v * v, 0) / increments.length;
  const rwLogLik = -increments.length / 2 * (Math.log(2 * Math.PI * rwVariance) + 1);
  const rwAic = -2 * rwLogLik + 2;

  // Model 2: Directional (trend + random walk)
  const meanInc = increments.reduce((a, b) => a + b, 0) / increments.length;
  const dirVariance = increments.reduce((s, v) => s + (v - meanInc) ** 2, 0) / increments.length;
  const dirLogLik = -increments.length / 2 * (Math.log(2 * Math.PI * dirVariance) + 1);
  const dirAic = -2 * dirLogLik + 4;

  // Model 3: Stasis (trait mean constant)
  const stasisMean = traitSeries.reduce((a, b) => a + b, 0) / n;
  const stasisVariance = traitSeries.reduce((s, v) => s + (v - stasisMean) ** 2, 0) / n;
  const stasisLogLik = -n / 2 * (Math.log(2 * Math.PI * stasisVariance) + 1);
  const stasisAic = -2 * stasisLogLik + 2;

  const models = [
    { name: 'Random Walk', aic: rwAic, params: { variance: rwVariance } },
    { name: 'Directional', aic: dirAic, params: { trend: meanInc, variance: dirVariance } },
    { name: 'Stasis', aic: stasisAic, params: { mean: stasisMean, variance: stasisVariance } },
  ];

  // AIC weights
  const minAic = Math.min(...models.map(m => m.aic));
  const deltas = models.map(m => m.aic - minAic);
  const likelihoods = deltas.map(d => Math.exp(-d / 2));
  const sumLikelihoods = likelihoods.reduce((a, b) => a + b, 0);
  const weights: Record<string, number> = {};
  models.forEach((m, i) => { weights[m.name] = likelihoods[i] / sumLikelihoods; });

  const best = models.reduce((a, b) => weights[a.name] > weights[b.name] ? a : b);

  return {
    bestModel: best.name, rateEstimate: best.params.variance, trendEstimate: best.params.trend ?? 0,
    aicWeights: weights, modelFits: models,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TPS (Thin Plate Spline) Deformation Grid
// ═══════════════════════════════════════════════════════════════════

export interface TPSResult {
  gridPoints: number[][];
  deformedGrid: number[][];
  bendingEnergy: number;
}

export function tpsDeformation(sourceLandmarks: number[][], targetLandmarks: number[][], gridSize: number = 15): TPSResult {
  const n = sourceLandmarks.length;
  const dim = 2;

  // Build TPS weight matrix
  const K = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    let r2 = 0;
    for (let d = 0; d < dim; d++) r2 += (sourceLandmarks[i][d] - sourceLandmarks[j][d]) ** 2;
    K.set(i, j, r2 > 0 ? r2 * Math.log(Math.sqrt(r2)) : 0);
  }

  // Build P matrix (landmark coordinates + 1)
  const P = Matrix.zeros(n, 3);
  for (let i = 0; i < n; i++) { P.set(i, 0, 1); P.set(i, 1, sourceLandmarks[i][0]); P.set(i, 2, sourceLandmarks[i][1]); }

  // Solve for TPS weights
  const L = Matrix.zeros(n + 3, n + 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) L.set(i, j, K.get(i, j));
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { L.set(i, n + j, P.get(i, j)); L.set(n + j, i, P.get(i, j)); }

  // Target coordinates
  const targetX = targetLandmarks.map(l => l[0]);
  const targetY = targetLandmarks.map(l => l[1]);

  // Solve L * w = [targetX; 0; 0; 0]
  const rhs = new Float64Array(n + 3);
  for (let i = 0; i < n; i++) rhs[i] = targetX[i];
  // Use simple Gaussian elimination
  const wx = solveLinearSystem(L, rhs);
  for (let i = 0; i < n; i++) rhs[i] = targetY[i];
  const wy = solveLinearSystem(L, rhs);

  // Generate grid
  const srcX = sourceLandmarks.map(l => l[0]);
  const srcY = sourceLandmarks.map(l => l[1]);
  const minX = Math.min(...srcX) - 1, maxX = Math.max(...srcX) + 1;
  const minY = Math.min(...srcY) - 1, maxY = Math.max(...srcY) + 1;

  const gridPoints: number[][] = [];
  const deformedGrid: number[][] = [];

  for (let gi = 0; gi < gridSize; gi++) for (let gj = 0; gj < gridSize; gj++) {
    const gx = minX + (maxX - minX) * gi / (gridSize - 1);
    const gy = minY + (maxY - minY) * gj / (gridSize - 1);
    gridPoints.push([gx, gy]);

    // Apply TPS
    let dx = wx[n] + wx[n + 1] * gx + wx[n + 2] * gy;
    let dy = wy[n] + wy[n + 1] * gx + wy[n + 2] * gy;
    for (let i = 0; i < n; i++) {
      let r2 = 0;
      for (let d = 0; d < dim; d++) {
        const diff = d === 0 ? gx - sourceLandmarks[i][0] : gy - sourceLandmarks[i][1];
        r2 += diff * diff;
      }
      const U = r2 > 0 ? r2 * Math.log(Math.sqrt(r2)) : 0;
      dx += wx[i] * U;
      dy += wy[i] * U;
    }
    deformedGrid.push([dx, dy]);
  }

  // Bending energy
  let bendingEnergy = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    bendingEnergy += wx[i] * K.get(i, j) * wx[j] + wy[i] * K.get(i, j) * wy[j];
  }

  return { gridPoints, deformedGrid, bendingEnergy };
}

function solveLinearSystem(A: Matrix, b: Float64Array): Float64Array {
  const n = A.rows;
  const aug = Matrix.zeros(n, n + 1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) aug.set(i, j, A.get(i, j));
    aug.set(i, n, b[i]);
  }
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(aug.get(row, col)) > Math.abs(aug.get(maxRow, col))) maxRow = row;
    if (maxRow !== col) for (let j = 0; j <= n; j++) { const t = aug.get(col, j); aug.set(col, j, aug.get(maxRow, j)); aug.set(maxRow, j, t); }
    const pivot = aug.get(col, col);
    if (Math.abs(pivot) < 1e-15) continue;
    for (let j = 0; j <= n; j++) aug.set(col, j, aug.get(col, j) / pivot);
    for (let row = 0; row < n; row++) { if (row === col) continue; const f = aug.get(row, col); for (let j = 0; j <= n; j++) aug.set(row, j, aug.get(row, j) - f * aug.get(col, j)); }
  }
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) result[i] = aug.get(i, n);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Relative Warps Analysis
// ═══════════════════════════════════════════════════════════════════

export interface RelativeWarpsResult {
  scores: Matrix;
  eigenvalues: number[];
  explainedVariance: number[];
  nComponents: number;
}

export function relativeWarps(alignedConfigs: Matrix, nComponents?: number): RelativeWarpsResult {
  // PCA on Procrustes-aligned coordinates
  const n = alignedConfigs.rows, p = alignedConfigs.cols;
  const nc = Math.min(nComponents ?? n - 1, n - 1, p);

  const mean = alignedConfigs.meanAxis(0);
  const centered = alignedConfigs.sub(mean);
  const cov = centered.transpose().matmul(centered).div(n - 1);
  const { eigenvalues, eigenvectors } = eigh_local(cov);

  const eigTop = eigenvalues.slice(0, nc);
  const totalVar = eigenvalues.reduce((a, b) => a + b, 0);
  const explained = eigTop.map(e => totalVar > 0 ? e / totalVar * 100 : 0);

  const scores = centered.matmul(eigenvectors.sliceCols(0, nc));

  return { scores, eigenvalues: eigTop, explainedVariance: explained, nComponents: nc };
}

function eigh_local(A: Matrix): { eigenvalues: number[]; eigenvectors: Matrix } {
  const n = A.rows; let T = A.clone(), Q = eye_local(n);
  for (let iter = 0; iter < 100 * n; iter++) {
    let maxOff = 0, pi = 0, qi = 1;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(T.get(i, j)) > maxOff) { maxOff = Math.abs(T.get(i, j)); pi = i; qi = j; }
    if (maxOff < 1e-14) break;
    let theta: number;
    if (Math.abs(T.get(pi, pi) - T.get(qi, qi)) < 1e-15) theta = Math.PI / 4;
    else theta = 0.5 * Math.atan2(2 * T.get(pi, qi), T.get(pi, pi) - T.get(qi, qi));
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let i = 0; i < n; i++) { const tp = T.get(i, pi), tq = T.get(i, qi); T.set(i, pi, c * tp - s * tq); T.set(i, qi, s * tp + c * tq); }
    for (let j = 0; j < n; j++) { const tp = T.get(pi, j), tq = T.get(qi, j); T.set(pi, j, c * tp - s * tq); T.set(qi, j, s * tp + c * tq); }
    for (let i = 0; i < n; i++) { const qp = Q.get(i, pi), qq = Q.get(i, qi); Q.set(i, pi, c * qp - s * qq); Q.set(i, qi, s * qp + c * qq); }
  }
  const eigenvalues: number[] = [];
  for (let i = 0; i < n; i++) eigenvalues.push(T.get(i, i));
  const order = eigenvalues.map((_, i) => i).sort((a, b) => eigenvalues[b] - eigenvalues[a]);
  const sorted = order.map(i => eigenvalues[i]);
  const evd = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) evd[i * n + j] = Q.get(i, order[j]);
  return { eigenvalues: sorted, eigenvectors: new Matrix(evd, n, n) };
}

function eye_local(n: number): Matrix { const m = Matrix.zeros(n, n); for (let i = 0; i < n; i++) m.data[i * n + i] = 1; return m; }

// ═══════════════════════════════════════════════════════════════════
// Divide Configuration into Blocks (for PLS analysis)
// ═══════════════════════════════════════════════════════════════════

export function divideConfigurationIntoBlocks(
  alignedConfigs: Matrix,
  division: 'anterior_posterior' | 'random' = 'anterior_posterior',
  randomSeed?: number,
): [Matrix, Matrix] {
  const nLandmarks = alignedConfigs.cols / 2;
  const mid = Math.floor(nLandmarks / 2);

  let firstHalf: number[], secondHalf: number[];

  if (division === 'random') {
    const rng = randomSeed !== undefined ? seededRNG(randomSeed) : Math.random;
    const indices = Array.from({ length: nLandmarks }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    firstHalf = indices.slice(0, mid);
    secondHalf = indices.slice(mid);
  } else {
    firstHalf = Array.from({ length: mid }, (_, i) => i);
    secondHalf = Array.from({ length: nLandmarks - mid }, (_, i) => mid + i);
  }

  // Convert landmark indices to flattened column indices
  const blockACols: number[] = [];
  const blockBCols: number[] = [];
  for (const lm of firstHalf) { for (let d = 0; d < 2; d++) blockACols.push(lm * 2 + d); }
  for (const lm of secondHalf) { for (let d = 0; d < 2; d++) blockBCols.push(lm * 2 + d); }
  blockACols.sort((a, b) => a - b);
  blockBCols.sort((a, b) => a - b);

  const blockA = alignedConfigs.sliceCols(blockACols[0], blockACols[blockACols.length - 1] + 1);
  const blockB = alignedConfigs.sliceCols(blockBCols[0], blockBCols[blockBCols.length - 1] + 1);

  return [blockA, blockB];
}

function seededRNG(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}
