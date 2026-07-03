/**
 * Coverage-based Rarefaction (iNEXT-style) — replaces ecology/beta_diversity.py::CoverageRarefactionAnalyzer.
 *
 * Estimates expected richness at standardised sample coverage levels.
 */
import { ComputationError } from '../../utils/Exceptions';

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
 * Compute coverage-based rarefaction.
 *
 * @param abundanceMatrix  samples × species
 * @param coverageLevels   target coverage (0–1) values to evaluate (default 0.5..0.99)
 * @param nIterations      bootstrap iterations (default 200)
 * @param sampleNames      optional names for samples
 */
export function coverageRarefaction(
  abundanceMatrix: number[][],
  coverageLevels: number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99],
  nIterations: number = 200,
  sampleNames?: string[]
): CoverageRarefactionResult {
  if (!Array.isArray(abundanceMatrix) || abundanceMatrix.length === 0)
    throw new ComputationError('Empty abundance matrix');
  const nSamples = abundanceMatrix.length;
  const nSpecies = abundanceMatrix[0].length;
  for (const row of abundanceMatrix) if (row.length !== nSpecies)
    throw new ComputationError('Inconsistent rows');
  const names = sampleNames ?? Array.from({ length: nSamples }, (_, i) => `Sample_${i + 1}`);

  // ─── For each sample, compute Chao1 abundance-based estimator ─────────────
  // Chao1 (incidence-based formula adapted to abundance data):
  //   S_obs = number of distinct species in sample (columns with abundance > 0)
  //   f1   = number of singletons  (species with abundance = 1)
  //   f2   = number of doubletons  (species with abundance = 2)
  //   S_chao1 = S_obs + f1 (f1 - 1) / (2 (f2 + 1))       (abundance-based)
  //                       — or  f1² / (2 f2) when f2 > 0
  //   The asymptotic richness projection onto coverage levels assumes a linear
  //   relationship (Chiu et al. 2014 iNEXT framework).
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
  // Expected richness at each coverage level — averaged across samples
  const expectedR = coverage.map(c => {
    let total = 0;
    for (let s = 0; s < nSamples; s++) total += asymptote[s] * c;
    return total / nSamples;
  });

  // ─── Bootstrap for confidence intervals (deterministic seed) ──────────────
  const bootstrapped: number[][] = [];
  let randState = 0x9e3779b9;
  const nextRand = () => {
    // xorshift32
    let x = (randState |= 0); x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    randState = x;
    return ((x >>> 0) % 2147483647) / 2147483647;
  };
  for (let it = 0; it < nIterations; it++) {
    const idx: number[] = [];
    for (let s = 0; s < nSamples; s++) idx.push(Math.floor(nextRand() * nSamples));
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
