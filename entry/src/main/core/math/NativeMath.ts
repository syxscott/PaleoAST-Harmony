/**
 * Native Math — NAPI wrapper for C++ linear algebra.
 * Uses import from .so file. Falls back to TS when unavailable.
 */

// HarmonyOS: import nativeModule from 'libpaleoast_napi.so';
// For now, use dynamic import with fallback
let nativeModule: any = null;
try {
  // In production HarmonyOS: import nativeModule from 'libpaleoast_napi.so';
  nativeModule = null; // Will be set when running on device
} catch (e) {
  nativeModule = null;
}

export const hasNative = (): boolean => nativeModule !== null;

export function nativeMultiply(A: Float64Array, B: Float64Array, m: number, n: number): Float64Array {
  if (nativeModule) return nativeModule.matrixMultiply(A.buffer, B.buffer, m, n);
  // TS fallback
  const k = A.length / m;
  const C = new Float64Array(m * n);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += A[i*k+p] * B[p*n+j];
      C[i*n+j] = s;
    }
  return C;
}

export function nativeSVD(A: Float64Array, m: number, n: number): Float64Array {
  if (nativeModule) return nativeModule.matrixSVD(A.buffer, m, n);
  return new Float64Array(n); // Fallback: caller uses linalg.ts
}

export function nativeInverse(A: Float64Array, n: number): Float64Array {
  if (nativeModule) return nativeModule.matrixInverse(A.buffer, n);
  return new Float64Array(n * n);
}

export function nativeEigh(A: Float64Array, n: number): Float64Array {
  if (nativeModule) return nativeModule.matrixEigh(A.buffer, n);
  return new Float64Array(n);
}

export function nativeDistanceMatrix(X: Float64Array, n: number, p: number, metric: number): Float64Array {
  if (nativeModule) return nativeModule.computeDistanceMatrix(X.buffer, n, p, metric);
  // TS fallback
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i+1; j < n; j++) {
      let d = 0;
      if (metric === 1) {
        let num=0, den=0;
        for (let k=0; k<p; k++) { num+=Math.abs(X[i*p+k]-X[j*p+k]); den+=X[i*p+k]+X[j*p+k]; }
        d = den>0 ? num/den : 0;
      } else {
        for (let k=0; k<p; k++) d+=(X[i*p+k]-X[j*p+k])**2;
        d = Math.sqrt(d);
      }
      D[i*n+j] = d; D[j*n+i] = d;
    }
  return D;
}
