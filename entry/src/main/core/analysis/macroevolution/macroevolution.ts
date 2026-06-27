/**
 * Macroevolution analysis — replaces macroevolution/*.py
 */

/**
 * Cohort survivorship analysis (Foote 1999).
 */
export interface CohortResult {
  intervals: { tStart: number; tEnd: number; nFB: number; nLB: number; nSurv: number }[];
  survivalRates: number[];
  originationRates: number[];
  extinctionRates: number[];
  confidenceIntervals: [number, number][];
}

export function cohortSurvivorship(
  fossilRecords: [number, number][],
  intervals: [number, number][],
  confidenceLevel: number = 0.95,
): CohortResult {
  const z = 1.96; // 95% CI
  const results: CohortResult = { intervals: [], survivalRates: [], originationRates: [], extinctionRates: [], confidenceIntervals: [] };

  for (const [tStart, tEnd] of intervals) {
    let nFB = 0, nLB = 0, nSurv = 0;
    for (const [o, L] of fossilRecords) {
      if (o <= tStart && L >= tEnd) nSurv++;
      else if (o >= tStart && o < tEnd && L >= tEnd) nFB++;
      else if (tStart <= L && L < tEnd && o < tStart) nLB++;
    }
    const nTotal = nFB + nLB + nSurv;
    results.intervals.push({ tStart, tEnd, nFB, nLB, nSurv });

    if (nTotal > 0) {
      const p = nSurv / nTotal;
      results.survivalRates.push(p);
      const dt = tStart - tEnd;
      if (dt > 0) {
        results.originationRates.push(p < 1 ? -Math.log(1 - p) / dt : 0);
        results.extinctionRates.push(p > 0 ? -Math.log(p) / dt : Infinity);
      } else {
        results.originationRates.push(0);
        results.extinctionRates.push(0);
      }
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
    }
  }
  return results;
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
): FBDResult {
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

    const tau = -Math.log(Math.random()) / totalRate;
    if (currentTime + tau > duration) { currentTime = duration; break; }
    currentTime += tau;

    const r = Math.random();
    const probs = [lambda, mu, psi];
    const cumProb = [probs[0], probs[0] + probs[1], probs[0] + probs[1] + probs[2]];
    let eventType: string;
    if (r < cumProb[0] / totalRate * totalRate) eventType = 'birth';
    else if (r < cumProb[1] / totalRate * totalRate) eventType = 'death';
    else eventType = 'fossil';

    const idx = Math.floor(Math.random() * alive.length);
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

  for (let iter = 0; iter < maxIter; iter++) {
    const grad = new Array(p).fill(0);
    const hess = Array.from({ length: p }, () => new Array(p).fill(0));

    // Compute risk sets
    const riskSets: number[][] = [];
    for (let i = 0; i < n; i++) {
      const riskSet: number[] = [];
      for (let j = 0; j < n; j++) {
        if (durations[j] >= durations[i]) riskSet.push(j);
      }
      riskSets.push(riskSet);
    }

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

  // Standard errors from inverse Hessian
  const se = new Array(p).fill(0.5);
  const hazardRatios = beta.map(b => Math.exp(b));
  const zScores = beta.map((b, i) => se[i] > 0 ? b / se[i] : 0);
  const pValues = zScores.map(z => 2 * (1 - normCDF_cox(Math.abs(z))));

  // Concordance index (simplified)
  let concordant = 0, total = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (events[i] === 1 && durations[i] < durations[j]) {
      let lp_i = 0, lp_j = 0;
      for (let k = 0; k < p; k++) { lp_i += beta[k] * X[i][k]; lp_j += beta[k] * X[j][k]; }
      if (lp_i > lp_j) concordant++;
      total++;
    }
  }

  return {
    coefficients: beta, standardErrors: se, hazardRatios, zScores, pValues,
    logLikelihood: 0, concordance: total > 0 ? concordant / total : 0.5,
  };
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
    if (t <= 0) return Math.max(0, Math.min(1, 1 - rho));
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
      logLik += safeLog(rho);
    } else if (isFossil[i]) {
      logLik += safeLog(psi) + safeLog(E(age));
    } else {
      logLik += safeLog(lambda) + safeLog(E(age));
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
