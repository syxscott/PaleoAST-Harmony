/**
 * Macroevolution analysis — replaces macroevolution/*.py
 */
import { PhyloNode, pic } from '../phylogenetics/phylogenetics';
import { seed as seedRng, rand } from '../../math/random';

/**
 * Cohort survivorship analysis (Foote 1999).
 */
export interface CohortResult {
  intervals: { tStart: number; tEnd: number; nFB: number; nLB: number; nSurv: number }[];
  survivalRates: number[];
  originationRates: number[];
  extinctionRates: number[];
  confidenceIntervals: [number, number][];
  /** Cohort counts: backward persistence / backward extinction (origination) /
   *  forward persistence / forward extinction (cohort.py IntervalData). */
  nBt: number[];
  nBl: number[];
  nFt: number[];
  nFl: number[];
  /** Foote (1997) per-capita rates p = −ln(N_bt/N_t)/Δt, q = −ln(N_bl/N_t)/Δt. */
  foote97Origination: number[];
  foote97Extinction: number[];
  /** Foote (2000) boundary-crosser fractions p_F = N_Ft/N_t, q_F = N_FL/N_t. */
  foote00Origination: number[];
  foote00Extinction: number[];
  /** λ/μ ratio per interval (SurvivorshipResult.get_rate_ratio). */
  rateRatio: number[];
}

export function cohortSurvivorship(
  fossilRecords: [number, number][],
  intervals: [number, number][],
  confidenceLevel: number = 0.95,
): CohortResult {
  // two-sided normal quantile for the requested confidence level
  const z = normQuantileLocalMacro(1 - (1 - confidenceLevel) / 2);
  const results: CohortResult = {
    intervals: [], survivalRates: [], originationRates: [], extinctionRates: [],
    confidenceIntervals: [], nBt: [], nBl: [], nFt: [], nFl: [],
    foote97Origination: [], foote97Extinction: [], foote00Origination: [], foote00Extinction: [],
    rateRatio: [],
  };

  for (const [tStart, tEnd] of intervals) {
    // Half-open cohort counting (older boundary tStart exclusive of records
    // beginning exactly at the boundary of the previous interval):
    // nBt = backward persistence (in interval, known before)
    // nBl = backward extinction = originated within the interval
    // nFt = forward persistence (survived past tEnd)
    // nFl = forward extinction = last seen within the interval
    let nFB = 0, nLB = 0, nSurv = 0;
    let nBt = 0, nBl = 0, nFt = 0, nFl = 0;
    for (const [o, L] of fossilRecords) {
      const inInterval = o <= tStart && L >= tEnd;
      const knownBefore = o < tStart;
      const survivesAfter = L > tEnd;
      if (inInterval) {
        nSurv++;
        if (knownBefore) nBt++;
        if (survivesAfter) nFt++;
        if (!knownBefore) nBl++;
        if (!survivesAfter) nFl++;
      } else if (o >= tStart && o < tEnd && L >= tEnd) nFB++;
      else if (tStart <= L && L < tEnd && o < tStart) nLB++;
    }
    const nTotal = nSurv;
    results.intervals.push({ tStart, tEnd, nFB, nLB, nSurv });
    results.nBt.push(nBt); results.nBl.push(nBl); results.nFt.push(nFt); results.nFl.push(nFl);

    if (nTotal > 0) {
      const p = nSurv / nTotal;
      results.survivalRates.push(p);
      const dt = tStart - tEnd;
      if (dt > 0) {
        results.originationRates.push(p < 1 ? -Math.log(1 - p) / dt : 0);
        results.extinctionRates.push(p > 0 ? -Math.log(p) / dt : Infinity);
        // Foote (1997) per-capita rates from backward crossers
        results.foote97Origination.push(nBt > 0 ? -Math.log(nBt / nTotal) / dt : Infinity);
        results.foote97Extinction.push(nBl > 0 ? -Math.log(nBl / nTotal) / dt : Infinity);
        // Foote (2000) boundary-crosser fractions
        results.foote00Origination.push(nFt / nTotal);
        results.foote00Extinction.push(nFl / nTotal);
      } else {
        results.originationRates.push(0);
        results.extinctionRates.push(0);
        results.foote97Origination.push(NaN);
        results.foote97Extinction.push(NaN);
        results.foote00Origination.push(NaN);
        results.foote00Extinction.push(NaN);
      }
      const lam = results.originationRates[results.originationRates.length - 1];
      const muRate = results.extinctionRates[results.extinctionRates.length - 1];
      results.rateRatio.push(isFinite(lam) && isFinite(muRate) && muRate > 0 ? lam / muRate : NaN);
      // Wilson CI
      const center = p + z * z / (2 * nTotal);
      const width = z * Math.sqrt(p * (1 - p) / nTotal + z * z / (4 * nTotal * nTotal));
      const denom = 1 + z * z / nTotal;
      results.confidenceIntervals.push([(center - width) / denom, (center + width) / denom]);
    } else {
      results.survivalRates.push(NaN);
      results.originationRates.push(NaN);
      results.extinctionRates.push(NaN);
      results.confidenceIntervals.push([NaN, NaN]);
      results.foote97Origination.push(NaN);
      results.foote97Extinction.push(NaN);
      results.foote00Origination.push(NaN);
      results.foote00Extinction.push(NaN);
      results.rateRatio.push(NaN);
    }
  }
  return results;
}

