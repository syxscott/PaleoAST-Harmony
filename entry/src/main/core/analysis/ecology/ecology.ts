/**
 * Ecology analysis modules — replaces ecology/*.py
 */
import { Matrix } from '../../math/Matrix';
import * as linalg from '../../math/linalg';
import { seed, rand, randint } from '../../math/random';
// Only `qnorm` is used from stats: the standard-normal quantile is the only
// correct way to turn a confidence level into a z multiplier.
import { qnorm } from '../../math/stats';
import { ComputationError } from '../../utils/Exceptions';

/**
 * Diversity indices for a single sample.
 */
export interface DiversityResult {
  sampleName: string;
  richness: number;
  shannon: number;
  simpson: number;
  pielou: number;
  margalef: number;
  evenness: number;
  totalIndividuals: number;
  abundances: Record<string, number>;
  /** Fisher's log-series alpha (undefined when non-convergent). */
  fisherAlpha?: number;
  /** Chao1 asymptotic richness estimator. */
  chao1?: number;
}

export function computeDiversity(abundances: number[], sampleName: string = 'Sample', speciesNames?: string[]): DiversityResult {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  const N = counts.reduce((a, b) => a + b, 0);
  const S = counts.length;
  if (N === 0 || S === 0) {
    return { sampleName, richness: 0, shannon: 0, simpson: 0, pielou: 0, margalef: 0, evenness: 0, totalIndividuals: 0, abundances: {} };
  }

  // Shannon H' = -sum(p_i * ln(p_i))
  let H = 0;
  for (const n of counts) { const p = n / N; if (p > 0) H -= p * Math.log(p); }

  // Simpson 1-D = 1 - sum(p_i^2)
  let D = 0;
  for (const n of counts) { const p = n / N; D += p * p; }
  const simpson = 1 - D;

  // Pielou J = H / ln(S)
  const pielou = S > 1 ? H / Math.log(S) : 0;

  // Margalef = (S - 1) / ln(N)
  const margalef = N > 1 ? (S - 1) / Math.log(N) : 0;

  // Preserve caller-provided species names; fall back to generic labels
  const names = speciesNames && speciesNames.length >= abundances.length
    ? speciesNames : undefined;
  const abundancesMap: Record<string, number> = {};
  let named = 0;
  for (let i = 0; i < abundances.length; i++) {
    if (abundances[i] > 0 && !isNaN(abundances[i])) {
      abundancesMap[names ? names[i] : `Species_${named + 1}`] = abundances[i];
      named++;
    }
  }

  // Fisher's alpha (S = α ln(1 + N/α)) and Chao1 richness
  const fisherAlpha = computeFisherAlpha(S, N) ?? undefined;
  const f1 = counts.filter(v => v === 1).length;
  const f2 = counts.filter(v => v === 2).length;
  const chao1 = f2 > 0 ? S + (f1 * f1) / (2 * f2)
    : f1 > 0 ? S + (f1 * (f1 - 1)) / 2
    : S;

  return {
    sampleName, richness: S, shannon: H, simpson, pielou, margalef, evenness: pielou,
    totalIndividuals: N, abundances: abundancesMap, fisherAlpha, chao1,
  };
}

// ─── Fisher's alpha & Chao1 confidence interval (diversity.py) ──────────────

/**
 * Solve Fisher's log-series richness relation S = α·ln(1 + N/α) for α by
 * Newton-Raphson (diversity.py _compute_fisher_alpha). Returns null on
 * non-convergence or degenerate input.
 */
export function computeFisherAlpha(S: number, N: number): number | null {
  if (S <= 0 || N <= 0) return null;
  let alpha = 1.0;
  for (let iter = 0; iter < 100; iter++) {
    const f = alpha * Math.log(1 + N / alpha) - S;
    const fPrime = Math.log(1 + N / alpha) - N / (alpha + N);
    if (Math.abs(fPrime) < 1e-10) break;
    const alphaNew = alpha - f / fPrime;
    if (Math.abs(alphaNew - alpha) < 1e-6) return alphaNew;
    alpha = alphaNew;
    if (alpha <= 0) return null;
  }
  return null;
}

/**
 * Chao1 estimator with log-transformed confidence interval
 * (Chao 1987 variance; Chao & Jost 2012 CI construction).
 * Returns (chao1, ciLower, ciUpper).
 */
export function chao1ConfidenceInterval(
  abundances: number[],
  confidenceLevel: number = 0.95,
): { chao1: number; ciLower: number; ciUpper: number } {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  if (counts.length === 0) return { chao1: 0, ciLower: 0, ciUpper: 0 };
  const n = counts.reduce((a, b) => a + b, 0);
  const sObs = counts.length;
  const f1 = counts.filter(v => v === 1).length;
  const f2 = counts.filter(v => v === 2).length;

  if (n === 0) return { chao1: sObs, ciLower: sObs, ciUpper: sObs };

  let chao1: number;
  if (f2 > 0) chao1 = sObs + (f1 * f1) / (2 * f2);
  else if (f1 > 0) chao1 = sObs + (f1 * (f1 - 1)) / 2;
  else chao1 = sObs;

  // Variance (Chao 1987 Eq. 5)
  let varChao1 = 0;
  if (f2 > 0 && f1 > 0) {
    const a = (2 * f2) / ((n - 1) * f1 + 2 * f2);
    const ratio = f1 / f2;
    varChao1 = f2 * ((a / 4) * ratio ** 4 + (a * a / 2) * ratio ** 3 + (a * a / 2) * ratio ** 2 + (a * a / 4) * ratio);
  } else if (f2 === 0 && f1 > 0) {
    varChao1 = (f1 * (f1 - 1)) / 2;
  }

  // Log-transformed CI (Chao & Jost 2012): K = exp(z·sqrt(ln(1 + var/ĉ²)))
  //
  // `z` must be the two-sided standard-normal quantile of the requested
  // confidence level: z = Φ⁻¹(1 − (1 − cl)/2).
  //
  // The previous expression `z95 · √(cl/0.95)` was not a quantile function at
  // all: it produced a 90% interval WIDER than the true 90% one (z = 1.908
  // instead of 1.645) and a 99% interval NARROWER than the true 99% one
  // (z = 2.001 instead of 2.576). Only 0.95 came out right, and only because
  // √1 = 1 — so every other confidence level silently mis-stated the
  // uncertainty of an estimator that ends up in a paper.
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) {
    throw new ComputationError(
      `chao1ConfidenceInterval: confidenceLevel must lie strictly between 0 and 1, got ${confidenceLevel}`);
  }
  const z = qnorm(1 - (1 - confidenceLevel) / 2);
  const logTerm = Math.log(1 + varChao1 / (chao1 * chao1));
  const K = Math.exp(z * Math.sqrt(Math.max(0, logTerm)));
  return { chao1, ciLower: chao1 / K, ciUpper: chao1 * K };
}

