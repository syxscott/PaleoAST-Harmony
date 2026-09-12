/**
 * Extended stratigraphy functions — ported from Python stratigraphy/*.py
 * functions missing from the base port:
 *   - broken_stick_test        (coniss.py, Bennett 1996 / Grimm 1987)
 *   - pyper_peterman_correction(correlation.py, Pyper & Peterman 1998)
 *   - PCHIP monotone interpolation (correlation.py AgeModelAnalyzer, Fritsch-Carlson)
 *   - paleotemperature formulas  (isotope_analysis.py: Erez & Luz 1983,
 *       Bemis et al. 1998, Kim & O'Neil 1997)
 *   - block_bootstrap_ci       (isotope_analysis.py, Politis & Romano 1994;
 *       optimal block size after Politis & White 2004)
 *   - bin_for_rose             (directional.py)
 *   - _detect_cyclic_contradictions (biostratigraphy.py, Guex 1991 framework)
 *   - find_significant_peaks   (spectral_analysis.py)
 *   - Mexican Hat (DOG m=2) wavelet + Fourier frequencies
 *     (Torrence & Compo 1998, Table 1)
 *   - DTW stratigraphic similarity (correlation.py _dtw_correlation)
 */
import { seed, rand, randint } from '../../math/random';
import { qt, pt } from '../../math/stats';

// ─── Broken-stick model (Bennett 1996 / Grimm 1987 / MacArthur 1957) ────────

export interface BrokenStickResult {
  significantZones: number;
  pValues: number[];
  brokenStickExpectation: number[];
}

/**
 * Broken-stick significance test for CONISS zone selection.
 *
 * E[k] = (1/n) * Σ_{i=k..n} (1/i) is the expected size of the k-th largest
 * segment of a unit stick broken at n-1 random points. Observed BD values
 * (sorted descending, normalised to sum 1) are compared one-to-one with the
 * expectation. p-values come from Monte-Carlo simulation of random breakages
 * (Dirichlet(1,...,1)); the number of significant zones is the contiguous
 * prefix where observed > expectation (Bennett 1996).
 */
export function brokenStickTest(bdValues: number[], nPermutations: number = 999): BrokenStickResult {
  const n = bdValues.length;
  if (n === 0) return { significantZones: 0, pValues: [], brokenStickExpectation: [] };

  // Expected broken-stick shares: E[k] = (1/n) Σ_{i=k..n} 1/i
  const suffix: number[] = new Array(n);
  let acc = 0;
  for (let i = n; i >= 1; i--) {
    acc += 1 / i;
    suffix[i - 1] = acc; // suffix[k-1] = Σ_{i=k..n} 1/i
  }
  const expectation = suffix.map(s => s / n);

  const sortedBd = [...bdValues].sort((a, b) => b - a);
  const totalBd = bdValues.reduce((a, b) => a + b, 0);
  if (totalBd <= 0) {
    return { significantZones: 0, pValues: new Array(n).fill(1), brokenStickExpectation: expectation };
  }
  const normalized = sortedBd.map(v => v / totalBd);

  // Monte-Carlo p-values: p_k = P(random k-th largest >= observed k-th) (add-one)
  const nPerm = Math.max(Math.floor(nPermutations), 99);
  const exceed = new Array(n).fill(0);
  seed(42);
  const gammaRand = (): number => {
    // Marsaglia-Tsang gamma(1) = exponential; Dirichlet(1,...,1) via normalised exp
    let u = 0;
    while (u <= 1e-300) u = rand();
    return -Math.log(u);
  };
  for (let p = 0; p < nPerm; p++) {
    const draws: number[] = [];
    for (let k = 0; k < n; k++) draws.push(gammaRand());
    draws.sort((a, b) => b - a);
    const total = draws.reduce((a, b) => a + b, 0);
    for (let k = 0; k < n; k++) {
      if (total > 0 && draws[k] / total >= normalized[k]) exceed[k]++;
    }
  }
  const pValues = exceed.map(c => (c + 1) / (nPerm + 1));

  // Significant zones = contiguous prefix where observed > expectation
  let significant = 0;
  for (let k = 0; k < n; k++) {
    if (normalized[k] > expectation[k] && pValues[k] < 0.05) significant++;
    else break;
  }
  return { significantZones: significant, pValues, brokenStickExpectation: expectation };
}

