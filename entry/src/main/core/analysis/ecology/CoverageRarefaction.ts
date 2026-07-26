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
  rngSeed: number = 42
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

  // ─── Expected richness: separate rarefaction (Hurlbert) from extrapolation ──
  // (Chao-Jost).  For each sample we pick the appropriate formula based on
  // whether the target coverage is below or above the observed coverage.
  const expectedR = coverage.map(c => {
    let total = 0;
    for (let s = 0; s < nSamples; s++) {
      const row = abundanceMatrix[s];
      const D = asymptote[s];
      const N = sampleSizes[s];
      // Compute observed coverage: c_obs = 1 - f1/N
      const f1 = row.filter(v => v === 1).length;
      const c_obs = N > 0 ? 1 - f1 / N : 1;
      if (c <= c_obs) {
        // Rarefaction: Hurlbert (1971) formula E(S|m)
        // Map coverage c to sub-sample size m using m = floor(c * N)
        const m = Math.max(1, Math.floor(c * N));
        total += rarefaction(row, m);
      } else {
        // Extrapolation: Chao & Jost (2012) Eq. 8b
        total += extrapolation(row, c, D);
      }
    }
    return total / nSamples;
  });

  // ─── Bootstrap for confidence intervals (seeded RNG) ─────────────────────
  const bootstrapped: number[][] = [];
  seed(rngSeed);
  for (let it = 0; it < nIterations; it++) {
    const idx: number[] = [];
    for (let s = 0; s < nSamples; s++) idx.push(Math.floor(rand() * nSamples));
    const bootR = coverage.map(c => {
      let total = 0;
      for (const s of idx) total += asymptote[s] * c;
      return total / Math.max(1, idx.length);
    });
    bootstrapped.push(bootR);
  }
  const lo: number[] = [], hi: number[] = [];
  for (let j = 0; j < coverage.length; j++) {
    const col = bootstrapped.map(b => b[j]).sort((a, b) => a - b);
    lo.push(col[Math.floor(nIterations * 0.025)]);
    hi.push(col[Math.floor(nIterations * 0.975)]);
  }

  return {
    sampleNames: names,
    coverageLevels: coverage,
    expectedRichness: expectedR,
    confidenceLower: lo,
    confidenceUpper: hi,
    asymptoteEstimate: asymptote,
    sampleSizes,
    method: 'inext'
  };
}
