/**
 * LOWESS (Locally Weighted Scatterplot Smoothing) — Cleveland (1979).
 *
 * Full algorithm with robust bisquare weighting:
 *   1. For each x_i, find k = floor(frac·n) nearest neighbors.
 *   2. Compute tricube weights: w_j = (1 - (|x_j - x_i| / d_i)³)³
 *   3. Fit weighted least squares (local linear).
 *   4. Compute residuals r_j = y_j - ŷ_j.
 *   5. Compute bisquare weights: W_j = B(r_j / 6MAD) where
 *        B(u) = (1 - u²)² for |u| < 1, else 0.
 *   6. Re-fit with product weights w_j · W_j.
 *   7. Iterate steps 4-6 for nIter passes (default 3).
 *
 * Reference: Cleveland, W.S. (1979) "Robust Locally Weighted Regression
 * and Smoothing Scatterplots", J. Amer. Statist. Assoc. 74(368): 829-836.
 */

/** Tricube kernel: (1 - |u|³)³ for |u| < 1, else 0 */
function tricube(u: number): number {
  const absU = Math.abs(u);
  if (absU >= 1) return 0;
  const t = 1 - absU * absU * absU;
  return t * t * t;
}

/** Local weighted linear fit with tricube kernel. */
function lowessFitWithWeights(x: number[], y: number[], k: number, biweights: number[]): number[] {
  const n = x.length;
  const result: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    // Nearest neighbors
    const dists = x.map((v, j) => ({ d: Math.abs(v - x[i]), j }));
    dists.sort((a, b) => a.d - b.d);
    const maxD = dists[k - 1].d || 1;

    // Build weighted local dataset
    const xLocal: number[] = [], yLocal: number[] = [], wLocal: number[] = [];
    for (let jj = 0; jj < k; jj++) {
      const { j, d } = dists[jj];
      const w = tricube(d / maxD) * biweights[j];
      if (w > 0) { xLocal.push(x[j]); yLocal.push(y[j]); wLocal.push(w); }
    }

    if (xLocal.length < 2) { result[i] = y[i]; continue; }

    // Weighted linear regression: y = a + b·x
    const wSum = wLocal.reduce((a, b) => a + b, 0);
    const wxSum = wLocal.reduce((a, w, idx) => a + w * xLocal[idx], 0);
    const wySum = wLocal.reduce((a, w, idx) => a + w * yLocal[idx], 0);
    const wxxSum = wLocal.reduce((a, w, idx) => a + w * xLocal[idx] * xLocal[idx], 0);
    const wxySum = wLocal.reduce((a, w, idx) => a + w * xLocal[idx] * yLocal[idx], 0);

    const denom = wSum * wxxSum - wxSum * wxSum;
    if (Math.abs(denom) < 1e-15) { result[i] = wySum / wSum; continue; }

    const b = (wSum * wxySum - wxSum * wySum) / denom;
    const a = (wySum - b * wxSum) / wSum;
    result[i] = a + b * x[i];
  }
  return result;
}

/** Local weighted linear fit (initial pass with unit weights). */
function lowessFit(x: number[], y: number[], k: number): number[] {
  return lowessFitWithWeights(x, y, k, new Array(x.length).fill(1));
}

/**
 * LOWESS smoothing with robust bisquare weighting.
 * @param x       X coordinates
 * @param y       Y values
 * @param frac    Fraction of points to use for each local fit (default 0.3)
 * @param nIter   Number of robustness iterations (default 3)
 * @returns       Smoothed y values
 */
export function lowess(x: number[], y: number[], frac: number = 0.3, nIter: number = 3): number[] {
  const n = x.length;
  const k = Math.max(3, Math.floor(frac * n));
  const result: number[] = new Array(n);

  // Initialize with local linear weighted least squares
  let fitted = lowessFit(x, y, k);

  for (let iter = 0; iter < nIter; iter++) {
    // Compute residuals
    const residuals = y.map((v, i) => v - fitted[i]);

    // Median absolute deviation (MAD)
    const sortedResid = [...residuals].sort((a, b) => Math.abs(a) - Math.abs(b));
    const mad = sortedResid[Math.floor(n / 2)] ?? 1;

    // Bisquare weights
    const biweights = residuals.map(r => {
      const u = r / (6 * mad + 1e-10);
      if (Math.abs(u) >= 1) return 0;
      const w = 1 - u * u;
      return w * w;
    });

    // Re-fit with product of tricube and bisquare weights
    fitted = lowessFitWithWeights(x, y, k, biweights);
  }

  for (let i = 0; i < n; i++) result[i] = fitted[i];
  return result;
}
