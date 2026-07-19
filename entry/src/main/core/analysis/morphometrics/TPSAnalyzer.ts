/**
 * Thin-Plate Spline analysis — replaces morphometrics/tps.py::TPSAnalyzer.
 *
 * Bookstein's constrained formulation:
 *     [K  P] [w]   [target]
 *     [P^T 0] [a] = [0   ]
 *
 * Kernel U(r) = r² log(r).
 * Bending energy: E = w^T K w.
 */
import { MorphometricsError } from '../../utils/Exceptions';

export interface TPSResult {
  source: number[][];
  target: number[][];
  affine: number[][];       // affine coefficients (n_affine × n_dims)
  nonAffine: number[][];   // non-affine weights (n_landmarks × n_dims)
  fullCoefficients: number[][]; // w then a stacked (n_landmarks + n_affine) × n_dims
  bendingEnergy: number;
  /** Apply the TPS to arbitrary points. */
  warpPoints: (points: number[][]) => number[][];
}

/**
 * Fit TPS deformation between source and target landmarks.
 *
 * @param source  (n_landmarks × n_dims) reference configuration
 * @param target  same shape, the deformed target
 */
export function tpsAnalyze(source: number[][], target: number[][]): TPSResult {
  if (source.length !== target.length) throw new MorphometricsError('Same number of source/target landmarks');
  const n = source.length;
  const d = source[0].length;
  if (d !== 2 && d !== 3) throw new MorphometricsError('TPS requires 2D or 3D');
  for (let i = 1; i < n; i++) {
    if (source[i].length !== d || target[i].length !== d) throw new MorphometricsError('Inconsistent dimensions');
  }

  // Build kernel matrix K (n × n) with K_ij = U(||s_i - s_j||),  U(r) = r² log r
  const K = _buildKernel(source);

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
    warpPoints: (points: number[][]) => _tpsWarp(points, source, x, m, d)
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
  return { warpedPoints: grid, grid: xs.map((r, i) => r.map((_, j) => [r[j], ys[i][j]])) };
}

function _buildKernel(src: number[][]): number[][] {
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
      row.push(r === 0 ? 0 : r * r * Math.log(r));
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
function _tpsWarp(points: number[][], source: number[][], x: number[][], m: number, d: number): number[][] {
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
      const U = r === 0 ? 0 : r * r * Math.log(r);
      for (let k = 0; k < d; k++) outPoint[k] += U * x[i][k];
    }
    out.push(outPoint);
  }
  return out;
}
