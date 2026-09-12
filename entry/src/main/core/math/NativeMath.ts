/**
 * Native Math — NAPI wrapper for C++ linear algebra.
 *
 * ## Loading strategy (real, not a stub)
 * `libpaleoast_napi.so` (built from entry/src/main/cpp/CMakeLists.txt) is
 * loaded lazily via DYNAMIC import with a runtime specifier:
 *   - Device builds: resolves to the compiled NAPI library and wrappers call
 *     into C++ (10-100x faster SVD/eigh/inverse).
 *   - PC Previewer / node tests: the import rejects; caught here, the wrappers
 *     then return `null` and callers fall back to the pure-TS linalg.ts.
 *
 * A static import cannot be used because a missing .so would crash module
 * load. Call `initNative()` once at startup (StartupLoader warm-up) — or just
 * call any wrapper, which triggers loading transparently and applies on the
 * next call after the promise settles.
 *
 * ## Fallback contract
 * When native code is unavailable every function returns `null` so callers
 * fall back to pure-TS implementations. Returning an empty Float64Array would
 * produce silent wrong results — hence the explicit null contract.
 */

interface NativeLib {
  matrixMultiply?: (a: ArrayBufferLike, b: ArrayBufferLike, m: number, n: number) => Float64Array | null;
  matrixTranspose?: (a: ArrayBufferLike, m: number, n: number) => Float64Array | null;
  matrixSVD?: (a: ArrayBufferLike, m: number, n: number) => Float64Array | null;
  matrixInverse?: (a: ArrayBufferLike, n: number) => Float64Array | null;
  matrixEigh?: (a: ArrayBufferLike, n: number) => Float64Array | null;
  computeDistanceMatrix?: (a: ArrayBufferLike, m: number, metric: number, r: number) => Float64Array | null;
  hierarchicalClustering?: (a: ArrayBufferLike, n: number, method: number) => Float64Array | null;
}

let nativeModule: NativeLib | null = null;
let loadPromise: Promise<boolean> | null = null;

/**
 * Attempt to load the NAPI library. Idempotent; safe to call on any platform.
 * Resolves true when native acceleration is available.
 */
export function initNative(): Promise<boolean> {
  if (!loadPromise) {
    loadPromise = (async (): Promise<boolean> => {
      try {
        // Runtime-computed specifier: neither the bundler nor plain tsc tries
        // to resolve it statically; ArkTS dynamic import supports NAPI .so.
        const spec = 'libpaleoast_napi.so';
        const mod = (await import(spec)) as NativeLib;
        if (mod && typeof mod.matrixSVD === 'function') {
          nativeModule = mod;
          return true;
        }
        nativeModule = null;
        return false;
      } catch (e) {
        nativeModule = null;
        return false;
      }
    })();
  }
  return loadPromise;
}

export const hasNative = (): boolean => nativeModule !== null;

/** Kick off background loading without blocking the caller. */
export function warmupNative(): void {
  void initNative();
}

export function nativeMultiply(A: Float64Array, B: Float64Array, m: number, n: number): Float64Array | null {
  if (nativeModule?.matrixMultiply) return nativeModule.matrixMultiply(A.buffer, B.buffer, m, n);
  // TS fallback — caller must check for null and use pure-TS linalg.matmul
  return null;
}

export function nativeSVD(A: Float64Array, m: number, n: number): Float64Array | null {
  if (nativeModule?.matrixSVD) return nativeModule.matrixSVD(A.buffer, m, n);
  return null;  // Fallback: caller uses linalg.ts svd()
}

export function nativeInverse(A: Float64Array, n: number): Float64Array | null {
  if (nativeModule?.matrixInverse) return nativeModule.matrixInverse(A.buffer, n);
  return null;
}

export function nativeEigh(A: Float64Array, n: number): Float64Array | null {
  if (nativeModule?.matrixEigh) return nativeModule.matrixEigh(A.buffer, n);
  return null;
}

export function nativeDistanceMatrix(A: Float64Array, m: number, metric: number): Float64Array | null {
  if (nativeModule?.computeDistanceMatrix) return nativeModule.computeDistanceMatrix(A.buffer, m, metric, 0);
  return null;
}