/** Acklam normal quantile (local helper; avoids a circular import of math/stats). */
function normQuantileLocalMacro(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;
  let q: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    q = p - 0.5; const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Foote (1997) marginal survival analysis for one interval
 * (cohort.py foote_analysis): survival probability with Wilson CI plus
 * per-capita origination/extinction rates.
 */
export function footeAnalysis(
  nSurv: number,
  nTotal: number,
  dt: number,
): { survivalProb: number; extinctionProb: number; originationRate: number; extinctionRate: number; ciLower: number; ciUpper: number } {
  if (nTotal === 0) {
    return { survivalProb: NaN, extinctionProb: NaN, originationRate: NaN, extinctionRate: NaN, ciLower: NaN, ciUpper: NaN };
  }
  const p = nSurv / nTotal;
  const z = 1.96;
  const center = p + z * z / (2 * nTotal);
  const width = z * Math.sqrt(p * (1 - p) / nTotal + z * z / (4 * nTotal * nTotal));
  const denom = 1 + z * z / nTotal;
  const ciLower = (center - width) / denom;
  const ciUpper = (center + width) / denom;
  const originationRate = dt > 0 ? (p < 1 ? -Math.log(1 - p) / dt : 0) : NaN;
  const extinctionRate = dt > 0 ? (p > 0 ? -Math.log(p) / dt : Infinity) : NaN;
  return { survivalProb: p, extinctionProb: 1 - p, originationRate, extinctionRate, ciLower, ciUpper };
}

/** Per-capita origination/extinction rates from a survival probability (cohort.py per_capita_rates). */
export function perCapitaRates(survivalRate: number, dt: number): { lambda: number; mu: number } {
  if (dt <= 0 || survivalRate <= 0 || survivalRate >= 1) return { lambda: NaN, mu: NaN };
  return { lambda: -Math.log(1 - survivalRate) / dt, mu: -Math.log(survivalRate) / dt };
}

/**
 * Diversity dynamics — replaces macroevolution/diversity.py.
 */
export interface DiversityDynamicsResult {
  times: number[];
  richness: number[];
  originationRates: number[];
  extinctionRates: number[];
}

export function estimateDiversity(
  fossilRecords: [number, number][],
  intervals: [number, number][],
): DiversityDynamicsResult {
  const times: number[] = [], richness: number[] = [];
  const origRates: number[] = [], extRates: number[] = [];

  for (let i = 0; i < intervals.length; i++) {
    const [tStart, tEnd] = intervals[i];
    times.push((tStart + tEnd) / 2);
    const count = fossilRecords.filter(([o, L]) => o <= tStart && L >= tEnd).length;
    richness.push(count);

    if (i > 0) {
      const dt = tStart - tEnd;
      if (dt > 0) {
        const dR = count - richness[i - 1];
        origRates.push(dR > 0 ? dR / dt : 0);
        extRates.push(dR < 0 ? -dR / dt : 0);
      } else {
        origRates.push(0); extRates.push(0);
      }
    } else {
      origRates.push(0); extRates.push(0);
    }
  }
  return { times, richness, originationRates: origRates, extinctionRates: extRates };
}

/**
 * FBD (Fossilized Birth-Death) process — replaces macroevolution/fbd.py.
 */
export interface FBDResult {
  lineages: { birthTime: number; deathTime: number | null; fossilAges: number[] }[];
  extantSpecies: number;
  fossilCount: number;
  diversityCurve: number[];
}

export function simulateFBD(
  lambda: number, mu: number, psi: number, duration: number, nLineages: number = 1,
  randomSeed?: number,
): FBDResult {
  if (randomSeed !== undefined) seedRng(randomSeed);
  const lineages: { id: number; birthTime: number; deathTime: number | null; fossilAges: number[]; parentId: number | null; isAlive: boolean }[] = [];
  let nextId = 0;
  let currentTime = 0;

  // Initialize
  for (let i = 0; i < nLineages; i++) {
    lineages.push({ id: nextId++, birthTime: 0, deathTime: null, fossilAges: [], parentId: null, isAlive: true });
  }

  const events: { type: string; time: number }[] = [];
  let eventCount = 0;
  const maxEvents = 100000;

  while (currentTime < duration && eventCount < maxEvents) {
    const alive = lineages.filter(l => l.isAlive);
    if (alive.length === 0) break;

    const totalRate = alive.length * (lambda + mu + psi);
    if (totalRate <= 0) break;

    const tau = -Math.log(rand()) / totalRate;
    if (currentTime + tau > duration) { currentTime = duration; break; }
    currentTime += tau;

    const r = rand();
    const birthProb = lambda / totalRate;
    const deathProb = (lambda + mu) / totalRate;
    let eventType: string;
    if (r < birthProb) eventType = 'birth';
    else if (r < deathProb) eventType = 'death';
    else eventType = 'fossil';

    const idx = Math.floor(rand() * alive.length);
    const parent = alive[idx];

    if (eventType === 'birth') {
      lineages.push({ id: nextId++, birthTime: currentTime, deathTime: null, fossilAges: [], parentId: parent.id, isAlive: true });
      events.push({ type: 'birth', time: currentTime });
    } else if (eventType === 'death') {
      parent.isAlive = false;
      parent.deathTime = currentTime;
      events.push({ type: 'death', time: currentTime });
    } else {
      parent.fossilAges.push(currentTime);
      events.push({ type: 'fossil', time: currentTime });
    }
    eventCount++;
  }

  const extant = lineages.filter(l => l.isAlive).length;
  const fossils = lineages.reduce((s, l) => s + l.fossilAges.length, 0);

  return {
    lineages: lineages.map(l => ({ birthTime: l.birthTime, deathTime: l.deathTime, fossilAges: l.fossilAges })),
    extantSpecies: extant,
    fossilCount: fossils,
    diversityCurve: events.filter(e => e.type !== 'fossil').map((_, i) => nLineages + events.slice(0, i + 1).filter(e => e.type === 'birth').length - events.slice(0, i + 1).filter(e => e.type === 'death').length),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Cox Proportional Hazards Model
// ═══════════════════════════════════════════════════════════════════

export interface CoxPHResult {
  coefficients: number[];
  standardErrors: number[];
  hazardRatios: number[];
  zScores: number[];
  pValues: number[];
  logLikelihood: number;
  concordance: number;
  /** Akaike Information Criterion: 2k − 2·logLik with k = #covariates. */
  aic: number;
}

export function coxPH(durations: number[], events: number[], covariates: number[][]): CoxPHResult {
  const n = durations.length;
  const p = covariates[0]?.length ?? 0;

  // Center covariates
  const means: number[] = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) means[j] += covariates[i][j];
    means[j] /= n;
  }
  const X = covariates.map(row => row.map((v, j) => v - means[j]));

  // Newton-Raphson for MLE
  const beta = new Array(p).fill(0);
  const maxIter = 50;

  // Pre-compute risk sets once (Stadler 2010 / Cox 1972)
  const riskSets: number[][] = [];
  for (let i = 0; i < n; i++) {
    const riskSet: number[] = [];
    for (let j = 0; j < n; j++) {
      if (durations[j] >= durations[i]) riskSet.push(j);
    }
    riskSets.push(riskSet);
  }

  const grad = new Array(p).fill(0);
  const hess: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let iter = 0; iter < maxIter; iter++) {
    grad.fill(0);
    for (const hrow of hess) hrow.fill(0);

    // Gradient and Hessian
    for (let i = 0; i < n; i++) {
      if (events[i] === 0) continue;

      let denom = 0;
      const numer: number[] = new Array(p).fill(0);
      const numer2: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));

      for (const j of riskSets[i]) {
        let lp = 0;
        for (let k = 0; k < p; k++) lp += beta[k] * X[j][k];
        const exp_lp = Math.exp(Math.min(lp, 20));
        denom += exp_lp;
        for (let k = 0; k < p; k++) {
          numer[k] += X[j][k] * exp_lp;
          for (let l = 0; l < p; l++) numer2[k][l] += X[j][k] * X[j][l] * exp_lp;
        }
      }

      let lp_i = 0;
      for (let k = 0; k < p; k++) lp_i += beta[k] * X[i][k];

      for (let k = 0; k < p; k++) {
        grad[k] += X[i][k] - numer[k] / denom;
        for (let l = 0; l < p; l++) {
          hess[k][l] -= (numer2[k][l] / denom - numer[k] * numer[l] / (denom * denom));
        }
      }
    }

    // Newton step
    const delta = solveLinearSystem_cox(hess, grad);
    let converged = true;
    for (let k = 0; k < p; k++) {
      beta[k] -= delta[k];
      if (Math.abs(delta[k]) > 1e-6) converged = false;
    }
    if (converged) break;
  }

  // Standard errors from inverse Hessian - compute properly from hessian matrix
  // SE = sqrt(diag(inverse(Hessian)))
  const invHess = invertMatrix(hess);
  const se = invHess.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const hazardRatios = beta.map(b => Math.exp(b));
  const zScores = beta.map((b, i) => se[i] > 0 ? b / se[i] : 0);
  const pValues = zScores.map(z => 2 * (1 - normCDF_cox(Math.abs(z))));

  // Concordance index (Harrell's C) - count all comparable pairs
  let concordant = 0, total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Comparable if: one event, other could be event or censored
      const comparable = (events[i] === 1 && durations[i] < durations[j]) ||
                        (events[j] === 1 && durations[j] < durations[i]);
      if (!comparable) continue;

      // Calculate linear predictors
      let lp_i = 0, lp_j = 0;
      for (let k = 0; k < p; k++) {
        lp_i += beta[k] * X[i][k];
        lp_j += beta[k] * X[j][k];
      }

      // Higher lp means higher risk (shorter survival)
      if (events[i] === 1 && durations[i] < durations[j]) {
        if (lp_i > lp_j) concordant++; // i failed first and had higher risk
        total++;
      } else if (events[j] === 1 && durations[j] < durations[i]) {
        if (lp_j > lp_i) concordant++; // j failed first and had higher risk
        total++;
      }
    }
  }

  // Compute log-likelihood at convergence
  let logLik = 0;
  for (let i = 0; i < n; i++) {
    let lp = 0;
    for (let k = 0; k < p; k++) lp += beta[k] * X[i][k];
    const riskSum = riskSets[i].reduce((s, j) =>
      s + Math.exp(Math.min(beta.reduce((sp, b, k) => sp + b * X[j][k], 0), 20)), 0);
    logLik += events[i] * lp - Math.log(riskSum);
  }

  return {
    coefficients: beta, standardErrors: se, hazardRatios, zScores, pValues,
    logLikelihood: logLik, concordance: total > 0 ? concordant / total : 0.5,
    aic: 2 * p - 2 * logLik,
  };
}