/**
 * Rarefaction curve — replaces ecology/rarefaction.py.
 */
export interface RarefactionResult {
  sampleName: string;
  sampleSizes: number[];
  expectedTaxa: number[];
  extrapolationFlag: boolean; // true when maxN >= N (beyond observed range)
}

export function computeRarefaction(abundances: number[], maxN?: number, nPoints: number = 50): RarefactionResult {
  const counts = abundances.filter(v => v > 0 && !isNaN(v));
  const N = counts.reduce((a, b) => a + b, 0);
  const S = counts.length;
  if (N === 0) return { sampleName: '', sampleSizes: [], expectedTaxa: [], extrapolationFlag: false };

  const maxSample = maxN ?? Math.floor(N / 2);
  const step = Math.max(1, Math.floor(maxSample / nPoints));
  const sizes: number[] = [];
  let extrapolationFlag = false;
  for (let n = 1; n <= maxSample; n += step) {
    if (n >= N) { extrapolationFlag = true; break; } // beyond observed range
    sizes.push(n);
  }
  if (!extrapolationFlag && maxSample < N) sizes.push(N); // include full sample

  const expected: number[] = [];
  for (const n of sizes) {
    let E = 0;
    for (const ni of counts) {
      if (N - ni < n) { E += 1; continue; }
      // P(species excluded) = C(N-ni, n) / C(N, n) using log
      let logP = 0;
      for (let k = 0; k < n; k++) logP += Math.log(N - ni - k) - Math.log(N - k);
      E += 1 - Math.exp(logP);
    }
    expected.push(E);
  }

  return { sampleName: '', sampleSizes: sizes, expectedTaxa: expected, extrapolationFlag };
}

/**
 * Shannon entropy: H = -sum(p_i * ln(p_i))
 */
export function shannon(abundances: number[]): number {
  const total = abundances.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let H = 0;
  for (const a of abundances) { if (a > 0) { const p = a / total; H -= p * Math.log(p); } }
  return H;
}

/**
 * Simpson index: 1 - sum(p_i^2)
 */
export function simpson(abundances: number[]): number {
  const total = abundances.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let D = 0;
  for (const a of abundances) { const p = a / total; D += p * p; }
  return 1 - D;
}

// ═══════════════════════════════════════════════════════════════════
// Beta Diversity Decomposition (Baselga 2010/2012)
// ═══════════════════════════════════════════════════════════════════

export interface BetaDiversityResult {
  totalBeta: number[][];
  turnover: number[][];
  nestedness: number[][];
  decompositionType: string;
  nSamples: number;
  /** Per-site-pair明细 (Baselga decomposition details). */
  pairwiseResults: {
    sampleI: string; sampleJ: string; sharedSpecies: number; onlyI: number; onlyJ: number;
    totalBeta: number; turnover: number; nestedness: number;
  }[];
}

export function betaDiversityDecomposition(
  abundanceMatrix: number[][],
  metric: 'jaccard' | 'sorensen' = 'jaccard',
  sampleNames?: string[],
): BetaDiversityResult {
  const n = abundanceMatrix.length;
  const names = sampleNames ?? Array.from({ length: n }, (_, i) => `Sample_${i + 1}`);
  const presence = abundanceMatrix.map(row => row.map(v => v > 0));
  const totalBeta: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const turnover: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const nestedness: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairwiseResults: BetaDiversityResult['pairwiseResults'] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let a = 0, b = 0, c = 0;
      for (let k = 0; k < presence[i].length; k++) {
        if (presence[i][k] && presence[j][k]) a++;
        else if (presence[i][k] && !presence[j][k]) b++;
        else if (!presence[i][k] && presence[j][k]) c++;
      }
      const total = a + b + c;
      if (total === 0) continue;

      // Baselga (2010/2012) partitioning:
      //   Jaccard: T = 2min(b,c)/(a+2min), N = a|b−c|/[total·(a+2min)]
      //   Sørensen: T = min(b,c)/(2a+min),  N = 2a·max(b,c)/[(2a+b+c)(2a+min)]
      let totalVal: number, turnVal: number, nestVal: number;
      if (metric === 'jaccard') {
        totalVal = (b + c) / total;
        const minBC = Math.min(b, c);
        const denomTurn = a + 2 * minBC;
        turnVal = denomTurn > 0 ? (2 * minBC) / denomTurn : 0;
        nestVal = denomTurn > 0 ? (a * Math.abs(b - c)) / (total * denomTurn) : 0;
      } else {
        const denom = 2 * a + b + c;
        totalVal = denom > 0 ? (b + c) / denom : 0;
        const minBC = Math.min(b, c);
        const denomTurn = 2 * a + minBC;
        turnVal = denomTurn > 0 ? minBC / denomTurn : 0;
        nestVal = (denom > 0 && denomTurn > 0) ? (2 * a * Math.max(b, c)) / (denom * denomTurn) : 0;
      }

      totalBeta[i][j] = totalBeta[j][i] = totalVal;
      turnover[i][j] = turnover[j][i] = turnVal;
      nestedness[i][j] = nestedness[j][i] = nestVal;
      pairwiseResults.push({
        sampleI: names[i], sampleJ: names[j],
        sharedSpecies: a, onlyI: b, onlyJ: c,
        totalBeta: totalVal, turnover: turnVal, nestedness: nestVal,
      });
    }
  }

  return { totalBeta, turnover, nestedness, decompositionType: metric, nSamples: n, pairwiseResults };
}

