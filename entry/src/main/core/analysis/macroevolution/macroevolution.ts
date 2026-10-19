/**
 * Macroevolution analysis — replaces macroevolution/*.py
 */
import { PhyloNode, pic } from '../phylogenetics/phylogenetics';
import { seed as seedRng, rand, poisson } from '../../math/random';
import { ComputationError, ConvergenceError } from '../../utils/Exceptions';
import { pchisq, qchisq } from '../../math/stats';

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
    // Time orientation: ages increase into the past, so tStart is the YOUNG
    // (youngest) boundary and tEnd the OLD one, giving tStart > tEnd. The
    // positive interval duration below is `dt = tStart - tEnd`, which is why
    // the record tests are written against that ordering.
    //
    // The Python original (macroevolution/cohort.py) uses the mirrored
    // convention — there t_start < t_end — so its predicates are written
    // `o > t_end` for "started before" and `L <= t_start` for "ended after".
    // The previous ArkTS translation flipped the bounds but not the operators,
    // which made the two boundary-crosser branches unsatisfiable:
    //   nFB: `o >= tStart && o < tEnd`  — impossible when tStart > tEnd
    //   nLB: `tStart <= L && L < tEnd`  — likewise impossible
    // So nFB and nLB were always 0, every taxon that touched the interval was
    // counted as a survivor, and the whole cohort analysis was degenerate. The
    // predicates below are the same four cases as the Python, re-expressed for
    // the young/old ordering this port uses.
    //
    //   nSurv  through-timer : existed before, survived past the young boundary
    //   nLB    backward crosser: existed before, went extinct inside
    //   nFB    forward crosser : originated inside, survived past
    //           (both)        : originated and went extinct inside
    // Taxa lying entirely before or entirely after the interval are not counted.
    let nFB = 0, nLB = 0, nSurv = 0;
    let nBt = 0, nBl = 0, nFt = 0, nFl = 0;
    for (const [o, L] of fossilRecords) {
      // The three origin bands must partition, so "before" has to be measured
      // against the bin's YOUNG boundary (`o > tStart`) and "after" against its
      // OLD one (`o < tEnd`). Writing `startedBefore = o > tEnd` — as the
      // previous version did — overlaps the interval itself, so every taxon
      // born inside the bin was classified as predating it.
      const startedBefore = o > tStart;
      const startedIn = o <= tStart && o >= tEnd;
      const endedAfter = L >= tStart;
      const endedIn = L < tStart && L >= tEnd;
      if (startedBefore && endedAfter) {
        nSurv++; nBt++; nFt++;
      } else if (startedBefore && endedIn) {
        nLB++; nBt++; nFl++;
      } else if (startedIn && endedAfter) {
        nFB++; nBl++; nFt++;
      } else if (startedIn && endedIn) {
        nBl++; nFl++;
      }
    }
    // The cohort total is every taxon that touched the interval — the
    // survivors plus BOTH boundary crossers. This line previously read
    // `const nTotal = nSurv;`, which dropped nFB and nLB and made
    // `p = nSurv / nTotal` identically 1 for every interval and every input:
    // survivalRates came out as all 1, originationRates and extinctionRates as
    // all 0, rateRatio as all NaN, and the Wilson interval collapsed to [1, 1].
    // The Python original (macroevolution/cohort.py) states it as
    // `n_total = n_fb + n_lb + n_surv`.
    const nTotal = nFB + nLB + nSurv;
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
  randomSeed: number = 42,
): FBDResult {
  // The seed defaults to 42 like every other simulation in this repo. The
  // old signature took `randomSeed?: number` and only seeded the PRNG when
  // a seed was given, so the controller's `simulateFBD(lambda, mu, psi,
  // dur)` call inherited whatever state the module-level PRNG happened to
  // be in: the same input gave a different simulation on every run.
  seedRng(randomSeed);
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

  // Diversity curve: the number of lineages alive AFTER each birth/death
  // event.
  //
  // The previous expression mapped over the FILTERED event list (fossils
  // removed) but sliced the UNFILTERED one with the filtered index, so every
  // event that followed a fossil was read at the wrong position. With
  // seed 1 the curve came out as [2,2] where the simulation actually
  // produced a birth at t=0.31 and another at t=2.62, i.e. [2,3].
  // The prefix sum has to run over the filtered list.
  const nonFossilEvents = events.filter(e => e.type !== 'fossil');
  let alive = nLineages;
  const diversityCurve = nonFossilEvents.map(e => {
    if (e.type === 'birth') alive++;
    else alive--;
    return alive;
  });

  return {
    lineages: lineages.map(l => ({ birthTime: l.birthTime, deathTime: l.deathTime, fossilAges: l.fossilAges })),
    extantSpecies: extant,
    fossilCount: fossils,
    diversityCurve,
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

  if (durations.length !== events.length) {
    throw new ComputationError(
      `coxPH: durations (${durations.length}) and events (${events.length}) must have the same length`);
  }
  if (covariates.length !== durations.length) {
    throw new ComputationError(
      `coxPH: covariates (${covariates.length}) must provide one row per observation (${durations.length})`);
  }
  if (n === 0) throw new ComputationError('coxPH: no observations to fit');
  const nEvents = events.reduce((s, e) => s + (e > 0 ? 1 : 0), 0);
  if (nEvents === 0) {
    // Without a single event the partial likelihood is 0/0 for every beta:
    // there is nothing to estimate, and the old code went on to report
    // logLik = -1.79, SE = 1, z = 0, p = 1 for a "fit" of pure noise.
    throw new ComputationError(
      'coxPH: the data contain no events (every observation is censored). ' +
      'The Cox partial likelihood is undefined without at least one event.');
  }

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

  // Standard errors from the inverse of the OBSERVATION information matrix.
  //
  // The accumulated `hess` is the Hessian of the NEGATIVE log-likelihood,
  // i.e. -I, so the information matrix is -hess. Inverting `hess` itself
  // yields negative variances, and `Math.max(0, ·)` then silently turned
  // every standard error into 0 -- which made z = 0 and p = 1 for every
  // input, including the fixture below where beta = -0.1488 is a real
  // effect. Invert -hess instead.
  const information = hess.map(row => row.map(v => -v));
  const invInformation = invertMatrix(information);
  const se = invInformation.map((row, i) => Math.sqrt(Math.max(0, row[i])));
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

  // Cox partial log-likelihood (Cox 1972, eq. 4.3):
  //
  //   logL = Σ_{i : δ_i = 1} [ β·x_i − log( Σ_{j ∈ R_i} e^{β·x_j} ) ]
  //
  // The old code added `events[i] * lp − log(riskSum)` for EVERY row, so each
  // censored observation removed a log(riskSum) term it never contributed
  // to. For the fixture dur=[5,3,6,2,4], ev=[1,1,0,1,0], x=[1..5] that
  // reported logLik = -4.7616 / AIC = 11.523 instead of the correct
  // partial log-likelihood -3.6337 / AIC = 9.2674.
  //
  // Note the censoring convention: the risk set R_i contains every subject
  // with duration ≥ duration_i, and only EVENT rows contribute.
  let logLik = 0;
  for (let i = 0; i < n; i++) {
    if (events[i] !== 1) continue;
    let lp = 0;
    for (let k = 0; k < p; k++) lp += beta[k] * X[i][k];
    let riskSum = 0;
    for (const j of riskSets[i]) {
      let lpj = 0;
      for (let k = 0; k < p; k++) lpj += beta[k] * X[j][k];
      riskSum += Math.exp(Math.min(lpj, 20));
    }
    logLik += lp - Math.log(riskSum);
  }

  return {
    coefficients: beta, standardErrors: se, hazardRatios, zScores, pValues,
    logLikelihood: logLik, concordance: total > 0 ? concordant / total : 0.5,
    aic: 2 * p - 2 * logLik,
  };
}

/**
 * Invert a square matrix using Gauss-Jordan elimination.
 *
 * @throws {ComputationError} when the matrix is singular. The old version
 *   `continue`d past a zero pivot, which left the augmented matrix
 *   un-normalised and returned it as the "inverse" (for an all-zero Hessian
 *   that is the identity, hence SE = 1 for a completely uninformative fit).
 *   Silently wrong standard errors are worse than an error.
 */
function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => [...row, ...new Array(n).fill(0).map((_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-15) {
      throw new ComputationError(
        'invertMatrix: the matrix is singular (a covariate carries no information, ' +
        'e.g. it is constant). The standard errors are not defined.');
    }
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

  // Risk-set bookkeeping.
  //
  // The old implementation took `uniqueTimes` from the EVENT times only and
  // removed observations from the risk set only at those times, so a
  // censored observation stayed "at risk" until the next event -- i.e. it
  // was counted in the risk set of every event time before its own
  // censoring. For g1 = [(0.5, censored), (1, event), (2, event)] and
  // g2 = [(1, event), (3, event)] that gave chi2 = 0.16155 instead of the
  // standard 0.42857.
  //
  // Here every DISTINCT time (event or censoring) is a bookkeeping point:
  // the risk set at time t is {i : time_i >= t} -- a subject censored at t is
  // still at risk for an event at t and leaves the set immediately after --
  // and all subjects observed at t leave the risk set once t is processed.
  let O1 = 0, E1 = 0, V = 0;
  let n1 = group1.length, n2 = group2.length;

  let idx = 0;
  while (idx < all.length) {
    const t = all[idx].time;
    let d1 = 0, d2 = 0, m1 = 0, m2 = 0;
    while (idx < all.length && all[idx].time === t) {
      if (all[idx].group === 0) { m1++; if (all[idx].event === 1) d1++; }
      else { m2++; if (all[idx].event === 1) d2++; }
      idx++;
    }
    const d = d1 + d2;
    const n = n1 + n2;
    if (d > 0 && n > 0) {
      O1 += d1;
      E1 += d * n1 / n;
      if (n > 1) V += d * (n1 / n) * (n2 / n) * (n - d) / (n - 1);
    }
    // everyone observed at time t leaves the risk set now
    n1 -= m1;
    n2 -= m2;
  }

  const chi2 = V > 0 ? (O1 - E1) ** 2 / V : 0;
  const p = 1 - pchisq(chi2, 1);

  return { statistic: chi2, pValue: p, df: 1 };
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

/**
 * Neutral (zero-sum) simulation of standing richness through time.
 *
 * @param rngSeed seed for the simulation's PRNG (default 42, matching the
 *   convention used elsewhere in this repo). Without it the trajectory was
 *   driven by Math.random() and changed on every call.
 */
export function simulateNeutral(nTaxa: number, duration: number, specRate = 0.1, extRate = 0.05, dt = 0.1, rngSeed: number = 42): NeutralSimResult {
  seedRng(rngSeed);
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
    const births = poisson(specRate * N * dt);
    const deaths = Math.min(N, poisson(extRate * N * dt));
    N = Math.max(0, N + births - deaths);
    richness[i] = N;
    origRates[i] = births / (N * dt + 1e-10);
    extRates[i] = deaths / (N * dt + 1e-10);
  }

  return { times, richness, originationRates: origRates, extinctionRates: extRates };
}

// ═══════════════════════════════════════════════════════════════════
// FBD Log-Likelihood (Stadler 2010 / Heath et al. 2014)
// ═══════════════════════════════════════════════════════════════════

/**
 * Tree data for the FBD log-likelihood.
 */
export interface FBDTreeData {
  /** Age of every node (time before present). */
  nodeAges: number[];
  /** Which nodes are sampled extant tips. */
  isExtant: boolean[];
  /** Which nodes are sampled fossil tips. */
  isFossil: boolean[];
  /**
   * Ages of the children of every node (empty for tips).
   *
   * The parent→child conditioning needs both ends of a branch: the
   * probability that a branch carries no sampled descendant other than the
   * node at its far end is p1(t_child) / p1(t_parent), so the parent's age
   * is required as well. Without the child ages the three tip branches
   * could not be conditioned the same way.
   */
  childAges?: number[][];
}

/**
 * FBD (fossilized birth-death) log-likelihood of a sampled tree.
 *
 * ## Conditioning (this is what the previous version got wrong)
 *
 * Let E(t) be the probability that a lineage alive at time t leaves no
 * sampled descendant, and p1(t) = 1 − E(t). The likelihood of a sampled
 * tree is the product over nodes of
 *
 *   [event factor at the node] × [branch conditioning of its children]
 *
 * where the branch conditioning of a child c of node v is
 *
 *   p1(t_c) / p1(t_v)
 *
 * i.e. the probability that the branch v→c carries no sampled descendant
 * other than c itself. The OLD version applied the conditioning
 * inconsistently: the fossil branch divided by (1 − E(t)), the internal
 * branch multiplied by (1 − E(t)), the extant branch had neither, and a
 * global `−(λ+μ+ψ)·age` term was added for every node on top of that
 * (the FBD net rate is λ−μ−ψ, and the term belonged to no branch in
 * particular). The three branches are now conditioned identically and the
 * global term is gone.
 *
 * The event factor is what happens AT the node:
 *   internal node → speciation, rate λ
 *   extant tip    → sampled extant lineage, rate ρ
 *   fossil tip    → sampled fossil, rate ψ, on a lineage that leaves no
 *                   other sampled descendant (E(t))
 *
 * NOTE: this is a self-consistent derivation from the Stadler (2010) /
 * Heath et al. (2014) conditioning; it has NOT been diffed value-by-value
 * against the Python original's `fbd_log_likelihood`. The per-node `E(t)`
 * used here is also the closed-form one below, which is not the same
 * function as `fbdExtinctionProbability` in this file.
 */
export function fbdLogLikelihood(
  speciation: number, extinction: number, fossilSampling: number,
  treeData: FBDTreeData,
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
  const childAges = treeData.childAges ?? [];

  for (let i = 0; i < nodeAges.length; i++) {
    const age = nodeAges[i];
    const e_t = E(age);
    const p1 = 1 - e_t;

    // --- the event at the node -------------------------------------------
    if (isExtant[i]) {
      // sampled extant lineage: the sampling rate is rho
      logLik += safeLog(rho);
    } else if (isFossil[i]) {
      // sampled fossil: rate psi, on a lineage that leaves no other
      // sampled descendant
      logLik += safeLog(psi) + safeLog(e_t);
    } else {
      // speciation event: rate lambda
      logLik += safeLog(lambda);
    }

    // --- the branches above the node --------------------------------------
    // Every branch is conditioned identically: the probability that the
    // branch from this node to a child carries no sampled descendant other
    // than the child itself.
    const kids = childAges[i] ?? [];
    for (let k = 0; k < kids.length; k++) {
      const p1Child = 1 - E(kids[k]);
      logLik += safeLog(p1Child) - safeLog(p1);
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
  // The z statistic and the p value follow from the same formula for every
  // input; only the 0/0 ratio is undefined. The old early return for
  // extinctionRate <= 0 threw away a perfectly computable z and p:
  // testEquilibrium(0.5, 0) reported z = 0 and p = 0 instead of z = 1 and
  // p = 0.3173, and testEquilibrium(0, 0) reported p = 0 for two identical
  // rates instead of p = 1.
  let ratio: number;
  if (extinctionRate > 0) ratio = originationRate / extinctionRate;
  else if (extinctionRate === 0 && originationRate > 0) ratio = Infinity;
  else ratio = NaN;                                  // 0/0 (or an invalid rate) is undefined
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
  // The confidence level has to drive the interval. The old code hard-coded
  // `z = 1.96`, so extinctionCI(..., 0.90), (..., 0.95) and (..., 0.99) all
  // returned the very same numbers.
  //
  // The quantile comes from the local Acklam helper in this file rather than
  // from core/math/stats, which would create a dependency on a module that
  // is being rewritten in parallel.
  const z = normQuantileLocalMacro(1 - (1 - confidenceLevel) / 2);
  const alpha = 1 - confidenceLevel;

  // Sampling rate from the observed record
  const r = nOccurrences / intervalDuration;

  if (correctSampling === 'none') {
    // Marshall (1990): the point estimate is the count divided by the
    // duration and the confidence limits are the Poisson (chi-square)
    // limits on the count:
    //   lower = chi2(alpha/2, 2n) / 2T
    //   upper = chi2(1 - alpha/2, 2(n+1)) / 2T
    //
    // The old code used the two quantiles the other way round and asked for
    // chi2(1 - alpha/2, 2n) as the LOWER limit. With n = 0 that is a
    // chi-square with 0 degrees of freedom, whose quantile is not a number
    // at all: the bisection converged to the artificial upper bound 1000
    // and extinctionCI(10, 5, 0, 1, 0.95, 'none') reported an upper limit
    // of ~100 instead of the Poisson limit.
    const ciLower = chi2Crit(alpha / 2, 2 * nOccurrences) / 2 / intervalDuration;
    const ciUpper = chi2Crit(1 - alpha / 2, 2 * nOccurrences + 2) / 2 / intervalDuration;
    return {
      extinctionRate: r, // point estimate = sampling rate
      ciLower,
      ciUpper,
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

/**
 * Chi-squared quantile (inverse CDF).
 *
 * A chi-square with 0 degrees of freedom is a point mass at 0, so its
 * quantile is 0 for every p > 0. The old version divided by `a = 0` inside
 * the incomplete gamma, produced NaN, and the bisection walked all the way
 * to its artificial upper bound of 1000 — which is how a 0-observation
 * record ended up with an extinction-rate upper limit of ~100.
 *
 * The quantile itself comes from core/math/stats, whose incomplete gamma
 * switches to a continued fraction for large arguments. The local copy that
 * used to live here was a pure series capped at 200 terms, so it silently
 * returned ~0 for any argument above ~400 and the bisection above it
 * produced garbage (an extinction-rate upper limit of 541 instead of 0.74).
 */
function chi2Crit(p: number, df: number): number {
  if (df <= 0) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  return qchisq(p, df);
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
  /**
   * σ — the diffusion coefficient (√σ²) of the early-burst process.
   *
   * This field used to be called `r0` and was documented as "initial rate
   * r₀", but it held √σ² — the diffusion coefficient, which is not a rate.
   * The initial variance rate of the process is σ² (the rate at the root);
   * see `sigma2`.
   */
  sigma: number;
  /**
   * Rate parameter r: the exponential decay of the variance rate with depth
   * (depth 0 = the root). r > 0 → the rate is highest at the root and
   * decays towards the tips (early burst); r < 0 → the rate grows with
   * depth; r = 0 → Brownian motion.
   */
  r: number;
  /** σ² — the variance rate at the root (the initial rate of the process). */
  sigma2: number;
  logLik: number;
  aic: number;
}

// ─── Shared numerical helpers for the phylogenetic models ───────────────────

/**
 * Root-to-node path lengths of a tree, used as the Brownian-motion
 * covariance structure: `D[i][j]` is the length of the path from the root
 * to the MRCA of tips i and j, and `D[i][i]` the length of the path from
 * the root to tip i.
 *
 * Under Brownian motion the covariance of two tips is σ²·(root→MRCA path)
 * and the variance of one tip is σ²·(root→tip path), so D is the standard
 * phylogenetic covariance matrix.
 */
function phylogeneticDepthMatrix(tips: PhyloNode[], tree: PhyloNode): number[][] {
  const n = tips.length;
  const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    D[i][i] = tips[i].distanceToAncestor(tree);
    for (let j = i + 1; j < n; j++) {
      const lca = tips[i].computeLCA(tips[j]);
      const shared = lca ? lca.distanceToAncestor(tree) : 0;
      D[i][j] = D[j][i] = shared;
    }
  }
  return D;
}

/** Cholesky factor of a symmetric positive definite matrix. */
function choleskyFactor(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, (_, i) => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 0)) {
          throw new ComputationError(
            'The phylogenetic covariance matrix is not positive definite ' +
            '(the tree has no usable branch lengths).');
        }
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Solve (L·Lᵀ)·x = b given the Cholesky factor L. */
function choleskySolve(L: number[][], b: number[]): number[] {
  const n = L.length;
  const y: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x: number[] = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

function dotProduct(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Golden-section maximisation of a unimodal function on [a, b].
 * Deterministic (no randomness) and reports whether the bracket collapsed.
 */
function goldenSectionMax(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number,
  maxIter: number,
): { x: number; fx: number; converged: boolean } {
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let lo = a, hi = b;
  let c = hi - invPhi * (hi - lo);
  let d = lo + invPhi * (hi - lo);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < maxIter; i++) {
    if (hi - lo <= tol * (1 + Math.abs(lo))) break;
    if (fc > fd) {
      hi = d; d = c; fd = fc;
      c = hi - invPhi * (hi - lo); fc = f(c);
    } else {
      lo = c; c = d; fc = fd;
      d = lo + invPhi * (hi - lo); fd = f(d);
    }
  }
  const x = (lo + hi) / 2;
  return { x, fx: f(x), converged: hi - lo <= tol * (1 + Math.abs(lo)) };
}

/**
 * Maximum-likelihood fit of the Ornstein-Uhlenbeck (OU) process to trait data
 * on a phylogenetic tree.
 *
 * The OU process: dX = α(θ - X)dt + σ dW
 * where α > 0 is the strength of selection (mean-reversion rate),
 * θ is the optimum, and σ is the diffusion coefficient.
 *
 * ## The covariance matrix
 *
 * The covariance of the OU process along a shared path of length d is the
 * integrated variance (σ²/2α)·(1 − e^{−2αd}), so the whole VCV is
 *
 *   V_OU(α, σ²) = σ² · C(α),   C(α)[i][j] = (1 − e^{−2α·D[i][j]}) / (2α)
 *
 * with D the root-to-MRCA path lengths (D[i][i] = the root-to-tip path).
 *
 * The previous version left the diagonal untouched: `if (i === j) return
 * V[i][j]` kept the raw root-to-tip path — a LENGTH — while the
 * off-diagonal entries were VARIANCES. The matrix mixed units, so σ² could
 * not follow the trait scale at all: multiplying every trait by 10 left
 * σ² bit-for-bit unchanged (9.533363325644017e-7 → 9.533363325644017e-7)
 * instead of scaling it by 100. The off-diagonal entries also used the
 * tip→LCA path, which is not the same for i→j and j→i, so the matrix was
 * not even symmetric. Both are fixed here: the OU transform is applied to
 * the whole matrix, diagonal included.
 *
 * ## The optimisation
 *
 * For a fixed α the model is x ~ N(θ·1, σ²·C(α)), so θ and σ² have
 * closed-form maximum-likelihood estimates:
 *
 *   θ̂ = (1'C⁻¹x) / (1'C⁻¹1),   σ̂² = (x − θ̂)'C⁻¹(x − θ̂) / n
 *
 * and only α is searched numerically (log grid + golden section).
 * Profiling the other two parameters out is what makes the fit
 * scale-equivariant: the profiled log-likelihood of the scaled data
 * differs from the original by the constant n·log(10), so the maximising α
 * is unchanged and σ² comes out exactly 100× larger.
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
  if (n < 2) {
    throw new ComputationError('fitOU: at least two tips with trait values are required');
  }
  const traits = tipNames.map(name => traitData[name] ?? 0);
  const mean_trait = traits.reduce((a, b) => a + b, 0) / n;

  // Brownian-motion covariance structure: root→MRCA (root→tip on the diagonal).
  const D = phylogeneticDepthMatrix(tips, tree);

  // OU covariance: the integrated OU variance along the shared path.
  const ouCov = (alpha: number): number[][] => {
    const C: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // -expm1(-x) = 1 - e^{-x}, numerically stable as alpha -> 0 (the BM limit)
        C[i][j] = -Math.expm1(-2 * alpha * D[i][j]) / (2 * alpha);
      }
    }
    return C;
  };

  // Profiled log-likelihood for a fixed alpha.
  const ones: number[] = new Array(n).fill(1);
  let covFailures = 0;
  let dataFailures = 0;
  const profileAt = (alpha: number): { logLik: number; theta: number; sigma2: number } | null => {
    let L: number[][];
    try {
      L = choleskyFactor(ouCov(alpha));
    } catch {
      covFailures++;
      return null;
    }
    let logDet = 0;
    for (let i = 0; i < n; i++) logDet += Math.log(L[i][i]);
    logDet *= 2;
    const z = choleskySolve(L, traits);     // C⁻¹x
    const u = choleskySolve(L, ones);      // C⁻¹1
    const uu = dotProduct(u, ones);
    if (!(uu > 0)) { covFailures++; return null; }
    const theta = dotProduct(u, traits) / uu;
    // (x - theta·1)'C⁻¹(x - theta·1) without the cancellation of x'C⁻¹x - ...
    const rx: number[] = traits.map(v => v - theta);
    const rz: number[] = z.map((v, i) => v - theta * u[i]);
    const Q = dotProduct(rx, rz);
    if (!(Q > 0)) { dataFailures++; return null; }   // constant traits: no variance
    const sigma2 = Q / n;
    const logLik = -0.5 * (n + n * Math.log(sigma2) + logDet + n * Math.log(2 * Math.PI));
    if (!isFinite(logLik)) return null;
    return { logLik, theta, sigma2 };
  };

  // Search alpha on a log grid around the natural scale 1/mean depth, then
  // refine between the neighbouring grid points.
  const meanDepth = D.reduce((s, row, i) => s + row[i], 0) / n;
  const base = meanDepth > 0 ? 1 / meanDepth : 1;
  const grid: number[] = [];
  for (let k = -4; k <= 4; k++) grid.push(base * Math.pow(10, k));

  let best: { alpha: number; logLik: number; theta: number; sigma2: number } | null = null;
  let bestIdx = 0;
  for (let i = 0; i < grid.length; i++) {
    const p = profileAt(grid[i]);
    if (p && (!best || p.logLik > best.logLik)) {
      best = { alpha: grid[i], logLik: p.logLik, theta: p.theta, sigma2: p.sigma2 };
      bestIdx = i;
    }
  }
  if (!best) {
    throw new ComputationError(
      dataFailures > 0 && covFailures === 0
        ? 'fitOU: the trait values are constant, so the variance is not identifiable.'
        : 'fitOU: no valid covariance matrix could be built from this tree ' +
          '(the branch lengths are degenerate).');
  }

  const maxIter = options?.maxIter ?? 200;
  const tol = options?.tol ?? 1e-10;
  const lo = grid[Math.max(0, bestIdx - 1)];
  const hi = grid[Math.min(grid.length - 1, bestIdx + 1)];
  const refined = goldenSectionMax(a => {
    const p = profileAt(a);
    return p ? p.logLik : -Infinity;
  }, lo, hi, tol, maxIter);
  if (!refined.converged) {
    throw new ConvergenceError(
      `fitOU: the search for alpha did not converge within ${maxIter} iterations`, maxIter);
  }
  const refinedProfile = profileAt(refined.x);
  let chosen = best;
  if (refinedProfile && refinedProfile.logLik > best.logLik) {
    chosen = {
      alpha: refined.x,
      logLik: refinedProfile.logLik,
      theta: refinedProfile.theta,
      sigma2: refinedProfile.sigma2,
    };
  }

  const k = 3; // number of parameters (alpha, sigma2, theta)
  const logLik = chosen.logLik;

  return {
    theta: chosen.theta,
    alpha: chosen.alpha,
    sigma2: chosen.sigma2,
    logLik,
    aic: 2 * k - 2 * logLik,
    traitMean: mean_trait,
  };
}

/**
 * Maximum-likelihood fit of the Early Burst (EB) / Rate Variability model.
 *
 * ## The model
 *
 * The variance rate of the process at depth s (depth 0 = the root) is
 * σ²·e^{−r·s}, so the variance accumulated along a path of length d
 * measured from the root is
 *
 *   W(d) = σ²·(1 − e^{−r·d}) / r      (r ≠ 0)
 *        = σ²·d                       (r = 0, the Brownian motion limit)
 *
 * and the covariance of two tips is W of their shared root→MRCA path:
 *
 *   V_EB(r, σ²) = σ² · C(r),   C(r)[i][j] = (1 − e^{−r·D[i][j]}) / r
 *
 * with D the root-to-MRCA path lengths (D[i][i] = the root-to-tip path).
 *
 * ## What was broken
 *
 * The old diagonal was `tips[i].distanceToAncestor(lca)` with
 * lca = computeLCA(tips[i], tips[i]) — the LCA of a tip with ITSELF is the
 * tip itself and `distanceToAncestor(self)` is 0, so the diagonal was 0 for
 * every tip. The Cholesky then failed on the second pivot, the likelihood
 * came back as the sentinel 1e10 for every parameter combination, and the
 * fit returned the first grid point (r = -2, σ² = 0.01, logLik = -1e10,
 * AIC = 20000000004) no matter what the data were: {A:1,B:2,C:3},
 * {A:10,B:20,C:30} and {A:100,B:1,C:50} all produced bit-identical
 * output. The diagonal now uses the root→tip path, like `fitOU`.
 *
 * The off-diagonal entries also mixed units: σ²/|r|·shared·exp(−r·depth)
 * has the dimension of a length cubed, not a variance.
 *
 * ## The optimisation
 *
 * The documented EB process has no drift term, so the trait mean is fixed
 * at 0 and σ² has a closed-form maximum-likelihood estimate for a fixed r:
 *
 *   σ̂² = x'C(r)⁻¹x / n
 *
 * Only r is searched numerically (log grid + golden section). As in the OU
 * fit, profiling σ² out is what makes the fit scale-equivariant: the
 * profiled log-likelihood of the scaled data differs by the constant
 * n·log(10), so the maximising r is unchanged and σ² comes out exactly
 * 100× larger.
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
  if (n < 2) {
    throw new ComputationError('fitEarlyBurst: at least two tips with trait values are required');
  }
  const traits = tipNames.map(name => traitData[name] ?? 0);

  // Brownian-motion covariance structure: root→MRCA (root→tip on the diagonal).
  const D = phylogeneticDepthMatrix(tips, tree);

  // Early-burst covariance: the integrated variance rate along the shared path.
  const ebCov = (r: number): number[][] => {
    const C: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // -expm1(-x) = 1 - e^{-x}, stable as r -> 0 (the Brownian motion limit)
        C[i][j] = Math.abs(r) < 1e-12 ? D[i][j] : -Math.expm1(-r * D[i][j]) / r;
      }
    }
    return C;
  };

  // Profiled log-likelihood for a fixed r (sigma2 is maximised analytically).
  let covFailures = 0;
  let dataFailures = 0;
  const profileAt = (r: number): { logLik: number; sigma2: number } | null => {
    let L: number[][];
    try {
      L = choleskyFactor(ebCov(r));
    } catch {
      covFailures++;
      return null;
    }
    let logDet = 0;
    for (let i = 0; i < n; i++) logDet += Math.log(L[i][i]);
    logDet *= 2;
    const z = choleskySolve(L, traits);     // C⁻¹x
    const Q = dotProduct(traits, z);
    if (!(Q > 0)) { dataFailures++; return null; }   // constant traits: no variance
    const sigma2 = Q / n;
    const logLik = -0.5 * (n + n * Math.log(sigma2) + logDet + n * Math.log(2 * Math.PI));
    if (!isFinite(logLik)) return null;
    return { logLik, sigma2 };
  };

  // Search r on a grid around the natural scale 1/mean depth (plus r = 0,
  // the Brownian motion limit), then refine between the neighbouring points.
  const meanDepth = D.reduce((s, row, i) => s + row[i], 0) / n;
  const base = meanDepth > 0 ? 1 / meanDepth : 1;
  const grid: number[] = [0];
  for (let k = -2; k <= 2; k++) {
    grid.push(base * Math.pow(10, k));
    grid.push(-base * Math.pow(10, k));
  }
  grid.sort((a, b) => a - b);

  let best: { r: number; logLik: number; sigma2: number } | null = null;
  let bestIdx = 0;
  for (let i = 0; i < grid.length; i++) {
    const p = profileAt(grid[i]);
    if (p && (!best || p.logLik > best.logLik)) {
      best = { r: grid[i], logLik: p.logLik, sigma2: p.sigma2 };
      bestIdx = i;
    }
  }
  if (!best) {
    throw new ComputationError(
      dataFailures > 0 && covFailures === 0
        ? 'fitEarlyBurst: the trait values are constant, so the variance is not identifiable.'
        : 'fitEarlyBurst: no valid covariance matrix could be built from this tree ' +
          '(the branch lengths are degenerate).');
  }

  const maxIter = options?.maxIter ?? 200;
  const tol = options?.tol ?? 1e-10;
  const lo = grid[Math.max(0, bestIdx - 1)];
  const hi = grid[Math.min(grid.length - 1, bestIdx + 1)];
  const refined = goldenSectionMax(r => {
    const p = profileAt(r);
    return p ? p.logLik : -Infinity;
  }, lo, hi, tol, maxIter);
  if (!refined.converged) {
    throw new ConvergenceError(
      `fitEarlyBurst: the search for r did not converge within ${maxIter} iterations`, maxIter);
  }
  const refinedProfile = profileAt(refined.x);
  let chosen = best;
  if (refinedProfile && refinedProfile.logLik > best.logLik) {
    chosen = { r: refined.x, logLik: refinedProfile.logLik, sigma2: refinedProfile.sigma2 };
  }

  const logLik = chosen.logLik;
  return {
    sigma: Math.sqrt(chosen.sigma2),
    r: chosen.r,
    sigma2: chosen.sigma2,
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
  /**
   * Log-likelihood of the fit, or null when the model has none.
   *
   * The PIC and BM branches are estimators, not likelihood models, so they
   * have no log-likelihood. The old code reported 0 for both, which a
   * model-comparison table reads as "a perfect fit" (AIC = 0).
   */
  logLik: number | null;
  /** AIC, or null when the model has no likelihood (see `logLik`). */
  aic: number | null;
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
    return { model: 'eb', rate: result.r, params: { sigma: result.sigma, r: result.r, sigma2: result.sigma2 }, logLik: result.logLik, aic: result.aic };
  }
  if (model === 'pic') {
    const result = pic(tree, traitData);
    const meanRate = result.contrasts.reduce((a, b) => a + Math.abs(b), 0) / result.nContrasts;
    return { model: 'pic', rate: meanRate, params: { nContrasts: result.nContrasts }, logLik: null, aic: null };
  }
  // BM: simple rate estimate = sum(contrasts²) / total tree length
  const result = pic(tree, traitData);
  const totalVar = result.contrasts.reduce((a, b) => a + b * b, 0);
  const treeLength = tree.computeTotalLength();
  const sigma2 = treeLength > 0 ? totalVar / treeLength : 0;
  return { model: 'bm', rate: Math.sqrt(sigma2), params: { sigma2, nContrasts: result.nContrasts }, logLik: null, aic: null };
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

/**
 * Poisson pmf of the fossil count produced by ONE lineage over an age span
 * (fbd.py fossil_count_distribution).
 *
 * The mean count is the sampling rate times the expected time-integrated
 * standing diversity of the lineage:
 *
 *     E[K] = ψ · ∫₀^age E[N(t)] dt,   E[N(t)] = e^{(λ−μ)t}
 *          = ψ · (e^{(λ−μ)·age} − 1)/(λ − μ)      (λ ≠ μ)
 *          = ψ · age                              (λ = μ)
 *
 * The previous implementation hard-coded `meanCount = ψ · age` and explicitly
 * discarded λ, μ and ρ (`void lambda; void mu; void rho`), so every
 * diversification rate produced the same distribution. The form above reduces
 * to `ψ · age` exactly when λ = μ — the one case the old formula was right for
 * — and otherwise accounts for the growth or decay of the lineage.
 *
 * ρ (probability of sampling an extant lineage) affects the FBD *likelihood*
 * through the conditioning on survival to the present; it does not enter this
 * per-lineage fossil-count expectation, so it is intentionally unused here.
 *
 * The returned vector covers k = 0..maxK; the tail mass above maxK is not
 * renormalised in (a truncated count distribution).
 */
export function fossilCountDistribution(
  lambda: number, mu: number, psi: number, rho: number, age: number, maxK: number = 20,
): number[] {
  void rho; // see note above: enters the likelihood, not this expectation
  const r = lambda - mu;
  let meanCount: number;
  if (Math.abs(r) < 1e-10) {
    meanCount = psi * age;                       // λ = μ: pure Poisson sampling
  } else {
    meanCount = psi * (Math.exp(r * age) - 1) / r;
  }
  if (!isFinite(meanCount) || meanCount < 0) meanCount = Math.max(0, psi * age);

  const probs: number[] = [];
  let logFact = 0;
  for (let k = 0; k <= maxK; k++) {
    if (k > 0) logFact += Math.log(k);
    if (meanCount === 0) { probs.push(k === 0 ? 1 : 0); continue; }
    const logP = -meanCount + k * Math.log(meanCount) - logFact;
    probs.push(logP < -700 ? 0 : Math.exp(logP));
  }

  // If the grid stops well before the mode, the vector is all-but-zero — which
  // reads as "no fossils" rather than "grid too small". Refuse instead of
  // returning a misleading distribution (e.g. lambda=0.5, mu=0.1, psi=0.5,
  // age=10 has mean 67, so a 0..40 grid captures only 0.03% of the mass).
  const captured = probs.reduce((a, b) => a + b, 0);
  if (captured < 0.99 && maxK < meanCount) {
    throw new Error(
      `fossilCountDistribution: maxK=${maxK} is too small for mean count ${meanCount.toFixed(2)} ` +
      `(grid captures only ${(captured * 100).toFixed(2)}% of the mass). ` +
      'Increase maxK to at least ceil(mean + 6*sqrt(mean)).'
    );
  }
  return probs;
}

/** Human-readable summary of a Kaplan-Meier / cohort survival fit. */
export function summarizeSurvival(
  times: number[],
  survivalProbs: number[],
  median?: number | null,
): string {
  const last = survivalProbs.length > 0 ? survivalProbs[survivalProbs.length - 1] : NaN;
  // `median !== undefined` is TRUE for null, and kaplanMeier returns null
  // when the median survival is never reached — the most common case for a
  // censored curve. The old check therefore evaluated `null.toFixed(2)` and
  // threw "TypeError: Cannot read properties of null (reading 'toFixed')"
  // exactly in the case the summary was supposed to report.
  const medianText = (median === undefined || median === null)
    ? 'median not reached'
    : `median=${median.toFixed(2)}`;
  return `Survival: ${survivalProbs.length} time points, final S(t)=${last.toFixed(3)}, ${medianText}`;
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
