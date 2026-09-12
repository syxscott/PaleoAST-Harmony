/**
 * Ripley's K Spatial Point Pattern Analysis — replaces statistics/spatial.py.
 *
 * Mathematical Foundation:
 *   K(r) = (A / n²) * Σ_{i≠j} I(d_ij < r)               (Diggle 2003)
 *   L(r) = sqrt(K(r) / π) - r                              (standardized)
 *   For CSR: K(r) = πr², L(r) = 0.
 *   Monte Carlo envelope simulates CSR.
 *
 * Boundary Corrections:
 *   - 'none':       uncorrected (default, useful when points are far from edges).
 *   - 'loeffler':   Loeffler & Thompson (1977) edge correction.
 *                   Weight for pair (i,j) = 1 / (1 - 2w_ij/d_ij)
 *                   where w_ij is the fraction of the circumference of a circle
 *                   of radius d_ij centred at i that lies inside the study area.
 *   - 'translation': Ohser & Stoyan (1981) translation correction.
 *                   Weights each pair by the fraction of the rectangular window
 *                   that is covered when one point is translated to cover the other.
 *
 * References:
 * - Diggle, P.J. (2003). Statistical Analysis of Spatial Point Patterns, 2nd ed.
 *   Arnold.  Sec. 4.3 "Edge corrections".
 * - Loeffler, E.J. & Thompson, J.P. (1977). "Boundary corrections for
 *  Estimator of the second-order characteristic of a planar point process."
 *   Biometrical J. 19(8): 595-600.
 * - Ohser, J. & Stoyan, D. (1981). "On the second-order analysis of stationary
 *   point processes." J. Appl. Probab. 18: 376-384.
 * - vegan::Kenvl / matasino::spatstat for R implementations.
 */
import { Matrix } from '../../math/Matrix';
import { ComputationError } from '../../utils/Exceptions';

export interface SpatialResult {
  rValues: number[];
  kValues: number[];
  lValues: number[];
  envelopeUpper: number[];
  envelopeLower: number[];
  pointCoords: number[][];
  nPoints: number;
  area: number;
  nSimulations: number;
  interpretation: string;
  boundaryCorrection: string;
}

/**
 * Boundary correction methods for Ripley's K.
 */
export type BoundaryCorrection = 'none' | 'loeffler' | 'translation';

/**
 * Analyze 2D spatial point pattern using Ripley's K with boundary corrections.
 *
 * @param coords              N×2 array of coordinates
 * @param rMax                maximum distance (default: 0.25 * min bounding dimension)
 * @param nRValues            number of r values to evaluate (default 50)
 * @param nSimulations        Monte Carlo simulations (default 99)
 * @param boundaryCorrection  'none' | 'loeffler' | 'translation' (default 'none')
 */
export function ripleyK(
  coords: number[][] | Matrix,
  rMax?: number,
  nRValues: number = 50,
  nSimulations: number = 99,
  boundaryCorrection: BoundaryCorrection = 'none',
): SpatialResult {
  let pts: number[][];
  if (coords instanceof Matrix) {
    if (coords.cols !== 2) throw new ComputationError('Coords must have 2 columns');
    pts = coords.to2D();
  } else {
    pts = coords;
  }
  if (pts.length < 3) throw new ComputationError('Need ≥ 3 points');
  for (const p of pts) if (p.length !== 2) throw new ComputationError('Coords must be (n, 2) — inconsistent row');

  const n = pts.length;

  // Bounding box + area
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of pts) {
    if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
    if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1];
  }
  const area = (xMax - xMin) * (yMax - yMin);
  if (area === 0) throw new ComputationError('Points have zero area');
  if (rMax === undefined) rMax = 0.25 * Math.min(xMax - xMin, yMax - yMin);

  const rValues: number[] = [];
  for (let i = 0; i < nRValues; i++) rValues.push((i / (nRValues - 1)) * rMax);

  const kValues = _computeK(pts, rValues, area, xMin, xMax, yMin, yMax, boundaryCorrection);
  const lValues = kValues.map((k, i) => Math.sqrt(Math.max(k, 0) / Math.PI) - rValues[i]);

  // Monte Carlo envelope
  const lSims: number[][] = [];
  for (let s = 0; s < nSimulations; s++) {
    const random = new Array(n);
    for (let i = 0; i < n; i++) {
      random[i] = [xMin + Math.random() * (xMax - xMin), yMin + Math.random() * (yMax - yMin)];
    }
    const kRand = _computeK(random, rValues, area, xMin, xMax, yMin, yMax, boundaryCorrection);
    const lRand = kRand.map((k, i) => Math.sqrt(Math.max(k, 0) / Math.PI) - rValues[i]);
    lSims.push(lRand);
  }
  const envelopeUpper: number[] = [], envelopeLower: number[] = [];
  for (let j = 0; j < nRValues; j++) {
    const vals = lSims.map(s => s[j]).sort((a, b) => a - b);
    envelopeLower.push(vals[Math.floor(nSimulations * 0.025)]);
    envelopeUpper.push(vals[Math.floor(nSimulations * 0.975)]);
  }

  // Interpretation: focus on second half of distance range to avoid boundary artifacts
  const halfFrom = Math.floor(nRValues / 4);
  let above = 0, below = 0, nw = 0;
  for (let j = halfFrom; j < nRValues; j++) {
    if (lValues[j] > envelopeUpper[j]) above++;
    if (lValues[j] < envelopeLower[j]) below++;
    nw++;
  }
  let interpretation: string;
  if (nw > 0 && above / nw > 0.5) interpretation = 'Pattern: CLUSTERED (L(r) above envelope → clustering)';
  else if (nw > 0 && below / nw > 0.5) interpretation = 'Pattern: REGULAR/DISPERSED (L(r) below envelope → regularity)';
  else interpretation = 'Pattern: RANDOM (L(r) within envelope → CSR consistent)';

  return {
    rValues, kValues, lValues, envelopeUpper, envelopeLower,
    pointCoords: pts, nPoints: n, area, nSimulations, interpretation,
    boundaryCorrection,
  };
}