// ═══════════════════════════════════════════════════════════════════
// Null Model Analysis
// ═══════════════════════════════════════════════════════════════════

export interface NullModelResult {
  observedScore: number;
  simulatedScores: number[];
  meanSimulated: number;
  stdSimulated: number;
  ses: number;
  pValue: number;
  nPermutations: number;
  metric: string;
}

/**
 * SIM9 null model algorithm (Gotelli 2000 "Null model analysis of species
 * co-occurrence patterns", Ecology 81(9): 2616-2626).
 *
 * SIM9 keeps row sums (species frequencies) and column sums (site richness)
 * fixed. It works by repeatedly selecting a presence (1) and an absence (0)
 * in the same row and swapping them — which is always feasible because
 * swapping within a row preserves that row's sum and also preserves the column
 * sums (one column gains a 1, the other loses a 1, so both column sums stay
 * unchanged).
 *
 * References:
 * - Gotelli, N.J. & Entsminger, G.L. (2001). EcoSim: null models software
 *   for ecology. https://gentsminger.com/ecosim/
 * - Stone, L. & Roberts, A. (1992). The checkerboard score: tests of spatial
 *   heterogeneity in faunal inventories. Oikos 64: 253-259.
 */
export function nullModel(
  presenceMatrix: number[][],
  metric: 'c_score' | 'checkerboard' | 'combo' = 'c_score',
  nPermutations: number = 999,
  rngSeed?: number,
  algorithm: 'swap' | 'shuffle' = 'swap'
): NullModelResult {
  const nSpecies = presenceMatrix.length, nSites = presenceMatrix[0].length;
  if (!Number.isFinite(nPermutations) || nPermutations < 1) {
    throw new ComputationError(`nullModel: nPermutations must be a finite number >= 1, got ${nPermutations}`);
  }
  const presence: number[][] = presenceMatrix.map(row => row.map(v => v > 0 ? 1 : 0));
  seed(rngSeed ?? 42); // seed the global PRNG (fixed: parameter no longer shadows seed())

  const computeCScore = (mat: number[][]): number => {
    const rs = mat.map(row => row.reduce((a, b) => a + b, 0));
    const scores: number[] = [];
    for (let i = 0; i < mat.length; i++) for (let j = i + 1; j < mat.length; j++) {
      let sij = 0;
      for (let k = 0; k < mat[i].length; k++) if (mat[i][k] === 1 && mat[j][k] === 1) sij++;
      scores.push((rs[i] - sij) * (rs[j] - sij));
    }
    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  };

  const computeCheckerboard = (mat: number[][]): number => {
    let count = 0;
    for (let i = 0; i < mat.length; i++) for (let j = i + 1; j < mat.length; j++) {
      for (let k = 0; k < mat[i].length; k++) for (let l = k + 1; l < mat[i].length; l++) {
        if ((mat[i][k] === 1 && mat[i][l] === 0 && mat[j][k] === 0 && mat[j][l] === 1) ||
            (mat[i][k] === 0 && mat[i][l] === 1 && mat[j][k] === 1 && mat[j][l] === 0)) count++;
      }
    }
    return count;
  };

  // Combined metric (null_models.py _compute_combo_score): mean of C-score and
  // normalised checkerboard unit square.
  const computeCombo = (mat: number[][]): number => {
    const c = computeCScore(mat);
    const cb = computeCheckerboard(mat);
    const maxCb = (nSpecies * (nSpecies - 1) / 2) * (nSites * (nSites - 1) / 2);
    const normCb = maxCb > 0 ? cb / maxCb : 0;
    return (c + normCb) / 2;
  };

  const computeScore = metric === 'checkerboard' ? computeCheckerboard
    : metric === 'combo' ? computeCombo
    : computeCScore;
  const observed = computeScore(presence);

  // SIM9 swap: build index of presence/absence positions per row
  const presIdx: number[][] = []; // presIdx[r] = [c where mat[r][c] == 1]
  const absIdx: number[][] = [];  // absIdx[r]  = [c where mat[r][c] == 0]
  for (let r = 0; r < nSpecies; r++) {
    presIdx.push([]); absIdx.push([]);
    for (let c = 0; c < nSites; c++) {
      if (presence[r][c] === 1) presIdx[r].push(c);
      else absIdx[r].push(c);
    }
  }

  // Degenerate guard: a row that holds only presences (or only absences)
  // cannot be changed by a within-row swap, and a matrix whose rows are all
  // constant cannot be changed by any algorithm implemented here. The null
  // distribution would then be a single repeated value (std = 0, SES = 0,
  // p = 1) — a silent "no co-occurrence structure" verdict that no data
  // supports. Fail loudly instead.
  let hasSwappableRow = false;
  for (let r = 0; r < nSpecies; r++) {
    if (presIdx[r].length > 0 && absIdx[r].length > 0) { hasSwappableRow = true; break; }
  }
  if (!hasSwappableRow) {
    throw new ComputationError(
      'nullModel: every row of the presence matrix is constant (all presences or all absences), '
      + 'so no null matrix can differ from the observed one and the null distribution / p-value would be meaningless');
  }

  const simulated: number[] = [];

  for (let perm = 0; perm < nPermutations; perm++) {
    // Deep-copy current matrix for this permutation
    const mat = presence.map(row => [...row]);

    if (algorithm === 'shuffle') {
      // Full random permutation of each row's entries (destroys both row and
      // column structure expectations — the liberal 'shuffle' algorithm of
      // null_models.py _shuffle_matrix)
      for (let r = 0; r < nSpecies; r++) {
        const rowSum = mat[r].reduce((a, b) => a + b, 0);
        const flat: number[] = [];
        for (let c = 0; c < nSites; c++) flat.push(mat[r][c]);
        // Fisher-Yates with the seeded RNG
        for (let i = flat.length - 1; i > 0; i--) {
          const j = randint(0, i + 1);
          const tmp = flat[i]; flat[i] = flat[j]; flat[j] = tmp;
        }
        // Re-draw until row sum matches (keeps species frequency)
        let sum = flat.reduce((a, b) => a + b, 0);
        let guard = 0;
        while (sum !== rowSum && guard < 50) {
          for (let i = flat.length - 1; i > 0; i--) {
            const j = randint(0, i + 1);
            const tmp = flat[i]; flat[i] = flat[j]; flat[j] = tmp;
          }
          sum = flat.reduce((a, b) => a + b, 0);
          guard++;
        }
        mat[r] = flat;
      }
    } else {
      const pIdx = presIdx.map(row => [...row]);
      const aIdx = absIdx.map(row => [...row]);
      // SIM9: swap within rows (preserves row sums).
      // The swap count must never be 0: with 0 swaps every "permuted" matrix
      // is the observed matrix, so the null distribution collapsed to a single
      // value (std = 0, p = 1) for any matrix with nSpecies·nSites < 10 —
      // a 3×3 presence/absence table always answered "no structure".
      const nSwaps = Math.max(1, Math.floor(nSpecies * nSites * 0.1));
      for (let s = 0; s < nSwaps; s++) {
        const r = randint(0, nSpecies);
        if (pIdx[r].length === 0 || aIdx[r].length === 0) continue;
        const pi = randint(0, pIdx[r].length);
        const ai = randint(0, aIdx[r].length);
        const cPres = pIdx[r][pi], cAbs = aIdx[r][ai];
        mat[r][cPres] = 0; mat[r][cAbs] = 1;
        pIdx[r][pi] = cAbs; aIdx[r][ai] = cPres;
      }
    }
    simulated.push(computeScore(mat));
  }

  const meanSim = simulated.reduce((a, b) => a + b, 0) / simulated.length;
  const stdSim = Math.sqrt(simulated.reduce((s, v) => s + (v - meanSim) ** 2, 0) / simulated.length);

  // A null distribution without spread cannot support a standardised effect
  // size: SES = (observed − mean)/std is then 0/0, or an astronomically large
  // number (4.3e13 was observed when std came out as 7.8e-16). A permutation
  // test that cannot separate the observed matrix from its null is not a
  // result — report the degeneracy instead of a number nobody can use.
  if (!(stdSim > 1e-12 * Math.max(1, Math.abs(meanSim)))) {
    throw new ComputationError(
      `nullModel: all ${nPermutations} simulated ${metric} scores are identical `
      + `(${simulated[0]}) — the null distribution has no spread, so the SES and the p-value are meaningless. `
      + `The presence matrix is too small or too symmetric for the `
      + `${algorithm === 'swap' ? 'SIM9 swap' : 'shuffle'} null model to sample.`);
  }

  const ses = (observed - meanSim) / stdSim;

  // One-sided p-value: P(simulated >= observed) with add-one correction
  const tailCount = simulated.filter(s => s >= observed).length;
  const pValue = (tailCount + 1) / (nPermutations + 1);

  return { observedScore: observed, simulatedScores: simulated, meanSimulated: meanSim, stdSimulated: stdSim, ses, pValue, nPermutations, metric };
}

