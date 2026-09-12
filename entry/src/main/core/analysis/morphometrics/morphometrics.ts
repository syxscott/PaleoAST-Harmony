import { Matrix } from '../../math/Matrix';
import { svd } from '../../math/linalg';
import { rand, createSeededRNG } from '../../math/random';
import { tCDF } from '../../math/special';
import { percentile } from '../../math/stats';
import { tpsKernel2D } from './tpsKernel';
import { MorphometricsError } from '../../utils/Exceptions';

/**
 * GPA (Generalized Procrustes Analysis) — replaces morphometrics/gpa.py.
 *
 * GPA is the fundamental preprocessing step in geometric morphometrics that
 * removes non-shape variation (translation, scaling, rotation) from landmark
 * configurations.
 *
 * Mathematical Foundation (Bookstein 1991; Dryden & Mardia 2016;
 * Rohlf & Slice 1990):
 *
 * Given N landmark configurations X₁..Xₙ ∈ ℝ^(k×m), GPA iteratively
 *   1. translates each configuration to its centroid,
 *   2. rescales it to unit centroid size CS = sqrt(Σ‖xᵢ − x̄‖²),
 *   3. rotates it onto the current consensus via SVD (Kabsch),
 * until the sum of squared Procrustes distances (SSE) converges.
 */
export interface GPAResult {
  /** (n_specimens, n_landmarks*n_dims) aligned coordinates. */
  alignedConfigurations: Matrix;
  /** Consensus (mean) configuration, (1, n_landmarks*n_dims). */
  meanShape: Matrix;
  /** Original centroid size of each specimen. */
  centroidSizes: number[];
  procrustesDistances: number[];
  /** Real number of iterations performed (not just the maximum). */
  nIterations: number;
  /** Per-specimen optimal rotation matrices (n_dims × n_dims). */
  rotations: number[][][];
  /** Cumulative scale factor applied to each specimen. */
  scales: number[];
  /** Original centroid (mean landmark) of each specimen (n × n_dims). */
  centroids: number[][];
  /** Whether the SSE convergence criterion was met. */
  converged: boolean;
  /** Final sum of squared Procrustes distances to the consensus. */
  finalSSE: number;
  nLandmarks: number;
  nDims: number;
  /** Coordinate components used per specimen (n_landmarks*n_dims). */
  nComponents: number;
}

export interface GPAOptions {
  /** Maximum number of iterations (default 100). */
  maxIter?: number;
  /** Convergence tolerance on the SSE change (default 1e-8). */
  tol?: number;
  /** Landmarks per specimen (resolves ambiguous flat widths). */
  nLandmarks?: number;
  /** Dimensions per landmark: 2 or 3 (resolves ambiguous flat widths). */
  nDims?: number;
  /** Alias for ``nDims`` — number of coordinate components per landmark. */
  nComponents?: number;
}

/**
 * Resolve the (nLandmarks, nDims) factorization of a flat row width.
 * Mirrors gpa.py::_prepare_configurations: ambiguous widths (divisible by
 * both 2 and 3, e.g. 6, 12) require explicit nLandmarks or nDims.
 */
function resolveShape(
  flatDim: number,
  nLandmarks?: number,
  nDims?: number,
): { k: number; d: number } {
  const dims = nDims ?? 2;
  if (nLandmarks !== undefined && nDims !== undefined) {
    if (nLandmarks * nDims !== flatDim) {
      throw new MorphometricsError(
        `Flat dimension ${flatDim} does not match nLandmarks (${nLandmarks}) * nDims (${nDims})`,
      );
    }
    return { k: nLandmarks, d: nDims };
  }
  if (nLandmarks !== undefined) {
    if (flatDim % nLandmarks !== 0) {
      throw new MorphometricsError(`Flat dimension ${flatDim} not divisible by nLandmarks=${nLandmarks}`);
    }
    const d = flatDim / nLandmarks;
    if (d !== 2 && d !== 3) {
      throw new MorphometricsError(
        `Cannot determine dimensions: flat_dim=${flatDim} / nLandmarks=${nLandmarks} = ${d}; provide nDims`,
      );
    }
    return { k: nLandmarks, d };
  }
  if (nDims !== undefined) {
    if (flatDim % nDims !== 0) {
      throw new MorphometricsError(`Flat dimension ${flatDim} not divisible by nDims=${nDims}`);
    }
    return { k: flatDim / nDims, d: nDims };
  }
  // Heuristic: default to 2D. Ambiguous widths divisible by both 2 and 3
  // require explicit nLandmarks/nDims (MorphometricsError otherwise).
  if (flatDim % 2 === 0 && flatDim % 3 === 0 && flatDim !== 0) {
    throw new MorphometricsError(
      `Ambiguous flat_dim=${flatDim} (divisible by both 2 and 3): provide nLandmarks or nDims`,
    );
  }
  if (flatDim % 2 !== 0 && flatDim % 3 === 0) return { k: flatDim / 3, d: 3 };
  if (flatDim % 2 !== 0) {
    throw new MorphometricsError(`Flat dimension ${flatDim} not divisible by 2 or 3`);
  }
  return { k: flatDim / 2, d: 2 };
}

/** Centroid size sqrt(Σ‖x − x̄‖²) of a landmark matrix (k × m). */
function _centroidSize(cfg: number[][]): number {
  const k = cfg.length, m = cfg[0].length;
  const mean = new Array<number>(m).fill(0);
  for (const p of cfg) for (let d = 0; d < m; d++) mean[d] += p[d] / k;
  let s = 0;
  for (const p of cfg) for (let d = 0; d < m; d++) { const v = p[d] - mean[d]; s += v * v; }
  return Math.sqrt(s);
}

/**
 * Optimal Kabsch rotation R (m×m) such that ``cfg @ Rᵀ ≈ consensus``.
 * R = V·Uᵀ from the SVD of H = targetᵀ·reference; when det(R) < 0 the last
 * row of Vt is flipped (proper-rotation correction; Bookstein 1989,
 * Dryden & Mardia 2016, Morpho::procSym).
 */