// ─── Pyper & Peterman (1998) effective-dof correlation ──────────────────────

export interface PyperPetermanResult {
  r: number;
  pCorrected: number;
  nEffective: number;
  nOriginal: number;
}

function acfAt(arr: number[], lag: number): number {
  if (lag === 0) return 1;
  const nLag = arr.length - lag;
  if (nLag <= 0) return 0;
  let num = 0, den = 0;
  for (let i = 0; i < arr.length; i++) den += arr[i] * arr[i];
  if (den === 0) return 0;
  for (let i = 0; i < nLag; i++) num += arr[i] * arr[i + lag];
  return num / den;
}

/**
 * Pearson correlation test corrected for time autocorrelation via the
 * effective sample size of Pyper & Peterman (1998), Can. J. Fish. Aquat. Sci.
 * n_eff = n (1 - Σ ρx(k)ρy(k)) / (1 + Σ ρx(k)ρy(k)).
 */
export function pyperPetermanCorrection(x: number[], y: number[], maxLag?: number): PyperPetermanResult {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (isFinite(x[i]) && isFinite(y[i])) { xs.push(x[i]); ys.push(y[i]); }
  }
  const n = xs.length;
  if (n < 4) return { r: NaN, pCorrected: NaN, nEffective: n, nOriginal: n };

  const m = Math.min(maxLag ?? Math.floor(n / 2), n - 1);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const xc = xs.map(v => v - mx);
  const yc = ys.map(v => v - my);

  let sumRhoProduct = 0;
  for (let k = 1; k <= m; k++) {
    sumRhoProduct += acfAt(xc, k) * acfAt(yc, k);
  }

  let nEff: number;
  if (1 + sumRhoProduct <= 0) nEff = 2;
  else nEff = Math.max(2, Math.min(n * (1 - sumRhoProduct) / (1 + sumRhoProduct), n));
  const nEffInt = Math.round(nEff);

  // Pearson r
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += xc[i] * yc[i]; sxx += xc[i] * xc[i]; syy += yc[i] * yc[i]; }
  const r = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;

  const df = Math.max(1, nEffInt - 2);
  let pCorrected: number;
  if (Math.abs(r) >= 1) pCorrected = 0;
  else {
    const tStat = r * Math.sqrt(df / (1 - r * r));
    pCorrected = 2 * (1 - pt(Math.abs(tStat), df));
  }
  return { r, pCorrected, nEffective: nEffInt, nOriginal: n };
}

// ─── PCHIP monotone cubic interpolation (Fritsch & Carlson 1980) ────────────

/**
 * Evaluate the PCHIP shape-preserving cubic Hermite interpolant at xq.
 * Slopes follow Fritsch-Carlson: secants filtered to guarantee monotonicity
 * (Python uses scipy PchipInterpolator — age-depth models must not oscillate).
 */
export function pchipSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  if (n < 2) return [0];
  const h: number[] = [], delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  const d: number[] = new Array(n);
  d[0] = delta[0];
  d[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      d[i] = 0;
    } else {
      // Harmonic mean of the two secant slopes (weighted by intervals)
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  return d;
}

