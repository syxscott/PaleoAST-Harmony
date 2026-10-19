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
 * Median of a numeric array.
 *
 * For an even number of values the two central order statistics are
 * averaged — the same convention as numpy's `np.median`, and therefore as
 * the reference implementation this module cites (Cleveland 1979 /
 * statsmodels). Taking only the upper central value shifts every
 * even-sized result.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  if (n !== y.length) {
    throw new Error(`lowess: x and y must have the same length (got ${x.length} and ${y.length})`);
  }
  if (n < 3) {
    // A local linear fit needs at least 3 points. With fewer, the
    // k-nearest-neighbour search runs past the end of the sorted distance
    // list and the call used to die with
    // "TypeError: Cannot read properties of undefined (reading 'd')" —
    // a message that says nothing about the actual cause.
    throw new Error(`lowess: needs at least 3 points to fit a local line, got ${n}`);
  }
  // k = number of neighbours per local fit: at least 3, and never more than
  // the sample size (a larger k indexes past the end of the distance list).
  const k = Math.min(n, Math.max(3, Math.floor(frac * n)));
  const result: number[] = new Array(n);

  // Initialize with local linear weighted least squares
  let fitted = lowessFit(x, y, k);

  for (let iter = 0; iter < nIter; iter++) {
    // Compute residuals
    const residuals = y.map((v, i) => v - fitted[i]);

    // Median absolute deviation of the residuals.
    //
    // ------------------------------------------------------------------
    // Which MAD?  Do NOT "fix" this to median(|r − median(r)|).
    //
    // The relative MAD (Hampel's estimator) was once assumed to be what
    // Cleveland (1979) and statsmodels use.  It is not.  statsmodels
    // 0.14.6, `statsmodels/nonparametric/_smoothers_lowess.pyx`:
    //
    //     cdef np.ndarray calculate_residual_weights(y, y_fit):
    //         for j in range(n):
    //             std_resid_data[j] = fabs(y[j] - y_fit[j])   # |r|
    //         median = <double>np.median(std_resid)          # median(|r|)
    //         scale = 6.0 * median
    //
    // i.e. the median of the *absolute* residuals — the convention this
    // module already used.  The real defect was the *median* itself:
    // `sortedResid[Math.floor(n / 2)]` takes only the upper central order
    // statistic, while numpy's `np.median` (and therefore statsmodels)
    // averages the two central order statistics of an even-sized sample.
    // That shifts the MAD, hence the 6*MAD bisquare cut-off, and moves the
    // smoothed curve away from the reference implementation on every
    // even-sized sample.
    //
    // Measured on a 30-point series with a +30 outlier: the curve was off
    // by up to 0.0028 against statsmodels; with the true median the two
    // agree to 2e-12.  Switching to the relative MAD instead would have
    // *increased* the deviation to 0.18.
    // ------------------------------------------------------------------
    const mad = median(residuals.map(r => Math.abs(r)));

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
