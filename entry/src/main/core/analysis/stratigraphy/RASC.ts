/**
 * Ranking and Scaling (RASC) — replaces stratigraphy/biostratigraphy.py::RASCAnalyzer.
 *
 * Iterative refinement: at each iteration, attempt to swap every adjacent
 * pair of events in the ranking; accept swap if it improves the cost
 * (sum of squared position differences weighted by the distance matrix).
 */
import { ComputationError } from '../../utils/Exceptions';

export interface BioeventResult {
  sections: string[];
  events: string[];
  zones?: never;
  ranking: string[];
  distanceMatrix?: number[][];
  method: 'rasc';
  costTrace?: number[];
  finalCost?: number;
}

/**
 * Compute RASC ranking by iterative adjacent swaps.
 *
 * @param distanceMatrix  n_events × n_events symmetric distance matrix
 * @param eventNames      optional event names
 * @param nIterations     maximum refinement iterations
 */
export function rasc(
  distanceMatrix: number[][],
  eventNames?: string[],
  nIterations: number = 100
): BioeventResult {
  const n = distanceMatrix.length;
  if (n === 0) throw new ComputationError('Empty distance matrix');
  for (let i = 0; i < n; i++) {
    if (distanceMatrix[i].length !== n) throw new ComputationError('Non-square matrix');
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(distanceMatrix[i][j] - distanceMatrix[j][i]) > 1e-9)
        throw new ComputationError('Distance matrix not symmetric');
    }
  }

  const events = eventNames ?? Array.from({ length: n }, (_, i) => `Event_${i + 1}`);
  let order = Array.from({ length: n }, (_, i) => i);
  const trace: number[] = [];

  for (let iter = 0; iter < nIterations; iter++) {
    let improved = false;
    let bestCost = _cost(order, distanceMatrix);
    for (let i = 1; i < n - 1; i++) {
      const swapped = order.slice();
      [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
      const newCost = _cost(swapped, distanceMatrix);
      if (newCost < bestCost) {
        order = swapped;
        bestCost = newCost;
        improved = true;
      }
    }
    trace.push(bestCost);
    if (!improved) break;
  }

  return {
    sections: [],
    events,
    ranking: order.map(i => events[i]),
    distanceMatrix,
    method: 'rasc',
    costTrace: trace,
    finalCost: trace[trace.length - 1]
  };
}

function _cost(order: number[], D: number[][]): number {
  // Sum of (position difference)² × D[i,j] for all pairs
  let s = 0;
  for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length; b++) {
      const i = order[a], j = order[b];
      const dp = (b - a);
      s += dp * dp * (D[i][j] || 0);
    }
  }
  return s;
}
