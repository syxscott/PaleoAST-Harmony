/**
 * Geological age modeling — replaces stratigraphy/correlation.py::AgeModelAnalyzer.
 *
 * Provides linear and PCHIP-based interpolation from biostratigraphic age
 * constraints and computes sedimentation rates.
 */
import { lowess } from '../../math/LOWESS';
import { pchipInterpolate } from './StratExtended';
import { ComputationError } from '../../utils/Exceptions';
export interface StratigraphicSection {
  name: string;
  heights: number[];
  thicknesses?: number[];
  lithologies?: string[];
  ages?: number[];
  ageErrors?: number[];
  notes?: string[];
}

export interface AgeModelResult {
  section: StratigraphicSection;
  modeledAges: number[];
  confidenceIntervals: [number[], number[]];
  sedimentationRates: number[];
  modelType: 'linear' | 'spline';
  /** True for the samples that lie outside the constrained height interval
   *  (their age is extrapolated, not interpolated). */
  extrapolated: boolean[];
}

export function buildAgeModel(
  section: StratigraphicSection,
  ageConstraints: [number, number, number][],   // (height, age, error)
  modelType: 'linear' | 'spline' = 'linear'
): AgeModelResult {
  if (ageConstraints.length < 2) throw new Error('Need ≥ 2 age constraints');
  const sorted = ageConstraints.slice().sort((a, b) => a[0] - b[0]);
  const ch = sorted.map(c => c[0]);
  const ca = sorted.map(c => c[1]);
  const ce = sorted.map(c => c[2]);

  // A repeated height makes the interpolation grid ambiguous: the PCHIP
  // secant became 0/0 = NaN and the whole age curve turned into NaN. The
  // duplicate is reported instead of being silently interpolated.
  for (let i = 1; i < ch.length; i++) {
    if (ch[i] === ch[i - 1]) {
      throw new ComputationError(
        `buildAgeModel: duplicate age constraint at height ${ch[i]} — ` +
        'the constraint heights must be distinct');
    }
  }

  // 'spline' uses PCHIP (monotone cubic Hermite, Fritsch-Carlson 1980):
  // sparse age constraints make natural cubic splines oscillate and can
  // produce negative sedimentation rates; PCHIP is shape-preserving
  // (2026-09 review H9, matches scipy PchipInterpolator).
  // Outside the constrained interval both models now behave the same way:
  // the age is linearly extrapolated along the end segment and flagged.
  const modeled = modelType === 'linear'
    ? _linearInterp(section.heights, ch, ca)
    : section.heights.map(h => pchipInterpolate(ch, ca, h));

  const lo = ch[0], hi = ch[ch.length - 1];
  const extrapolated = section.heights.map(h => h < lo || h > hi);
  // Ages are Ma before present, so an extrapolated age can never be
  // younger than the present: clamp it at 0 rather than reporting a
  // negative age. (The 'linear' model truncates and never goes negative.)
  const modeledAges = modeled.map((a, i) => (extrapolated[i] ? Math.max(0, a) : a));

  // Sedimentation rate (geological convention: age decreases with height)
  const rates = new Array(section.heights.length).fill(0);
  for (let i = 1; i < section.heights.length; i++) {
    const dh = section.heights[i] - section.heights[i - 1];
    const da = modeledAges[i] - modeledAges[i - 1];
    if (Math.abs(da) > 1e-12) rates[i] = Math.abs(dh / da);  // Always positive, magnitude only
    // Note: using Math.abs() because geological age convention is "Ma before present" (decreasing upward)
    else rates[i] = rates[i - 1];
  }

  const meanErr = ce.reduce((s, e) => s + e, 0) / ce.length;
  const ciLower = modeledAges.map(a => a - 1.96 * meanErr);
  const ciUpper = modeledAges.map(a => a + 1.96 * meanErr);

  return {
    section, modeledAges,
    confidenceIntervals: [ciLower, ciUpper],
    sedimentationRates: rates,
    modelType,
    extrapolated
  };
}

