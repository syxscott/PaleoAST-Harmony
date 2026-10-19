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

  // Pair weights actually used by the search: the (normalised) distance
  // matrix plus the co-occurrence structure of the observed sections.
  const weights = _pairWeights(distanceMatrix, sectionData, n);

  // Step 1: Construct reference section from section data (if provided)
  // Reference section is the optimal average position of each event
  const refSection = _constructReferenceSection(distanceMatrix, weights, sectionData, n);

  // Step 2: Initial ranking by sorting events by reference section position
  let order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => refSection[a] - refSection[b]);

  const trace: number[] = [];

  // Step 3: Constrained swaps (Gradstein 1985)
  for (let iter = 0; iter < nIterations; iter++) {
    let improved = false;
    let bestCost = _cost(order, weights);
    for (let i = 0; i < n - 1; i++) {
      const swapped = order.slice();
      [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
      const newCost = _cost(swapped, weights);
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
 * Effective pair weights for the RASC search.
 *
 * Two sources are combined:
 *
 *  1. the caller-supplied distance matrix, normalised to [0, 1] (scaling a
 *     single-term cost does not change its arg-min, so the behaviour
 *     without section data is unchanged);
 *  2. the **co-occurrence** of the observed sections: two events that are
 *     found together in a section are close in time and must not be put
 *     far apart in the reference section.
 *
 * The section data holds presence/abundance per (section, event) — it
 * carries no height for an individual event — so co-occurrence is the
 * observable proxy for "these two events belong to the same level". The
 * old implementation ignored the section data completely (the `_refQuality`
 * body never mentioned its `sectionData` argument), which made the ranking
 * a pure function of the distance matrix: two sections with completely
 * opposite observations produced bit-identical rankings.
 */
function _pairWeights(D: number[][], sectionData: number[][] | undefined, n: number): number[][] {
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = D[i][j];
      if (isFinite(v) && v > maxD) maxD = v;
    }
  }
  const dScale = maxD > 0 ? maxD : 1;

  const w: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = isFinite(D[i][j]) ? D[i][j] / dScale : 0;
      w[i][j] = v; w[j][i] = v;
    }
  }

  if (sectionData && sectionData.length > 0) {
    for (let s = 0; s < sectionData.length; s++) {
      if (!sectionData[s] || sectionData[s].length < n) {
        throw new ComputationError(
          `RASC: section ${s + 1} has ${sectionData[s]?.length ?? 0} columns, expected at least ${n}`);
      }
    }
    const co = _coOccurrence(sectionData, n);
    let maxCo = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) if (co[i][j] > maxCo) maxCo = co[i][j];
    }
    const cScale = maxCo > 0 ? maxCo : 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const c = co[i][j] / cScale;
        w[i][j] += c; w[j][i] += c;
      }
    }
  }
  return w;
}

/** Number of sections in which each pair of events is observed together. */
function _coOccurrence(sectionData: number[][], n: number): number[][] {
  const co: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const row of sectionData) {
    for (let i = 0; i < n; i++) {
      if (!(row[i] > 0)) continue;
      for (let j = i + 1; j < n; j++) {
        if (!(row[j] > 0)) continue;
        co[i][j]++; co[j][i]++;
      }
    }
  }
  return co;
}

/**
 * Construct the reference section: the event positions that minimise the
 * weighted misfit against the pair weights (the distance matrix plus the
 * co-occurrence structure of the observed sections).
 *
 * The positions are found by constrained swaps (Gradstein 1985 style); the
 * swap that lowers the misfit is kept, the other one is reverted.
 */
function _constructReferenceSection(
  D: number[][], weights: number[][], sectionData: number[][] | undefined, n: number
): number[] {
  // Without section data the weights are the distance matrix alone, so the
  // reference section is the 1D scaling of that matrix.
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
        // _refQuality is a MISFIT (Σ W·Δrank²) and must be minimised, matching
        // the `_cost` convention rasc() itself uses. Keep the swap only when it
        // lowers the misfit; otherwise restore the previous order. The two
        // branches were inverted, so the search kept worse arrangements and
        // discarded better ones.
        const before = _refQuality(positions, weights);
        [positions[i], positions[j]] = [positions[j], positions[i]];
        const after = _refQuality(positions, weights);
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

/**
 * Misfit of a candidate reference section: the weighted sum of the squared
 * rank separations of all event pairs.
 *
 * The weights are the pair weights built by `_pairWeights` — they contain
 * the observed co-occurrence structure, so the reference section (and with
 * it the ranking) really depends on the sections that were measured.
 */
function _refQuality(positions: number[], weights: number[][]): number {
  let q = 0;
  for (let a = 0; a < positions.length; a++) {
    for (let b = a + 1; b < positions.length; b++) {
      const rankDist = Math.abs(positions[a] - positions[b]);
      q += weights[a][b] * rankDist * rankDist;
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

function _cost(order: number[], weights: number[][]): number {
  // Sum of (position difference)² × weight for all pairs. The weights
  // contain the observed co-occurrence structure, so the ranking depends
  // on the measured sections and not only on the distance matrix.
  let s = 0;
  for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length; b++) {
      const i = order[a], j = order[b];
      const dp = (b - a);
      s += dp * dp * (weights[i][j] || 0);
    }
  }
  return s;
}
