/**
 * Random number generation replacing numpy.random.
 */

let _seed: number | undefined;

export function seed(s: number): void { _seed = s; }

/** Uniform [0, 1). */
export function rand(): number { return Math.random(); }

/** Uniform integer [lo, hi). */
export function randint(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo));
}

/** Array of n uniform [0,1). */
export function randArray(n: number): number[] {
  const d: number[] = [];
  for (let i = 0; i < n; i++) d.push(Math.random());
  return d;
}

/** Standard normal via Box-Muller. */
export function randn(): number {
  const u1 = Math.random() || 1e-10, u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Array of n standard normals. */
export function randnArray(n: number): number[] {
  const d: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.random() || 1e-10, u2 = Math.random();
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
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Shuffle array in-place. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Random choice from array. */
export function choice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Poisson random number. */
export function poisson(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}