// ═══════════════════════════════════════════════════════════════════
// DTW (Dynamic Time Warping)
// ═══════════════════════════════════════════════════════════════════

export interface DTWResult {
  distance: number;
  path: [number, number][];
  /** Sequences aligned along the warping path (dtw.py warped_seq1/2). */
  warpedSeq1: number[];
  warpedSeq2: number[];
  /** Full cumulative cost matrix D[i][j]. */
  cumulativeMatrix: number[][];
}

type Seq = number | number[];

/** Element access for scalar (1D) or vector (multivariate) sequences. */
function seqAt(s: Seq, i: number): number | number[] {
  return Array.isArray(s) ? (s as unknown as number[][])[i] : (s as unknown as number[])[i];
}
/** Seq length whether scalar (1D) or vector (multivariate). */
function seqLen(s: Seq): number {
  return typeof seqAt(s, 0) === 'object' ? (s as unknown as number[][]).length : (s as number[]).length;
}

function localCost(a: number | number[], b: number | number[], metric: string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    const d = a - b;
    if (metric === 'cityblock') return Math.abs(d);
    if (metric === 'cosine') return 1 - (a * b) / (Math.abs(a) * Math.abs(b) + 1e-12);
    return d * d; // euclidean (squared, sqrt applied at the end)
  }
  const va = a as number[], vb = b as number[];
  const n = Math.min(va.length, vb.length);
  if (metric === 'cosine') {
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < n; k++) { dot += va[k] * vb[k]; na += va[k] * va[k]; nb += vb[k] * vb[k]; }
    return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
  }
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const d = va[k] - vb[k];
    sum += metric === 'cityblock' ? Math.abs(d) : d * d;
  }
  return sum;
}

