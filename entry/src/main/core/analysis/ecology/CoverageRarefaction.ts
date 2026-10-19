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
    // A species with ni > N − m can never be missed by a sub-sample of m
    // individuals (C(N − ni, m) is 0 there). Without this guard the log-sum
    // below evaluates log(N − ni − k) on a negative argument and returns
    // NaN — the same protection computeRarefaction in ecology.ts carries.
    if (N - ni < m) { E += 1; continue; }
    // P(species excluded when drawing m from N) = C(N-ni, m) / C(N, m)
    // Use log-sum to avoid overflow
    let logP = 0;
    for (let k = 0; k < m; k++) logP += Math.log(N - ni - k) - Math.log(N - k);
    E += 1 - Math.exp(logP);
  }
  return E;
}

/**
 * Expected species richness at coverage c, extrapolated from the observed
 * sample (Chao & Jost 2012, coverage-based extrapolation).
 *
 * The estimator saturates at the Chao1 asymptote. The estimated pool of
 * undetected species is f̂₀ = Ŝ_Chao1 − S_obs, and only the fraction of the
 * coverage gap that is actually closed — (c − c_obs)/(1 − c_obs) — is filled in:
 *
 *     S(c) = S_obs + f̂₀ · (c − c_obs) / (1 − c_obs)
 *
 * Boundary behaviour (all enforced below):
 *   c = c_obs → S_obs        (nothing to extrapolate)
 *   c → 1     → Ŝ_Chao1      (finite asymptote)
 *   monotone non-decreasing in c, clamped to [S_obs, Ŝ_Chao1]
 *
 * The previous implementation returned `chao1 + f1/(1 − c)`, which both
 * double-counted f1 (the Chao1 asymptote already contains it) and DIVERGED as
 * c → 1 — at c = 0.99 with f1 = 5 it inflated richness by 500 species, and
 * species richness is bounded. f1 is still the driver of how much extra
 * richness is reachable, but through c_obs and f̂₀ rather than directly.
 *
 * @param abundances    species abundances (observed sample)
 * @param c             target coverage (0–1)
 * @param chao1         Chao1 asymptote S_obs + f1²/(2f2) (or S_obs + f1(f1−1)/2)
 * @returns extrapolated species richness at coverage c
 */
export function extrapolation(abundances: number[], c: number, chao1: number): number {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  const N = counts.reduce((a, b) => a + b, 0);
  const Sobs = counts.length;

  if (N === 0) return chao1;
  if (c >= 1) return chao1;

  // f1 = number of singletons → observed sample coverage c_obs = 1 − f1/N
  const f1 = counts.filter(v => v === 1).length;
  const cObs = 1 - f1 / N;
  return extrapolateFromStats(Sobs, chao1, cObs, c);
}

/**
 * Core of the Chao & Jost (2012) coverage extrapolation, expressed through
 * the four summary statistics the estimator needs. Kept separate from
 * `extrapolation()` so that a bootstrap replicate of a sample — which has its
 * own S_obs / f1 / f2 / N — can reuse exactly the same formula.
 */
function extrapolateFromStats(Sobs: number, chao1: number, cObs: number, c: number): number {
  if (c >= 1) return chao1;
  if (c <= cObs) return Sobs;

  // Pool of undetected species carried by the Chao1 asymptote.
  const f0 = Math.max(0, chao1 - Sobs);
  if (f0 === 0) return Sobs;

  const denom = 1 - cObs; // = f1/N > 0, since c > cObs here
  if (!(denom > 0)) return chao1;

  const closed = Math.min(1, (c - cObs) / denom);
  const value = Sobs + f0 * closed;
  return Math.min(chao1, Math.max(Sobs, value));
}

