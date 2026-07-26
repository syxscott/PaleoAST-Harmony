/**
 * Native Math — NAPI wrapper for C++ linear algebra.
 *
 * Static import pattern (recommended by HarmonyOS):
 *   On device: import nativeModule from 'libpaleoast_napi.so';
 *   On PC preview: create src/mock/libpaleoast_napi.so.ts returning null,
 *   configure build-profile.json5 mock switch.
 *
 * hasNative() allows graceful TS fallback when native module is unavailable.
 *
 * ## Fallback strategy
 * When the native module is absent (PC preview / testing), all functions
 * return `null` so that the caller knows to fall back to the pure-TS
 * implementation in linalg.ts.  Returning an empty Float64Array would hide
 * this and produce silent wrong results — hence the explicit null contract.
 */

// Device mode (uncomment on real device):
// import nativeModule from 'libpaleoast_napi.so';
// PC preview mode:
const nativeModule: any = null;

export const hasNative = (): boolean => nativeModule !== null;

export function nativeMultiply(A: Float64Array, B: Float64Array, m: number, n: number): Float64Array | null {
  if (nativeModule) return nativeModule.matrixMultiply(A.buffer, B.buffer, m, n);
  // TS fallback — caller must check for null and use pure-TS linalg.matmul
  return null;
}

export function nativeSVD(A: Float64Array, m: number, n: number): Float64Array | null {
  if (nativeModule) return nativeModule.matrixSVD(A.buffer, m, n);
  return null;  // Fallback: caller uses linalg.ts svd()
}

export function nativeInverse(A: Float64Array, n: number): Float64Array | null {
  if (nativeModule) return nativeModule.matrixInverse(A.buffer, n);
  return null;  // Fallback: caller uses linalg.ts inv()
}

export function nativeEigh(A: Float64Array, n: number): Float64Array | null {
  if (nativeModule) return nativeModule.matrixEigh(A.buffer, n);
  return null;  // Fallback: caller uses linalg.ts eigh()
}

export function nativeDistanceMatrix(X: Float64Array, n: number, p: number, metric: number): Float64Array | null {
  if (nativeModule) return nativeModule.computeDistanceMatrix(X.buffer, n, p, metric);
  // TS fallback — caller checks null
  return null;
}
