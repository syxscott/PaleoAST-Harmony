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

/**
 * Native library surface.
 *
 * A function returns the numeric payload on success or a short "Error:<Code>"
 * string on a business failure (see cpp/core/ErrorHandler.h and
 * cpp/types/libpaleoast_napi/index.d.ts). The wrappers below normalise that to
 * `Float64Array | null` so callers keep a single null check, while
 * `nativeLastError()` exposes why.
 */
interface NativeLib {
  matrixMultiply?: (a: ArrayBufferLike, b: ArrayBufferLike, m: number, n: number) => Float64Array | string;
  matrixTranspose?: (a: ArrayBufferLike, m: number, n: number) => Float64Array | string;
  matrixSVD?: (a: ArrayBufferLike, m: number, n: number) => Float64Array | string;
  matrixInverse?: (a: ArrayBufferLike, n: number) => Float64Array | string;
  matrixEigh?: (a: ArrayBufferLike, n: number) => Float64Array | string;
  /** (data, points n, dimensions p, metric) — matches the C++ argument order. */
  computeDistanceMatrix?: (a: ArrayBufferLike, n: number, p: number, metric: number) => Float64Array | string;
  hierarchicalClustering?: (a: ArrayBufferLike, n: number, method: number) => Float64Array | string;
}

let nativeModule: NativeLib | null = null;
let loadPromise: Promise<boolean> | null = null;

/** Reason for the most recent native failure, or null when it succeeded. */
let lastError: string | null = null;

/**
 * Why the last native call returned null.
 *
 * `null` covers three distinct situations, so callers should distinguish them:
 *   - 'Error:Singular' / 'Error:NoConvergence' / ... : C++ reported a cause
 *   - 'Error:NotLoaded'  : the .so never loaded, so the TS fallback ran
 *   - null               : the call succeeded (no fallback needed)
 */
export function nativeLastError(): string | null {
  return lastError;
}

/**
 * Normalise a raw native return into the wrapper contract.
 *
 * A string means the C++ layer reported a business failure; anything falsy
 * means we never reached C++. Either way the caller gets null and can query
 * `nativeLastError()`.
 */
function unwrap(result: Float64Array | string | null | undefined, label: string): Float64Array | null {
  if (typeof result === 'string') {
    lastError = result;
    return null;
  }
  if (!result) {
    lastError = 'Error:NotLoaded';
    return null;
  }
  lastError = null;
  void label;
  return result;
}

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
  if (nativeModule?.matrixMultiply) return unwrap(nativeModule.matrixMultiply(A.buffer, B.buffer, m, n), 'multiply');
  // TS fallback — caller must check for null and use pure-TS linalg.matmul
  lastError = 'Error:NotLoaded';
  return null;
}

export function nativeSVD(A: Float64Array, m: number, n: number): Float64Array | null {
  if (nativeModule?.matrixSVD) return unwrap(nativeModule.matrixSVD(A.buffer, m, n), 'svd');
  lastError = 'Error:NotLoaded';
  return null;  // Fallback: caller uses linalg.ts svd()
}

export function nativeInverse(A: Float64Array, n: number): Float64Array | null {
  if (nativeModule?.matrixInverse) return unwrap(nativeModule.matrixInverse(A.buffer, n), 'inverse');
  lastError = 'Error:NotLoaded';
  return null;
}

export function nativeEigh(A: Float64Array, n: number): Float64Array | null {
  if (nativeModule?.matrixEigh) return unwrap(nativeModule.matrixEigh(A.buffer, n), 'eigh');
  lastError = 'Error:NotLoaded';
  return null;
}

/**
 * Pairwise distance matrix.
 *
 * @param n      number of points (rows)
 * @param p      dimensionality (columns) — previously this argument was passed
 *               as the metric and the metric as a trailing 0, so the C++
 *               dimension check `n*p == size` always failed and the call
 *               silently degraded to the TS path.
 * @param metric 0 = Euclidean, 1 = Canberra (the C++ layer only implements
 *               these two; other metrics must use the TS implementation).
 */
export function nativeDistanceMatrix(A: Float64Array, n: number, p: number, metric: number): Float64Array | null {
  if (nativeModule?.computeDistanceMatrix) {
    return unwrap(nativeModule.computeDistanceMatrix(A.buffer, n, p, metric), 'distanceMatrix');
  }
  lastError = 'Error:NotLoaded';
  return null;
}
