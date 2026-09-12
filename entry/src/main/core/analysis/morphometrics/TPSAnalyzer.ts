/**
 * Thin-Plate Spline analysis — replaces morphometrics/tps.py::TPSAnalyzer.
 *
 * Bookstein's constrained formulation:
 *     [K  P] [w]   [target]
 *     [P^T 0] [a] = [0   ]
 *
 * Kernel U(r) = r² log(r)  (Bookstein 1989)
 * Bending energy: E = w^T K w.
 *
 * References:
 * - Bookstein, F.L. (1989). "Principal warps: thin-plate splines and the
 *   decomposition of deformations." IEEE TPAMI 11(6): 567-585.
 * - Bookstein, F.L. (1991). Morphometric Tools for Landmark Data.
 * - Rohlf, F.J. & Slice, D. (1990). Syst. Zool. 39: 40-59.
 */
import { MorphometricsError } from '../../utils/Exceptions';
import { tpsKernel2D, tpsKernel3D } from './tpsKernel';

export interface TPSResult {
  source: number[][];
  target: number[][];
  affine: number[][];       // affine coefficients (n_affine × n_dims)
  nonAffine: number[][];   // non-affine weights (n_landmarks × n_dims)
  fullCoefficients: number[][]; // w then a stacked (n_landmarks + n_affine) × n_dims
  bendingEnergy: number;
  /** 2 for planar, 3 for volumetric configurations. */
  nDims: 2 | 3;
  /** Apply the TPS to arbitrary points. */
  warpPoints: (points: number[][]) => number[][];
}

/**
 * Validate and convert a configuration to the standard (n_landmarks, n_dims)
 * format.  Port of morphometrics/tps.py::_validate_configuration:
 *
 * - ``(n_landmarks, n_dims)`` arrays pass through.
 * - A flat 1D array is parsed landmark-major: an even length is interpreted
 *   as 2D (x₀, y₀, x₁, y₁, ...), an odd length as 3D (x₀, y₀, z₀, ...).
 */
export function validateConfiguration(config: number[] | number[][]): number[][] {
  if (config.length === 0) throw new MorphometricsError('Empty configuration');
  const first = config[0];
  if (typeof first === 'number') {
    // Flattened (1D) format, landmark-major
    const flat = config as number[];
    const nDims = flat.length % 2 === 0 ? 2 : 3;
    const nLandmarks = Math.floor(flat.length / nDims);
    const out: number[][] = [];
    for (let i = 0; i < nLandmarks; i++) {
      out.push(flat.slice(i * nDims, (i + 1) * nDims));
    }
    return out;
  }
  const pts = config as number[][];
  const d = pts[0].length;
  for (const p of pts) {
    if (p.length !== d) throw new MorphometricsError('Configuration rows must have consistent length');
  }
  if (d !== 2 && d !== 3) throw new MorphometricsError('TPS requires 2D or 3D configurations');
  return pts.map(p => p.slice());
}

/**
 * Fit TPS deformation between source and target landmarks.
 *
 * @param source  (n_landmarks × n_dims) reference configuration, or a flat
 *                1D array (parsed landmark-major; even length = 2D, odd = 3D)
 * @param target  same shape, the deformed target
 *
 * Kernel: U(r) = r² log(r) in 2D (Bookstein 1989) and U(r) = −|r| in 3D
 * (Bookstein 1991 — the 3D bending-energy matrix is −|r| so that
 * E = wᵀKw ≥ 0).
 */
export function tpsAnalyze(sourceInput: number[] | number[][], targetInput: number[] | number[][]): TPSResult {
  const source = validateConfiguration(sourceInput);
  const target = validateConfiguration(targetInput);
  if (source.length !== target.length) throw new MorphometricsError('Same number of source/target landmarks');
  const n = source.length;
  if (n === 0) throw new MorphometricsError('TPS requires at least one landmark');
  const d = source[0].length;
  if (d !== 2 && d !== 3) throw new MorphometricsError('TPS requires 2D or 3D');
  const kernel = d === 2 ? tpsKernel2D : tpsKernel3D;

  // Build kernel matrix K (n × n) with K_ij = U(||s_i - s_j||)
  const K = _buildKernel(source, kernel);

  // Affine constraint matrix P (n × (d+1))
  const P: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    for (let j = 0; j < d; j++) row.push(source[i][j]);
    P.push(row);
  }
  const m = P[0].length;

  // Assemble block system  L x = rhs   where  L = [[K P]; [P^T 0]]
  const L = _zeros(n + m, n + m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) L[i][j] = K[i][j];
    for (let j = 0; j < m; j++) { L[i][n + j] = P[i][j]; L[n + j][i] = P[i][j]; }
  }
  // RHS: target for first n rows, 0 for last m
  const rhs: number[][] = [];
  for (let i = 0; i < n; i++) rhs.push(target[i].slice());
  for (let i = 0; i < m; i++) rhs.push(new Array(d).fill(0));

  // Solve via Gaussian elimination; fall back to simple Jacobi iteration if singular
  let x: number[][];
  try {
    x = _solveBlock(L, rhs, n, m);
  } catch {
    // Build rank-deficient least squares fallback (perturb L by tiny ridge)
    for (let i = 0; i < L.length; i++) L[i][i] += 1e-10;
    x = _solveBlock(L, rhs, n, m);
  }

  // Extract
  const nonAffine: number[][] = [];
  const affine: number[][] = [];
  for (let i = 0; i < n; i++) nonAffine.push(x[i]);
  for (let i = n; i < n + m; i++) affine.push(x[i]);

  // Bending energy E = w^T K w (summed over coordinates)
  let E = 0;
  for (let c = 0; c < d; c++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += K[i][j] * nonAffine[j][c];
      E += nonAffine[i][c] * s;
    }
  }

  return {
    source, target,
    affine, nonAffine,
    fullCoefficients: x,
    bendingEnergy: E,
    nDims: d as 2 | 3,
    warpPoints: (points: number[][]) => _tpsWarp(points, source, x, m, d, kernel)
  };
}

