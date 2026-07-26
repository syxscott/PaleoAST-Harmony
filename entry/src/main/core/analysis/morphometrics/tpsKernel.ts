/**
 * Shared TPS (Thin-Plate Spline) kernel functions.
 *
 * References:
 * - Bookstein, F.L. (1989). "Principal warps: thin-plate splines and the
 *   decomposition of deformations." IEEE TPAMI 11(6): 567-585.
 * - Bookstein, F.L. (1991). "Morphometric Tools for Landmark Data."
 * - Rohlf, F.J. & Slice, D. (1990). "Extensions of the Procrustes method
 *   for the optimal superimposition of landmarks." Syst. Zool. 39: 40-59.
 *
 * Kernel functions:
 *   2D: K(r) = r² log(r)   (Bookstein 1989, Eq. 3)
 *   3D: K(r) = -|r|        (Bookstein 1991, linearized bending energy)
 */

import { Matrix } from '../../math/Matrix';

/** 2D TPS kernel: K(r) = r² log(r), r > 0; K(0) = 0 */
export function tpsKernel2D(r: number): number {
  if (r <= 0) return 0;
  return r * r * Math.log(r);
}

/** 3D TPS kernel: K(r) = -|r|, r > 0; K(0) = 0 */
export function tpsKernel3D(r: number): number {
  if (r <= 0) return 0;
  return -Math.abs(r);
}

/**
 * Build the TPS kernel matrix K_ij = U(||s_i - s_j||).
 * @param source  landmarks (n × d)
 * @param dim     2 for 2D, 3 for 3D
 */
export function buildKernelMatrix(source: number[][], dim: 2 | 3): Matrix {
  const n = source.length;
  const K = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { K.set(i, j, 0); continue; }
      let r2 = 0;
      for (let d = 0; d < dim; d++) {
        const diff = source[i][d] - source[j][d];
        r2 += diff * diff;
      }
      const r = Math.sqrt(r2);
      K.set(i, j, tpsKernel2D(r));
    }
  }
  return K;
}

/**
 * Build the 3D TPS kernel matrix.
 * Uses K(r) = -|r| per Bookstein (1991).
 */
export function buildKernelMatrix3D(source: number[][]): Matrix {
  const n = source.length;
  const K = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { K.set(i, j, 0); continue; }
      const dx = source[i][0] - source[j][0];
      const dy = source[i][1] - source[j][1];
      const dz = source[i][2] - source[j][2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      K.set(i, j, tpsKernel3D(r));
    }
  }
  return K;
}

/**
 * Compute bending energy: E = w^T K w.
 * @param K     kernel matrix (n × n)
 * @param weights  TPS non-affine weights (n × d)
 * @param dim   dimensionality
 */
export function bendingEnergy(K: Matrix, weights: number[][], dim: number): number {
  const n = K.rows;
  let E = 0;
  for (let c = 0; c < dim; c++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += K.get(i, j) * weights[j][c];
      E += weights[i][c] * s;
    }
  }
  return E;
}