function _findRotation(reference: number[][], target: number[][]): number[][] {
  const k = target.length, m = target[0].length;
  const H = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < k; i++)
    for (let a = 0; a < m; a++)
      for (let b = 0; b < m; b++) H[a][b] += target[i][a] * reference[i][b];
  const { U, Vt } = svd(new Matrix(Float64Array.from(H.flat()), m, m));
  const formR = (vt: Matrix): number[][] => {
    const R = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let a = 0; a < m; a++) s += vt.get(a, i) * U.get(j, a);
        R[i][j] = s;
      }
    return R;
  };
  let R = formR(Vt);
  if (_detSmall(R) < 0) {
    const Vt2 = Vt.clone();
    for (let j = 0; j < m; j++) Vt2.set(m - 1, j, -Vt2.get(m - 1, j));
    R = formR(Vt2);
  }
  return R;
}

function _detSmall(R: number[][]): number {
  const n = R.length;
  if (n === 2) return R[0][0] * R[1][1] - R[0][1] * R[1][0];
  return R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
       - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
       + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
}

/** Rotate a (k × m) configuration: cfg' = cfg @ Rᵀ. */
function _rotateConfig(cfg: number[][], R: number[][]): number[][] {
  const k = cfg.length, m = cfg[0].length;
  const out: number[][] = [];
  for (let i = 0; i < k; i++) {
    const p = new Array<number>(m).fill(0);
    for (let a = 0; a < m; a++)
      for (let b = 0; b < m; b++) p[b] += cfg[i][a] * R[a][b];
    out.push(p);
  }
  return out;
}

/**
 * Generalized Procrustes Analysis.
 *
 * Accepts a flat (n_specimens, n_landmarks*n_dims) matrix in the
 * coordinate-major layout used throughout this module
 * ([x₀..x_k, y₀..y_k(, z₀..z_k)]).  Pass ``nLandmarks``/``nDims``
 * (or ``nComponents``) to resolve ambiguous flat widths or to analyze 3D
 * configurations.
 *
 * @param configurations (n_specimens, n_landmarks*n_dims) flat coordinates
 * @param maxIter        maximum iterations (default 100)
 * @param tol            convergence tolerance (default 1e-8)
 * @param nLandmarks     landmarks per specimen (optional)
 * @param nDims          dimensions per landmark, 2 or 3 (optional)
 * @param nComponents    alias for ``nDims`` (optional)
 */
export function gpa(
  configurations: Matrix,
  maxIter: number = 100,
  tol: number = 1e-8,
  nLandmarks?: number,
  nDims?: number,
  nComponents?: number,
): GPAResult {
  const nSpec = configurations.rows;
  const nCols = configurations.cols;
  const dims = nDims ?? nComponents;
  const { k: nLM, d: dim } = resolveShape(nCols, nLandmarks, dims);
  if (nSpec < 1) throw new MorphometricsError('GPA requires at least one specimen');

  // Decode each flat (coordinate-major) row into a (k × m) landmark matrix
  const decode = (row: number[]): number[][] => {
    const cfg: number[][] = [];
    for (let j = 0; j < nLM; j++) {
      const p: number[] = [];
      for (let d = 0; d < dim; d++) p.push(row[d * nLM + j]);
      cfg.push(p);
    }
    return cfg;
  };
  const encode = (cfg: number[][]): number[] => {
    const row = new Array<number>(nCols).fill(0);
    for (let j = 0; j < nLM; j++)
      for (let d = 0; d < dim; d++) row[d * nLM + j] = cfg[j][d];
    return row;
  };

  const original: number[][][] = [];
  for (let i = 0; i < nSpec; i++) original.push(decode(configurations.row(i)));

  // Original centroid sizes and centroids (Bookstein 1991 definition)
  const originalSizes = original.map(cfg => _centroidSize(cfg));

  const aligned: number[][][] = original.map(cfg => cfg.map(p => p.slice()));
  const scales = new Array<number>(nSpec).fill(1);
  const originalCentroids: number[][] = Array.from({ length: nSpec }, () => new Array<number>(dim).fill(0));

  let consensus: number[][] = aligned[0];
  let rotations: number[][][] = Array.from({ length: nSpec }, () => _eye(dim));
  let prevSSE = Infinity;
  let lastSSE = Infinity;
  let nIterations = 0;
  let converged = false;

  const iterations = Math.max(1, maxIter);
  for (let iter = 0; iter < iterations; iter++) {
    nIterations = iter + 1;
    // Step 1: translate to centroids
    for (let i = 0; i < nSpec; i++) {
      const c = new Array<number>(dim).fill(0);
      for (const p of aligned[i]) for (let d = 0; d < dim; d++) c[d] += p[d] / nLM;
      for (const p of aligned[i]) for (let d = 0; d < dim; d++) p[d] -= c[d];
      if (iter === 0) originalCentroids[i] = c;
    }
    // Step 2: scale to unit centroid size
    for (let i = 0; i < nSpec; i++) {
      const size = _centroidSize(aligned[i]);
      if (size > 1e-12) {
        for (const p of aligned[i]) for (let d = 0; d < dim; d++) p[d] /= size;
      }
      scales[i] *= size;
    }
    // Step 3: consensus (mean configuration)
    consensus = Array.from({ length: nLM }, () => new Array<number>(dim).fill(0));
    for (let i = 0; i < nSpec; i++)
      for (let j = 0; j < nLM; j++)
        for (let d = 0; d < dim; d++) consensus[j][d] += aligned[i][j][d] / nSpec;
    // Step 4: rotate each specimen onto the consensus
    const iterRotations: number[][][] = [];
    for (let i = 0; i < nSpec; i++) {
      const R = _findRotation(consensus, aligned[i]);
      iterRotations.push(R);
      aligned[i] = _rotateConfig(aligned[i], R);
    }
    rotations = iterRotations;

    // Sum of squared Procrustes distances to the consensus
    let sse = 0;
    for (let i = 0; i < nSpec; i++)
      for (let j = 0; j < nLM; j++)
        for (let d = 0; d < dim; d++) {
          const v = aligned[i][j][d] - consensus[j][d];
          sse += v * v;
        }
    lastSSE = sse;
    if (Math.abs(prevSSE - sse) < tol) {
      converged = true;
      break;
    }
    prevSSE = sse;
  }

  // Procrustes distances to the consensus
  const procDists: number[] = [];
  for (let i = 0; i < nSpec; i++) {
    let dist = 0;
    for (let j = 0; j < nLM; j++)
      for (let d = 0; d < dim; d++) {
        const v = aligned[i][j][d] - consensus[j][d];
        dist += v * v;
      }
    procDists.push(Math.sqrt(dist));
  }

  const alignedData = new Float64Array(nSpec * nCols);
  for (let i = 0; i < nSpec; i++) {
    const row = encode(aligned[i]);
    for (let j = 0; j < nCols; j++) alignedData[i * nCols + j] = row[j];
  }

  return {
    alignedConfigurations: new Matrix(alignedData, nSpec, nCols),
    meanShape: Matrix.from1D(encode(consensus), 1, nCols),
    centroidSizes: originalSizes,
    procrustesDistances: procDists,
    nIterations,
    rotations,
    scales,
    centroids: originalCentroids,
    converged,
    finalSSE: lastSSE,
    nLandmarks: nLM,
    nDims: dim,
    nComponents: nCols,
  };
}