/**
 * Dynamic Time Warping (dtw.py compute) — supports 1D and multivariate (2D)
 * sequences, euclidean/cityblock/cosine local metrics, and a Sakoe-Chiba band.
 * Returns the path, warped sequences, and the cumulative cost matrix.
 */
export function dtw(
  seq1: Seq,
  seq2: Seq,
  window?: number,
  metric: 'euclidean' | 'cityblock' | 'cosine' = 'euclidean',
): DTWResult {
  const n1 = seqLen(seq1);
  const n2 = seqLen(seq2);
  const D = Array.from({ length: n1 }, () => new Array(n2).fill(Infinity));
  D[0][0] = localCost(seqAt(seq1, 0), seqAt(seq2, 0), metric);

  // Sakoe-Chiba band: cells outside |i − j| ≤ window are UNREACHABLE and stay
  // at Infinity. The previous code wrote a constant 1e10 penalty there, which
  // is not a path cost at all: the end cell became 1e10 whenever the band was
  // too narrow to reach it, and the reported "distance" was a fabricated
  // 100000. Infinity is the honest marker — the caller is told the band does
  // not reach (see the explicit error below).
  const inBand = (i: number, j: number): boolean =>
    window === undefined || Math.abs(i - j) <= window;

  for (let i = 1; i < n1; i++) {
    if (!inBand(i, 0)) continue; // stays Infinity
    D[i][0] = D[i - 1][0] + localCost(seqAt(seq1, i), seqAt(seq2, 0), metric);
  }
  for (let j = 1; j < n2; j++) {
    if (!inBand(0, j)) continue; // stays Infinity
    D[0][j] = D[0][j - 1] + localCost(seqAt(seq1, 0), seqAt(seq2, j), metric);
  }

  for (let i = 1; i < n1; i++) for (let j = 1; j < n2; j++) {
    if (!inBand(i, j)) continue; // stays Infinity
    D[i][j] = localCost(seqAt(seq1, i), seqAt(seq2, j), metric) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
  }

  const rawDistance = D[n1 - 1][n2 - 1];
  if (!isFinite(rawDistance)) {
    const minWindow = Math.abs((n1 - 1) - (n2 - 1));
    throw new ComputationError(
      `dtw: the Sakoe-Chiba band (window=${window}) does not reach the end cell `
      + `(${n1 - 1}, ${n2 - 1}) — a window of at least ${minWindow} is required`);
  }

  // Backtrack
  const path: [number, number][] = [];
  let i = n1 - 1, j = n2 - 1;
  path.push([i, j]);
  while (i > 0 || j > 0) {
    if (i === 0) j--;
    else if (j === 0) i--;
    else {
      const minVal = Math.min(D[i - 1][j - 1], D[i - 1][j], D[i][j - 1]);
      if (minVal === D[i - 1][j - 1]) { i--; j--; }
      else if (minVal === D[i - 1][j]) i--;
      else j--;
    }
    path.push([i, j]);
  }
  path.reverse();

  // Warped sequences along the path
  const isVec1 = typeof seqAt(seq1, 0) === 'object';
  const isVec2 = typeof seqAt(seq2, 0) === 'object';
  const dim1 = isVec1 ? (seq1 as unknown as number[][])[0].length : 0;
  const dim2 = isVec2 ? (seq2 as unknown as number[][])[0].length : 0;
  const dim = Math.max(dim1, dim2);
  const warped1: number[] = [], warped2: number[] = [];
  for (const [pi, pj] of path) {
    const a = seqAt(seq1, pi), b = seqAt(seq2, pj);
    for (let d = 0; d < dim; d++) {
      warped1.push(typeof a === 'number' ? a : ((a as number[])[d] ?? NaN));
      warped2.push(typeof b === 'number' ? b : ((b as number[])[d] ?? NaN));
    }
  }

  let distance = D[n1 - 1][n2 - 1];
  if (metric === 'euclidean') distance = Math.sqrt(Math.max(0, distance));

  return { distance, path, warpedSeq1: warped1, warpedSeq2: warped2, cumulativeMatrix: D };
}

/**
 * Pairwise DTW distance matrix over a set of sequences
 * (dtw.py distance_matrix). Uses the normalized DTW distance.
 */
export function dtwDistanceMatrix(
  sequences: Seq[],
  window?: number,
  metric: 'euclidean' | 'cityblock' | 'cosine' = 'euclidean',
): number[][] {
  const n = sequences.length;
  const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const lenI = seqLen(sequences[i]);
      const lenJ = seqLen(sequences[j]);
      const d = dtw(sequences[i], sequences[j], window, metric).distance;
      // Normalized distance (divides by path-length proxy n+m) as in Python
      const norm = d / (lenI + lenJ);
      M[i][j] = M[j][i] = norm;
    }
  }
  return M;
}

// ═══════════════════════════════════════════════════════════════════
// Abundance Models
// ═══════════════════════════════════════════════════════════════════

export interface AbundanceModelFit {
  name: string;
  params: Record<string, number>;
  rSquared: number;
  aic: number;
}

