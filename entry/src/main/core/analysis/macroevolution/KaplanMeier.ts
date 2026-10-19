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
  /**
   * Event indicator (1 = event, 0 = censored) in the SAME order as
   * `timesFull`, i.e. sorted by time. The old version returned the event
   * flags in INPUT order next to a sorted `timesFull`, so the two arrays
   * could not be read off each other (kaplanMeier([5,1,3],[0,1,1]) gave
   * events = [0,1,1] and timesFull = [1,3,5]).
   */
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

  // If no events, return trivial.
  //
  // Every array has to describe the same set of time points. The old
  // version returned `times` with one entry per observed time but
  // `survivalProb` (and the rest) with a single entry, so
  // kaplanMeier([1,2,3],[0,0,0]) came back with times.length = 3 and
  // survivalProb.length = 1 — a caller that zips the arrays silently
  // reads the wrong values. With no event the survival curve is 1
  // everywhere, so it is reported at every observed time.
  if (outS.length === 0) {
    const nTimes = uniqueTimes.length;
    return {
      times: uniqueTimes,
      survivalProb: new Array(nTimes).fill(1),
      stdError: new Array(nTimes).fill(0),
      lowerCI: new Array(nTimes).fill(1),
      upperCI: new Array(nTimes).fill(1),
      nAtRisk: new Array(nTimes).fill(tS.length),
      nEvents: new Array(nTimes).fill(0),
      medianSurvival: null,
      events: eS,
      timesFull: tS
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
    // sorted with timesFull, so the two arrays line up element by element
    events: eS,
    timesFull: tS
  };
}
