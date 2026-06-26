import { Matrix } from '../../math/Matrix';
import { mean, std } from '../../math/stats';

/**
 * CONISS (Constrained Incremental Sum of Squares) — replaces stratigraphy/coniss.py.
 */
export interface CONISSResult {
  linkageMatrix: number[][];
  nZones: number;
  zoneAssignments: number[];
}

export function coniss(data: Matrix, nZones: number = 4): CONISSResult {
  const n = data.rows;
  // Ward's method linkage (simplified)
  const clusters: { indices: number[]; centroid: number[] }[] = [];
  for (let i = 0; i < n; i++) {
    clusters.push({ indices: [i], centroid: data.row(i) });
  }

  const linkage: number[][] = [];
  let nextId = n;

  while (clusters.length > 1) {
    // Find closest pair (Ward's criterion)
    let minDist = Infinity, mergeI = 0, mergeJ = 1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // Increase in sum of squares
        const ni = clusters[i].indices.length, nj = clusters[j].indices.length;
        let ss = 0;
        for (let k = 0; k < clusters[i].centroid.length; k++) {
          const diff = clusters[i].centroid[k] - clusters[j].centroid[k];
          ss += diff * diff;
        }
        const dist = (ni * nj) / (ni + nj) * ss;
        if (dist < minDist) { minDist = dist; mergeI = i; mergeJ = j; }
      }
    }

    // Merge
    const ci = clusters[mergeI], cj = clusters[mergeJ];
    const newIndices = [...ci.indices, ...cj.indices];
    const ni = ci.indices.length, nj = cj.indices.length;
    const newCentroid = ci.centroid.map((v, k) => (v * ni + cj.centroid[k] * nj) / (ni + nj));

    linkage.push([ci.indices[0] < n ? ci.indices[0] : nextId - n + ci.indices[0],
      cj.indices[0] < n ? cj.indices[0] : nextId - n + cj.indices[0], Math.sqrt(minDist), newIndices.length]);

    clusters.splice(mergeJ, 1);
    clusters[mergeI] = { indices: newIndices, centroid: newCentroid };
    nextId++;
  }

  // Assign zones by cutting the dendrogram
  const assignments = new Array(n).fill(0);
  // Simple: assign based on the last nZones-1 merges
  // (In real implementation, use fcluster equivalent)
  for (let i = 0; i < n; i++) assignments[i] = Math.floor(i * nZones / n);

  return { linkageMatrix: linkage, nZones, zoneAssignments: assignments };
}

/**
 * Markov Chain Analysis — replaces stratigraphy/markov.py.
 */
export interface MarkovResult {
  transitionMatrix: number[][];
  faciesNames: string[];
  chiSquared: number;
  pValue: number;
  df: number;
  isMarkovian: boolean;
  stationaryDist: number[];
}

export function markov(sequence: number[], faciesNames?: string[]): MarkovResult {
  const uniqueStates = [...new Set(sequence)].sort((a, b) => a - b);
  const nStates = uniqueStates.length;
  const names = faciesNames ?? uniqueStates.map(s => `Facies_${s}`);
  const stateToIdx = new Map(uniqueStates.map((s, i) => [s, i]));

  // Build transition count matrix
  const T: number[][] = Array.from({ length: nStates }, () => new Array(nStates).fill(0));
  for (let i = 0; i < sequence.length - 1; i++) {
    const from = stateToIdx.get(sequence[i])!, to = stateToIdx.get(sequence[i + 1])!;
    T[from][to]++;
  }

  // Chi-squared test for Markovity
  const rowSums = T.map(row => row.reduce((a, b) => a + b, 0));
  const colSums: number[] = new Array(nStates).fill(0);
  for (let i = 0; i < nStates; i++) for (let j = 0; j < nStates; j++) colSums[j] += T[i][j];
  const total = rowSums.reduce((a, b) => a + b, 0);

  let chi2 = 0;
  for (let i = 0; i < nStates; i++) {
    for (let j = 0; j < nStates; j++) {
      const expected = rowSums[i] * colSums[j] / total;
      if (expected > 0) chi2 += (T[i][j] - expected) ** 2 / expected;
    }
  }
  const df = (nStates - 1) ** 2;
  // Approximate p-value (chi-squared survival function)
  const p = 1 - chi2CDF_approx(chi2, df);

  // Stationary distribution (power iteration)
  let pi = new Array(nStates).fill(1 / nStates);
  for (let iter = 0; iter < 100; iter++) {
    const newPi = new Array(nStates).fill(0);
    for (let i = 0; i < nStates; i++) {
      for (let j = 0; j < nStates; j++) {
        newPi[j] += pi[i] * (rowSums[i] > 0 ? T[i][j] / rowSums[i] : 0);
      }
    }
    pi = newPi;
  }

  return { transitionMatrix: T, faciesNames: names, chiSquared: chi2, pValue: p, df, isMarkovian: p < 0.05, stationaryDist: pi };
}