function _eye(n: number): number[][] {
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) M[i][i] = 1;
  return M;
}

/**
 * EFA (Elliptic Fourier Analysis) — replaces morphometrics/efa.py.
 *
 * A closed contour (x(t), y(t)) parameterized by cumulative chord length is
 * approximated by N harmonics:
 *
 *     x(t) = A₀ + Σₙ [aₙ cos(2nπt/T) + bₙ sin(2nπt/T)]
 *     y(t) = C₀ + Σₙ [cₙ cos(2nπt/T) + dₙ sin(2nπt/T)]
 *
 * Coefficients use the closed-form Kuhl & Giardina (1982) integrals and are
 * normalized with the Haines & Crampton (2000) starting-point normalization
 * so contours are comparable across specimens.
 *
 * References:
 * - Kuhl, F.P. & Giardina, C.R. (1982). CGIP 18: 236-258.
 * - Rohlf, F.J. & Archie, J.W. (1984). Evolution 38(6): 1169-1180.
 * - Haines, A.J. & Crampton, J.S. (2000). PaleoBiology 26(2): 208-218.
 */
export interface EFAResult {
  harmonics: { n: number; a: number; b: number; c: number; d: number }[];
  coefficients: number[][];
  nHarmonics: number;
  nPoints: number;
  /** DC offsets (zero after starting-point normalization). */
  a0: number;
  c0: number;
  /** Reconstructed contour from the normalized coefficients (nPoints × 2). */
  reconstructed: number[][];
  /** Resampled original contour (nPoints × 2). */
  original: number[][];
}

/**
 * Normalize EFD coefficients with the Haines-Crampton starting-point
 * normalization (Rohlf & Archie 1984; Haines & Crampton 2000).  Three steps
 * make coefficients comparable across specimens:
 *
 * 1. First-harmonic rotation: rotate harmonic n by n·φ₁ where
 *    φ₁ = atan2(b₁, a₁), so a₁ lies on the +x axis.
 * 2. Size normalization: divide all coefficients by |a₁|.
 * 3. Direction normalization: if a₁ < 0 after rotation, flip the signs of
 *    all aₙ and cₙ (reverse traversal direction).
 *
 * The DC offsets are returned as 0 (translation invariance).
 *
 * @param coefficients (n_harmonics, 4) rows (aₙ, bₙ, cₙ, dₙ), n = 1..N
 * @param a0           DC offset along x (ignored, returned as 0)
 * @param c0           DC offset along y (ignored, returned as 0)
 */
export function normalizeStartingPoint(
  coefficients: number[][],
  a0: number = 0,
  c0: number = 0,
): { coefficients: number[][]; a0: number; c0: number } {
  void a0; void c0; // translation is eliminated; DC offsets return as 0
  if (coefficients.length === 0) {
    return { coefficients: coefficients.map(r => r.slice()), a0: 0, c0: 0 };
  }
  const nHarmonics = coefficients.length;
  const efd = coefficients.map(r => r.slice());

  // Step 1: first-harmonic rotation
  const a1 = efd[0][0], b1 = efd[0][1];
  const phi1 = Math.atan2(b1, a1);
  for (let n = 0; n < nHarmonics; n++) {
    const nPhi1 = (n + 1) * phi1;
    const c = Math.cos(nPhi1), s = Math.sin(nPhi1);
    const aOld = efd[n][0], bOld = efd[n][1];
    efd[n][0] = aOld * c + bOld * s;
    efd[n][1] = -aOld * s + bOld * c;
    const cOld = efd[n][2], dOld = efd[n][3];
    efd[n][2] = cOld * c + dOld * s;
    efd[n][3] = -cOld * s + dOld * c;
  }
  // Step 2: size normalization (unit |a₁|)
  const a1Mag = Math.abs(efd[0][0]);
  if (a1Mag > 0) {
    for (let n = 0; n < nHarmonics; n++)
      for (let j = 0; j < 4; j++) efd[n][j] /= a1Mag;
  }
  // Step 3: direction normalization (a₁ > 0)
  if (efd[0][0] < 0) {
    for (let n = 0; n < nHarmonics; n++) { efd[n][0] = -efd[n][0]; efd[n][2] = -efd[n][2]; }
  }
  return { coefficients: efd, a0: 0, c0: 0 };
}

/**
 * Reconstruct a contour from Fourier coefficients.
 *
 * @param a0           DC offset along x
 * @param c0           DC offset along y
 * @param coefficients (n_harmonics, 4) rows (aₙ, bₙ, cₙ, dₙ)
 * @param nPoints      number of output points (default 200)
 * @param period       contour period T used in the original analysis
 *                     (defaults to 2π, correct only for a normalized
 *                     t ∈ [0, 2π) parameterization)
 */