export function fitAbundanceModels(abundances: number[]): AbundanceModelFit[] {
  const sorted = [...abundances].filter(v => v > 0).sort((a, b) => b - a);
  const S = sorted.length;
  const N = sorted.reduce((a, b) => a + b, 0);
  const results: AbundanceModelFit[] = [];

  // Log-normal (Preston 1948): bin species into log2 abundance octaves and fit
  // S(R) = S0·exp(−a·R²) by regressing ln(S_R) on R² (advanced.py fit_log_normal)
  {
    const logAbund = sorted.map(v => Math.log2(v + 1));
    const maxOctave = Math.ceil(Math.max(...logAbund, 0));
    const hist: number[] = new Array(maxOctave + 1).fill(0);
    for (const v of logAbund) hist[Math.min(Math.floor(v), maxOctave)]++;
    const validR: number[] = [], validLnS: number[] = [];
    for (let r = 0; r < hist.length; r++) {
      if (hist[r] > 0) { validR.push(r); validLnS.push(Math.log(hist[r])); }
    }
    if (validR.length >= 3) {
      const reg = linearRegression(validR.map(r => r * r), validLnS);
      const a = -reg.slope;
      const S0 = Math.exp(reg.intercept);
      // The log-normal (Preston veil line) model predicts a COUNT of species
      // per octave, so its residual has to be measured against the observed
      // octave COUNTS. The previous code compared the count-scale prediction
      // S0·exp(−a·r²) with the LOGARITHM of the observed count, mixing two
      // scales inside one sum of squares; the resulting SSE was inflated by
      // orders of magnitude and the AIC was off by ~100 units, so the model
      // could win (or lose) the ranking for a numerical reason that has
      // nothing to do with how well it fits.
      const predictedCount = validR.map(r => S0 * Math.exp(-a * r * r));
      const ssRes = validR.reduce((s, r, i) => s + (hist[r] - predictedCount[i]) ** 2, 0);
      results.push({
        name: 'Log-Normal (Preston)',
        params: { S0, a, sigma: a > 0 ? 1 / Math.sqrt(2 * a) : Infinity },
        rSquared: reg.r2,
        aic: S * Math.log(ssRes / S + 1e-10) + 4,
      });
    } else {
      // Fallback: rank-abundance Zipf form when too few octaves.
      // The residual must also live on the raw-count scale — `mse` is a
      // log-space quantity and cannot be compared with the count-scale SSE of
      // the other models.
      const logRanks = sorted.map((_, i) => Math.log(i + 1));
      const logAbund2 = sorted.map(v => Math.log(v));
      const lrResult = linearRegression(logRanks, logAbund2);
      const predicted = sorted.map((_, i) => Math.exp(lrResult.intercept + lrResult.slope * logRanks[i]));
      const ssResFb = sorted.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
      results.push({
        name: 'Log-Normal',
        params: { slope: lrResult.slope, intercept: lrResult.intercept },
        rSquared: lrResult.r2,
        aic: S * Math.log(ssResFb / S + 1e-10) + 4,
      });
    }
  }

  // Geometric series: p_i = p_1 * (1-k)^(i-1)
  const k = 1 - sorted[sorted.length - 1] / sorted[0];
  const expected = sorted.map((_, i) => sorted[0] * Math.pow(1 - Math.max(0, Math.min(1, k)), i));
  const ssRes = sorted.reduce((s, v, i) => s + (v - expected[i]) ** 2, 0);
  const ssTot = sorted.reduce((s, v) => s + (v - N / S) ** 2, 0);
  results.push({ name: 'Geometric', params: { k: Math.max(0, Math.min(1, k)) }, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0, aic: S * Math.log(ssRes / S + 1e-10) + 4 });

  // Broken stick: E[n_i] = (N/S) * sum(1/j, j=i..S)
  const brokenStick = sorted.map((_, i) => {
    let s = 0; for (let j = i + 1; j <= S; j++) s += 1 / j; return (N / S) * s;
  });
  const ssResBS = sorted.reduce((s, v, i) => s + (v - brokenStick[i]) ** 2, 0);
  results.push({ name: 'Broken Stick', params: {}, rSquared: ssTot > 0 ? 1 - ssResBS / ssTot : 0, aic: S * Math.log(ssResBS / S + 1e-10) + 2 });

  // Log-series (Fisher 1943): expected freq of abundance i is α·x^i/i with
  // α from the closed Newton solver
  const alpha = computeFisherAlpha(S, N);
  if (alpha !== null) {
    const x = N / (alpha + N);
    const maxAbund = Math.ceil(Math.max(...sorted));
    const freq: number[] = new Array(maxAbund).fill(0);
    for (const a of sorted) freq[Math.min(a, maxAbund) - 1]++;
    const expFreq: number[] = [];
    for (let i = 1; i <= maxAbund; i++) expFreq.push(alpha * Math.pow(x, i) / i);
    const meanFreq = freq.reduce((a, b) => a + b, 0) / freq.length;
    const ssResLS = freq.reduce((s, v, i) => s + (v - (expFreq[i] ?? 0)) ** 2, 0);
    const ssTotLS = freq.reduce((s, v) => s + (v - meanFreq) ** 2, 0);
    results.push({
      name: 'Log-Series',
      params: { alpha, x },
      rSquared: ssTotLS > 0 ? 1 - ssResLS / ssTotLS : 0,
      aic: S * Math.log(ssResLS / S + 1e-10) + 4,
    });
  }

  // Sort by AIC (best/lowest first) per advanced.py fit_all
  results.sort((a, b) => a.aic - b.aic);
  return results;
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number; mse: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (y[i] - (slope * x[i] + intercept)) ** 2; ssTot += (y[i] - my) ** 2; }
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, mse: ssRes / n };
}

// ═══════════════════════════════════════════════════════════════════
// SHE Analysis
// ═══════════════════════════════════════════════════════════════════

export interface SHEResult {
  logS: number[];
  logH: number[];
  logE: number[];
  sampleNames: string[];
}