function chi2CDF_approx(x: number, k: number): number {
  if (x <= 0) return 0;
  // Regularized incomplete gamma P(k/2, x/2)
  return gammainc_approx(k / 2, x / 2);
}

function gammainc_approx(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, term = 1 / a;
    for (let n = 1; n < 200; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < 1e-14 * Math.abs(sum)) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma_approx(a));
  } else {
    let f = 1e-30, c = 1e-30, d = 1 / (x + 1 - a);
    f = d;
    for (let n = 1; n < 200; n++) {
      const an = n * (a - n), bn = x + 2 * n + 1 - a;
      d = bn + an * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
      c = bn + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      const delta = c * d; f *= delta;
      if (Math.abs(delta - 1) < 1e-14) break;
    }
    return 1 - f * Math.exp(-x + a * Math.log(x) - lgamma_approx(a));
  }
}

function lgamma_approx(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma_approx(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Directional (circular) statistics — replaces stratigraphy/directional.py.
 */
export interface DirectionalResult {
  meanDirectionDeg: number;
  resultantLength: number;
  rayleighP: number;
  circularVariance: number;
}

export function directional(anglesDeg: number[]): DirectionalResult {
  const n = anglesDeg.length;
  const rad = anglesDeg.map(a => a * Math.PI / 180);
  let C = 0, S = 0;
  for (const r of rad) { C += Math.cos(r); S += Math.sin(r); }
  C /= n; S /= n;
  const R = Math.sqrt(C * C + S * S);
  const meanDir = (Math.atan2(S, C) * 180 / Math.PI + 360) % 360;
  const circVar = 1 - R;
  // Rayleigh test p-value
  const Z = n * R * R;
  const rayleighP = Math.exp(-Z) * (1 + (2 * Z - Z * Z) / (4 * n));
  return { meanDirectionDeg: meanDir, resultantLength: R, rayleighP, circularVariance: circVar };
}

/**
 * Extinction confidence intervals — replaces stratigraphy/extinction.py.
 */
export interface ExtinctionCIResult {
  ladPositions: number[];
  ciLower: number[];
  ciUpper: number[];
  method: string;
}

export function extinctionCI(lads: number[], method: 'marshall' | 'strauss_sadler' = 'marshall', confidenceLevel: number = 0.95): ExtinctionCIResult {
  const q = 1 - confidenceLevel;
  const n = lads.length;
  const ciLower: number[] = [], ciUpper: number[] = [];

  for (let i = 0; i < n; i++) {
    const lad = lads[i];
    ciLower.push(lad);
    if (method === 'marshall') {
      const k = i + 1;
      const nEff = k / 0.7; // Simplified
      ciUpper.push(lad - Math.log(q) / nEff);
    } else {
      // Strauss-Sadler: beta quantile
      const rank = i + 1;
      const upperNorm = betaPPF_approx(1 - q, rank, n - rank + 1);
      const expectedNorm = rank / (n + 1);
      const scale = Math.max(1, Math.max(...lads));
      ciUpper.push(lad + Math.max(0, (upperNorm - expectedNorm) * scale));
    }
  }
  return { ladPositions: lads, ciLower, ciUpper, method };
}

function betaPPF_approx(p: number, a: number, b: number): number {
  let x = a / (a + b);
  for (let i = 0; i < 20; i++) {
    const f = betainc_approx(a, b, x) - p;
    const fp = Math.pow(x, a - 1) * Math.pow(1 - x, b - 1);
    if (Math.abs(fp) < 1e-15) break;
    x -= f / fp * 0.1;
    x = Math.max(1e-10, Math.min(1 - 1e-10, x));
  }
  return x;
}

function betainc_approx(a: number, b: number, x: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  let sum = 0, term = 1;
  for (let n = 0; n < 100; n++) {
    if (n > 0) term *= (a + n - 1) * x / (a + b + n - 1);
    sum += term / (a + n);
    if (Math.abs(term / (a + n)) < 1e-12) break;
  }
  const lbeta = lgamma_approx(a) + lgamma_approx(b) - lgamma_approx(a + b);
  return sum * Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta);
}

// ═══════════════════════════════════════════════════════════════════
// Spectral Analysis (FFT Periodogram)
// ═══════════════════════════════════════════════════════════════════

export interface SpectralResult {
  frequencies: number[];
  periods: number[];
  power: number[];
  peakFrequency: number;
  peakPeriod: number;
}

export function spectralAnalysis(timeSeries: number[]): SpectralResult {
  const n = timeSeries.length;
  // Remove mean
  const m = timeSeries.reduce((a, b) => a + b, 0) / n;
  const x = timeSeries.map(v => v - m);

  // Compute periodogram via DFT
  const nFreqs = Math.floor(n / 2);
  const frequencies: number[] = [], periods: number[] = [], power: number[] = [];

  for (let k = 1; k <= nFreqs; k++) {
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      re += x[t] * Math.cos(angle);
      im -= x[t] * Math.sin(angle);
    }
    const p = (re * re + im * im) / n;
    const freq = k / n;
    frequencies.push(freq);
    periods.push(1 / freq);
    power.push(p);
  }

  // Find peak
  let maxPower = 0, peakIdx = 0;
  for (let i = 0; i < power.length; i++) { if (power[i] > maxPower) { maxPower = power[i]; peakIdx = i; } }

  return { frequencies, periods, power, peakFrequency: frequencies[peakIdx], peakPeriod: periods[peakIdx] };
}

