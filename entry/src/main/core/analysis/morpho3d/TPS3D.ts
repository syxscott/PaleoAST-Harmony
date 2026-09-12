/**
 * 3D TPS �� replaces morpho3d/tps3d.py
 *
 * Thin-plate spline interpolation/deformation of 3D point sets.
 *
 * Kernel notes (see the Python source documentation):
 *   'thin_plate'  : U(r) = r          — standard 3D TPS kernel (the
 *                                     fundamental solution of the 3D
 *                                     Laplacian).  NOT r²·log(r), which is
 *                                     the 2D biharmonic kernel.
 *   'cubic'       : U(r) = r³         — 3D biharmonic (surface interpolation)
 *   'multiquadric': U(r) = √(r² + c²)
 *   'gaussian'    : U(r) = exp(−r²/2σ²)
 *
 * The fitted map is the ABSOLUTE coordinate field
 *     f(x) = a·[1, x, y, z] + Σᵢ wᵢ·U(‖x − pᵢ‖)   (per output dimension)
 * consistent with morphometrics/TPSAnalyzer — evaluating it yields target
 * coordinates, not displacements.
 */

export type TPS3DKernel = 'thin_plate' | 'cubic' | 'multiquadric' | 'gaussian';

export interface TPS3DResult {
  /** Kernel weights, dim-major layout: weights[dim][i] (3 × n). */
  weights: number[][];
  bendingEnergy: number;
  /** Affine coefficients flattened [a0..a3 | dim0, dim1, dim2] (12). */
  affineCoefs: number[];
  /** Kernel used for the fit (so results reproduce their own mapping). */
  kernel: TPS3DKernel;
  /** Source control points (n × 3). */
  sourcePoints: number[][];
  /** Target control points (n × 3). */
  targetPoints: number[][];
  /** Regularization λ added to the kernel diagonal during the fit. */
  regularization: number;
  /** Transform arbitrary points with the fitted spline. */
  transformPoints: (points: number[][]) => number[][];
}

export interface TPS3DFitOptions {
  /** Radial basis kernel (default 'thin_plate'). */
  kernel?: TPS3DKernel;
  /** Regularization λ added to the kernel matrix diagonal (default 0). */
  regularization?: number;
}

/** Radial basis value U(r) for the selected kernel. */
export function tps3dKernelValue(r: number, kernel: TPS3DKernel): number {
  if (r < 1e-10) return 0;
  switch (kernel) {
    case 'cubic': return r * r * r;
    case 'thin_plate': return r;
    case 'multiquadric': return Math.sqrt(r * r + 1.0);
    case 'gaussian': return Math.exp(-(r * r) / 2.0);
    default: return r;
  }
}

/** Gradient ∂U/∂x of the radial basis at distance vector r_vec (|rvec| = r). */
function _kernelGradient(rVec: number[], r: number, kernel: TPS3DKernel): number[] {
  if (r < 1e-10) return [0, 0, 0];
  const [dx, dy, dz] = rVec;
  switch (kernel) {
    case 'cubic': {
      // dU/dr = 3r² → grad = 3r · r_hat = 3·r_vec
      return [3 * dx, 3 * dy, 3 * dz];
    }
    case 'thin_plate': {
      // dU/dr = 1 → grad = r_hat
      return [dx / r, dy / r, dz / r];
    }
    case 'multiquadric': {
      const s = Math.sqrt(r * r + 1.0);
      return [dx / s, dy / s, dz / s];
    }
    case 'gaussian': {
      const g = Math.exp(-(r * r) / 2.0);
      return [-dx * g, -dy * g, -dz * g];
    }
    default: {
      return [3 * dx, 3 * dy, 3 * dz];
    }
  }
}

function _solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-300) continue;
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let k = col; k <= n; k++) aug[row][k] -= factor * aug[col][k];
    }
  }
  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i] !== 0 ? aug[i][i] : 1e-300;
  }
  return x;
}

/**
 * Fit a 3D TPS map between two point sets.
 *
 * Solves the constrained (regularized) system
 *     [K + λI   P] [w]   [Y]
 *     [Pᵀ       0] [a] = [0]
 * where K_ij = U(‖p_i − p_j‖) and P = [1, x, y, z].
 *
 * @param sourceLandmarks  source points (n × 3)
 * @param targetLandmarks  target points (n × 3, absolute coordinates)
 * @param options          kernel (default 'thin_plate') and regularization
 */