/** Invert a square matrix using Gaussian elimination. Returns identity on singular matrix. */
function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => [...row, ...new Array(n).fill(0).map((_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-15) continue; // singular - return 0s
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
}

function solveLinearSystem_cox(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-15) continue;
    for (let j = 0; j <= n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) { if (row === col) continue; const f = aug[row][col]; for (let j = 0; j <= n; j++) aug[row][j] -= f * aug[col][j]; }
  }
  return aug.map(row => row[n]);
}

function normCDF_cox(x: number): number {
  return 0.5 * (1 + erf_cox(x / Math.SQRT2));
}

function erf_cox(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  return sign * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

// ═══════════════════════════════════════════════════════════════════
// Log-rank Test
// ═══════════════════════════════════════════════════════════════════

export interface LogRankResult {
  statistic: number;
  pValue: number;
  df: number;
}

export function logRankTest(group1: { time: number; event: number }[], group2: { time: number; event: number }[]): LogRankResult {
  const all = [...group1.map(g => ({ ...g, group: 0 })), ...group2.map(g => ({ ...g, group: 1 }))];
  all.sort((a, b) => a.time - b.time);

  const uniqueTimes = [...new Set(all.filter(a => a.event === 1).map(a => a.time))].sort((a, b) => a - b);

  let O1 = 0, E1 = 0, V = 0;
  const n1_total = group1.length, n2_total = group2.length;
  let n1 = n1_total, n2 = n2_total;

  for (const t of uniqueTimes) {
    const d1 = all.filter(a => a.time === t && a.event === 1 && a.group === 0).length;
    const d2 = all.filter(a => a.time === t && a.event === 1 && a.group === 1).length;
    const d = d1 + d2;
    const n = n1 + n2;

    if (n > 0) {
      O1 += d1;
      E1 += d * n1 / n;
      if (n > 1) V += d * (n1 / n) * (n2 / n) * (n - d) / (n - 1);
    }

    // Remove censored and dead at time t
    n1 -= all.filter(a => a.time === t && a.group === 0).length;
    n2 -= all.filter(a => a.time === t && a.group === 1).length;
  }

  const chi2 = V > 0 ? (O1 - E1) ** 2 / V : 0;
  const p = 1 - chi2CDF_lr(chi2, 1);

  return { statistic: chi2, pValue: p, df: 1 };
}

function chi2CDF_lr(x: number, k: number): number {
  if (x <= 0) return 0;
  return gammainc_lr(k / 2, x / 2);
}

function gammainc_lr(a: number, x: number): number {
  if (x <= 0) return 0;
  let sum = 1 / a, term = 1 / a;
  for (let n = 1; n < 200; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < 1e-14 * Math.abs(sum)) break; }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma_lr(a));
}