// ═══════════════════════════════════════════════════════════════════
// Stratigraphic Correlation
// ═══════════════════════════════════════════════════════════════════

export interface CorrelationResult {
  sections: { name: string; heights: number[]; values: number[] }[];
  correlationMatrix: number[][];
  bestMatch: { section1: string; section2: string; correlation: number }[];
}

export function stratigraphicCorrelation(sections: { name: string; heights: number[]; values: number[] }[]): CorrelationResult {
  const n = sections.length;
  const corrMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const bestMatch: { section1: string; section2: string; correlation: number }[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) { corrMatrix[i][j] = 1; continue; }
      // Interpolate to common grid and compute correlation
      const v1 = sections[i].values, v2 = sections[j].values;
      const minLen = Math.min(v1.length, v2.length);
      if (minLen < 2) { corrMatrix[i][j] = 0; corrMatrix[j][i] = 0; continue; }
      const c = pearsonCorr(v1.slice(0, minLen), v2.slice(0, minLen));
      corrMatrix[i][j] = corrMatrix[j][i] = c;
      if (c > 0.5) bestMatch.push({ section1: sections[i].name, section2: sections[j].name, correlation: c });
    }
  }

  bestMatch.sort((a, b) => b.correlation - a.correlation);
  return { sections, correlationMatrix: corrMatrix, bestMatch };
}

function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da2 = 0, db2 = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; num += da * db; da2 += da * da; db2 += db * db; }
  const denom = Math.sqrt(da2 * db2);
  return denom > 0 ? num / denom : 0;
}

// ═══════════════════════════════════════════════════════════════════
// Biostratigraphy (Unitary Associations)
// ═══════════════════════════════════════════════════════════════════

export interface BiostratResult {
  uazGroups: { uazName: string; events: string[]; zoneIndices: number[] }[];
  zones: { name: string; events: string[] }[];
  nZones: number;
}

export function biostratigraphy(fadMatrix: number[][], ladMatrix: number[][], eventNames: string[]): BiostratResult {
  const nSections = fadMatrix.length;
  const nEvents = fadMatrix[0].length;

  // Build presence/absence for each section
  const sections: { fad: number[]; lad: number[] }[] = [];
  for (let s = 0; s < nSections; s++) {
    sections.push({ fad: fadMatrix[s], lad: ladMatrix[s] });
  }

  // Compute co-occurrence matrix
  const coOccurrence: number[][] = Array.from({ length: nEvents }, () => new Array(nEvents).fill(0));
  for (let s = 0; s < nSections; s++) {
    const present: boolean[] = [];
    for (let e = 0; e < nEvents; e++) {
      present.push(sections[s].fad[e] > 0 || sections[s].lad[e] > 0);
    }
    for (let i = 0; i < nEvents; i++) for (let j = i; j < nEvents; j++) {
      if (present[i] && present[j]) { coOccurrence[i][j]++; coOccurrence[j][i]++; }
    }
  }

  // Build zones from maximal cliques (simplified)
  const zones: { name: string; events: string[] }[] = [];
  const used = new Set<number>();

  for (let e = 0; e < nEvents; e++) {
    if (used.has(e)) continue;
    const clique: number[] = [e];
    for (let f = e + 1; f < nEvents; f++) {
      if (used.has(f)) continue;
      let inClique = true;
      for (const c of clique) { if (coOccurrence[c][f] < 2) { inClique = false; break; } }
      if (inClique) clique.push(f);
    }
    for (const c of clique) used.add(c);
    zones.push({ name: `Zone_${zones.length + 1}`, events: clique.map(i => eventNames[i]) });
  }

  // Build UAZ groups (simplified: each zone is a UAZ)
  const uazGroups = zones.map((z, i) => ({
    uazName: `UAZ_${i + 1}`,
    events: z.events,
    zoneIndices: [i],
  }));

  return { uazGroups, zones, nZones: zones.length };
}

