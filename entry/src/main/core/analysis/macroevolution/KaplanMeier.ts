/**
 * Kaplan-Meier survival curve estimator — replaces macroevolution/survival.py::KaplanMeierAnalyzer.
 *
 * S(t) = Π_{t_i < t} (1 - d_i / n_i)
 *
 * Greenwood's formula for SE; log-log CI for boundedness.
 */
import { ComputationError } from '../../utils/Exceptions';
import { qnorm } from '../../math/stats';

export interface SurvivalResult {
  times: number[];
  survivalProb: number[];
  stdError: number[];
  lowerCI: number[];
  upperCI: number[];
  nAtRisk: number[];
  nEvents: number[];
  medianSurvival: number | null;
  events: number[];
  timesFull: number[];
}

/**
 * Compute Kaplan-Meier survival curve.
 *
 * @param times              time to event or censoring (n)
 * @param events             event indicator 1=event, 0=censored (n)
 * @param confidenceLevel    confidence level (default 0.95)
 */
export function kaplanMeier(
  times: number[],
  events: number[],
  confidenceLevel: number = 0.95
): SurvivalResult {
  if (times.length !== events.length) throw new ComputationError('times and events length mismatch');
  if (times.length === 0) throw new ComputationError('Empty data');
  if (times.some(t => t < 0)) throw new ComputationError('Times must be non-negative');

  // Flatten & binarize events
  const t = times.slice();
  const e = events.map(v => v > 0 ? 1 : 0);

  // Sort by time
  const idx = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
  const tS = idx.map(i => t[i]);
  const eS = idx.map(i => e[i]);

  // Group by unique times — count events & at risk
  const uniqueTimesSet = new Set(tS);
  const uniqueTimes = Array.from(uniqueTimesSet).sort((a, b) => a - b);

  let cumSurv = 1.0;
  let greenwoodSum = 0.0;

  const outTimes: number[] = [];
  const outS: number[] = [];
  const outSE: number[] = [];
  const outNAR: number[] = [];
  const outNE: number[] = [];

  // Only retain event-time points
  for (const tU of uniqueTimes) {
    // at risk = number of observations with t ≥ tU
    const atRisk = tS.filter(tv => tv >= tU).length;
    const dEvents = tS.reduce((c, tv, i) => (tv === tU && eS[i] === 1) ? c + 1 : c, 0);
    if (dEvents === 0) continue;
    outTimes.push(tU);
    outNAR.push(atRisk);
    outNE.push(dEvents);

    cumSurv *= (1 - dEvents / atRisk);
    outS.push(cumSurv);

    if (atRisk > dEvents) greenwoodSum += dEvents / (atRisk * (atRisk - dEvents));
    outSE.push(cumSurv * Math.sqrt(greenwoodSum));
  }

  // If no events, return trivial
  if (outS.length === 0) {
    return {
      times: uniqueTimes, survivalProb: [1], stdError: [0], lowerCI: [1], upperCI: [1],
      nAtRisk: [tS.length], nEvents: [0], medianSurvival: null, events: e, timesFull: tS
    };
  }

  // Confidence intervals (log-log transformation per Klein & Moeschberger)
  const z = qnorm(1 - (1 - confidenceLevel) / 2);
  const lowerCI: number[] = [], upperCI: number[] = [];
  for (let i = 0; i < outS.length; i++) {
    const S = Math.max(outS[i], 1e-10);
    const se = Math.max(outSE[i], 1e-10);
    // Skip CI when S is ~1 (log-log undefined). Use plain Greenwood CIs in that case.
    if (outS[i] >= 0.9999) { lowerCI.push(S); upperCI.push(S); continue; }
    const logS = Math.log(S);
    const logLogS = Math.log(-logS);
    const logLogSE = (z * se) / (S * Math.abs(logS));
    const lower = Math.exp(-Math.exp(logLogS + logLogSE));
    const upper = Math.exp(-Math.exp(logLogS - logLogSE));
    if (isFinite(lower) && isFinite(upper)) {
      lowerCI.push(Math.min(1, Math.max(0, lower)));
      upperCI.push(Math.min(1, Math.max(0, upper)));
    } else {
      lowerCI.push(S); upperCI.push(S);
    }
  }

  // Median survival - fixed: find first time survival drops to or below 0.5
  let medianSurvival: number | null = null;
  const firstBelow = outS.findIndex(s => s <= 0.5);
  if (firstBelow >= 0) medianSurvival = outTimes[firstBelow];

  return {
    times: outTimes,
    survivalProb: outS,
    stdError: outSE,
    lowerCI,
    upperCI,
    nAtRisk: outNAR,
    nEvents: outNE,
    medianSurvival,
    events: e,
    timesFull: tS
  };
}
