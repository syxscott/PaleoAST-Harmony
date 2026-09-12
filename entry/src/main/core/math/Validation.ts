/**
 * Input validation utilities for math operations.
 * Ensures numerical stability by catching NaN/Inf early.
 */
import { Matrix } from './Matrix';

/**
 * Throws if v is not a finite number.
 * @param name - Variable name for error message
 * @param v - Value to check
 */
export function assertFinite(name: string, v: number): void {
  if (!Number.isFinite(v)) {
    throw new Error(`${name} must be finite, got ${v}`);
  }
}

/**
 * Throws if any element in the matrix is not finite.
 * @param name - Matrix name for error message
 * @param m - Matrix to validate
 */
export function assertFiniteMatrix(name: string, m: Matrix): void {
  for (let i = 0; i < m.length; i++) {
    if (!Number.isFinite(m.data[i])) {
      throw new Error(`${name}[${i}] is not finite: ${m.data[i]}`);
    }
  }
}

/**
 * Throws if the matrix is singular or near-singular, judged by the smallest
 * diagonal pivot after Gaussian elimination (partial pivoting), or — as a
 * cheap pre-check — by zero rows/columns.
 * @param m - Matrix to validate (square matrices only)
 * @param name - Operation name for error message
 * @param threshold - Pivot threshold relative to the matrix max magnitude
 */
export function assertNoSingular(m: Matrix, name: string = 'matrix', threshold: number = 1e-14): void {
  if (m.rows !== m.cols) {
    throw new Error(`${name}: singularity check requires a square matrix (${m.rows}×${m.cols})`);
  }
  const n = m.rows;
  // Scale-relative threshold: absolute 1e-14 is meaningless for large entries
  let maxAbs = 0;
  for (let i = 0; i < m.length; i++) maxAbs = Math.max(maxAbs, Math.abs(m.data[i]));
  if (maxAbs === 0) throw new Error(`${name}: matrix is all zeros (singular)`);
  const tol = threshold * maxAbs;

  // Working copy — Gaussian elimination with partial pivoting
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    aug.push(Array.from(m.data.subarray(i * n, (i + 1) * n)));
  }
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    if (Math.abs(aug[maxRow][col]) <= tol) {
      throw new Error(`${name}: matrix is singular or near-singular (pivot ${aug[maxRow][col]} at column ${col})`);
    }
    const pivotRow = aug[maxRow];
    aug[maxRow] = aug[col];
    aug[col] = pivotRow;
    const pivot = aug[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      if (factor === 0) continue;
      for (let j = col; j < n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
}