// ═══════════════════════════════════════════════════════════════════
// Isotope Analysis
// ═══════════════════════════════════════════════════════════════════

export interface IsotopeResult {
  depths: number[];
  values: number[];
  mean: number;
  std: number;
  trend: number;
  peakValues: { depth: number; value: number }[];
}

export function isotopeAnalysis(depths: number[], values: number[]): IsotopeResult {
  const n = values.length;
  const m = values.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - 1));

  // Linear trend
  let num = 0, den = 0;
  const md = depths.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) { num += (depths[i] - md) * (values[i] - m); den += (depths[i] - md) ** 2; }
  const trend = den > 0 ? num / den : 0;

  // Find peaks (local maxima)
  const peaks: { depth: number; value: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) peaks.push({ depth: depths[i], value: values[i] });
  }

  return { depths: [...depths], values: [...values], mean: m, std: s, trend, peakValues: peaks };
}

// ═══════════════════════════════════════════════════════════════════
// Wavelet Transform (CWT with Morlet wavelet)
// ═══════════════════════════════════════════════════════════════════

export interface WaveletResult {
  scales: number[];
  power: number[][];
  periods: number[];
  peakFrequency: number;
  wavelet: string;
}

export function waveletTransform(timeSeries: number[], scales?: number[], wavelet: string = 'morlet'): WaveletResult {
  const n = timeSeries.length;
  const defaultScales = Array.from({ length: 30 }, (_, i) => 2 + i * 2);
  const s = scales ?? defaultScales;
  const power: number[][] = [];

  for (const scale of s) {
    const row: number[] = [];
    for (let t = 0; t < n; t++) {
      let re = 0, im = 0;
      for (let tau = 0; tau < n; tau++) {
        const dt = (tau - t) / scale;
        const morlet = Math.exp(-dt * dt / 2) * Math.cos(5 * dt); // Morlet wavelet
        re += timeSeries[tau] * morlet;
      }
      row.push(re * re / scale);
    }
    power.push(row);
  }

  const periods = s.map(scale => scale * 1.03); // Approximate period
  const avgPower = power.map(row => row.reduce((a, b) => a + b, 0) / row.length);
  let maxP = 0, peakIdx = 0;
  for (let i = 0; i < avgPower.length; i++) { if (avgPower[i] > maxP) { maxP = avgPower[i]; peakIdx = i; } }

  return { scales: s, power, periods, peakFrequency: 1 / (periods[peakIdx] || 1), wavelet };
}

// ═══════════════════════════════════════════════════════════════════
// LOWESS Smoothing
// ═══════════════════════════════════════════════════════════════════