/**
 * Compute sedimentation rates with optional LOWESS smoothing.
 * Returns (heights, rates, smoothedRates).
 */
export function computeSedimentationRate(
  section: StratigraphicSection,
  smooth: boolean = true,
  frac: number = 0.3
): { heights: number[]; rates: number[]; smoothedRates: number[] } {
  if (!section.ages) throw new Error('Section must have age data');
  if (section.heights.length !== section.ages.length) throw new Error('heights/ages length mismatch');
  const h = section.heights, a = section.ages;
  const rates = new Array(h.length).fill(0);
  for (let i = 1; i < h.length; i++) {
    const dh = h[i] - h[i - 1];
    const da = a[i] - a[i - 1];
    rates[i] = Math.abs(da) > 1e-12 ? Math.abs(dh / da) : 0;
  }
  let smoothed = rates.slice();
  if (smooth && h.length > 4) {
    try {
      // rates[0] is a placeholder: there is no interval above the first
      // sample, so it stays 0. Feeding that 0 to the smoother dragged the
      // top of the curve down (a constant rate of 5 came back as
      // 1.86/3.04/4.14 for the first three samples). The fit therefore
      // runs on the real rates only, and the first entry of the smoothed
      // series is the first smoothed rate.
      const sub = lowess(h.slice(1), rates.slice(1), frac, 0);
      smoothed = [sub[0], ...sub];
    } catch {
      smoothed = rates;
    }
  }
  return { heights: h, rates, smoothedRates: smoothed };
}

function _linearInterp(x: number[], xh: number[], yh: number[]): number[] {
  const out = new Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (xi <= xh[0]) { out[i] = yh[0]; continue; }
    if (xi >= xh[xh.length - 1]) { out[i] = yh[yh.length - 1]; continue; }
    let k = 1;
    while (k < xh.length && xh[k] < xi) k++;
    const t = (xi - xh[k - 1]) / (xh[k] - xh[k - 1]);
    out[i] = yh[k - 1] * (1 - t) + yh[k] * t;
  }
  return out;
}

/**
 * @deprecated Natural cubic spline (kept for reference). Age models now use
 * PCHIP — natural splines oscillate with sparse age constraints and can imply
 * negative sedimentation rates (Python correlation.py switched to PCHIP).
 */
function _cubicInterp(x: number[], xh: number[], yh: number[]): number[] {
  const n = xh.length;
  if (n < 2) return x.map(_ => yh[0] ?? 0);
  if (n === 2) {
    // Linear fallback for 2-point spline
    return x.map(xi => yh[0] + ((yh[1] - yh[0]) / (xh[1] - xh[0])) * (xi - xh[0]));
  }
  // Compute second derivatives y2[]
  const y2 = new Array(n).fill(0);
  const u = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const sig = (xh[i] - xh[i - 1]) / (xh[i + 1] - xh[i - 1]);
    const p = sig * y2[i - 1] + 2;
    y2[i] = (sig - 1) / p;
    const dd = (yh[i + 1] - yh[i]) / (xh[i + 1] - xh[i]) - (yh[i] - yh[i - 1]) / (xh[i] - xh[i - 1]);
    u[i] = (6 * dd / (xh[i + 1] - xh[i - 1]) - sig * u[i - 1]) / p;
  }
  for (let i = n - 2; i >= 0; i--) y2[i] = y2[i] * y2[i + 1] + u[i];
  // Spline eval
  return x.map(xi => {
    if (xi <= xh[0]) return yh[0];
    if (xi >= xh[n - 1]) return yh[n - 1];
    let k = 1;
    while (k < n - 1 && xh[k] < xi) k++;
    const h = xh[k] - xh[k - 1];
    const a = (xh[k] - xi) / h;
    const b = (xi - xh[k - 1]) / h;
    return a * yh[k - 1] + b * yh[k]
      + ((a * a * a - a) * y2[k - 1] + (b * b * b - b) * y2[k]) * h * h / 6;
  });
}

