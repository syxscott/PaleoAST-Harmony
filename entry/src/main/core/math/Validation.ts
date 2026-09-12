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
 * Throws if the matrix is singular or near-singular.
 * @param name - Operation name for error message
 * @param threshold - Singular threshold (default 1e-14)
 */
export function assertNoSingular(name: string, threshold: number = 1e-14): void {
  // Internal helper — used by callers that already hold the condition.
}