export function pchipInterpolate(xs: number[], ys: number[], xq: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (n === 1) return ys[0];
  if (xq <= xs[0] || n === 2) {
    // linear extrapolation on the end segments
    const i = xq <= xs[0] ? 0 : 0;
    const d = pchipSlopes(xs, ys);
    const h = xs[1] - xs[0];
    const t = (xq - xs[i]) / h;
    const h00 = (1 + 2 * t) * (1 - t) * (1 - t), h10 = t * (1 - t) * (1 - t);
    const h01 = t * t * (3 - 2 * t), h11 = t * t * (t - 1);
    return h00 * ys[i] + h10 * h * d[i] + h01 * ys[i + 1] + h11 * h * d[i + 1];
  }
  if (xq >= xs[n - 1]) {
    const d = pchipSlopes(xs, ys);
    const i = n - 2;
    const h = xs[i + 1] - xs[i];
    const t = (xq - xs[i]) / h;
    const h00 = (1 + 2 * t) * (1 - t) * (1 - t), h10 = t * (1 - t) * (1 - t);
    const h01 = t * t * (3 - 2 * t), h11 = t * t * (t - 1);
    return h00 * ys[i] + h10 * h * d[i] + h01 * ys[i + 1] + h11 * h * d[i + 1];
  }
  // locate bracketing interval
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= xq) lo = mid; else hi = mid;
  }
  const d = pchipSlopes(xs, ys);
  const h = xs[lo + 1] - xs[lo];
  const t = (xq - xs[lo]) / h;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return h00 * ys[lo] + h10 * h * d[lo] + h01 * ys[lo + 1] + h11 * h * d[lo + 1];
}

// ─── Paleotemperature equations (isotope_analysis.py) ───────────────────────

/** Erez & Luz (1983): T = 17.0 − 4.52·(δc − δw) + 0.03·(δc − δw)². */
export function computePaleotemperatureErezLuz(delta18OSw: number, delta18Oc: number): number {
  const diff = delta18Oc - delta18OSw;
  return 17.0 - 4.52 * diff + 0.03 * diff * diff;
}

/** Bemis et al. (1998): T = 16.998 − 4.52·(δc − δw), genus-specific δw correction. */
export function computePaleotemperatureBemis(delta18Oc: number, genus: string = 'generic'): number {
  const corrections: Record<string, number> = {
    'G. ruber': 0.27,       // shallow mixed layer
    'G. sacculifer': 0.22,  // sub-surface
    'generic': 0.0,
  };
  const delta18OSw = corrections[genus] ?? corrections['generic'];
  return 16.998 - 4.52 * (delta18Oc - delta18OSw);
}

/**
 * Kim & O'Neil (1997): 1000 ln α = 18.03·(10³/T) − 32.42.
 * δc is converted from VPDB to VSMOW first (δc_VSMOW = 1.03091·δc_VPDB + 30.91) —
 * skipping this yields nonsensical ~300 °C results (scale-mixing defect).
 */
export function computePaleotemperatureKimONeil(delta18OSw: number, delta18Oc: number): number {
  const delta18OcVsmow = 1.03091 * delta18Oc + 30.91;
  const alpha = (1 + delta18OcVsmow / 1000) / (1 + delta18OSw / 1000);
  const lnAlpha = Math.log(alpha);
  const tKelvin = 18030.0 / (1000.0 * lnAlpha + 32.42);
  return tKelvin - 273.15;
}

// ─── Block bootstrap (Politis & Romano 1994; Politis & White 2004) ──────────

/** ACF-based automatic block size selection (simplified Politis-White 2004). */
export function optimalBlockSize(data: number[]): number {
  const n = data.length;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const centered = data.map(v => v - mean);
  const varSum = centered.reduce((a, v) => a + v * v, 0);
  const maxLag = Math.min(Math.floor(n / 2), Math.floor(Math.sqrt(n)) + 1);
  if (varSum === 0) return Math.max(1, Math.floor(n / 10));

  const threshold = 1.96 / Math.sqrt(n);
  let m = 1;
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += centered[i] * centered[i + lag];
    const rho = s / varSum;
    if (Math.abs(rho) < threshold) break;
    m = lag;
  }
  let b = Math.max(1, Math.min(m, Math.floor(Math.sqrt(n))));
  b = Math.max(b, Math.floor(Math.cbrt(n)));
  return b;
}

/**
 * Circular block bootstrap confidence interval for an arbitrary statistic.
 * Resamples overlapping blocks and concatenates to length n, then takes
 * percentile CIs at level `alpha`.
 */
