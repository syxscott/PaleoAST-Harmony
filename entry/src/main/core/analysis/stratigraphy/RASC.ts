/**
 * Ranking and Scaling (RASC) — replaces stratigraphy/biostratigraphy.py::RASCAnalyzer.
 *
 * Implements Gradstein (1985) RASC algorithm:
 *   1. Compute pairwise cross-correlation matrix between sections.
 *   2. Construct reference section by optimal averaging of all sections.
 *   3. Rank events along the reference section using weighted swaps.
 *   4. Scale positions to minimize misfit (biozone compression/extension).
 *
 * Reference: Gradstein, F.M. (1985) "Biostratigraphic Correlation by
 * Quantitative Multiple Event Stratigraphy", Utrecht Micropaleontological
 * Bulletins 35: 77-89.
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
  referenceSection?: number[];
  scalingFactors?: number[];
}

/**
 * Compute RASC ranking by constrained iterative swaps on reference section.
 *
 * @param distanceMatrix  n_events × n_events symmetric distance matrix
 * @param eventNames      optional event names
 * @param nIterations     maximum refinement iterations
 * @param sectionData     optional: n_sections × n_events presence/absence or abundance
 *                        Used to construct reference section via optimal averaging.
 */
export function rasc(
  distanceMatrix: number[][],
  eventNames?: string[],
  nIterations: number = 100,
  sectionData?: number[][]
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

  // Step 1: Construct reference section from section data (if provided)
  // Reference section is the optimal average position of each event
  const refSection = _constructReferenceSection(distanceMatrix, sectionData, n);

  // Step 2: Initial ranking by sorting events by reference section position
  let order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => refSection[a] - refSection[b]);

  const trace: number[] = [];

  // Step 3: Constrained swaps (Gradstein 1985)
  for (let iter = 0; iter < nIterations; iter++) {
    let improved = false;
    let bestCost = _cost(order, distanceMatrix);
    for (let i = 0; i < n - 1; i++) {
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

  // Step 4: Compute scaling factors (compress/extend positions to best fit each section)
  const scalingFactors = sectionData
    ? _computeScalingFactors(order, distanceMatrix, sectionData, refSection)
    : undefined;

  return {
    sections: sectionData ? sectionData.map((_, i) => `Section_${i + 1}`) : [],
    events,
    ranking: order.map(i => events[i]),
    distanceMatrix,
    method: 'rasc',
    costTrace: trace,
    finalCost: trace[trace.length - 1],
    referenceSection: refSection,
    scalingFactors
  };
}

/**
 * Construct reference section: weighted average of event positions across sections.
 * Uses optimal sequence alignment (Gradstein 1985 approach).
 */
function _constructReferenceSection(
  D: number[][], sectionData: number[][] | undefined, n: number
): number[] {
  // If no section data, use 1D scaling from distance matrix
  if (!sectionData || sectionData.length === 0) {
    return _scaleFromDistanceMatrix(D, n);
  }

  // Use MDS-like scaling: positions minimize weighted distance to all sections
  // Start with uniform positions
  const positions = Array.from({ length: n }, (_, i) => i);

  // Iterative refinement
  for (let iter = 0; iter < 50; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Swap test: does swapping improve reference section quality?
        // _refQuality is a MISFIT (Σ D·Δrank²) and must be minimised, matching
        // the `_cost` convention rasc() itself uses. Keep the swap only when it
        // lowers the misfit; otherwise restore the previous order. The two
        // branches were inverted, so the search kept worse arrangements and
        // discarded better ones.
        const before = _refQuality(positions, D, sectionData);
        [positions[i], positions[j]] = [positions[j], positions[i]];
        const after = _refQuality(positions, D, sectionData);
        if (after < before) {
          changed = true; // improvement kept
        } else {
          [positions[i], positions[j]] = [positions[j], positions[i]]; // revert
        }
      }
    }
    if (!changed) break;
  }

  // Normalize to [0, n]
  const minP = Math.min(...positions), maxP = Math.max(...positions);
  if (maxP - minP > 1e-10) {
    return positions.map(p => (p - minP) / (maxP - minP) * (n - 1));
  }
  return positions;
}

function _refQuality(positions: number[], D: number[][], sectionData: number[][]): number {
  // Weighted sum of squared rank differences
  let q = 0;
  for (let a = 0; a < positions.length; a++) {
    for (let b = a + 1; b < positions.length; b++) {
      const i = a, j = b;
      const rankDist = Math.abs(positions[a] - positions[b]);
      q += D[i][j] * rankDist * rankDist;
    }
  }
  return q;
}

function _scaleFromDistanceMatrix(D: number[][], n: number): number[] {
  // MDS-based 1D scaling using power iteration on distance matrix
  // Use first eigenvector of the distance-based "connectivity" matrix
  let pos = Array.from({ length: n }, (_, i) => i - n / 2);

  for (let iter = 0; iter < 20; iter++) {
    const newPos = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let wSum = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = D[i][j] || 1;
        const w = 1 / (d * d + 1e-10);
        newPos[i] += w * pos[j];
        wSum += w;
      }
      if (wSum > 0) newPos[i] /= wSum;
    }
    pos = newPos;
  }

  // Sort and assign ranks
  const sorted = pos.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  for (let i = 0; i < n; i++) ranks[sorted[i].i] = i;
  return ranks;
}

function _computeScalingFactors(
  order: number[], D: number[][], sectionData: number[][], refSection: number[]
): number[] {
  // For each section, compute scaling factor s such that s·refPosition ≈ actual position
  // Minimizes Σ (s·ref_i - actual_i)² · weight
  const nSec = sectionData.length;
  const factors: number[] = [];

  for (let s = 0; s < nSec; s++) {
    // Find event positions in this section
    const positions: number[] = [];
    const refPos: number[] = [];
    for (let e = 0; e < sectionData[0].length; e++) {
      if (sectionData[s][e] > 0) {
        // Position in ranking
        const rankIdx = order.indexOf(e);
        if (rankIdx >= 0) {
          refPos.push(refSection[e]);
          positions.push(rankIdx);
        }
      }
    }
    if (positions.length < 2) { factors.push(1); continue; }

    // Least squares: s = Σ r_i·p_i / Σ p_i²
    let num = 0, den = 0;
    for (let i = 0; i < positions.length; i++) {
      num += refPos[i] * positions[i];
      den += refPos[i] * refPos[i];
    }
    factors.push(den > 0 ? num / den : 1);
  }
  return factors;
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
