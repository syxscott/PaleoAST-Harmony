/**
 * Seeded pseudo-random number generation replacing numpy.random.
 *
 * ## Algorithm: Mulberry32
 * A fast, high-quality 32-bit PRNG suitable for scientific computing.
 * - Reference: David B. Lampton, "The Mulberry32 PRNG", 2017.
 *   https://github.com/skeeto/mulberry32 (public domain)
 * - Period: 2^64
 * - State: single 64-bit integer (the seed)
 *
 * This module replaces all internal `Math.random()` calls with the seeded
 * Mulberry32 generator, enabling fully reproducible scientific simulations.
 * Call `seed(n)` before any random operations to establish the state.
 */

let _state: number = 12345;

/**
 * Create a seeded RNG function using Mulberry32 algorithm.
 * Unlike the global seed()/rand() pair, this returns an independent RNG
 * instance that can be passed around and used concurrently.
 *
 * Ref: David B. Lampton (2017), "The Mulberry32 PRNG"
 */
export function createSeededRNG(seed: number): () => number {
  let s = (seed >>> 0) | 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0xFFFFFFFF;
  };
}

/** Seed the internal PRNG state. All subsequent calls to rand* functions
 * will produce deterministic sequences until seed() is called again. */
export function seed(s: number): void { _state = s >>> 0; }

/** Internal: advance the Mulberry32 state and return the next u32 value. */
function _next(): number {
  _state = (_state + 0x6D2B79F5) >>> 0;
  let z = _state;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0);
}

/** Internal: uniform [0, 1) as IEEE-754 double. */
function _float(): number { return _next() / 0xFFFFFFFF; }

/** Uniform [0, 1). */
export function rand(): number { return _float(); }

/** Uniform integer [lo, hi). */
export function randint(lo: number, hi: number): number {
  return lo + Math.floor(_float() * (hi - lo));
}

/** Array of n uniform [0,1). */
export function randArray(n: number): number[] {
  const d: number[] = [];
  for (let i = 0; i < n; i++) d.push(_float());
  return d;
}

/**
 * Standard normal via Box-Muller transform.
 * Ref: G.E.P. Box & M.E. Muller (1958), "A Note on the Generation of
 *      Random Normal Deviates".  Annals Math. Stat. 29:610-611.
 */
export function randn(): number {
  const u1 = _float() || 1e-10, u2 = _float();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Array of n standard normals. */
export function randnArray(n: number): number[] {
  const d: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const u1 = _float() || 1e-10, u2 = _float();
    const r = Math.sqrt(-2 * Math.log(u1));
    d.push(r * Math.cos(2 * Math.PI * u2));
    if (i + 1 < n) d.push(r * Math.sin(2 * Math.PI * u2));
  }
  return d.slice(0, n);
}

/** Permutation of [0, n). */
export function permutation(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(_float() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Shuffle array in-place. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(_float() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Random choice from array. */
export function choice<T>(arr: T[]): T {
  return arr[Math.floor(_float() * arr.length)];
}

/**
 * Poisson random number via Knuth's algorithm.
 * Ref: D.E. Knuth (1969), _Seminumerical Algorithms_ (TAOCP Vol 2), Sec 3.4.1.
 */
export function poisson(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= _float(); } while (p > L);
  return k - 1;
}