function lgamma_lr(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma_lr(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ═══════════════════════════════════════════════════════════════════
// Exponential / Logistic Model Fitting
// ═══════════════════════════════════════════════════════════════════

export interface ModelFitResult {
  name: string;
  params: Record<string, number>;
  rSquared: number;
  aic: number;
  residuals: number[];
}

export function fitExponential(times: number[], values: number[]): ModelFitResult {
  const logValues = values.map(v => Math.log(Math.max(v, 1e-10)));
  const { slope, intercept, r2 } = linReg(times, logValues);
  const predicted = times.map(t => Math.exp(slope * t + intercept));
  const residuals = values.map((v, i) => v - predicted[i]);
  const mse = residuals.reduce((s, r) => s + r * r, 0) / values.length;
  return { name: 'Exponential', params: { r: slope, N0: Math.exp(intercept) }, rSquared: r2, aic: values.length * Math.log(mse + 1e-10) + 4, residuals };
}

export function fitLogistic(times: number[], values: number[]): ModelFitResult {
  // Grid search for K, then linearize
  const maxVal = Math.max(...values);
  let bestR2 = -Infinity, bestParams = { r: 0.1, K: maxVal * 2, N0: values[0] };

  for (const K of [maxVal * 1.5, maxVal * 2, maxVal * 3, maxVal * 5]) {
    const logit = values.map(v => Math.log(Math.max(K / Math.max(v, 1e-10) - 1, 1e-10)));
    const { slope, intercept, r2 } = linReg(times, logit);
    if (r2 > bestR2) {
      bestR2 = r2;
      bestParams = { r: -slope, K, N0: K / (1 + Math.exp(intercept)) };
    }
  }

  const predicted = times.map(t => bestParams.K / (1 + ((bestParams.K - bestParams.N0) / bestParams.N0) * Math.exp(-bestParams.r * t)));
  const residuals = values.map((v, i) => v - predicted[i]);
  const mse = residuals.reduce((s, r) => s + r * r, 0) / values.length;

  return { name: 'Logistic', params: bestParams, rSquared: bestR2, aic: values.length * Math.log(mse + 1e-10) + 6, residuals };
}

function linReg(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (y[i] - (slope * x[i] + intercept)) ** 2; ssTot += (y[i] - my) ** 2; }
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

// ═══════════════════════════════════════════════════════════════════
// Neutral Simulation
// ═══════════════════════════════════════════════════════════════════

export interface NeutralSimResult {
  times: number[];
  richness: number[];
  originationRates: number[];
  extinctionRates: number[];
}

export function simulateNeutral(nTaxa: number, duration: number, specRate = 0.1, extRate = 0.05, dt = 0.1): NeutralSimResult {
  const nSteps = Math.floor(duration / dt);
  const times: number[] = new Array(nSteps).fill(0);
  const richness: number[] = new Array(nSteps).fill(0);
  const origRates: number[] = new Array(nSteps).fill(0);
  const extRates: number[] = new Array(nSteps).fill(0);

  let N = nTaxa;
  times[0] = 0;
  richness[0] = N;

  for (let i = 1; i < nSteps; i++) {
    times[i] = i * dt;
    const births = poisson_sim(specRate * N * dt);
    const deaths = Math.min(N, poisson_sim(extRate * N * dt));
    N = Math.max(0, N + births - deaths);
    richness[i] = N;
    origRates[i] = births / (N * dt + 1e-10);
    extRates[i] = deaths / (N * dt + 1e-10);
  }

  return { times, richness, originationRates: origRates, extinctionRates: extRates };
}

function poisson_sim(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// ═══════════════════════════════════════════════════════════════════
// FBD Log-Likelihood (Stadler 2010 / Heath et al. 2014)
// ═══════════════════════════════════════════════════════════════════

export function fbdLogLikelihood(
  speciation: number, extinction: number, fossilSampling: number,
  treeData: { nodeAges: number[]; isExtant: boolean[]; isFossil: boolean[] },
  rho: number = 1.0,
): number {
  const lambda = speciation, mu = extinction, psi = fossilSampling;
  const gamma = Math.sqrt((lambda - mu - psi) ** 2 + 4 * lambda * psi);
  const alpha = (lambda + mu + psi + gamma) / (2 * lambda);
  const beta_fbd = (lambda + mu + psi - gamma) / (2 * lambda);
  const r = 1 - rho;

  const E = (t: number): number => {
    // E(t) = probability a lineage alive at time t is extinct by present (Stadler 2010)
    // At t=0 (process origin), no lineages have had time to go extinct -> E(0) = 0
    if (t <= 0) return 0;
    if (lambda <= 0) return Math.max(0, Math.min(1, 1 - rho * Math.exp(-(mu + psi) * t)));
    const e_gt = Math.exp(gamma * t);
    const num = beta_fbd * (r - alpha) * e_gt - alpha * (r - beta_fbd);
    const den = (r - alpha) * e_gt - (r - beta_fbd);
    if (Math.abs(den) < 1e-300) return 1;
    return Math.max(0, Math.min(1, num / den));
  };

  const safeLog = (x: number) => x > 0 ? Math.log(x) : -Infinity;

  let logLik = 0;
  const { nodeAges, isExtant, isFossil } = treeData;

  for (let i = 0; i < nodeAges.length; i++) {
    const age = nodeAges[i];
    logLik += -(lambda + mu + psi) * age;
    if (isExtant[i]) {
      // Extant sampled: factor rho (Stadler 2010 Eq. 3)
      logLik += safeLog(rho);
    } else if (isFossil[i]) {
      // Fossil: factor psi * E(t) / (1 - E(t)) per Stadler 2010 / Heath et al. 2014
      // This is the odds that the lineage is represented in the fossil record
      const e_t = E(age);
      const oneMinusE = 1 - e_t;
      if (oneMinusE > 0) {
        logLik += safeLog(psi) + safeLog(e_t) - safeLog(oneMinusE);
      } else {
        logLik += safeLog(psi) + safeLog(e_t);
      }
    } else {
      // Internal node (neither extant tip nor fossil tip): factor
      // lambda * (1 - E(t)) / (1 - E(child_ages)) per FBD theory
      // For reconstructed birth-death process: speciation rate conditioned on
      // producing at least one sampled descendant
      logLik += safeLog(lambda) + safeLog(1 - E(age));
    }
  }

  return logLik;
}

// ═══════════════════════════════════════════════════════════════════
// Equilibrium Test (χ² test for origination = extinction)
// ═══════════════════════════════════════════════════════════════════

export interface EquilibriumResult {
  ratio: number;
  zStatistic: number;
  pValue: number;
  isEquilibrium: boolean;
}

export function testEquilibrium(originationRate: number, extinctionRate: number): EquilibriumResult {
  if (extinctionRate <= 0) return { ratio: Infinity, zStatistic: 0, pValue: 0, isEquilibrium: false };
  const ratio = originationRate / extinctionRate;
  const se = Math.sqrt(originationRate ** 2 + extinctionRate ** 2);
  const z = se > 0 ? (originationRate - extinctionRate) / se : 0;
  const p = 2 * (1 - normCDF_eq(Math.abs(z)));
  return { ratio, zStatistic: z, pValue: p, isEquilibrium: p > 0.05 };
}

function normCDF_eq(x: number): number {
  return 0.5 * (1 + erf_eq(x / Math.SQRT2));
}

function erf_eq(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  return sign * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

// ═══════════════════════════════════════════════════════════════════
// Signor-Lipps Correction (Signor & Lipps 1982)
// See also: paleotree::footeRateCI, Marshall (1990) CI
// ═══════════════════════════════════════════════════════════════════

export interface ExtinctionCIResult {
  extinctionRate: number;
  ciLower: number;
  ciUpper: number;
  samplingRate: number;
  turnover: number;
  method: 'signor-lipps' | 'marshall' | 'none';
}

/**
 * Compute extinction confidence intervals with optional Signor-Lipps (1982) correction.
 *
 * The Signor-Lipbs correction accounts for sampling uncertainty: even if no fossils
 * are found after time t, the true extinction may have occurred anywhere between t
 * and t + δ (the sampling interval). Marshall (1990) CI assumes a Poisson model;
 * the Signor-Lipbs extension adds uncertainty by modeling the sampling rate r as
 * uncertain, giving wider (more conservative) CIs.
 *
 * References:
 * - Signor, P.W. & Lipps, J.H. (1982). Sampling bias, gradual extinction
 *   scenarios, and extinction rates. Geol. Soc. Am. Spec. Pap. 190: 291–296.
 * - Marshall, C.R. (1990). Confidence intervals on stratigraphic ranges.
 *   Paleobiology 16(4): 461–464.
 * - Foote, M. (2000). Stratigraphic ranges in the marine fossil record.
 *   Paleobiology 26(4): 596–609.
 */
export function extinctionCI(
  lastOccurrence: number,
  intervalDuration: number,
  nOccurrences: number,
  samplingInterval: number,
  confidenceLevel: number = 0.95,
  correctSampling: 'signor-lipps' | 'none' = 'signor-lipps',
): ExtinctionCIResult {
  const z = 1.96; // 95% CI
  const alpha = 1 - confidenceLevel;

  // Sampling rate from the observed record
  const r = nOccurrences / intervalDuration;

  // Marshall (1990) CI: based on Poisson confidence limits for nOccurrences
  // The last occurrence is at lastOccurrence; the CI extends forward
  const k_crit = chi2Crit(alpha / 2, 2 * nOccurrences + 2) / 2;
  const k_crit_upper = chi2Crit(1 - alpha / 2, 2 * nOccurrences) / 2;

  if (correctSampling === 'none') {
    const extRate = r; // point estimate = sampling rate
    return {
      extinctionRate: extRate,
      ciLower: k_crit_upper / intervalDuration,
      ciUpper: k_crit / intervalDuration,
      samplingRate: r,
      turnover: 1,
      method: 'none',
    };
  }

  // Signor-Lipbs (1982): the sampling rate r is itself uncertain.
  // The confidence interval on the extinction rate e must account for
  // uncertainty in r: the full extinction interval is [t, t + δ] where
  // δ ~ Uniform(0, samplingInterval) due to Signor-Lipbs effect.
  //
  // We use the Marshall (1990) framework but add a uniform random
  // offset δ to the apparent last occurrence, then integrate over r.
  // This gives: CI_upper = (nOccurrences + 1) / (t + δ) (approx)
  // A conservative (Signor-Lipbs-aware) CI is wider by ~samplingInterval/2.
  const delta_sl = samplingInterval / 2; // expected offset due to Signor-Lipbs
  const t_eff = intervalDuration + delta_sl; // effective duration accounting for gap

  const extRate = r;
  const ciLower = Math.max(0, (nOccurrences - z * Math.sqrt(nOccurrences)) / t_eff);
  const ciUpper = (nOccurrences + 1 + z * Math.sqrt(nOccurrences + 1)) / (intervalDuration + delta_sl);

  return {
    extinctionRate: extRate,
    ciLower,
    ciUpper,
    samplingRate: r,
    turnover: 1, // turnover = extinction/sampling when no other info
    method: 'signor-lipps',
  };
}

/** Chi-squared quantile (inverse CDF) — simple bisection. */
function chi2Crit(p: number, df: number): number {
  let lo = 0, hi = 1000;
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (chi2CDF_sl(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function chi2CDF_sl(x: number, df: number): number {
  return gammainc_sl(df / 2, x / 2);
}

function gammainc_sl(a: number, x: number): number {
  if (x <= 0) return 0;
  let sum = 1 / a, term = 1 / a;
  for (let n = 1; n < 200; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < 1e-14 * Math.abs(sum)) break; }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma_sl(a));
}

function lgamma_sl(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma_sl(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ═══════════════════════════════════════════════════════════════════
// OU (Ornstein-Uhlenbeck) and Early Burst (EB) Evolution Models
// References:
// - Hansen, T.F. (1997). Stabilizing selection and the comparative analysis
//   of adaptation. Evolution 51(5): 1341–1351. [OU model]
// - Butler, M.A. & King, A.A. (2004). Phylogenetic comparative analysis:
//   a modeling approach for adaptive evolution. Am. Nat. 164(5): 683–695. [OUM]
// - Blomberg, S.P. et al. (2003). Testing for phylogenetic signal in
//   comparative data: behavioral traits are more labile. Evolution 57(4): 717–745. [EB]
// ═══════════════════════════════════════════════════════════════════

export interface OUResult {
  /** Adaptive optimum θ */
  theta: number;
  /** Selection strength α */
  alpha: number;
  /** Brownian motion variance σ² */
  sigma2: number;
  /** Log-likelihood */
  logLik: number;
  /** AIC */
  aic: number;
  /** Trait mean (used as starting guess for θ) */
  traitMean: number;
}

export interface EBResult {
  /** Initial rate r₀ */
  r0: number;
  /** Rate parameter r (positive = early burst, negative = decline) */
  r: number;
  /** σ² (diffusion coefficient) */
  sigma2: number;
  logLik: number;
  aic: number;
}

/**
 * Maximum-likelihood fit of the Ornstein-Uhlenbeck (OU) process to trait data
 * on a phylogenetic tree.
 *
 * The OU process: dX = α(θ - X)dt + σ dW
 * where α > 0 is the strength of selection (mean-reversion rate),
 * θ is the optimum, and σ is the diffusion coefficient.
 *
 * The log-likelihood is computed from the phylogenetic VCV matrix transformed
 * by the OU solution (Hansen 1997, Butler & King 2004):
 * V_OU = (σ²/2α) * (exp(-α*L_ij) + exp(-α*L_ji) - exp(-α*L_ij_shared))
 * For implementation we use the standard OU phylogenetic regression.
 *
 * References:
 * - Hansen, T.F. (1997). Stabilizing selection and the comparative analysis
 *   of adaptation. Evolution 51(5): 1341–1351.
 * - Butler, M.A. & King, A.A. (2004). Phylogenetic comparative analysis:
 *   a modeling approach for adaptive evolution. Am. Nat. 164(5): 683–695.
 */
export function fitOU(
  tree: PhyloNode,
  traitData: Record<string, number>,
  options?: { maxIter?: number; tol?: number }
): OUResult {
  const tips = tree.getLeaves();
  const tipNames = tips.map(t => t.name);
  const n = tips.length;
  const traits = tipNames.map(name => traitData[name] ?? 0);
  const mean_trait = traits.reduce((a, b) => a + b, 0) / n;

  // Build phylogenetic VCV (standard Brownian motion convention:
  // diag = root→tip, off-diag = root→LCA — the previous accumulation of
  // tip→LCA paths produced tip-tip distances and a singular matrix)
  const V: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    V[i][i] = tips[i].distanceToAncestor(tree);
    for (let j = i + 1; j < n; j++) {
      const lca = tips[i].computeLCA(tips[j]);
      const shared = lca ? tips[i].distanceToAncestor(lca) : 0;
      V[i][j] = V[j][i] = shared;
    }
  }

  // Negative log-likelihood for ML optimization
  function negLogLik(params: number[]): number {
    const [alpha, sigma2, theta] = params;
    if (alpha <= 0 || sigma2 <= 0) return 1e10;
    // Transform V by OU exponential decay: exp(-alpha * shared_path)
    const Vscaled: number[][] = Array.from({ length: n }, (_, i) =>
      new Array(n).fill(0).map((_, j) => {
        if (i === j) return V[i][j];
        // For OU, off-diagonal V[i,j] = (sigma2/2alpha) * (1 - exp(-2*alpha*shared))
        return (sigma2 / (2 * alpha)) * (1 - Math.exp(-2 * alpha * V[i][j]));
      })
    );
    // Add jitter for numerical stability
    for (let k = 0; k < n; k++) Vscaled[k][k] += 1e-8;
    const ll = mvnormLogDensity_ou(traits.map(t => t - theta), Vscaled);
    return isFinite(ll) ? -ll : 1e10;
  }

  // Grid search for initial values
  const alphas = [0.01, 0.1, 0.5, 1, 2, 5, 10];
  const sigmas = [0.1, 0.5, 1, 2];
  let bestParams = [1.0, 1.0, mean_trait];
  let bestNLL = Infinity;

  for (const a of alphas) {
    for (const s of sigmas) {
      const nll = negLogLik([a, s, mean_trait]);
      if (nll < bestNLL) { bestNLL = nll; bestParams = [a, s, mean_trait]; }
    }
  }

  // Newton-Raphson refinement (3 parameters: alpha, sigma2, theta)
  const maxIter = options?.maxIter ?? 100;
  const tol = options?.tol ?? 1e-6;
  let [alpha, sigma2, theta] = bestParams;

  for (let iter = 0; iter < maxIter; iter++) {
    // Numerical gradient
    const eps = 1e-5;
    const grad: number[] = [];
    const params = [alpha, sigma2, theta];
    const baseNLL = negLogLik(params);
    for (let i = 0; i < 3; i++) {
      const p = [...params];
      p[i] += eps;
      grad.push((negLogLik(p) - baseNLL) / eps);
    }

    // Simple gradient descent step (Hessian is complex to compute numerically)
    const stepSize = 0.001;
    const newParams = params.map((p, i) => Math.max(1e-6, p - stepSize * grad[i]));
    const newNLL = negLogLik(newParams);

    if (newNLL < baseNLL) {
      [alpha, sigma2, theta] = newParams;
      if (Math.abs(newNLL - baseNLL) < tol) break;
    } else {
      // Try smaller step
      const smallStep = newParams.map((p, i) => params[i] + 0.1 * (p - params[i]));
      const smallerNLL = negLogLik(smallStep);
      if (smallerNLL < baseNLL) {
        [alpha, sigma2, theta] = smallStep;
      }
      break;
    }
  }

  const finalNLL = negLogLik([alpha, sigma2, theta]);
  const k = 3; // number of parameters
  const logLik = -finalNLL;

  return {
    theta,
    alpha,
    sigma2,
    logLik,
    aic: 2 * k - 2 * logLik,
    traitMean: mean_trait,
  };
}

function mvnormLogDensity_ou(x: number[], V: number[][]): number {
  const n = x.length;
  // Cholesky-based log-density
  const L: number[][] = Array.from({ length: n }, (_, i) => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = V[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return -Infinity;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  const y: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < i; j++) s += L[i][j] * y[j];
    y[i] = (x[i] - s) / L[i][i];
  }
  let quad = 0;
  for (let i = 0; i < n; i++) quad += y[i] * y[i];
  let logDet = 0;
  for (let i = 0; i < n; i++) logDet += Math.log(L[i][i]);
  logDet *= 2;
  return -0.5 * (quad + logDet + n * Math.log(2 * Math.PI));
}

/**
 * Maximum-likelihood fit of the Early Burst (EB) / Rate Variability model.
 *
 * The EB process: dX/dt = r₀·exp(-r·t)·X + σ·dW
 * or equivalently: variance accumulates as V(t) = σ²/r · (1 - exp(-r·t))
 *
 * For a tree with branch lengths L, the expected variance under EB is:
 * V_ij = (σ²/r) · (shared_path_length) · exp(-r · depth_to_MRCA)
 *
 * When r > 0: early burst (rapid early evolution, slows down)
 * When r < 0: declining rate (slow start, accelerates)
 * When r = 0: Brownian motion (σ² · t)
 *
 * References:
 * - Blomberg, S.P. et al. (2003). Testing for phylogenetic signal in
 *   comparative data. Evolution 57(4): 717–745.
 */
export function fitEarlyBurst(
  tree: PhyloNode,
  traitData: Record<string, number>,
  options?: { maxIter?: number; tol?: number }
): EBResult {
  const tips = tree.getLeaves();
  const tipNames = tips.map(t => t.name);
  const n = tips.length;
  const traits = tipNames.map(name => traitData[name] ?? 0);

  // Build VCV with path lengths and depths to MRCA
  interface VCVEntry { shared: number; depthToLCA: number }
  const vcvInfo: VCVEntry[][] = Array.from({ length: n }, () => []);
  const tipDepths: number[] = [];

  // Compute tip depths (root-to-tip path length)
  for (let i = 0; i < n; i++) {
    let depth = 0;
    let node: PhyloNode | null = tips[i];
    while (node) { depth += node.branchLength || 0; node = node.parent; }
    tipDepths[i] = depth;
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lca = tips[i].computeLCA(tips[j]);
      const shared = lca ? tips[i].distanceToAncestor(lca) : 0;
      // depth to LCA: time from root to MRCA
      const depthToLCA = lca ? lca.distanceToAncestor(tree) : 0;
      vcvInfo[i][j] = { shared, depthToLCA };
    }
  }

  function negLogLik(params: number[]): number {
    const [r, sigma2] = params;
    if (sigma2 <= 0) return 1e10;
    const n = traits.length;
    const V: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const { shared, depthToLCA } = vcvInfo[i][j];
        if (r === 0) {
          V[i][j] = sigma2 * shared;
        } else {
          // EB: variance scales with rate at time of MRCA
          V[i][j] = (sigma2 / Math.abs(r)) * shared * Math.exp(-r * depthToLCA);
        }
      }
    }
    // Jitter for stability
    for (let k = 0; k < n; k++) V[k][k] += 1e-8;
    const ll = mvnormLogDensity_ou(traits, V);
    return isFinite(ll) ? -ll : 1e10;
  }

  // Grid search for r and sigma2
  const rs = [-2, -1, -0.5, -0.1, 0, 0.1, 0.5, 1, 2, 5];
  const sigmas = [0.1, 0.5, 1, 2, 5];
  let bestParams = [0, 1.0];
  let bestNLL = Infinity;

  for (const r of rs) {
    for (const s of sigmas) {
      const nll = negLogLik([r, s * s]);
      if (nll < bestNLL) { bestNLL = nll; bestParams = [r, s * s]; }
    }
  }

  // Gradient descent refinement
  const maxIter = options?.maxIter ?? 50;
  const tol = options?.tol ?? 1e-6;
  let [r, sigma2] = bestParams;

  for (let iter = 0; iter < maxIter; iter++) {
    const eps = 1e-4;
    const gradR = (negLogLik([r + eps, sigma2]) - negLogLik([r, sigma2])) / eps;
    const gradS = (negLogLik([r, sigma2 + eps]) - negLogLik([r, sigma2])) / eps;
    const step = 0.01;
    const newR = r - step * gradR;
    const newS2 = Math.max(1e-6, sigma2 - step * gradS);
    const newNLL = negLogLik([newR, newS2]);
    if (Math.abs(newNLL - bestNLL) < tol) break;
    if (newNLL < bestNLL) { r = newR; sigma2 = newS2; bestNLL = newNLL; }
    else break;
  }

  const logLik = -negLogLik([r, sigma2]);
  return {
    r0: Math.sqrt(sigma2),
    r,
    sigma2,
    logLik,
    aic: 4 - 2 * logLik, // 2 params (r, sigma2)
  };
}

/** Unified evolution rate interface that wraps OU, EB, and PIC-based methods. */
export interface EvolutionRateResult {
  model: 'ou' | 'eb' | 'bm' | 'pic';
  /** Rate estimate (interpretation depends on model) */
  rate: number;
  params: Record<string, number>;
  logLik: number;
  aic: number;
}

/**
 * Fit an evolutionary rate model (OU, EB, or PIC-based) to trait data on a tree.
 *
 * @param tree  Phylogenetic tree
 * @param traitData  Trait values at tips
 * @param model  'ou' | 'eb' | 'bm' | 'pic'
 */
export function evolutionRate(
  tree: PhyloNode,
  traitData: Record<string, number>,
  model: 'ou' | 'eb' | 'bm' | 'pic' = 'bm',
): EvolutionRateResult {
  if (model === 'ou') {
    const result = fitOU(tree, traitData);
    return { model: 'ou', rate: result.alpha, params: { theta: result.theta, alpha: result.alpha, sigma2: result.sigma2 }, logLik: result.logLik, aic: result.aic };
  }
  if (model === 'eb') {
    const result = fitEarlyBurst(tree, traitData);
    return { model: 'eb', rate: result.r, params: { r0: result.r0, r: result.r, sigma2: result.sigma2 }, logLik: result.logLik, aic: result.aic };
  }
  if (model === 'pic') {
    const result = pic(tree, traitData);
    const meanRate = result.contrasts.reduce((a, b) => a + Math.abs(b), 0) / result.nContrasts;
    return { model: 'pic', rate: meanRate, params: { nContrasts: result.nContrasts }, logLik: 0, aic: 0 };
  }
  // BM: simple rate estimate = sum(contrasts²) / total tree length
  const result = pic(tree, traitData);
  const totalVar = result.contrasts.reduce((a, b) => a + b * b, 0);
  const treeLength = tree.computeTotalLength();
  const sigma2 = treeLength > 0 ? totalVar / treeLength : 0;
  return { model: 'bm', rate: Math.sqrt(sigma2), params: { sigma2, nContrasts: result.nContrasts }, logLik: 0, aic: 0 };
}

// ─── Re-exports: Kaplan-Meier survival ─────────────────────────────────────────
export { kaplanMeier, type SurvivalResult } from './KaplanMeier';

// ═══════════════════════════════════════════════════════════════════
// FBD analytic functions + survival summaries
// (ported from fbd.py FossilizedBirthDeathProcess and survival.py summaries)
// ═══════════════════════════════════════════════════════════════════

/**
 * Probability that a lineage alive at time t before present leaves NO sampled
 * descendant (neither extant tip nor fossil). E(t) satisfies the Riccati ODE
 * dE/dt = λE² − (λ+μ+ψ)E + μ with E(0) = 1 − ρ (fbd.py _E). Integrated
 * with RK4 for numerical robustness.
 */
export function fbdExtinctionProbability(
  lambda: number, mu: number, psi: number, rho: number, t: number,
): number {
  if (t <= 0) return 1 - rho;
  const f = (E: number): number => lambda * E * E - (lambda + mu + psi) * E + mu;
  const steps = Math.max(64, Math.min(4096, Math.ceil(t * 128)));
  const h = t / steps;
  let E = 1 - rho;
  for (let i = 0; i < steps; i++) {
    const k1 = f(E);
    const k2 = f(E + h / 2 * k1);
    const k3 = f(E + h / 2 * k2);
    const k4 = f(E + h * k3);
    E += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
    if (E < 0) E = 0;
    if (E > 1) E = 1;
  }
  return E;
}

/** P(lineage survives to present): S(t) = r/(r + μ(1−e^{−rt})); r≈0 → 1/(1+μt). */
export function survivalProbability(lambda: number, mu: number, age: number): number {
  if (age < 0) return NaN;
  if (age === 0) return 1.0;
  const r = lambda - mu;
  if (Math.abs(r) < 1e-10) return 1.0 / (1.0 + mu * age);
  const expRt = Math.exp(-r * age);
  return r / (r + mu * (1.0 - expRt));
}

/** Expected diversity from one lineage after time t: e^{(λ−μ)t}. */
export function expectedDiversity(lambda: number, mu: number, time: number): number {
  return Math.exp((lambda - mu) * time);
}

/** Poisson pmf of fossil counts per lineage over an age span (fbd.py fossil_count_distribution). */
export function fossilCountDistribution(
  lambda: number, mu: number, psi: number, rho: number, age: number, maxK: number = 20,
): number[] {
  // Mean fossil count ≈ ψ · ∫₀^age N(t)dt for a lineage running age years,
  // standardised by survival: ψ·age for a lineage that persists the span.
  void lambda; void mu; void rho;
  const meanCount = Math.max(0, psi * age);
  const probs: number[] = [];
  let logFact = 0;
  for (let k = 0; k <= maxK; k++) {
    if (k > 0) logFact += Math.log(k);
    const logP = -meanCount + k * Math.log(meanCount > 0 ? meanCount : 1e-300) - logFact;
    probs.push(meanCount === 0 ? (k === 0 ? 1 : 0) : Math.exp(logP));
  }
  return probs;
}

/** Human-readable summary of a Kaplan-Meier / cohort survival fit. */
export function summarizeSurvival(
  times: number[],
  survivalProbs: number[],
  median?: number,
): string {
  const last = survivalProbs.length > 0 ? survivalProbs[survivalProbs.length - 1] : NaN;
  return `Survival: ${survivalProbs.length} time points, final S(t)=${last.toFixed(3)}`
    + (median !== undefined ? `, median=${median.toFixed(2)}` : ', median not reached');
}

/** Human-readable summary of a Cox proportional-hazards fit. */
export function summarizeCoxPH(coefficients: number[], pValues: number[], concordance: number): string {
  const sig = pValues.filter(p => p < 0.05).length;
  return `Cox PH: ${coefficients.length} covariate(s), ${sig} significant at 5%, C-index=${concordance.toFixed(3)}`;
}

/** Human-readable summary of a log-rank test. */
export function summarizeLogRank(statistic: number, pValue: number): string {
  const verdict = pValue < 0.05 ? 'significant difference' : 'no significant difference';
  return `Log-rank: χ²=${statistic.toFixed(3)}, p=${pValue.toFixed(4)} → ${verdict} between groups`;
}