/** Generate a warped grid spanning the source's bounding box. */
export function tpsWarpGrid(
  result: TPSResult,
  gridRows: number = 20,
  gridCols: number = 20
): { warpedPoints: number[][][]; grid: number[][] } {
  const src = result.source;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of src) {
    if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
    if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1];
  }
  const margin = 0.1 * Math.max(xMax - xMin, yMax - yMin);
  xMin -= margin; xMax += margin; yMin -= margin; yMax += margin;
  const xs: number[][] = [], ys: number[][] = [];
  for (let i = 0; i < gridRows; i++) {
    const y = yMin + (i / (gridRows - 1)) * (yMax - yMin);
    const row: number[] = [], row2: number[] = [];
    for (let j = 0; j < gridCols; j++) {
      const x = xMin + (j / (gridCols - 1)) * (xMax - xMin);
      row.push(x); row2.push(y);
    }
    xs.push(row); ys.push(row2);
  }
  const points: number[][] = [];
  for (let i = 0; i < gridRows; i++) for (let j = 0; j < gridCols; j++) points.push([xs[i][j], ys[i][j]]);
  const warped = result.warpPoints(points);
  const grid: number[][][] = [];
  for (let i = 0; i < gridRows; i++) {
    const row: number[][] = [];
    for (let j = 0; j < gridCols; j++) row.push(warped[i * gridCols + j]);
    grid.push(row);
  }
  // `grid` is the source lattice that was warped (flat n_pts × 2);
  // `warpedPoints` is the deformed lattice reshaped to (rows × cols × 2),
  // matching Python warp_grid's reshape(grid_shape + (2,)).
  return { warpedPoints: grid, grid: points };
}

function _buildKernel(src: number[][], kernel: (r: number) => number): number[][] {
  const n = src.length;
  const K: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) { row.push(0); continue; }
      let sq = 0;
      for (let k = 0; k < src[i].length; k++) {
        const d = src[i][k] - src[j][k];
        sq += d * d;
      }
      const r = Math.sqrt(sq);
      row.push(kernel(r));
    }
    K.push(row);
  }
  return K;
}

function _zeros(rows: number, cols: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) out.push(new Array(cols).fill(0));
  return out;
}

/** Solve n+m system with right-hand side (n+m) × d via block Gaussian elimination. */
function _solveBlock(L: number[][], rhs: number[][], n: number, m: number): number[][] {
  const dim = n + m;
  // Augmented matrix (dim × (dim + d))
  const d = rhs[0].length;
  const aug: number[][] = [];
  for (let i = 0; i < dim; i++) {
    const row: number[] = L[i].slice();
    for (let k = 0; k < d; k++) row.push(rhs[i][k]);
    aug.push(row);
  }
  for (let i = 0; i < dim; i++) {
    // find pivot
    let maxV = Math.abs(aug[i][i]), maxR = i;
    for (let r = i + 1; r < dim; r++) if (Math.abs(aug[r][i]) > maxV) { maxV = Math.abs(aug[r][i]); maxR = r; }
    if (maxV < 1e-300) throw new Error('singular TPS system');
    [aug[i], aug[maxR]] = [aug[maxR], aug[i]];
    for (let r = i + 1; r < dim; r++) {
      const factor = aug[r][i] / aug[i][i];
      for (let c = i; c < dim + d; c++) aug[r][c] -= factor * aug[i][c];
    }
  }
  // back-substitute - fixed: solve each RHS column independently
  const x: number[][] = [];
  for (let i = 0; i < dim; i++) x.push(new Array(d).fill(0));
  for (let i = dim - 1; i >= 0; i--) {
    for (let k = 0; k < d; k++) {
      let sum = aug[i][dim + k]; // RHS for dimension k
      for (let j = i + 1; j < dim; j++) {
        sum -= aug[i][j] * x[j][k];
      }
      x[i][k] = sum / aug[i][i];
    }
  }
  return x;
}

/** Apply TPS coefficients to a new set of points. */
function _tpsWarp(
  points: number[][],
  source: number[][],
  x: number[][],
  m: number,
  d: number,
  kernel: (r: number) => number,
): number[][] {
  const n = source.length;
  const out: number[][] = [];
  for (const p of points) {
    const outPoint = new Array(d).fill(0);
    // Affine contribution (m parameters)
    for (let k = 0; k < d; k++) {
      let s = x[n][k]; // a0 (intercept)
      for (let dim = 0; dim < d; dim++) s += x[n + 1 + dim][k] * p[dim];
      outPoint[k] = s;
    }
    // Non-affine (kernel) contribution
    for (let i = 0; i < n; i++) {
      let sq = 0;
      for (let dim = 0; dim < d; dim++) {
        const dd = p[dim] - source[i][dim];
        sq += dd * dd;
      }
      const r = Math.sqrt(sq);
      const U = kernel(r);
      for (let k = 0; k < d; k++) outPoint[k] += U * x[i][k];
    }
    out.push(outPoint);
  }
  return out;
}