/**
 * Compute Ripley's K at a set of distances with the specified boundary correction.
 *
 * Uncorrected:  K(r) = (A / n²) * Σ_{i≠j} I(d_ij < r)
 *
 * Loeffler (1977): w_ij = 1 / (1 - 2w/d_ij) where w is the fraction of the
 *   circumference outside the window.  Approximated by measuring how much of
 *   the circle centred at i with radius d_ij falls inside the bounding rectangle.
 *   Formula: w_ij = 1 / (1 - 2 * (Δx_out + Δy_out) / (2πd_ij))
 *   where Δx_out = max(0, d_ij - min(x_i, x_max-x_i)) + max(0, d_ij - min(x_i, x_i-x_min))
 *   and similarly for y.  Full circle fraction = 1 - (Δx_out + Δy_out) / (2πd_ij).
 *
 * Translation (Ohser & Stoyan 1981): weights each pair by the fraction of
 *   the rectangular window that is overlapped when one point is used as a
 *   centre.  For axis-aligned rectangle the weight reduces to:
 *     e_ij = (w - d_ij_x)^+ * (w - d_ij_y)^+ / w²
 *   where w = area of window, d_ij_x = |x_i - x_j|, and (·)^+ = max(·, 0).
 */
function _computeK(
  pts: number[][],
  rValues: number[],
  area: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
  correction: BoundaryCorrection,
): number[] {
  const n = pts.length;
  const out: number[] = [];

  for (const r of rValues) {
    if (r <= 0) { out.push(0); continue; }

    let count = 0;
    let weightSum = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[i][0] - pts[j][0];
        const dy = pts[i][1] - pts[j][1];
        const dij = Math.sqrt(dx * dx + dy * dy);

        if (dij < r) {
          let w = 1.0; // default: no correction

          if (correction === 'loeffler') {
            // Loeffler (1977) circumference-based weight
            w = _loefflerWeight(pts[i][0], pts[i][1], dij, xMin, xMax, yMin, yMax);
          } else if (correction === 'translation') {
            // Ohser-Stoyan (1981) translation correction
            w = _translationWeight(pts[i][0], pts[i][1], pts[j][0], pts[j][1],
                                   xMin, xMax, yMin, yMax, area);
          }

          count += w;
          weightSum += w;
        }
      }
    }

    // Use weightSum instead of raw count for corrected versions
    const K = n > 1 ? (area * weightSum) / (n * (n - 1)) : 0;
    out.push(K);
  }
  return out;
}

/**
 * Loeffler (1977) boundary correction weight for a pair (i, j).
 * w_ij = 1 / (1 - α_ij) where α_ij is the fraction of the circumference
 * of the circle centred at point i that lies outside the study rectangle.
 */
function _loefflerWeight(
  xi: number, yi: number, dij: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
): number {
  // Fraction of the circle circumference outside each edge
  // (approximated as arc length fraction, not chord fraction)
  const w = xMax - xMin;
  const h = yMax - yMin;

  // For each edge, the arc fraction outside is:
  //   θ_out = 2 * arccos(d_edge / dij)
  // where d_edge is the perpendicular distance from the point to the edge.
  let arcOutside = 0.0;

  // Left edge: d = xi - xMin
  if (xi - xMin < dij) {
    const cosTheta = Math.max(-1, Math.min(1, (xi - xMin) / dij));
    const theta = Math.acos(cosTheta);
    arcOutside += theta / Math.PI;
  }

  // Right edge: d = xMax - xi
  if (xMax - xi < dij) {
    const cosTheta = Math.max(-1, Math.min(1, (xMax - xi) / dij));
    const theta = Math.acos(cosTheta);
    arcOutside += theta / Math.PI;
  }

  // Bottom edge: d = yi - yMin
  if (yi - yMin < dij) {
    const cosTheta = Math.max(-1, Math.min(1, (yi - yMin) / dij));
    const theta = Math.acos(cosTheta);
    arcOutside += theta / Math.PI;
  }

  // Top edge: d = yMax - yi
  if (yMax - yi < dij) {
    const cosTheta = Math.max(-1, Math.min(1, (yMax - yi) / dij));
    const theta = Math.acos(cosTheta);
    arcOutside += theta / Math.PI;
  }

  const fractionInside = Math.max(0, 1 - arcOutside);
  return fractionInside > 0 ? 1 / fractionInside : 1;
}

/**
 * Ohser-Stoyan (1981) translation correction.
 * Weight for pair (i,j) based on how much of the study rectangle is covered
 * when translating the rectangle by vector (x_j - x_i, y_j - y_i).
 *
 * For a rectangular window W = [0,w] × [0,h], the correction is:
 *   e_ij = (w - |x_j - x_i|)^+ * (h - |y_j - y_i|)^+ / (w * h)
 * where (·)^+ = max(·, 0).
 */
function _translationWeight(
  xi: number, yi: number, xj: number, yj: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
  area: number,
): number {
  const w = xMax - xMin;
  const h = yMax - yMin;
  const dx = Math.abs(xj - xi);
  const dy = Math.abs(yj - yi);

  const overlapX = Math.max(0, w - dx);
  const overlapY = Math.max(0, h - dy);

  const weight = (overlapX * overlapY) / area;
  return weight > 0 ? 1 / weight : 1;
}