export function tps3dFit(
  sourceLandmarks: number[][],
  targetLandmarks: number[][],
  options: TPS3DFitOptions = {},
): TPS3DResult {
  const kernel: TPS3DKernel = options.kernel ?? 'thin_plate';
  const regularization = options.regularization ?? 0;
  const n = sourceLandmarks.length;
  // Kernel matrix with the selected 3D kernel
  // (the previous implementation hard-coded the 2D r²·log(r) kernel, which
  //  is not the standard 3D thin-plate kernel)
  const K: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) { K[i][j] = 0; continue; }
    const dx = sourceLandmarks[i][0] - sourceLandmarks[j][0];
    const dy = sourceLandmarks[i][1] - sourceLandmarks[j][1];
    const dz = sourceLandmarks[i][2] - sourceLandmarks[j][2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    K[i][j] = tps3dKernelValue(r, kernel);
  }
  if (regularization > 0) {
    for (let i = 0; i < n; i++) K[i][i] += regularization;
  }
  // Build augmented system: [K | P; P^T | 0] [w; a] = [Y; 0]
  const dim = n + 4;
  const aug: number[][] = Array.from({ length: dim }, (_, i) => new Array(dim).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) aug[i][j] = K[i][j];
  for (let i = 0; i < n; i++) {
    aug[i][n+0] = 1; aug[i][n+1] = sourceLandmarks[i][0];
    aug[i][n+2] = sourceLandmarks[i][1]; aug[i][n+3] = sourceLandmarks[i][2];
    aug[n+0][i] = 1; aug[n+1][i] = sourceLandmarks[i][0];
    aug[n+2][i] = sourceLandmarks[i][1]; aug[n+3][i] = sourceLandmarks[i][2];
  }
  // Target coordinates stacked as [Yx, Yy, Yz]
  const Yx = targetLandmarks.map(p => p[0]);
  const Yy = targetLandmarks.map(p => p[1]);
  const Yz = targetLandmarks.map(p => p[2]);
  const solveAug = (Y: number[]): number[] => {
    const b = [...Y, 0, 0, 0, 0];
    return _solveLinear(aug, b);
  };
  const wx = solveAug(Yx), wy = solveAug(Yy), wz = solveAug(Yz);
  const weights: number[][] = [[], [], []];
  for (let i = 0; i < n; i++) {
    weights[0].push(wx[i]); weights[1].push(wy[i]); weights[2].push(wz[i]);
  }
  const affineCoefs = [wx[n], wx[n+1], wx[n+2], wx[n+3], wy[n], wy[n+1], wy[n+2], wy[n+3], wz[n], wz[n+1], wz[n+2], wz[n+3]];
  // Bending energy = trace(W^T K W); with the −|r|/r convention K is the
  // bending-energy matrix, so the quadratic form is ≥ 0 for thin_plate.
  let be = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    be += (weights[0][i]*weights[0][j] + weights[1][i]*weights[1][j] + weights[2][i]*weights[2][j]) * K[i][j];
  }

  const result: TPS3DResult = {
    weights, bendingEnergy: be, affineCoefs,
    kernel,
    sourcePoints: sourceLandmarks.map(p => [p[0], p[1], p[2]]),
    targetPoints: targetLandmarks.map(p => [p[0], p[1], p[2]]),
    regularization,
    transformPoints: (points: number[][]) => tps3DDeformAll(points, sourceLandmarks, weights, affineCoefs, kernel),
  };
  return result;
}

/** Evaluate the fitted spline (absolute coordinates) at many points. */
function tps3DDeformAll(
  points: number[][],
  sourceLandmarks: number[][],
  weights: number[][],
  affineCoefs: number[],
  kernel: TPS3DKernel,
): number[][] {
  return points.map(p => tps3DDeform(p, sourceLandmarks, weights, affineCoefs, kernel));
}

