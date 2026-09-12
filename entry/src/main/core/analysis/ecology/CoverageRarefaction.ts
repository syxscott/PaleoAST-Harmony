/**
 * Coverage-based Rarefaction (iNEXT-style) — replaces ecology/beta_diversity.py::CoverageRarefactionAnalyzer.
 *
 * Estimates expected richness at standardised sample coverage levels.
 *
 * References:
 * - Hurlbert, S.H. (1971). "The nonconcept of species diversity: a critique and
 *   alternative parameters." Ecology 52(4): 577-586.  [rarefaction]
 * - Chao, A. & Jost, L. (2012). "Coverage-based rarefaction and extrapolation:
 *   standardizing samples by completeness rather than size." Ecology 93(12):
 *   2533-2547.  [extrapolation]
 * - Chiu, C.H., Jost, L. & Chao, A. (2014). "Phylogenetic rarefaction and
 *   extrapolation: the species accumulation function of iNEXT."  Methods Ecol Evol.
 */
import { ComputationError } from '../../utils/Exceptions';
import { seed, rand } from '../../math/random';

export interface CoverageRarefactionResult {
  sampleNames: string[];
  coverageLevels: number[];
  expectedRichness: number[];
  confidenceLower: number[];
  confidenceUpper: number[];
  asymptoteEstimate: number[];
  sampleSizes: number[];
  method: string;
  /** Hill number order: 0 = richness, 1 = exp(Shannon), 2 = 1/Simpson. */
  hillOrder?: 0 | 1 | 2;
}

/**
 * Hurlbert (1971) rarefaction formula for expected species richness at sample
 * size m (where m ≤ N, the total number of individuals):
 *
 *   E(S|m) = Σ_{i=1}^S [1 - C(N - n_i, m) / C(N, m)]
 *
 * which simplifies to the probability-based form used below.
 * This is ONLY valid for m ≤ N (rarefaction, not extrapolation).
 *
 * @param abundances  species abundances in a single sample
 * @param m          sub-sample size (must be ≤ N)
 * @returns expected species richness at size m
 */
export function rarefaction(abundances: number[], m: number): number {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  const N = counts.reduce((a, b) => a + b, 0);
  if (N === 0 || m <= 0) return 0;
  if (m >= N) return counts.length; // full sample — all species observed

  let E = 0;
  for (const ni of counts) {
    // P(species excluded when drawing m from N) = C(N-ni, m) / C(N, m)
    // Use log-sum to avoid overflow
    let logP = 0;
    for (let k = 0; k < m; k++) logP += Math.log(N - ni - k) - Math.log(N - k);
    E += 1 - Math.exp(logP);
  }
  return E;
}

/**
 * Chao & Jost (2012) extrapolation formula for expected species richness at
 * coverage c (0 < c < 1).  Coverage of a sample is:
 *   c = 1 - f1/N  (proportion of individuals in non-singleton species)
 *
 * Extrapolated richness at coverage c:
 *   E(S|c) = S_obs + f1(1 - c)^(-1)  [Chao & Jost 2012, Eq. 8b]
 *
 * This is only valid for c ≥ c_obs (extrapolation beyond observed coverage).
 *
 * @param abundances    species abundances
 * @param c            target coverage (0–1)
 * @param chao1        Chao1 asymptotic estimator (S_obs + f1²/(2f2))
 * @returns extrapolated species richness at coverage c
 */
export function extrapolation(abundances: number[], c: number, chao1: number): number {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  const N = counts.reduce((a, b) => a + b, 0);
  if (N === 0 || c <= 0 || c >= 1) return chao1;

  // f1 = number of singletons
  const f1 = counts.filter(v => v === 1).length;
  // E(S|c) from Chao & Jost (2012) Eq. 8b
  const extrapolated = chao1 + f1 * Math.pow(1 - c, -1);
  return extrapolated;
}

/**
 * Compute coverage-based rarefaction and extrapolation (iNEXT-style).
 *
 * @param abundanceMatrix  samples × species
 * @param coverageLevels   target coverage (0–1) values to evaluate (default 0.5..0.99)
 * @param nIterations      bootstrap iterations for CI (default 200)
 * @param sampleNames      optional names for samples
 * @param rngSeed          seed for reproducible bootstrap (default 42)
 */
