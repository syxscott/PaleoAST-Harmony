/**
 * Reduced Major Axis (RMA) Regression — replaces morphometrics/rma.py.
 *
 * Unlike ordinary least-squares (OLS) regression which assumes x is measured
 * without error, RMA minimises the area of right-triangles formed by residuals
 * in both x and y directions simultaneously.  This makes RMA symmetric and
 * appropriate for allometry (size-shape relationships) where neither variable
 * is a predictor in the causal sense.
 *
 * The RMA slope is:
 *   b_RMA = sign(r) * (σ_y / σ_x)
 *
 * where σ_x and σ_y are the standard deviations and r is the Pearson correlation.
 *
 * References:
 * - Legendre, P. & Legendre, L. (2012). Numerical Ecology, 3rd ed.  Sec. 13.1.3
 *   "Reduced major axis regression." Elsevier.
 * - Warton, D.I. et al. (2006). "SMATR: Standardised Major Axis Tests and
 *   Routines." R package lmodel2.  doi:10.1111/j.2041-210X.2012.00221.x
 * - Niklas, K.J. (1994). "Plant allometry."  Univ. Chicago Press.  [allometric
 *   applications]
 * - Ricker, W.E. (1984). "Computation and uses of central trend lines."
 *   Canadian J. Zoology 62: 1897-1905.
 */
import { Matrix } from '../../math/Matrix';
import { mean, std, qt } from '../../math/stats';

/** Input type alias for plain arrays or Matrix columns */
export type Vector = number[] | Matrix;

function toArray(v: Vector): number[] {
  return Array.isArray(v) ? v : v.toArray();
}

export interface RMAResult {
  slope: number;
  intercept: number;
  slopeCI: [number, number];   // 95% confidence interval
  r2: number;
  /** Correlation coefficient r */
  r: number;
  /** Standard error of the slope estimate */
  slopeSE: number;
}

export function rmaRegression(x: Vector, y: Vector): RMAResult {
  const X = toArray(x);
  const Y = toArray(y);

  if (X.length !== Y.length) {
    throw new Error(`rmaRegression: x (${X.length}) and y (${Y.length}) must have equal length`);
  }
  if (X.length < 3) {
    throw new Error('rmaRegression: need at least 3 data points');
  }

  const n = X.length;

  // ── Sample statistics ───────────────────────────────────────────────────────
  const xMean = mean(X), yMean = mean(Y);
  const xStd = std(X), yStd = std(Y);

  // Pearson r
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (X[i] - xMean) * (Y[i] - yMean);
  }
  cov /= n - 1;
  const r = xStd > 0 && yStd > 0 ? cov / (xStd * yStd) : 0;

  // ── RMA slope and intercept ────────────────────────────────────────────────
  // b_RMA = sign(cov) * σ_y / σ_x
  const slope = (xStd > 0 && yStd > 0) ? Math.sign(cov) * (yStd / xStd) : 0;
  const intercept = yMean - slope * xMean;

  // ── R² (same as OLS — proportion of variance explained) ────────────────────
  const r2 = r * r;

  // ── Standard error of slope ────────────────────────────────────────────────
  // SE(b_RMA) = |b_RMA| * sqrt((1 - r²) / (n - 2))   [Ricker 1984; Legendre 2012]
  const residVar = 1 - r2;
  const slopeSE = Math.abs(slope) * Math.sqrt(Math.max(0, residVar) / (n - 2));

  // ── 95% CI via t-distribution ─────────────────────────────────────────────
  // The verified t quantile from math/stats (Newton iteration on the exact t
  // CDF, itself validated against scipy). The module used to carry its own
  // copy built on a mistranscribed Numerical Recipes 6.2C continued fraction:
  // NR's betacf alternates TWO different `aa` forms per iteration, and the
  // port merged them into one with the wrong denominators. tCDF was then
  // wrong, Newton diverged, and the 95% interval came out as e.g.
  // [-388, 390] for a slope of 2.00 at n = 10. It also silently fell back to
  // the normal quantile for df > 100, so even the wide case was off
  // (t(0.975, 200) = 1.9719, not 1.9600).
  const tCrit = qt(0.975, n - 2);
  const ci: [number, number] = [
    slope - tCrit * slopeSE,
    slope + tCrit * slopeSE,
  ];

  return { slope, intercept, slopeCI: ci, r2, r, slopeSE };
}