export function blockBootstrapCI(
  data: number[],
  statisticFn: (sample: number[]) => number,
  blockSize?: number,
  nBootstrap: number = 1000,
  alpha: number = 0.05,
  rngSeed: number = 42,
): { ciLower: number; ciUpper: number } {
  const xs = data.filter(v => isFinite(v));
  const n = xs.length;
  if (n < 4) return { ciLower: NaN, ciUpper: NaN };

  let b = blockSize ?? optimalBlockSize(xs);
  b = Math.max(1, Math.min(b, Math.floor(n / 2)));

  seed(rngSeed);
  const stats: number[] = [];
  for (let i = 0; i < nBootstrap; i++) {
    const resampled: number[] = [];
    while (resampled.length < n) {
      const start = randint(0, n - b);
      for (let k = 0; k < b && resampled.length < n; k++) resampled.push(xs[start + k]);
    }
    stats.push(statisticFn(resampled));
  }
  stats.sort((a, b2) => a - b2);
  const qLow = alpha / 2, qHigh = 1 - alpha / 2;
  const idx = (q: number): number => Math.max(0, Math.min(nBootstrap - 1, Math.floor(q * nBootstrap)));
  return { ciLower: stats[idx(qLow)], ciUpper: stats[idx(qHigh)] };
}

// ─── Rose diagram binning (directional.py) ──────────────────────────────────

/** Bin angles into a rose diagram. Returns (bin centers deg, counts). */
export function binForRose(anglesDeg: number[], nBins: number = 12): { binCenters: number[]; counts: number[] } {
  const edges: number[] = [];
  for (let i = 0; i <= nBins; i++) edges.push((360 / nBins) * i);
  const counts = new Array(nBins).fill(0);
  for (const a of anglesDeg) {
    const norm = ((a % 360) + 360) % 360;
    let bin = Math.floor(norm / (360 / nBins));
    if (bin >= nBins) bin = nBins - 1;
    counts[bin]++;
  }
  const centers = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2);
  return { binCenters: centers, counts };
}

// ─── UA cyclic contradiction detection (biostratigraphy.py / Guex 1991) ─────

export interface CyclicContradiction {
  eventA: string;
  eventB: string;
  nSectionsABeforeB: number;
  nSectionsBBeforeA: number;
  sectionsABeforeB: number[];
  sectionsBBeforeA: number[];
}

/**
 * Detect FAD ordering contradictions between event pairs across sections:
 * event i's FAD older than j's in one section but younger in another is a
 * logical inversion of the assumed order.
 */
export function detectCyclicContradictions(
  fad: number[][],
  eventNames: string[],
): CyclicContradiction[] {
  const nSections = fad.length;
  if (nSections === 0) return [];
  const nEvents = fad[0].length;
  if (nEvents < 2) return [];

  const contradictions: CyclicContradiction[] = [];
  for (let i = 0; i < nEvents; i++) {
    for (let j = i + 1; j < nEvents; j++) {
      const sectI: number[] = [], sectJ: number[] = [];
      for (let s = 0; s < nSections; s++) {
        const fi = fad[s]?.[i], fj = fad[s]?.[j];
        if (fi === undefined || fj === undefined) continue;
        if (!isFinite(fi) || !isFinite(fj)) continue;
        if (fi < fj) sectI.push(s);
        else if (fj < fi) sectJ.push(s);
      }
      if (sectI.length > 0 && sectJ.length > 0) {
        contradictions.push({
          eventA: eventNames[i] ?? `Event_${i + 1}`,
          eventB: eventNames[j] ?? `Event_${j + 1}`,
          nSectionsABeforeB: sectI.length,
          nSectionsBBeforeA: sectJ.length,
          sectionsABeforeB: sectI,
          sectionsBBeforeA: sectJ,
        });
      }
    }
  }
  return contradictions;
}

// ─── Spectral peak detection (spectral_analysis.py) ─────────────────────────