/**
 * Compute coverage-based rarefaction and extrapolation (iNEXT-style).
 *
 * @param abundanceMatrix  samples × species
 * @param coverageLevels   target coverage (0–1) values to evaluate (default 0.5..0.99)
 * @param nIterations      number of individual-level replicates used for the
 *                         point estimate and the CI (default 200)
 * @param sampleNames      optional names for samples
 * @param rngSeed          seed for reproducible sampling (default 42)
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
  //   S_chao1 = S_obs + f1^2 / (2 f2)   when f2 > 0
  //             S_obs + f1(f1-1) / 2    when f2 = 0, f1 > 0
  // (The comment above used to advertise f1(f1-1) / (2(f2+1)); the code has
  // always used the classic Chao (1984) form f1^2 / (2 f2).)
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
  const nCov = coverage.length;
  const nIter = Math.max(1, Math.floor(nIterations));

  // Individual-level species pools (for the sub-sampling replicates)
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
  //
  // Point estimates AND confidence intervals come from the SAME set of
  // individual-level replicates, and `nIterations` is the number of those
  // replicates:
  //
  //   * rarefaction branch (c ≤ c_obs): every replicate draws
  //     m = floor(c·N) individuals WITHOUT replacement from the sample's
  //     individual pool and reports the Hill number of that sub-sample. The
  //     mean over replicates converges to the exact Hurlbert expectation
  //     E[S(m)], and the 2.5 % / 97.5 % percentiles give the sampling
  //     interval of the sub-sample.
  //   * extrapolation branch (c > c_obs): every replicate resamples N
  //     individuals WITH replacement (bootstrap), recomputes S_obs / f1 / f2
  //     → the Chao1 asymptote and the observed coverage OF THE REPLICATE, and
  //     applies the Chao & Jost (2012) extrapolation formula to it.
  //
  // The previous implementation drew ONE random sub-sample per
  // (coverage, sample) pair and then took the mean / percentiles ACROSS
  // SAMPLES: `nIterations` had no effect whatsoever (1 and 1000 iterations
  // returned bit-identical numbers) and a single sample produced a zero-width
  // "95 % CI".
  const reps: number[][][] = [];
  for (let s = 0; s < nSamples; s++) reps.push(coverage.map(() => [] as number[]));

  for (let s = 0; s < nSamples; s++) {
    const N = sampleSizes[s];
    const pool = pools[s];
    const f1 = abundanceMatrix[s].filter(v => v === 1).length;
    const c_obs = N > 0 ? 1 - f1 / N : 1;

    if (pool.length === 0) {
      // Empty sample: no individuals at all, so every replicate is 0.
      for (let ci = 0; ci < nCov; ci++) for (let it = 0; it < nIter; it++) reps[s][ci].push(0);
      continue;
    }

    // Which coverage levels are answered by sub-sampling and which by
    // extrapolation (decided once — both branches are deterministic given c).
    const needs: { ci: number; m: number }[] = [];
    const extrap: { ci: number; c: number }[] = [];
    for (let ci = 0; ci < nCov; ci++) {
      const c = coverage[ci];
      if (c <= c_obs) needs.push({ ci, m: Math.min(pool.length, Math.max(1, Math.floor(c * N))) });
      else extrap.push({ ci, c });
    }
    needs.sort((a, b) => a.m - b.m);

    for (let iter = 0; iter < nIter; iter++) {
      // (1) One random permutation of the individual pool; its prefix of
      //     length m is the sub-sample at coverage c.
      const order = pool.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      // Walk the permutation once and snapshot the Hill number whenever the
      // number of drawn individuals reaches one of the requested m values.
      const snapshot = new Array<number>(needs.length).fill(0);
      const drawnCounts = new Map<number, number>();
      let ti = 0;
      for (let i = 0; i < pool.length && ti < needs.length; i++) {
        const sp = pool[order[i]];
        drawnCounts.set(sp, (drawnCounts.get(sp) ?? 0) + 1);
        const drawn = i + 1;
        while (ti < needs.length && needs[ti].m === drawn) {
          snapshot[ti] = hillOf(drawnCounts, drawn);
          ti++;
        }
      }
      for (let k = 0; k < needs.length; k++) reps[s][needs[k].ci].push(snapshot[k]);

      // (2) One with-replacement bootstrap replicate, shared by all
      //     extrapolated coverage levels of this iteration.
      if (extrap.length > 0) {
        const boot = new Map<number, number>();
        for (let i = 0; i < N; i++) {
          const sp = pool[Math.floor(rand() * pool.length)];
          boot.set(sp, (boot.get(sp) ?? 0) + 1);
        }
        let bF1 = 0, bF2 = 0;
        for (const cnt of boot.values()) {
          if (cnt === 1) bF1++;
          else if (cnt === 2) bF2++;
        }
        const bS = boot.size;
        let bChao1 = bS;
        if (bF2 > 0) bChao1 = bS + (bF1 * bF1) / (2 * bF2);
        else if (bF1 > 0) bChao1 = bS + bF1 * (bF1 - 1) / 2;
        const bCObs = N > 0 ? 1 - bF1 / N : 1;
        for (const e of extrap) {
          reps[s][e.ci].push(extrapolateFromStats(bS, bChao1, bCObs, e.c));
        }
      }
    }
  }

  // Pool the replicates of every sample: the point estimate is their mean and
  // the interval their 2.5 % / 97.5 % percentiles (so it also carries the
  // spread BETWEEN samples, not just the within-sample sampling error).
  const expectedR: number[] = [];
  const lo: number[] = [], hi: number[] = [];
  for (let ci = 0; ci < nCov; ci++) {
    const pooled: number[] = [];
    for (let s = 0; s < nSamples; s++) for (const v of reps[s][ci]) pooled.push(v);
    pooled.sort((a, b) => a - b);
    if (pooled.length === 0) { expectedR.push(0); lo.push(0); hi.push(0); continue; }
    expectedR.push(pooled.reduce((a, b) => a + b, 0) / pooled.length);
    lo.push(pooled[Math.max(0, Math.floor(pooled.length * 0.025))]);
    hi.push(pooled[Math.min(pooled.length - 1, Math.floor(pooled.length * 0.975))]);
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
