/**
 * Ripley's K Spatial Point Pattern Analysis — replaces statistics/spatial.py.
 *
 * Mathematical Foundation:
 *   K(r) = (A / n²) * Σ_{i≠j} I(d_ij < r)               (Diggle 2003)
 *   L(r) = sqrt(K(r) / π) - r                              (standardized)
 *   For CSR: K(r) = πr², L(r) = 0.
 *   Monte Carlo envelope simulates CSR.
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
}

/**
 * Analyze 2D spatial point pattern using Ripley's K.
 *
 * @param coords         N×2 array
 * @param rMax           maximum distance (default: 0.25 * min dimension)
 * @param nRValues       number of r values to evaluate (default 50)
 * @param nSimulations   Monte Carlo simulations (default 99)
 */
export function ripleyK(
  coords: number[][] | Matrix,
  rMax?: number,
  nRValues: number = 50,
  nSimulations: number = 99
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

  // Pre-compute squared distances for K(r)
  const kValues = _computeK(pts, rValues, area);
  const lValues = kValues.map((k, i) => Math.sqrt(Math.max(k, 0) / Math.PI) - rValues[i]);

  // Monte Carlo envelope
  const lSims: number[][] = [];
  for (let s = 0; s < nSimulations; s++) {
    const random = new Array(n);
    for (let i = 0; i < n; i++) {
      random[i] = [xMin + Math.random() * (xMax - xMin), yMin + Math.random() * (yMax - yMin)];
    }
    const kRand = _computeK(random, rValues, area);
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
    pointCoords: pts, nPoints: n, area, nSimulations, interpretation
  };
}

function _computeK(pts: number[][], rValues: number[], area: number): number[] {
  const n = pts.length;
  const out: number[] = [];
  for (const r of rValues) {
    if (r <= 0) { out.push(0); continue; }
    let count = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[i][0] - pts[j][0];
        const dy = pts[i][1] - pts[j][1];
        if (dx * dx + dy * dy < r * r) count++;
      }
    }
    out.push(n > 1 ? (area * 2 * count) / (n * n) : 0);
  }
  return out;
}