/**
 * Evaluate the fitted 3D TPS at a single point.
 *
 * Semantics unified with TPSAnalyzer: the returned value is the ABSOLUTE
 * transformed coordinate
 *     f(x) = a·[1, x, y, z] + Σᵢ wᵢ·U(‖x − pᵢ‖)
 * (the previous implementation added the input point on top of the affine
 * + kernel sum, i.e. mixed a displacement field with an absolute field and
 * double-counted the identity part).
 *
 * @param point            query point [x, y, z]
 * @param sourceLandmarks  source control points (n × 3)
 * @param weights          dim-major weights from tps3dFit (3 × n)
 * @param affineCoefs      flattened affine coefficients (12)
 * @param kernel           kernel used in the fit (default thin_plate)
 */
export function tps3DDeform(
  point: number[],
  sourceLandmarks: number[][],
  weights: number[][],
  affineCoefs: number[],
  kernel: TPS3DKernel = 'thin_plate',
): number[] {
  const n = sourceLandmarks.length;
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < n; i++) {
    const d0 = point[0]-sourceLandmarks[i][0], d1 = point[1]-sourceLandmarks[i][1], d2 = point[2]-sourceLandmarks[i][2];
    const r = Math.sqrt(d0*d0 + d1*d1 + d2*d2);
    const U = tps3dKernelValue(r, kernel);
    dx += weights[0][i] * U;
    dy += weights[1][i] * U;
    dz += weights[2][i] * U;
  }
  // Affine part: [1, x, y, z] @ affine_coefs (absolute, not added to point)
  const ax = affineCoefs.slice(0, 4), ay = affineCoefs.slice(4, 8), az = affineCoefs.slice(8, 12);
  const fx = ax[0] + ax[1]*point[0] + ax[2]*point[1] + ax[3]*point[2] + dx;
  const fy = ay[0] + ay[1]*point[0] + ay[2]*point[1] + ay[3]*point[2] + dy;
  const fz = az[0] + az[1]*point[0] + az[2]*point[1] + az[3]*point[2] + dz;
  return [fx, fy, fz];
}

/**
 * Batch-transform points with a fitted TPS result
 * (port of tps3d.py::TPS3DResult.transform_points).
 */
export function transformPoints(result: TPS3DResult, points: number[][]): number[][] {
  return result.transformPoints(points);
}

/**
 * Create a regular 3D lattice over a box and deform it with the fitted
 * TPS (port of tps3d.py::TPS3D.create_deformation_grid).
 *
 * @param gridRange  [xmin, xmax, ymin, ymax, zmin, zmax]
 * @param resolution [nx, ny, nz]
 * @returns grid points (nx·ny·nz × 3) and displacement vectors
 *          f(x) − x (nx·ny·nz × 3)
 */
export function createDeformationGrid(
  result: TPS3DResult,
  gridRange: [number, number, number, number, number, number],
  resolution: [number, number, number],
): { gridPoints: number[][]; deformations: number[][] } {
  const [xmin, xmax, ymin, ymax, zmin, zmax] = gridRange;
  const [nx, ny, nz] = resolution;
  const gridPoints: number[][] = [];
  for (let i = 0; i < nx; i++) {
    const x = nx === 1 ? xmin : xmin + ((xmax - xmin) * i) / (nx - 1);
    for (let j = 0; j < ny; j++) {
      const y = ny === 1 ? ymin : ymin + ((ymax - ymin) * j) / (ny - 1);
      for (let k = 0; k < nz; k++) {
        const z = nz === 1 ? zmin : zmin + ((zmax - zmin) * k) / (nz - 1);
        gridPoints.push([x, y, z]);
      }
    }
  }
  const deformed = result.transformPoints(gridPoints);
  const deformations = deformed.map((p, i) => [p[0] - gridPoints[i][0], p[1] - gridPoints[i][1], p[2] - gridPoints[i][2]]);
  return { gridPoints, deformations };
}

/**
 * Jacobian matrices of the TPS map at the given points
 * (port of tps3d.py::TPS3D.compute_jacobian).
 *
 *     J(x) = A_linear + Σᵢ wᵢ ⊗ ∂U/∂x(pᵢ − x)
 *
 * with kernel-dependent ∂U/∂x (thin_plate: r̂; cubic: 3·r_vec;
 * multiquadric: r_vec/√(r²+1); gaussian: −r_vec·exp(−r²/2)).
 *
 * @returns (m, 3, 3) Jacobians, J[dim][coord]
 */