export function reconstructFromCoefficients(
  a0: number,
  c0: number,
  coefficients: number[][],
  nPoints: number = 200,
  period?: number,
): number[][] {
  const T = period === undefined ? 2 * Math.PI : period;
  const out: number[][] = [];
  for (let i = 0; i < nPoints; i++) {
    const t = (i / nPoints) * T;
    let x = a0, y = c0;
    for (let n = 0; n < coefficients.length; n++) {
      const omega = ((n + 1) * 2 * Math.PI) / T;
      const [a, b, c, d] = coefficients[n];
      x += a * Math.cos(omega * t) + b * Math.sin(omega * t);
      y += c * Math.cos(omega * t) + d * Math.sin(omega * t);
    }
    out.push([x, y]);
  }
  return out;
}

/**
 * Resample a contour to nPoints with uniform chord-length spacing.
 * Port of efa.py::_resample_contour.
 */
export function resampleContour(contour: number[][], nPoints: number): number[][] {
  const n = contour.length;
  const cumArc: number[] = [0];
  for (let i = 1; i < n; i++) {
    const dx = contour[i][0] - contour[i - 1][0];
    const dy = contour[i][1] - contour[i - 1][1];
    cumArc.push(cumArc[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cumArc[n - 1];
  const out: number[][] = [];
  for (let i = 0; i < nPoints; i++) {
    const s = (i / nPoints) * total;
    out.push([_interpArc(contour, cumArc, s, 0), _interpArc(contour, cumArc, s, 1)]);
  }
  return out;
}

function _interpArc(contour: number[][], cumArc: number[], s: number, coord: number): number {
  const n = contour.length;
  if (s <= 0) return contour[0][coord];
  if (s >= cumArc[n - 1]) return contour[n - 1][coord];
  // Binary search for the segment [i-1, i] containing s
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumArc[mid] <= s) lo = mid; else hi = mid;
  }
  const segLen = cumArc[hi] - cumArc[lo];
  const u = segLen > 0 ? (s - cumArc[lo]) / segLen : 0;
  return contour[lo][coord] + u * (contour[hi][coord] - contour[lo][coord]);
}

/**
 * Perform EFA on a closed contour.
 *
 * @param contour     (N, 2) array of (x, y) coordinates (closed or open)
 * @param nHarmonics  number of harmonics to compute
 * @param nPoints     number of points for uniform resampling (default 200)
 */
export function efa(contour: number[][], nHarmonics: number = 10, nPoints: number = 200): EFAResult {
  // Copy: never mutate the caller's contour
  const pts = contour.map(p => [p[0], p[1]]);
  const eps = 1e-9;
  if (Math.abs(pts[0][0] - pts[pts.length - 1][0]) > eps ||
      Math.abs(pts[0][1] - pts[pts.length - 1][1]) > eps) {
    pts.push([pts[0][0], pts[0][1]]);
  }

  // Resample to uniform chord-length spacing
  const resampled = resampleContour(pts, nPoints);
  const nPts = resampled.length;

  const t: number[] = [0];
  for (let i = 1; i < nPts; i++) {
    const dx = resampled[i][0] - resampled[i - 1][0];
    const dy = resampled[i][1] - resampled[i - 1][1];
    t.push(t[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const T = t[nPts - 1];
  if (T === 0) {
    // Degenerate contour: keep the historical graceful empty result
    return {
      harmonics: [], coefficients: [], nHarmonics: 0, nPoints: nPts,
      a0: 0, c0: 0, reconstructed: [], original: resampled,
    };
  }

  const dx: number[] = [], dy: number[] = [];
  for (let i = 1; i < nPts; i++) {
    dx.push(resampled[i][0] - resampled[i - 1][0]);
    dy.push(resampled[i][1] - resampled[i - 1][1]);
  }

  // DC offsets before normalization
  let a0 = 0, c0 = 0;
  for (let i = 0; i < nPts; i++) { a0 += resampled[i][0] / nPts; c0 += resampled[i][1] / nPts; }

  let coefficients: number[][] = [];
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
    coefficients.push([a * factor, b * factor, c * factor, d * factor]);
  }

  // Haines-Crampton starting-point normalization: makes coefficients
  // comparable across specimens (starting point, size, orientation).
  const norm = normalizeStartingPoint(coefficients, a0, c0);
  coefficients = norm.coefficients;
  const a0Norm = norm.a0, c0Norm = norm.c0;

  const harmonics = coefficients.map((coef, i) => ({
    n: i + 1, a: coef[0], b: coef[1], c: coef[2], d: coef[3],
  }));

  // Reconstruct on the original cumulative chord parameterization
  const reconstructed: number[][] = [];
  for (let i = 0; i < nPts; i++) {
    let x = a0Norm, y = c0Norm;
    for (let n = 0; n < harmonics.length; n++) {
      const h = harmonics[n];
      const omega = 2 * Math.PI * h.n / T;
      x += h.a * Math.cos(omega * t[i]) + h.b * Math.sin(omega * t[i]);
      y += h.c * Math.cos(omega * t[i]) + h.d * Math.sin(omega * t[i]);
    }
    reconstructed.push([x, y]);
  }

  return {
    harmonics, coefficients, nHarmonics, nPoints: nPts,
    a0: a0Norm, c0: c0Norm, reconstructed, original: resampled,
  };
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
  /** Dimensions per landmark used for centroid size (default 2). */
  nDims: number;
  /** Number of shape variables used in the regression. */
  nComponents: number;
}

/**
 * Allometry analysis: multivariate regression of Procrustes coordinates on
 * log centroid size (Klingenberg 2016).
 *
 * Centroid size uses the Bookstein (1991) definition relative to the
 * specimen's own centroid:
 *
 *     CS = sqrt( Σᵢ ‖xᵢ − x̄‖² )
 *
 * (the previous implementation measured distance from the coordinate
 * origin, which biases every analysis built on the sizes).
 *
 * @param configurations (n_specimens, n_landmarks*n_dims), coordinate-major
 * @param nComponents    optional number of principal components of the
 *                       centered shape used as regressors; predictions are
 *                       back-transformed to the full shape space
 * @param nDims          dimensions per landmark (default 2)
 */
export function allometry(configurations: Matrix, nComponents?: number, nDims: number = 2): AllometryResult {
  const n = configurations.rows;
  const p = configurations.cols;
  if (p % nDims !== 0) {
    throw new MorphometricsError(`Column count ${p} not divisible by nDims=${nDims}`);
  }
  const nLM = p / nDims;

  // Centroid sizes: sqrt(Σ|x − x̄|²) per specimen (block-major layout)
  const cs: number[] = [];
  const logCS: number[] = [];
  for (let i = 0; i < n; i++) {
    let size = 0;
    for (let d = 0; d < nDims; d++) {
      let mean = 0;
      for (let j = 0; j < nLM; j++) mean += configurations.get(i, d * nLM + j) / nLM;
      for (let j = 0; j < nLM; j++) {
        const v = configurations.get(i, d * nLM + j) - mean;
        size += v * v;
      }
    }
    const s = Math.sqrt(size);
    cs.push(s);
    logCS.push(Math.log(s));
  }

  // Center the shape data
  const meanShape = configurations.meanAxis(0);
  const centered = configurations.sub(meanShape);

  // Optional PCA reduction of the shape variables
  let shapeUsed = centered;
  let basis: Matrix | null = null;
  let nVarsUsed = p;
  if (nComponents !== undefined && nComponents > 0 && nComponents < p) {
    const cov = centered.transpose().matmul(centered).div(Math.max(1, n - 1));
    const eig = eigh_local(cov); // sorted descending
    basis = eig.eigenvectors.sliceCols(0, nComponents);
    shapeUsed = centered.matmul(basis);
    nVarsUsed = nComponents;
  }

  // Multivariate regression: shape = intercept + coef * log(CS)
  const X = Matrix.zeros(n, 2);
  for (let i = 0; i < n; i++) { X.set(i, 0, 1); X.set(i, 1, logCS[i]); }

  const XtXinv = inv2x2(X.transpose().matmul(X));
  const B = XtXinv.matmul(X.transpose()).matmul(shapeUsed); // (2, nVarsUsed)

  const intercept: number[] = B.row(0);
  const coefficients: number[] = B.row(1);

  const predicted = X.matmul(B);
  const residuals = shapeUsed.sub(predicted);

  // R-squared
  const centeredUsed = shapeUsed;
  const ssTot = centeredUsed.sub(centeredUsed.meanAxis(0)).mul(centeredUsed.sub(centeredUsed.meanAxis(0))).sum();
  const ssRes = residuals.mul(residuals).sum();
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // F-test for isometry (H0: all allometric coefficients = 0)
  const ssNull = (() => {
    // intercept-only model: SS = Σ ‖y − ȳ‖²
    const m = centeredUsed.meanAxis(0);
    const d = centeredUsed.sub(m);
    return d.mul(d).sum();
  })();
  const dfModel = nVarsUsed;      // number of shape variables (Python df1)
  const dfRes = n - 2;            // residual df
  const F = ssRes > 0 && dfRes > 0 ? ((ssNull - ssRes) / dfModel) / (ssRes / dfRes) : 0;
  const pVal = ssRes > 0 && dfRes > 0 ? 1 - fCDF_local(F, dfModel, dfRes) : 1.0;

  // Back-transform predictions to the full shape space
  const predictedFull = basis ? predicted.matmul(basis.transpose()).add(meanShape) : predicted.add(meanShape);

  return {
    centroidSizes: cs, logCentroidSizes: logCS,
    regressionCoefficients: coefficients, regressionIntercept: intercept,
    rSquared: r2, fStatistic: F, isometryPValue: pVal,
    residuals, predictedShapes: predictedFull,
    nSpecimens: n, nLandmarks: nLM,
    nDims, nComponents: nVarsUsed,
  };
}

function inv2x2(A: Matrix): Matrix {
  return inv_general(A);
}

function inv_general(A: Matrix): Matrix {
  // Local Gauss-Jordan inverse (avoids mutating shared math/ helpers)
  const n = A.rows;
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
    if (Math.abs(pivot) < 1e-15) throw new MorphometricsError('allometry: singular design matrix');
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
  /** P-value of the directional trend (t-test on the trend slope). */
  trendSignificance: number | null;
  /** Bootstrap confidence interval for the rate estimate. */
  rateCILower: number | null;
  rateCIUpper: number | null;
  /** OU optimum θ of the stasis model (best model = stasis only). */
  optimum: number | null;
  /** OU attraction strength α of the stasis model. */
  attractionStrength: number | null;
  aicValues: Record<string, number>;
  logLikelihoods: Record<string, number>;
  /** Posterior model probabilities (= normalized AIC weights). */
  modelProbabilities: Record<string, number>;
  nMeasurements: number;
  traitMean: number;
  traitVariance: number;
}

export interface EvolutionRateOptions {
  /** Models to fit: subset of ['random_walk', 'directional', 'stasis']. */
  models?: string[];
  /** Confidence level for the rate bootstrap CI (default 0.95). */
  confidenceLevel?: number;
  /** Seed for the reproducible bootstrap resampling (default 42). */
  rngSeed?: number;
  /** Number of bootstrap replicates (default 199). */
  nBootstrap?: number;
}

// — model log-likelihood fits (port of evolution_rate.py::_fit_*) —

/** Random walk: MLE rate = Σdx² / Σdt (heteroscedastic increments). */
function _fitRandomWalk(dx: number[], dt: number[]): { ll: number; rate: number } {
  if (dx.length === 0) return { ll: 0, rate: 0 };
  const dtSum = dt.reduce((a, b) => a + b, 0);
  const rate = dtSum > 0 ? dx.reduce((s, v) => s + v * v, 0) / dtSum : 0;
  let ll = 0;
  for (let i = 0; i < dx.length; i++) {
    const v = Math.max(rate * dt[i], 1e-10);
    ll += -0.5 * Math.log(2 * Math.PI) - 0.5 * Math.log(v) - 0.5 * (dx[i] * dx[i]) / v;
  }
  return { ll, rate };
}

/** Directional (trend + RW): E[dx] = β·dt, t-test on β. */
function _fitDirectional(
  trait: number[], dx: number[], dt: number[],
): { ll: number; rate: number; trend: number; trendSe: number; trendP: number } {
  if (dx.length === 0) return { ll: 0, rate: 0, trend: 0, trendSe: 0, trendP: 1 };
  const n = trait.length;
  const dt2Sum = dt.reduce((s, v) => s + v * v, 0);
  const beta = dt2Sum > 0 ? dx.reduce((s, v, i) => s + v * dt[i], 0) / dt2Sum : 0;
  const residuals = dx.map((v, i) => v - beta * dt[i]);
  const dtSum = dt.reduce((a, b) => a + b, 0);
  const ssRes = residuals.reduce((s, v) => s + v * v, 0);
  const rate = dtSum > 0 ? ssRes / dtSum : 0;
  const seBeta = dt2Sum > 0 && n > 2 ? Math.sqrt(ssRes / ((n - 2) * dt2Sum)) : 0;
  let trendP = 1;
  if (seBeta > 0) {
    const tStat = beta / seBeta;
    trendP = 2 * (1 - tCDF(Math.abs(tStat), n - 2));
  }
  let ll = 0;
  for (let i = 0; i < dx.length; i++) {
    const v = Math.max(rate * dt[i], 1e-10);
    ll += -0.5 * Math.log(2 * Math.PI) - 0.5 * Math.log(v) - 0.5 * (residuals[i] * residuals[i]) / v;
  }
  return { ll, rate, trend: beta, trendSe: seBeta, trendP };
}

/**
 * Stasis as an Ornstein-Uhlenbeck process:
 *     dx = −α·(θ − x)·dt + σ·dW
 * θ = series mean; α from the lag-1 autocorrelation; σ² weighted by dt.
 */
function _fitStasis(
  trait: number[], dx: number[], dt: number[],
): { ll: number; rate: number; theta: number; alpha: number } {
  if (dx.length === 0) return { ll: 0, rate: 0, theta: 0, alpha: 0 };
  const n = trait.length;
  const theta = trait.reduce((a, b) => a + b, 0) / n;
  const traitVar = trait.reduce((s, v) => s + (v - theta) ** 2, 0) / n; // population variance

  let alpha: number;
  if (n > 2 && traitVar > 0) {
    let autocorr = 0;
    for (let i = 0; i < n - 1; i++) autocorr += (trait[i] - theta) * (trait[i + 1] - theta);
    autocorr = autocorr / ((n - 1) * traitVar);
    alpha = autocorr > 0 ? -Math.log(Math.max(0.01, Math.min(0.99, autocorr))) : 0.1;
  } else {
    alpha = 0.1;
  }

  const residuals = dx.map((v, i) => v + alpha * (trait[i] - theta) * dt[i]);
  const dtSum = dt.reduce((a, b) => a + b, 0);
  const sigmaSq = dtSum > 0 ? residuals.reduce((s, v) => s + v * v, 0) / dtSum : 0;
  const sigma = Math.sqrt(Math.max(sigmaSq, 1e-10));

  let ll = 0;
  for (let i = 0; i < dx.length; i++) {
    const v = Math.max(sigma * sigma * dt[i], 1e-10);
    ll += -0.5 * Math.log(2 * Math.PI) - 0.5 * Math.log(v) - 0.5 * (residuals[i] * residuals[i]) / v;
  }
  return { ll, rate: sigma, theta, alpha };
}

/**
 * Bootstrap confidence interval for the rate estimate (port of
 * evolution_rate.py::_bootstrap_rate_ci).  Increments are resampled with
 * replacement from the centered empirical residual distribution, a
 * bootstrap trait series is reconstructed, and the selected model is
 * refit.  Uses the seeded PRNG from math/random (never Math.random).
 */
function _bootstrapRateCI(
  trait: number[],
  timeIntervals: number[],
  model: string,
  confidenceLevel: number,
  rng: () => number,
  nBootstrap: number,
): { lower: number | null; upper: number | null } {
  const n = trait.length;
  if (n < 5) return { lower: null, upper: null };

  const dx = [];
  for (let i = 1; i < n; i++) dx.push(trait[i] - trait[i - 1]);
  const meanDx = dx.reduce((a, b) => a + b, 0) / dx.length;
  const residuals = dx.map(v => v - meanDx);

  const rates: number[] = [];
  for (let b = 0; b < nBootstrap; b++) {
    const bootResiduals = residuals.map(() => residuals[Math.floor(rng() * residuals.length)]);
    const bootTrait: number[] = [trait[0]];
    for (let i = 0; i < bootResiduals.length; i++) bootTrait.push(bootTrait[i] + bootResiduals[i]);
    const bootDx: number[] = [];
    for (let i = 1; i < bootTrait.length; i++) bootDx.push(bootTrait[i] - bootTrait[i - 1]);

    if (model === 'random_walk') {
      rates.push(_fitRandomWalk(bootDx, timeIntervals).rate);
    } else if (model === 'directional') {
      rates.push(_fitDirectional(bootTrait, bootDx, timeIntervals).rate);
    } else if (model === 'stasis') {
      rates.push(_fitStasis(bootTrait, bootDx, timeIntervals).rate);
    }
  }
  if (rates.length === 0) return { lower: null, upper: null };
  const alphaLevel = 1 - confidenceLevel;
  return {
    lower: percentile(rates, (alphaLevel / 2) * 100),
    upper: percentile(rates, (1 - alphaLevel / 2) * 100),
  };
}

/**
 * Analyze the mode and rate of morphological evolution (Foote 1997;
 * Pagel 1994).  Fits random-walk (Brownian motion), directional
 * (trend + RW) and stasis (Ornstein-Uhlenbeck) models, selects by AIC,
 * reports bootstrap rate CIs and the trend significance (SE + t-test).
 *
 * @param traitSeries   trait values in stratigraphic/time order (n,)
 * @param timeIntervals time/depth spacing between consecutive measurements
 *                      (n−1,).  Defaults to unit intervals.  The intervals
 *                      enter every estimate: rate = Σdx²/Σdt is dt-weighted
 *                      and the log-likelihood variances are rate·dt.
 * @param options       models / confidenceLevel / rngSeed / nBootstrap
 */
export function evolutionRate(
  traitSeries: number[],
  timeIntervals?: number[] | null,
  options: EvolutionRateOptions = {},
): EvolutionRateResult {
  const empty: EvolutionRateResult = {
    bestModel: 'unknown', rateEstimate: 0, trendEstimate: 0, aicWeights: {}, modelFits: [],
    trendSignificance: null, rateCILower: null, rateCIUpper: null,
    optimum: null, attractionStrength: null,
    aicValues: {}, logLikelihoods: {}, modelProbabilities: {},
    nMeasurements: traitSeries.length, traitMean: 0, traitVariance: 0,
  };
  const n = traitSeries.length;
  if (n < 3) return empty;

  // Time intervals: default to unit spacing; validate length when given
  let dt: number[];
  if (timeIntervals === undefined || timeIntervals === null) {
    dt = new Array<number>(n - 1).fill(1);
  } else {
    if (timeIntervals.length !== n - 1) {
      throw new MorphometricsError(
        `Number of intervals (${timeIntervals.length}) must equal measurements - 1 (${n - 1})`,
      );
    }
    dt = timeIntervals.slice();
  }

  const models = options.models ?? ['random_walk', 'directional', 'stasis'];
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const rng = createSeededRNG(options.rngSeed ?? 42);
  const nBootstrap = options.nBootstrap ?? 199;

  const dx: number[] = [];
  for (let i = 1; i < n; i++) dx.push(traitSeries[i] - traitSeries[i - 1]);

  const traitMean = traitSeries.reduce((a, b) => a + b, 0) / n;
  const traitVariance = traitSeries.reduce((s, v) => s + (v - traitMean) ** 2, 0) / n;

  // Fit requested models
  const ll: Record<string, number> = {};
  const rate: Record<string, number> = {};
  const trend: Record<string, number> = {};
  const trendSe: Record<string, number> = {};
  const trendP: Record<string, number> = {};
  const theta: Record<string, number> = {};
  const alpha: Record<string, number> = {};

  if (models.includes('random_walk')) {
    const f = _fitRandomWalk(dx, dt);
    ll['random_walk'] = f.ll; rate['random_walk'] = f.rate;
  }
  if (models.includes('directional')) {
    const f = _fitDirectional(traitSeries, dx, dt);
    ll['directional'] = f.ll; rate['directional'] = f.rate;
    trend['directional'] = f.trend; trendSe['directional'] = f.trendSe; trendP['directional'] = f.trendP;
  }
  if (models.includes('stasis')) {
    const f = _fitStasis(traitSeries, dx, dt);
    ll['stasis'] = f.ll; rate['stasis'] = f.rate;
    theta['stasis'] = f.theta; alpha['stasis'] = f.alpha;
  }

  // AIC with parameter counts k = {rw: 1, dir: 2, stasis: 3}
  const k: Record<string, number> = { random_walk: 1, directional: 2, stasis: 3 };
  const aicValues: Record<string, number> = {};
  for (const m of Object.keys(ll)) {
    aicValues[m] = -2 * ll[m] + 2 * (k[m] ?? 1);
  }

  // AIC weights = posterior model probabilities
  const minAic = Math.min(...Object.values(aicValues));
  const modelProbabilities: Record<string, number> = {};
  let totalWeight = 0;
  for (const m of Object.keys(aicValues)) {
    modelProbabilities[m] = Math.exp(-0.5 * (aicValues[m] - minAic));
    totalWeight += modelProbabilities[m];
  }
  for (const m of Object.keys(modelProbabilities)) modelProbabilities[m] /= totalWeight;

  let bestModel = Object.keys(modelProbabilities)[0];
  for (const m of Object.keys(modelProbabilities)) {
    if (modelProbabilities[m] > modelProbabilities[bestModel]) bestModel = m;
  }

  // Bootstrap CI for the rate of the best model
  const ci = _bootstrapRateCI(traitSeries, dt, bestModel, confidenceLevel, rng, nBootstrap);

  // Legacy display names kept for backward compatibility
  const displayNames: Record<string, string> = {
    random_walk: 'Random Walk', directional: 'Directional', stasis: 'Stasis',
  };
  const aicWeights: Record<string, number> = {};
  const modelFits: { name: string; aic: number; params: Record<string, number> }[] = [];
  for (const m of Object.keys(aicValues)) {
    const name = displayNames[m] ?? m;
    aicWeights[name] = modelProbabilities[m];
    const params: Record<string, number> = { rate: rate[m], variance: rate[m] };
    if (m === 'directional') { params.trend = trend[m]; params.trendSe = trendSe[m]; params.trendP = trendP[m]; }
    if (m === 'stasis') { params.mean = theta[m]; params.theta = theta[m]; params.alpha = alpha[m]; }
    modelFits.push({ name, aic: aicValues[m], params });
  }

  return {
    bestModel: displayNames[bestModel] ?? bestModel,
    rateEstimate: rate[bestModel] ?? 0,
    trendEstimate: bestModel === 'directional' ? trend[bestModel] : 0,
    aicWeights, modelFits,
    trendSignificance: bestModel === 'directional' ? (trendP[bestModel] ?? null) : null,
    rateCILower: ci.lower,
    rateCIUpper: ci.upper,
    optimum: bestModel === 'stasis' ? (theta[bestModel] ?? null) : null,
    attractionStrength: bestModel === 'stasis' ? (alpha[bestModel] ?? null) : null,
    aicValues,
    logLikelihoods: { ...ll },
    modelProbabilities,
    nMeasurements: n,
    traitMean,
    traitVariance,
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
    K.set(i, j, tpsKernel2D(Math.sqrt(r2)));
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
      const U = tpsKernel2D(Math.sqrt(r2));
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
  /** Cumulative explained variance (%, against the full variance). */
  cumulativeVariance: number[];
  /** Shape change vectors (n_vars × n_components). */
  eigenvectors: Matrix;
  /** Mean Procrustes configuration (1 × n_vars). */
  meanShape: Matrix;
  nComponents: number;
}

/**
 * Relative Warps Analysis: PCA on Procrustes-aligned coordinates
 * (Rohlf 1999).  Explained variance is reported against the *full*
 * variance, so a truncated result does not artificially reach 100%.
 */
export function relativeWarps(alignedConfigs: Matrix, nComponents?: number): RelativeWarpsResult {
  // PCA on Procrustes-aligned coordinates
  const n = alignedConfigs.rows, p = alignedConfigs.cols;
  const nc = Math.max(1, Math.min(nComponents ?? n - 1, n - 1, p));

  const mean = alignedConfigs.meanAxis(0);
  const centered = alignedConfigs.sub(mean);
  const cov = centered.transpose().matmul(centered).div(n - 1);
  const { eigenvalues, eigenvectors } = eigh_local(cov);

  const eigTop = eigenvalues.slice(0, nc);
  const totalVar = eigenvalues.reduce((a, b) => a + b, 0);
  const explained = eigTop.map(e => totalVar > 0 ? e / totalVar * 100 : 0);
  const cumulative: number[] = [];
  let acc = 0;
  for (const v of explained) { acc += v; cumulative.push(acc); }

  const eigVecs = eigenvectors.sliceCols(0, nc);
  const scores = centered.matmul(eigVecs);

  return {
    scores, eigenvalues: eigTop, explainedVariance: explained,
    cumulativeVariance: cumulative,
    eigenvectors: eigVecs,
    meanShape: mean,
    nComponents: nc,
  };
}

/**
 * Reconstruct the shape at a given position along a relative warp.
 * Port of relative_warps.py::RelativeWarpsAnalyzer.get_shape_at_warp:
 *
 *     shape = mean_shape + eigenvector[:, j] · t · sqrt(eigenvalue[j])
 *
 * @param alignedConfigs  aligned configurations (n × p); the mean shape is
 *                        computed from them (a single-row mean is also valid)
 * @param eigenvectors    warp vectors (p × n_components)
 * @param scores          eigenvalues (variances) per warp — the position t is
 *                        expressed in standard-deviation units
 * @param warpIndex       which relative warp (0-indexed)
 * @param t               position along the warp (in std deviations)
 * @returns reconstructed configuration as a (1 × p) Matrix
 */
export function getShapeAtWarp(
  alignedConfigs: Matrix,
  eigenvectors: Matrix,
  scores: number[] | Matrix,
  warpIndex: number,
  t: number,
): Matrix {
  const p = alignedConfigs.cols;
  if (warpIndex < 0 || warpIndex >= eigenvectors.cols) {
    throw new MorphometricsError(`Warp number ${warpIndex} exceeds available components`);
  }
  const eigenvals = scores instanceof Matrix ? Array.from(scores.data) : scores;
  if (warpIndex >= eigenvals.length) {
    throw new MorphometricsError(`Warp number ${warpIndex} exceeds available eigenvalues`);
  }
  // Mean shape: mean over specimens (a (1 × p) input is its own mean)
  const meanShape = alignedConfigs.rows > 1 ? alignedConfigs.meanAxis(0) : alignedConfigs.clone();
  const stdDev = Math.sqrt(Math.max(0, eigenvals[warpIndex]));
  const out = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    out[j] = meanShape.get(0, j) + eigenvectors.get(j, warpIndex) * t * stdDev;
  }
  return new Matrix(out, 1, p);
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

/**
 * Select an arbitrary subset of columns (fixes the previous
 * implementation, which took a contiguous sliceCols range and therefore
 * grabbed the wrong columns whenever the random permutation interleaved
 * landmarks).
 */
function _selectColumns(M: Matrix, cols: number[]): Matrix {
  const nc = cols.length;
  const d = new Float64Array(M.rows * nc);
  for (let i = 0; i < M.rows; i++)
    for (let j = 0; j < nc; j++) d[i * nc + j] = M.get(i, cols[j]);
  return new Matrix(d, M.rows, nc);
}

/**
 * Divide landmark configurations into two blocks for PLS analysis.
 *
 * @param alignedConfigs (n_specimens, n_landmarks*n_dims) aligned data
 * @param division       'anterior_posterior': contiguous split of landmarks
 *                       at the midpoint;
 *                       'size_matched': split of the flattened landmark
 *                       columns at the midpoint (API-compatible with the
 *                       Python mode of the same name; the size-partition
 *                       dead code of the original implementation has no
 *                       analogue here);
 *                       'random': random permutation of landmarks, split
 *                       at the midpoint.
 * @param randomSeed     optional seed for the 'random' division (seeded
 *                       Mulberry32 stream; the global PRNG state of other
 *                       draws is untouched when a seed is given)
 */
export function divideConfigurationIntoBlocks(
  alignedConfigs: Matrix,
  division: 'anterior_posterior' | 'size_matched' | 'random' = 'anterior_posterior',
  randomSeed?: number,
): [Matrix, Matrix] {
  const nLandmarks = alignedConfigs.cols / 2;
  const p = alignedConfigs.cols;

  if (division === 'size_matched') {
    // Split the flattened landmark columns at the midpoint
    const midCols = Math.floor(p / 2);
    return [alignedConfigs.sliceCols(0, midCols), alignedConfigs.sliceCols(midCols, p)];
  }

  const mid = Math.floor(nLandmarks / 2);
  let firstHalf: number[], secondHalf: number[];

  if (division === 'random') {
    const rng = randomSeed !== undefined ? createSeededRNG(randomSeed) : rand;
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

  // Convert landmark indices to flattened column indices (landmark-major)
  const blockACols: number[] = [];
  const blockBCols: number[] = [];
  for (const lm of firstHalf) { for (let d = 0; d < 2; d++) blockACols.push(lm * 2 + d); }
  for (const lm of secondHalf) { for (let d = 0; d < 2; d++) blockBCols.push(lm * 2 + d); }
  blockACols.sort((a, b) => a - b);
  blockBCols.sort((a, b) => a - b);

  // Select exactly the permuted columns (not a contiguous slice)
  const blockA = _selectColumns(alignedConfigs, blockACols);
  const blockB = _selectColumns(alignedConfigs, blockBCols);

  return [blockA, blockB];
}

// ─── Re-exports: Eigenshape / 2B-PLS Integration / TPS basis ───────────────────
export { eigenshape, type EigenshapeResult } from './Eigenshape';
export { plsIntegration, type PLSResult } from './Integration';
// (`tpsAnalyze`/`tpsWarpGrid` return the `TPSResult` declared in ./TPSAnalyzer;
// the module-local `TPSResult` interface above belongs to `tpsDeformation`,
// so the type name itself is not re-exported here to avoid the conflict.)
export { tpsAnalyze, tpsWarpGrid } from './TPSAnalyzer';