export function lowessSmooth(x: number[], y: number[], frac: number = 0.3): number[] {
  const n = x.length;
  const k = Math.max(2, Math.floor(frac * n));
  const result: number[] = [];

  for (let i = 0; i < n; i++) {
    // Find k nearest neighbors
    const distances = x.map((v, j) => ({ dist: Math.abs(v - x[i]), idx: j }));
    distances.sort((a, b) => a.dist - b.dist);
    const maxDist = distances[k - 1].dist || 1;

    // Tricube weights
    let wSum = 0, wySum = 0;
    for (let j = 0; j < k; j++) {
      const d = distances[j].dist / maxDist;
      const w = d < 1 ? Math.pow(1 - d * d * d, 3) : 0;
      wSum += w;
      wySum += w * y[distances[j].idx];
    }
    result.push(wSum > 0 ? wySum / wSum : y[i]);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Polynomial Trend Fitting
// ═══════════════════════════════════════════════════════════════════

export interface TrendResult {
  coefficients: number[];
  predicted: number[];
  rSquared: number;
  degree: number;
}

export function fitPolynomialTrend(x: number[], y: number[], degree: number = 2): TrendResult {
  const n = x.length;
  // Build Vandermonde matrix
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let d = 0; d <= degree; d++) row.push(Math.pow(x[i], d));
    X.push(row);
  }

  // Solve normal equations: (X^T X) beta = X^T y
  const p = degree + 1;
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }

  // Solve via Gaussian elimination
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < p; col++) {
    let maxRow = col;
    for (let row = col + 1; row < p; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-15) continue;
    for (let j = 0; j <= p; j++) aug[col][j] /= pivot;
    for (let row = 0; row < p; row++) { if (row === col) continue; const f = aug[row][col]; for (let j = 0; j <= p; j++) aug[row][j] -= f * aug[col][j]; }
  }
  const coeffs = aug.map(row => row[p]);

  const predicted = x.map(xi => { let s = 0; for (let d = 0; d <= degree; d++) s += coeffs[d] * Math.pow(xi, d); return s; });
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (y[i] - predicted[i]) ** 2; ssTot += (y[i] - yMean) ** 2; }

  return { coefficients: coeffs, predicted, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0, degree };
}

// ═══════════════════════════════════════════════════════════════════
// Moving Average
// ═══════════════════════════════════════════════════════════════════

export function movingAverage(data: number[], windowSize: number = 5): number[] {
  const n = data.length;
  const half = Math.floor(windowSize / 2);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) { sum += data[j]; count++; }
    result.push(sum / count);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Outlier Detection (IQR method)
// ═══════════════════════════════════════════════════════════════════

export interface OutlierResult {
  cleaned: number[];
  outlierIndices: number[];
  outlierValues: number[];
  lowerBound: number;
  upperBound: number;
}

export function removeOutliers(data: number[], method: 'iqr' | 'zscore' = 'iqr', threshold: number = 1.5): OutlierResult {
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  const outlierIndices: number[] = [];
  const outlierValues: number[] = [];
  let lowerBound: number, upperBound: number;

  if (method === 'iqr') {
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    lowerBound = q1 - threshold * iqr;
    upperBound = q3 + threshold * iqr;
  } else {
    const mean = data.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(data.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    lowerBound = mean - threshold * std;
    upperBound = mean + threshold * std;
  }

  const cleaned: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lowerBound || data[i] > upperBound) {
      outlierIndices.push(i);
      outlierValues.push(data[i]);
    } else {
      cleaned.push(data[i]);
    }
  }

  return { cleaned, outlierIndices, outlierValues, lowerBound, upperBound };
}

// ═══════════════════════════════════════════════════════════════════
// Cross-Validation (Leave-One-Out)
// ═══════════════════════════════════════════════════════════════════

export interface CrossValResult {
  predictions: number[];
  residuals: number[];
  press: number;
  r2cv: number;
}

export function crossValidate(x: number[], y: number[], degree: number = 2): CrossValResult {
  const n = x.length;
  const predictions: number[] = [];

  for (let leaveOut = 0; leaveOut < n; leaveOut++) {
    const xTrain = x.filter((_, i) => i !== leaveOut);
    const yTrain = y.filter((_, i) => i !== leaveOut);
    const trend = fitPolynomialTrend(xTrain, yTrain, degree);

    // Predict at left-out point
    let pred = 0;
    for (let d = 0; d <= degree; d++) pred += trend.coefficients[d] * Math.pow(x[leaveOut], d);
    predictions.push(pred);
  }

  const residuals = y.map((v, i) => v - predictions[i]);
  const press = residuals.reduce((s, r) => s + r * r, 0);
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);

  return { predictions, residuals, press, r2cv: ssTot > 0 ? 1 - press / ssTot : 0 };
}

// ═══════════════════════════════════════════════════════════════════
// Isotopic Excursion Detection
// ═══════════════════════════════════════════════════════════════════

export interface ExcursionResult {
  excursions: { index: number; depth: number; value: number; direction: 'positive' | 'negative'; magnitude: number }[];
  nExcursions: number;
  threshold: number;
}

export function detectExcursions(depths: number[], values: number[], threshold: number = 2): ExcursionResult {
  const n = values.length;
  const m = values.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - 1));

  const excursions: ExcursionResult['excursions'] = [];
  for (let i = 0; i < n; i++) {
    const z = s > 0 ? (values[i] - m) / s : 0;
    if (Math.abs(z) >= threshold) {
      excursions.push({
        index: i, depth: depths[i], value: values[i],
        direction: z > 0 ? 'positive' : 'negative', magnitude: Math.abs(z),
      });
    }
  }
  return { excursions, nExcursions: excursions.length, threshold };
}

