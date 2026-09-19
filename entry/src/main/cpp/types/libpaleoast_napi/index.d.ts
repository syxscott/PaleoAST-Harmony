/**
 * Type surface for libpaleoast_napi.so (entry/src/main/cpp).
 *
 * HOW THIS FILE IS USED
 * HarmonyOS resolves a NAPI library through the module's package manifest, not
 * by scanning the .so: `entry/oh-package.json5` must declare
 *   "libpaleoast_napi.so": "file:./src/main/cpp/types/libpaleoast_napi"
 * and this directory must provide the declaration below plus the package
 * descriptor next to it. Without both, `import('libpaleoast_napi.so')` cannot
 * be resolved and the native layer silently never loads
 * (core/math/NativeMath.ts -> initNative() would return false forever).
 *
 * RETURN CONTRACT
 * Every function returns the numeric payload as an ArrayBuffer on success, or a
 * short "Error:<Code>" string on a BUSINESS failure. Codes come from
 * cpp/core/ErrorHandler.h:
 *   Error:DivByZero  Error:Domain  Error:NotSquare  Error:DimMismatch
 *   Error:Singular   Error:NoConvergence  Error:NotSymmetric
 *   Error:BadArgument  Error:Unknown
 * `NativeMath.ts` converts the string into `null` + a queryable reason, so
 * callers keep the plain null check while the UI can show why.
 *
 * COVERAGE NOTE (read before wiring these into analysis code)
 * `matrixSVD` returns SINGULAR VALUES ONLY and `matrixEigh` returns
 * EIGENVALUES ONLY — neither returns vectors. The pure-TS `linalg.svd` / `eigh`
 * return U/S/Vt and eigenvalues+eigenvectors respectively, so the native
 * functions are NOT drop-in replacements and nothing in the analysis path calls
 * them yet. Verify the C++ results against the (already fixed) TS
 * implementations before switching any caller over.
 */

/** Matrix multiply: A (m×k) · B (k×n) → C (m×n). k is inferred as A.length/m. */
export const matrixMultiply: (a: ArrayBuffer, b: ArrayBuffer, m: number, n: number) => ArrayBuffer | string;

/** Matrix transpose: A (r×c) → Aᵀ (c×r). */
export const matrixTranspose: (a: ArrayBuffer, r: number, c: number) => ArrayBuffer | string;

/** Singular values of A (m×n), sorted descending. Values only — no U/Vt. */
export const matrixSVD: (a: ArrayBuffer, m: number, n: number) => ArrayBuffer | string;

/** Inverse of a square matrix (Gauss-Jordan, partial pivoting). */
export const matrixInverse: (a: ArrayBuffer, n: number) => ArrayBuffer | string;

/** Eigenvalues of a symmetric n×n matrix, sorted descending. Values only. */
export const matrixEigh: (a: ArrayBuffer, n: number) => ArrayBuffer | string;

/**
 * Pairwise distances for n points in p dimensions.
 * @param metric 0 = Euclidean, 1 = Canberra
 * @returns n×n symmetric matrix with a zero diagonal
 */
export const computeDistanceMatrix: (a: ArrayBuffer, n: number, p: number, metric: number) => ArrayBuffer | string;

/**
 * Agglomerative hierarchical clustering on a precomputed n×n distance matrix.
 * @param method 0 = average (UPGMA), 1 = complete, 2 = single, 3 = Ward.D2
 * @returns (n-1)×4 flattened linkage matrix: [left, right, distance, newSize]
 */
export const hierarchicalClustering: (a: ArrayBuffer, n: number, method: number) => ArrayBuffer | string;