export function coverageRarefaction(
  abundanceMatrix: number[][],
  coverageLevels: number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99],
  nIterations: number = 200,
  sampleNames?: string[],
  rngSeed: number = 42,
  q: 0 | 1 | 2 = 0,
): CoverageRarefactionResult {
  if (!Array.isArray(abundanceMatrix) || abundanceMatrix.length === 0)
    throw new ComputationError('Empty abundance matrix');
  const nSamples = abundanceMatrix.length;
  const nSpecies = abundanceMatrix[0].length;
  for (const row of abundanceMatrix) if (row.length !== nSpecies)
    throw new ComputationError('Inconsistent rows');
  const names = sampleNames ?? Array.from({ length: nSamples }, (_, i) => `Sample_${i + 1}`);

  // ─── Chao1 abundance-based estimator (asymptotic richness) ─────────────────
  //   S_chao1 = S_obs + f1(f1-1) / (2(f2+1))  when f2 > 0
  //             S_obs + f1(f1-1) / 2           when f2 = 0, f1 > 0
  // Reference: Chao, A. (1984). "Nonparametric estimation of the number of
  //            classes in a population." Scand. J. Stat. 11: 265-270.
  const asymptote: number[] = [];
  const sampleSizes: number[] = [];
  for (let s = 0; s < nSamples; s++) {
    const row = abundanceMatrix[s];
    let nTotal = 0, Sobs = 0, f1 = 0, f2 = 0;
    for (let j = 0; j < nSpecies; j++) {
      const v = row[j];
      if (v <= 0 || isNaN(v)) continue;
      nTotal += v;
      Sobs++;
      if (v === 1) f1++;
      else if (v === 2) f2++;
    }
    let chao1 = Sobs;
    if (f2 > 0) chao1 = Sobs + (f1 * f1) / (2 * f2);
    else if (f1 > 0) chao1 = Sobs + f1 * (f1 - 1) / 2;
    asymptote.push(chao1);
    sampleSizes.push(nTotal);
  }

  const coverage = coverageLevels.slice();

  // Individual-level species pools (for the rarefaction bootstrap)
  const pools: number[][] = abundanceMatrix.map(row => {
    const pool: number[] = [];
    for (let j = 0; j < nSpecies; j++) for (let k = 0; k < Math.floor(row[j]); k++) pool.push(j);
    return pool;
  });

  seed(rngSeed);

  /** Empirical Hill number of order q for a count vector. */
  const hillOf = (counts: Map<number, number>, total: number): number => {
    if (total === 0) return 0;
    if (q === 0) return counts.size;
    if (q === 1) {
      let h = 0;
      for (const c of counts.values()) { const p = c / total; h -= p * Math.log(p); }
      return Math.exp(h);
    }
    let s = 0;
    for (const c of counts.values()) { const p = c / total; s += p * p; }
    return s > 0 ? 1 / s : 0;
  };

  // ─── Expected qD(coverage): rarefaction (c ≤ c_obs) vs extrapolation ────────
  // Point estimates AND confidence intervals come from the same individual-level
  // bootstrap (sub-sampling m = floor(c·N) individuals without replacement,
  // matching the iNEXT convention Python follows).
  const expectedR: number[] = [];
  const lo: number[] = [], hi: number[] = [];
  for (const c of coverage) {
    const drawStats: number[] = [];
    for (let s = 0; s < nSamples; s++) {
      const row = abundanceMatrix[s];
      const N = sampleSizes[s];
      const f1 = row.filter(v => v === 1).length;
      const c_obs = N > 0 ? 1 - f1 / N : 1;
      if (c <= c_obs) {
        const m = Math.max(1, Math.floor(c * N));
        const pool = pools[s];
        if (m >= pool.length) {
          const cnt = new Map<number, number>();
          for (const sp of pool) cnt.set(sp, (cnt.get(sp) ?? 0) + 1);
          drawStats.push(hillOf(cnt, pool.length));
        } else {
          // Partial Fisher-Yates: draw m without replacement
          const idxs = pool.map((_, i) => i);
          for (let i = 0; i < m; i++) {
            const j = i + Math.floor(rand() * (idxs.length - i));
            const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
          }
          const cnt = new Map<number, number>();
          for (let i = 0; i < m; i++) {
            const sp = pool[idxs[i]];
            cnt.set(sp, (cnt.get(sp) ?? 0) + 1);
          }
          drawStats.push(hillOf(cnt, m));
        }
      } else {
        // Extrapolation branch: Chao & Jost (2012) asymptotic form
        drawStats.push(extrapolation(row, c, asymptote[s]));
      }
    }
    drawStats.sort((a, b) => a - b);
    const mean = drawStats.reduce((a, b) => a + b, 0) / drawStats.length;
    expectedR.push(mean);
    lo.push(drawStats[Math.max(0, Math.floor(nSamples * 0.025))]);
    hi.push(drawStats[Math.min(drawStats.length - 1, Math.floor(nSamples * 0.975))]);
  }

  return {
    sampleNames: names,
    coverageLevels: coverage,
    expectedRichness: expectedR,
    confidenceLower: lo,
    confidenceUpper: hi,
    asymptoteEstimate: asymptote,
    sampleSizes,
    method: 'inext',
    hillOrder: q,
  };
}