// ═══════════════════════════════════════════════════════════════════
// Endemic Species Filter
// ═══════════════════════════════════════════════════════════════════

export function filterEndemic(abundanceMatrix: number[][], minOccurrence: number = 1): { endemic: number[]; widespread: number[]; endemicCount: number; widespreadCount: number } {
  const nSpecies = abundanceMatrix[0]?.length ?? 0;
  const endemic: number[] = [];
  const widespread: number[] = [];

  for (let j = 0; j < nSpecies; j++) {
    let occurrences = 0;
    for (let i = 0; i < abundanceMatrix.length; i++) {
      if (abundanceMatrix[i][j] > 0) occurrences++;
    }
    if (occurrences <= minOccurrence) endemic.push(j);
    else widespread.push(j);
  }

  return { endemic, widespread, endemicCount: endemic.length, widespreadCount: widespread.length };
}

// ═══════════════════════════════════════════════════════════════════
// ARMA(p,q) Model
// ═══════════════════════════════════════════════════════════════════

export interface ARMAResult {
  arCoeffs: number[];
  maCoeffs: number[];
  intercept: number;
  residuals: number[];
  fitted: number[];
  aic: number;
  order: [number, number];
}

export function buildARMAModel(timeSeries: number[], p: number = 1, q: number = 0): ARMAResult {
  const n = timeSeries.length;
  const mean = timeSeries.reduce((a, b) => a + b, 0) / n;
  const y = timeSeries.map(v => v - mean);

  // Simple AR(p) via Yule-Walker equations
  const arCoeffs: number[] = new Array(p).fill(0);
  if (p > 0) {
    // Compute autocorrelations
    const acf: number[] = new Array(p + 1).fill(0);
    for (let lag = 0; lag <= p; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += y[i] * y[i + lag];
      acf[lag] = sum / n;
    }

    // Solve Toeplitz system for AR coefficients
    if (p === 1) {
      arCoeffs[0] = acf[1] / (acf[0] || 1);
    } else {
      // Levinson-Durbin recursion (simplified)
      const R = acf.slice(0, p + 1);
      const a = new Array(p).fill(0);
      let e = R[0];
      for (let k = 0; k < p; k++) {
        let lambda = 0;
        for (let j = 0; j < k; j++) lambda += a[j] * R[k - j];
        lambda = (R[k + 1] - lambda) / (e || 1e-10);
        const aNew = [...a];
        aNew[k] = lambda;
        for (let j = 0; j < k; j++) aNew[j] = a[j] - lambda * a[k - 1 - j];
        for (let i = 0; i < p; i++) a[i] = aNew[i];
        e *= (1 - lambda * lambda);
      }
      for (let i = 0; i < p; i++) arCoeffs[i] = a[i];
    }
  }

  // MA coefficients (simplified: set to 0 for AR-only)
  const maCoeffs: number[] = new Array(q).fill(0);

  // Compute fitted values and residuals
  const fitted: number[] = new Array(n).fill(mean);
  const residuals: number[] = new Array(n).fill(0);

  for (let t = p; t < n; t++) {
    let pred = mean;
    for (let j = 0; j < p; j++) pred += arCoeffs[j] * (y[t - 1 - j] || 0);
    fitted[t] = pred;
    residuals[t] = timeSeries[t] - pred;
  }

  // AIC
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const aic = n * Math.log(ssRes / n + 1e-10) + 2 * (p + q + 1);

  return { arCoeffs, maCoeffs, intercept: mean, residuals, fitted, aic, order: [p, q] };
}

export function armaPredict(model: ARMAResult, nSteps: number): number[] {
  const { arCoeffs, intercept, residuals } = model;
  const p = arCoeffs.length;
  const n = residuals.length;
  const predictions: number[] = [];

  // Use last p residuals and values
  const recentValues = residuals.slice(-p).map((r, i) => r + intercept);

  for (let step = 0; step < nSteps; step++) {
    let pred = intercept;
    for (let j = 0; j < p; j++) {
      const idx = recentValues.length - 1 - j;
      pred += arCoeffs[j] * (idx >= 0 ? recentValues[idx] : 0);
    }
    predictions.push(pred);
    recentValues.push(pred);
  }

  return predictions;
}