export function sheAnalysis(abundanceMatrix: number[][], sampleNames?: string[]): SHEResult {
  const n = abundanceMatrix.length;
  const names = sampleNames ?? Array.from({ length: n }, (_, i) => `Sample_${i + 1}`);
  const logS: number[] = [], logH: number[] = [], logE: number[] = [];
  // A sample with no individuals has no logarithm at all. The previous code
  // wrote -Infinity into logS for such a sample while logH/logE used the -999
  // sentinel, so ONE empty sample carried TWO different encodings and JSON
  // serialisation turned the -Infinity into null. One sentinel now.
  const NO_DATA = -999;

  // Sort samples by total abundance (ascending)
  const totals = abundanceMatrix.map((row, i) => ({ total: row.reduce((a, b) => a + b, 0), idx: i }));
  totals.sort((a, b) => a.total - b.total);

  for (let i = 0; i < n; i++) {
    const row = abundanceMatrix[totals[i].idx];
    const counts = row.filter(v => v > 0);
    const S = counts.length;
    const N = counts.reduce((a, b) => a + b, 0);
    let H = 0;
    for (const c of counts) { const p = c / N; if (p > 0) H -= p * Math.log(p); }
    const E = S > 1 ? H / Math.log(S) : 0;
    // Standard SHE: log(S), H, E — no offset (S ≥ 1, H ≥ 0, E ≥ 0)
    logS.push(S > 0 ? Math.log(S) : NO_DATA);
    logH.push(H > 0 ? H : NO_DATA);
    logE.push(E > 0 ? E : NO_DATA);
  }

  return { logS, logH, logE, sampleNames: totals.map(t => names[t.idx]) }; // Fixed: use totals[i].idx correctly
}

// ═══════════════════════════════════════════════════════════════════
// Paleo-environmental Reconstruction
// ═══════════════════════════════════════════════════════════════════

export interface PaleoEnvResult {
  axis1Scores: number[];
  heights: number[];
  explainedInertia: number;
  pearsonCorr: number;
  wasFlipped: boolean;
  /** Species (column) scores on CA axis 1, sign-matched with site scores. */
  columnSpeciesAxis: number[];
  /** Singular values of the chi-square standardized matrix. */
  singularValues: number[];
}

export function paleoEnvironment(abundanceMatrix: number[][], heights: number[]): PaleoEnvResult {
  const n = abundanceMatrix.length;
  // Correspondence Analysis on abundance matrix
  const rowTotals = abundanceMatrix.map(row => row.reduce((a, b) => a + b, 0));
  const nCols = abundanceMatrix[0].length;
  const colTotals: number[] = new Array(nCols).fill(0);
  for (const row of abundanceMatrix) for (let j = 0; j < row.length; j++) colTotals[j] += row[j];
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  // Chi-square standardized matrix
  const expected = abundanceMatrix.map((row, i) => row.map((v, j) => rowTotals[i] * colTotals[j] / grandTotal));
  const Ystd = abundanceMatrix.map((row, i) => row.map((v, j) => expected[i][j] > 0 ? (v - expected[i][j]) / Math.sqrt(expected[i][j]) : 0));

  // Eigen-decomposition of YᵀY
  const Ymat = Matrix.from2D(Ystd);
  const { eigenvalues, eigenvectors } = eigh_from_matrix(Ymat.transpose().matmul(Ymat));
  const axis1 = Ymat.matmul(eigenvectors.sliceCols(0, 1)).col(0);

  // Correlation with heights
  const pearson = pearsonCorr(heights, axis1);
  let wasFlipped = false;
  const scores = [...axis1];
  if (pearson < 0) { for (let i = 0; i < scores.length; i++) scores[i] = -scores[i]; wasFlipped = true; }

  // Species (column) scores on CA axis 1.
  //
  // The eigenvectors come from YᵀY, so they live in the SPECIES space
  // (length nSpecies) and Y·v₁ (used above) is the SITE score. The CA column
  // principal coordinates are therefore v₁ scaled by √λ₁ — the standard
  // "species scores" of a correspondence analysis (vegan::cca reports exactly
  // this). The previous code used Y·v₁ here as well, which made
  // `columnSpeciesAxis` a bit-for-bit copy of `axis1Scores`.
  //
  // (Yᵀ·v₁ would be the form for eigenvectors of Y·Yᵀ, i.e. for the SITE
  // space; with the nSites×nSpecies layout used here it is not even
  // dimensionally defined unless nSites = nSpecies.)
  const lambda1 = Math.max(0, eigenvalues[0] ?? 0);
  const scale1 = Math.sqrt(lambda1);
  const speciesScoresRaw = eigenvectors.sliceCols(0, 1).col(0).map((v: number) => v * scale1);
  const speciesScores = wasFlipped ? speciesScoresRaw.map((v: number) => -v) : [...speciesScoresRaw];

  // Singular values = sqrt(eigenvalues) (paleoenv.py singular_values)
  const singularValues = eigenvalues.map(ev => Math.sqrt(Math.max(0, ev)));

  const totalInertia = eigenvalues.reduce((a, b) => a + Math.max(0, b), 0);
  const explained = totalInertia > 0 ? Math.max(0, eigenvalues[0]) / totalInertia : 0;

  return {
    axis1Scores: scores, heights: [...heights], explainedInertia: explained,
    pearsonCorr: Math.abs(pearson), wasFlipped, columnSpeciesAxis: speciesScores, singularValues,
  };
}

/**
 * Full eigen-decomposition via linalg.eigh.
 * Returns ALL eigenvalues and eigenvectors (descending order).
 * Callers should slice to top-k as needed.
 */
/** Pearson correlation between two equal-length series. */
function pearsonCorr(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom > 0 ? sxy / denom : 0;
}