export function computeJacobian(result: TPS3DResult, points: number[][]): number[][][] {
  const src = result.sourcePoints;
  const jacobians: number[][][] = [];
  for (const p of points) {
    // J[k][j] = affine[k][j+1] + Σ_i weights[k][i] · ∂U_i/∂x_j
    const J: number[][] = [
      [result.affineCoefs[1], result.affineCoefs[2], result.affineCoefs[3]],
      [result.affineCoefs[5], result.affineCoefs[6], result.affineCoefs[7]],
      [result.affineCoefs[9], result.affineCoefs[10], result.affineCoefs[11]],
    ];
    for (let i = 0; i < src.length; i++) {
      const rVec = [p[0] - src[i][0], p[1] - src[i][1], p[2] - src[i][2]];
      const r = Math.sqrt(rVec[0] * rVec[0] + rVec[1] * rVec[1] + rVec[2] * rVec[2]);
      const gradU = _kernelGradient(rVec, r, result.kernel);
      for (let k = 0; k < 3; k++) {
        const w = result.weights[k][i];
        for (let j = 0; j < 3; j++) J[k][j] += w * gradU[j];
      }
    }
    jacobians.push(J);
  }
  return jacobians;
}

/**
 * One-shot 3D TPS interpolation convenience function
 * (port of tps3d.py::interpolate_tps3d).
 *
 * @param source       source points (n × 3)
 * @param target       target points (n × 3)
 * @param queryPoints  points to evaluate (m × 3)
 * @param kernel       kernel type ('thin_plate' is the standard 3D TPS)
 * @returns interpolated points (m × 3, absolute coordinates)
 */
export function interpolateTPS3D(
  source: number[][],
  target: number[][],
  queryPoints: number[][],
  kernel: TPS3DKernel = 'thin_plate',
): number[][] {
  const result = tps3dFit(source, target, { kernel });
  return result.transformPoints(queryPoints);
}

/**
 * Class wrapper mirroring morpho3d/tps3d.py::TPS3D.
 *
 *     const tps = new TPS3D({ kernel: 'thin_plate', regularization: 0 });
 *     tps.fit(source, target);
 *     tps.transform([[0.5, 0.5, 0.5]]);
 */
export class TPS3D {
  private _kernel: TPS3DKernel;
  private _regularization: number;
  private _result: TPS3DResult | null = null;

  constructor(options: TPS3DFitOptions = {}) {
    this._kernel = options.kernel ?? 'thin_plate';
    this._regularization = options.regularization ?? 0;
  }

  /** Fit the spline; returns this for chaining. */
  fit(source: number[][], target: number[][]): TPS3D {
    this._result = tps3dFit(source, target, { kernel: this._kernel, regularization: this._regularization });
    return this;
  }

  /** Fit and return a TPS3DResult snapshot (API parity with Python analyze). */
  analyze(source: number[][], target: number[][]): TPS3DResult {
    this.fit(source, target);
    return this._result as TPS3DResult;
  }

  /** Transform new points (absolute coordinates). */
  transform(points: number[][]): number[][] {
    if (!this._result) throw new Error('TPS not fitted, call fit() first');
    return this._result.transformPoints(points);
  }

  /** Deformed regular lattice — see {@link createDeformationGrid}. */
  createDeformationGrid(
    gridRange: [number, number, number, number, number, number],
    resolution: [number, number, number],
  ): { gridPoints: number[][]; deformations: number[][] } {
    if (!this._result) throw new Error('TPS not fitted, call fit() first');
    return createDeformationGrid(this._result, gridRange, resolution);
  }

  /** Jacobians at the given points — see {@link computeJacobian}. */
  computeJacobian(points: number[][]): number[][][] {
    if (!this._result) throw new Error('TPS not fitted');
    return computeJacobian(this._result, points);
  }

  /** 4×3 affine parameter block [a0..a3] per output dimension. */
  getAffineMatrix(): number[][] {
    if (!this._result) throw new Error('TPS not fitted');
    const a = this._result.affineCoefs;
    return [a.slice(0, 4), a.slice(4, 8), a.slice(8, 12)];
  }

  /** Kernel weights (n × 3, point-major). */
  getWeights(): number[][] {
    if (!this._result) throw new Error('TPS not fitted');
    const w = this._result.weights, n = w[0].length;
    const out: number[][] = [];
    for (let i = 0; i < n; i++) out.push([w[0][i], w[1][i], w[2][i]]);
    return out;
  }
}