export interface SpectralPeak {
  frequency: number;
  period: number;
  power: number;
  relativePower: number;
}

/** Find significant peaks in a periodogram (local maxima above threshold × max power). */
export function findSignificantPeaks(
  frequencies: number[],
  periods: number[],
  power: number[],
  threshold: number = 0.5,
): SpectralPeak[] {
  const n = power.length;
  if (n === 0) return [];
  const maxPower = Math.max(...power);
  if (maxPower <= 0) return [];
  const thresholdValue = threshold * maxPower;

  const peaks: SpectralPeak[] = [];
  let inPeak = false, peakStart = 0;
  for (let i = 0; i < n; i++) {
    if (power[i] > thresholdValue && !inPeak) {
      inPeak = true;
      peakStart = i;
    } else if (power[i] <= thresholdValue && inPeak) {
      inPeak = false;
      let localMax = peakStart;
      for (let k = peakStart; k < i; k++) if (power[k] > power[localMax]) localMax = k;
      peaks.push({
        frequency: frequencies[localMax],
        period: periods[localMax],
        power: power[localMax],
        relativePower: power[localMax] / maxPower,
      });
    }
  }
  if (inPeak) {
    // peak running to the end of the array
    let localMax = peakStart;
    for (let k = peakStart; k < n; k++) if (power[k] > power[localMax]) localMax = k;
    peaks.push({
      frequency: frequencies[localMax],
      period: periods[localMax],
      power: power[localMax],
      relativePower: power[localMax] / maxPower,
    });
  }
  return peaks;
}

// ─── Wavelets: Mexican Hat (DOG m=2) + Fourier frequencies (T&C 1998) ───────

/**
 * Dilated, L2-normalized Mexican Hat (DOG m=2) wavelet:
 * ψ_s(t) = (1 − η²) e^{−η²/2}, η = t/s. (Ricker wavelet is the same function.)
 */
export function mexicanHatWavelet(scale: number): number[] {
  const s = scale;
  let length = Math.max(Math.ceil(10.0 * s) | 1, 7);
  if (length % 2 === 0) length += 1;
  const half = (length - 1) / 2;
  const w: number[] = [];
  let energy = 0;
  for (let i = 0; i < length; i++) {
    const eta = (i - half) / s;
    const v = (1 - eta * eta) * Math.exp(-0.5 * eta * eta);
    w.push(v);
    energy += v * v;
  }
  const norm = Math.sqrt(energy);
  return norm > 0 ? w.map(v => v / norm) : w;
}

/**
 * Fourier frequency (cycles per sample) of a unit-dilation wavelet at the
 * given scale, following Torrence & Compo (1998), Table 1:
 *   Morlet (ω0=6):  λ = 4πs/(ω0+sqrt(2+ω0²)) → f ≈ 0.968/s
 *   Mexican Hat:    λ = 2πs/sqrt(m+1/2)       → f ≈ 0.252/s
 */
export function fourierWaveFrequency(scale: number, wavelet: 'morlet' | 'mexican_hat'): number {
  if (wavelet === 'morlet') {
    const w0 = 6.0;
    const lambdaPerS = 4.0 * Math.PI / (w0 + Math.sqrt(2.0 + w0 * w0));
    return 1.0 / (lambdaPerS * scale);
  }
  const lambdaPerS = 2.0 * Math.PI / Math.sqrt(2.5);
  return 1.0 / (lambdaPerS * scale);
}

// ─── DTW stratigraphic similarity (correlation.py _dtw_correlation) ─────────

/**
 * Dynamic-time-warping similarity between two height series:
 * similarity = 1 / (1 + DTW/(n+m)). Used by stratigraphicCorrelation('dtw').
 */
export function dtwSimilarity(hA: number[], hB: number[]): number {
  const n = hA.length, m = hB.length;
  if (n + m === 0) return 1.0;
  const dtw: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(hA[i - 1] - hB[j - 1]);
      dtw[i][j] = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
    }
  }
  return 1 / (1 + dtw[n][m] / (n + m));
}