function eigh_from_matrix(M: Matrix): { eigenvalues: number[]; eigenvectors: Matrix } {
  return linalg.eigh(M);
}

// ═══════════════════════════════════════════════════════════════════
// Log-series distribution fit (Fisher 1943)
// ═══════════════════════════════════════════════════════════════════

export interface LogSeriesResult {
  alpha: number;
  x: number;
  expected: number[];
  observed: number[];
  rSquared: number;
}

export function fitLogSeries(abundances: number[]): LogSeriesResult {
  const sorted = [...abundances].filter(v => v > 0).sort((a, b) => b - a);
  const S = sorted.length;
  const N = sorted.reduce((a, b) => a + b, 0);

  // Frequency counts: f(1), f(2), f(3), ...
  const maxAbund = Math.max(...sorted);
  const freq: number[] = new Array(maxAbund).fill(0);
  for (const a of sorted) freq[a - 1]++;

  // Fisher's alpha via 1D Newton iteration on f(α) = α·ln(1 + N/α) − S
  // (the x = N/(N+α) relation is substituted analytically, so the broken
  // 2-variable fixed-step loop is replaced by the exact solver of
  // diversity.py _compute_fisher_alpha)
  const alphaSolved = computeFisherAlpha(S, N);
  let alpha = alphaSolved ?? S / 5;
  let x = N / (alpha + N);

  // Expected frequencies
  const expected: number[] = [];
  for (let i = 1; i <= maxAbund; i++) expected.push(alpha * Math.pow(x, i) / i);

  // R-squared
  let ssRes = 0, ssTot = 0;
  const meanFreq = freq.reduce((a, b) => a + b, 0) / freq.length;
  for (let i = 0; i < freq.length; i++) {
    ssRes += (freq[i] - expected[i]) ** 2;
    ssTot += (freq[i] - meanFreq) ** 2;
  }

  return { alpha, x, expected, observed: freq, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

// ═══════════════════════════════════════════════════════════════════
// LB_Keogh lower bound for DTW
// ═══════════════════════════════════════════════════════════════════

export function lbKeogh(query: number[], reference: number[], window: number = 5): number {
  const nR = reference.length;
  const U: number[] = new Array(nR).fill(0);
  const L: number[] = new Array(nR).fill(0);

  for (let j = 0; j < nR; j++) {
    const lo = Math.max(0, j - window);
    const hi = Math.min(nR - 1, j + window);
    let maxV = -Infinity, minV = Infinity;
    for (let k = lo; k <= hi; k++) { maxV = Math.max(maxV, reference[k]); minV = Math.min(minV, reference[k]); }
    U[j] = maxV; L[j] = minV;
  }

  let lb = 0;
  for (let i = 0; i < query.length; i++) {
    const j = Math.min(i, nR - 1);
    if (query[i] > U[j]) lb += (query[i] - U[j]) ** 2;
    else if (query[i] < L[j]) lb += (L[j] - query[i]) ** 2;
  }
  return Math.sqrt(lb);
}


// Sample-based rarefaction (Scheiner 2003) — hypergeometric expectation
export interface SampleBasedRarefactionResult {
  sampleSizes: number[];
  expectedRichness: number[];
  observedRichness: number;
}

/** log C(n, k) computed without overflow. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lgammaLocal(n + 1) - lgammaLocal(k + 1) - lgammaLocal(n - k + 1);
}

function lgammaLocal(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgammaLocal(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Sample-based rarefaction with the exact hypergeometric expectation
 * (rarefaction.py compute_sample_based_rarefaction):
 *   E[S(k)] = Σ_i [1 − C(N − n_i, k) / C(N, k)]
 * where N = total sample count and n_i = samples containing species i.
 * (The previous prefix-scan implementation was a species-accumulation
 * curve, not a rarefaction — Python explicitly deprecated that form.)
 */
export function sampleBasedRarefaction(
  abundanceMatrix: number[][],
  nPoints: number = 50,
): SampleBasedRarefactionResult {
  const nSamples = abundanceMatrix.length;
  const allSpecies = new Set<number>();
  const occurrences = new Map<number, number>(); // species → #samples containing it
  for (let s = 0; s < nSamples; s++) {
    for (let j = 0; j < abundanceMatrix[s].length; j++) {
      if (abundanceMatrix[s][j] > 0) {
        allSpecies.add(j);
        occurrences.set(j, (occurrences.get(j) ?? 0) + 1);
      }
    }
  }

  const totalSpecies = allSpecies.size;
  const sampleSizes: number[] = [];
  const expected: number[] = [];
  const logC_N_k_cache = new Map<number, number>();

  for (let k = 1; k <= nSamples; k += Math.max(1, Math.floor(nSamples / Math.max(1, nPoints)))) {
    if (!logC_N_k_cache.has(k)) logC_N_k_cache.set(k, logChoose(nSamples, k));
    const logDenom = logC_N_k_cache.get(k)!;
    sampleSizes.push(k);
    let E = 0;
    for (const sp of allSpecies) {
      const ni = occurrences.get(sp) ?? 0;
      // P(species absent from a k-sample) = C(N−ni, k)/C(N, k)
      const logAbsent = logChoose(nSamples - ni, k) - logDenom;
      E += 1 - Math.exp(logAbsent);
    }
    expected.push(E);
  }
  return { sampleSizes, expectedRichness: expected, observedRichness: totalSpecies };
}

// ─── Re-exports: Coverage-based Rarefaction ────────────────────────────────────
export { coverageRarefaction, rarefaction, type CoverageRarefactionResult } from './CoverageRarefaction';
// ─── Re-exports: SQS ──────────────────────────────────────────────────────────
export { sqs, type SQSResult } from './SQS';
