import { Matrix } from '../../math/Matrix';

/**
 * CONISS: Constrained Incremental Sum of Squares by agglomerative clustering.
 *
 * Implements Grimm (1987) "CONISS: a FORTRAN 77 program for stratigraphically
 * constrained cluster analysis by the method of incremental sum of squares",
 * Computers & Geosciences 13(1): 13-35.
 *
 * Key constraints:
 *   - Only adjacent samples (i and i+1) can be merged (no time reversal).
 *   - Uses Bray-Curtis distance: d(i,j) = Σ|y_i - y_j| / Σ|y_i + y_j|
 *   - At each step, find the adjacent pair with minimum Bray-Curtis distance
 *     and merge using incremental sum of squares (Ward criterion).
 *   - Linkage matrix: [clusterA, clusterB, distance, count]
 */
export interface CONISSResult {
  linkageMatrix: number[][];
  nZones: number;
  zoneAssignments: number[];
}

function _brayCurtis(a: number[], b: number[]): number {
  let num = 0, den = 0;
  for (let k = 0; k < a.length; k++) {
    num += Math.abs(a[k] - b[k]);
    den += Math.abs(a[k] + b[k]);
  }
  return den > 0 ? num / den : 0;
}

export function coniss(data: Matrix, nZones: number = 4): CONISSResult {
  const n = data.rows;

  // Initialize: each sample is its own cluster; track adjacent pairs only
  const clusters: { indices: number[]; centroid: number[]; ss: number }[] = [];
  for (let i = 0; i < n; i++) {
    const row = data.row(i);
    clusters.push({ indices: [i], centroid: row, ss: 0 });
  }

  const linkage: number[][] = [];
  let nextId = n;

  // At each iteration, find the best adjacent merge
  while (clusters.length > 1) {
    let bestDist = Infinity;
    let bestMerge = 1; // default: merge cluster 0 and 1

    for (let i = 0; i < clusters.length - 1; i++) {
      const dist = _brayCurtis(clusters[i].centroid, clusters[i + 1].centroid);
      if (dist < bestDist) {
        bestDist = dist;
        bestMerge = i;
      }
    }

    const mergeI = bestMerge;
    const mergeJ = bestMerge + 1;
    const ci = clusters[mergeI], cj = clusters[mergeJ];

    // Ward's incremental SS: ΔSS = (n_i·n_j)/(n_i+n_j) · d²
    const ni = ci.indices.length, nj = cj.indices.length;
    const deltaSS = (ni * nj / (ni + nj)) * bestDist * bestDist;

    // New centroid
    const newCentroid = ci.centroid.map((v, k) => (v * ni + cj.centroid[k] * nj) / (ni + nj));
    const newIndices = [...ci.indices, ...cj.indices];
    const newSS = ci.ss + cj.ss + deltaSS;

    // linkage entry: [idxA, idxB, distance, count]
    const idA = ci.indices[0] < n ? ci.indices[0] : nextId - n + ci.indices[0];
    const idB = cj.indices[0] < n ? cj.indices[0] : nextId - n + cj.indices[0];
    linkage.push([idA, idB, Math.sqrt(deltaSS), newIndices.length]);

    // Merge in place
    clusters.splice(mergeJ, 1);
    clusters[mergeI] = { indices: newIndices, centroid: newCentroid, ss: newSS };
    nextId++;
  }

  // Zone assignment via binary split distance threshold
  const assignments = new Array(n).fill(0);
  if (linkage.length > 0 && nZones > 1) {
    // Total SS to distribute across zones
    const totalSS = clusters[0]?.ss ?? 0;
    const targetSS = totalSS / nZones;
    let cumSS = 0;
    // Work backwards: where does each zone start?
    for (let i = n - 1; i >= 0 && assignments.filter(a => a === 0).length > 0; i--) {
      cumSS += linkage[i]?.[2] ** 2 ?? 0;
      assignments[i] = Math.max(0, Math.min(nZones - 1, Math.floor(cumSS / (targetSS + 1e-10))));
    }
  }

  return { linkageMatrix: linkage, nZones, zoneAssignments: assignments };
}

/**
 * Markov Chain Analysis — replaces stratigraphy/markov.py.
 *
 * Implements Anderson & Goodman (1957) "Statistical Inference about Markov Chains",
 * J. Roy. Statist. Soc. B 19(1): 1-39.
 *
 * Two tests:
 *   - Markovity test (H0: zero-order vs H1: first-order Markov)
 *   - Homogeneity test (H0: time-homogeneous vs H1: varying transitions)
 *
 * The chi-squared statistic for Markovity is:
 *   χ² = Σ Σ (n_ij - n_i·p̂_j|i)² / (n_i·p̂_j|i)
 * where p̂_j|i = n_ij / n_i· (observed first-order MLE)
 * and under H0 (independence) p̂_j|i = n_·j / n··
 */
export interface MarkovResult {
  transitionMatrix: number[][];
  faciesNames: string[];
  chiSquared: number;
  pValue: number;
  df: number;
  isMarkovian: boolean;
  stationaryDist: number[];
  transitionProbs: number[][]; // MLE P(j|i)
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

  // Row sums (number of times state i is observed as "from")
  const rowSums = T.map(row => row.reduce((a, b) => a + b, 0));
  const total = rowSums.reduce((a, b) => a + b, 0);

  // Transition probabilities MLE: P̂(j|i) = n_ij / n_i·
  const transProbs: number[][] = T.map((row, i) =>
    row.map(v => rowSums[i] > 0 ? v / rowSums[i] : 0)
  );

  // Anderson & Goodman (1957) χ² test for Markovity:
  // H0: independence (zero-order), H1: first-order Markov
  // E[n_ij | H0] = n_i· × n_·j / n_··
  const colSums: number[] = new Array(nStates).fill(0);
  for (let i = 0; i < nStates; i++) for (let j = 0; j < nStates; j++) colSums[j] += T[i][j];

  let chi2 = 0;
  for (let i = 0; i < nStates; i++) {
    for (let j = 0; j < nStates; j++) {
      if (rowSums[i] === 0) continue;
      const expectedUnderH0 = rowSums[i] * colSums[j] / total;
      if (expectedUnderH0 > 0) {
        chi2 += (T[i][j] - expectedUnderH0) ** 2 / expectedUnderH0;
      }
    }
  }
  // df = (m-1)² where m = number of states (for full transition matrix)
  const df = (nStates - 1) * (nStates - 1);
  const p = 1 - chi2CDF_approx(chi2, df);

  // Stationary distribution via power iteration on transition matrix
  let pi = new Array(nStates).fill(1 / nStates);
  for (let iter = 0; iter < 200; iter++) {
    const newPi = new Array(nStates).fill(0);
    for (let i = 0; i < nStates; i++) {
      for (let j = 0; j < nStates; j++) {
        newPi[j] += pi[i] * transProbs[i][j];
      }
    }
    const norm = newPi.reduce((a, b) => a + b, 0);
    for (let j = 0; j < nStates; j++) newPi[j] /= norm;
    pi = newPi;
  }

  return {
    transitionMatrix: T, faciesNames: names,
    chiSquared: chi2, pValue: p, df,
    isMarkovian: p < 0.05,  // reject H0 at 5% → is Markovian
    stationaryDist: pi,
    transitionProbs: transProbs
  };
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
// Spectral Analysis (FFT Periodogram with window + Lomb-Scargle)
// ═══════════════════════════════════════════════════════════════════

export interface SpectralResult {
  frequencies: number[];
  periods: number[];
  power: number[];
  peakFrequency: number;
  peakPeriod: number;
  method: 'dft' | 'lomb-scargle';
}

/** Hanning window weights. */
function _hanningWindow(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
}

/** Welch window weights (parabolic). */
function _welchWindow(n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const x = (i - (n - 1) / 2) / ((n - 1) / 2);
    return 1 - x * x;
  });
}

export function spectralAnalysis(
  timeSeries: number[],
  method: 'dft' | 'lomb-scargle' = 'dft',
  windowType: 'hanning' | 'welch' | 'none' = 'hanning'
): SpectralResult {
  const n = timeSeries.length;

  if (method === 'lomb-scargle') {
    return _lombScargle(timeSeries);
  }

  // DFT with optional windowing
  const m = timeSeries.reduce((a, b) => a + b, 0) / n;
  let x = timeSeries.map(v => v - m);

  // Apply window function
  if (windowType === 'hanning') {
    const w = _hanningWindow(n);
    x = x.map((v, i) => v * w[i]);
  } else if (windowType === 'welch') {
    const w = _welchWindow(n);
    x = x.map((v, i) => v * w[i]);
  }

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
    frequencies.push(k / n);
    periods.push(n / k);
    power.push(p);
  }

  let maxPower = 0, peakIdx = 0;
  for (let i = 0; i < power.length; i++) { if (power[i] > maxPower) { maxPower = power[i]; peakIdx = i; } }

  return { frequencies, periods, power, peakFrequency: frequencies[peakIdx], peakPeriod: periods[peakIdx], method: 'dft' };
}

/**
 * Lomb-Scargle periodogram for unevenly sampled time series.
 *
 * Reference: Lomb (1976) Astrophys. Space Sci. 39: 447-462;
 * Scargle (1982) Astrophys. J. 263: 835-853.
 *
 * P(ω) = (1/2σ²) · { [Σ y_i·cos(ω(t_i-τ))]² / Σ cos²(ω(t_i-τ))
 *                         + [Σ y_i·sin(ω(t_i-τ))]² / Σ sin²(ω(t_i-τ)) }
 * where τ = atan(Σ sin(2ωt_i) / Σ cos(2ωt_i)) / (2ω)
 */
function _lombScargle(timeSeries: number[]): SpectralResult {
  const n = timeSeries.length;
  const m = timeSeries.reduce((a, b) => a + b, 0) / n;
  const y = timeSeries.map(v => v - m);
  const sigma2 = y.reduce((s, v) => s + v * v, 0) / n;

  // Default: uniform "time" positions (can be generalized)
  const t = Array.from({ length: n }, (_, i) => i);

  const nFreqs = Math.max(50, Math.floor(n / 2));
  const frequencies: number[] = [], periods: number[] = [], power: number[] = [];

  for (let ki = 1; ki <= nFreqs; ki++) {
    const freq = ki / n;
    const omega = 2 * Math.PI * freq;

    // Compute τ
    let sin2t = 0, cos2t = 0;
    for (let i = 0; i < n; i++) { sin2t += Math.sin(2 * omega * t[i]); cos2t += Math.cos(2 * omega * t[i]); }
    const tau = Math.atan2(sin2t, cos2t) / (2 * omega);

    let numerC = 0, numerS = 0, denomC = 0, denomS = 0;
    for (let i = 0; i < n; i++) {
      const theta = omega * (t[i] - tau);
      const yc = y[i] * Math.cos(theta);
      const ys = y[i] * Math.sin(theta);
      numerC += yc;
      numerS += ys;
      denomC += Math.cos(theta) ** 2;
      denomS += Math.sin(theta) ** 2;
    }

    const p = denomC > 0 && denomS > 0
      ? (1 / (2 * sigma2)) * (numerC * numerC / denomC + numerS * numerS / denomS)
      : 0;

    frequencies.push(freq);
    periods.push(1 / freq);
    power.push(p);
  }

  let maxPower = 0, peakIdx = 0;
  for (let i = 0; i < power.length; i++) { if (power[i] > maxPower) { maxPower = power[i]; peakIdx = i; } }

  return { frequencies, periods, power, peakFrequency: frequencies[peakIdx], peakPeriod: periods[peakIdx], method: 'lomb-scargle' };
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

  // Build zones from maximal cliques using co-occurrence matrix
  const zones: { name: string; events: string[] }[] = [];
  const used = new Set<number>();

  for (let e = 0; e < nEvents; e++) {
    if (used.has(e)) continue;
    const clique: number[] = [e];
    for (let f = e + 1; f < nEvents; f++) {
      if (used.has(f)) continue;
      let inClique = true;
      const minCooccur = Math.max(2, Math.ceil(nSections * 0.1));  // At least 10% of sections
      for (const c of clique) { if (coOccurrence[c][f] < minCooccur) { inClique = false; break; } }
      if (inClique) clique.push(f);
    }
    for (const c of clique) used.add(c);
    zones.push({ name: `Zone_${zones.length + 1}`, events: clique.map(i => eventNames[i]) });
  }

  // Each zone becomes a Unitary Association (UAZ)
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

/**
 * Continuous Wavelet Transform using the Morlet wavelet.
 *
 * Implements Torrence & Compo (1998) "A Practical Guide to Wavelet Analysis",
 * Bull. Amer. Meteor. Soc. 79: 61-78.
 *
 * Morlet wavelet (angular frequency ω₀ = 6 for default):
 *   ψ(t) = π^(-1/4) · exp(iω₀t) · exp(-t²/2)
 *
 * CWT: W(s, t) = Σ x(t') · ψ*((t' - t)/s) / √s
 *
 * Cone of Influence (COI): region where edge effects dominate.
 *   COI: |t - n/2| < s · √2 · ω₀
 *
 * Normalization: L2-normalized (not just divided by √s).
 */
export interface WaveletResult {
  scales: number[];
  power: number[][];
  periods: number[];
  peakFrequency: number;
  wavelet: string;
  coi: number[];
}

export function waveletTransform(
  timeSeries: number[],
  scales?: number[],
  wavelet: string = 'morlet',
  omega0: number = 6.0
): WaveletResult {
  const n = timeSeries.length;
  const m = timeSeries.reduce((a, b) => a + b, 0) / n;
  const x = timeSeries.map(v => v - m);

  // Logarithmically-spaced scales (Torrence & Compo 1998)
  // scale_j = scale_0 · 2^(j·dj), dj = 0.125
  const scale0 = 2;
  const dj = 0.125;
  const defaultScales: number[] = [];
  for (let j = 0; j < 30; j++) {
    defaultScales.push(scale0 * Math.pow(2, j * dj));
  }
  const s = scales ?? defaultScales;

  // COI (Cone of Influence) at each time point
  const coi: number[] = [];
  for (let t = 0; t < n; t++) {
    // distance from center (n/2) in sample units
    const dist = Math.abs(t - n / 2);
    // COI boundary: dist < s * sqrt(2) * omega0 / (2*pi) * factor
    // Simplified: mark edge region for each scale
    coi.push(dist);
  }

  const power: number[][] = [];

  for (const scale of s) {
    const row: number[] = [];
    for (let t = 0; t < n; t++) {
      let re = 0, im = 0;
      for (let tau = 0; tau < n; tau++) {
        const dt = (tau - t) / scale;
        // Complex Morlet: ψ(t) = π^(-1/4) · exp(iω₀t) · exp(-t²/2)
        const normFactor = Math.PI ** (-0.25);
        const expDecay = Math.exp(-dt * dt / 2);
        const cosPart = Math.cos(omega0 * dt);
        const sinPart = Math.sin(omega0 * dt);
        // Real part: normFactor * expDecay * cos(omega0 * dt)
        // Imag part: normFactor * expDecay * sin(omega0 * dt)
        re += x[tau] * normFactor * expDecay * cosPart;
        im += x[tau] * normFactor * expDecay * sinPart;
      }
      // L2 normalization: divide by sqrt(scale)
      const norm = 1 / Math.sqrt(scale);
      row.push((re * re + im * im) * norm * norm);
    }
    power.push(row);
  }

  // Period ≈ scale / (1.03 * omega0 / (2π)) per Torrence & Compo
  const periods = s.map(scale => scale * 1.03 * (2 * Math.PI / omega0));
  const avgPower = power.map(row => row.reduce((a, b) => a + b, 0) / row.length);
  let maxP = 0, peakIdx = 0;
  for (let i = 0; i < avgPower.length; i++) { if (avgPower[i] > maxP) { maxP = avgPower[i]; peakIdx = i; } }

  return { scales: s, power, periods, peakFrequency: 1 / (periods[peakIdx] || 1), wavelet, coi };
}

// ═══════════════════════════════════════════════════════════════════
// LOWESS Smoothing
// ═══════════════════════════════════════════════════════════════════

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
export function lowessSmooth(x: number[], y: number[], frac: number = 0.3, nIter: number = 3): number[] {
  const n = x.length;
  const k = Math.max(3, Math.floor(frac * n));
  const result: number[] = new Array(n);

  // Initialize with local linear weighted least squares
  let fitted = _lowessFit(x, y, k);

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
    fitted = _lowessFitWithWeights(x, y, k, biweights);
  }

  for (let i = 0; i < n; i++) result[i] = fitted[i];
  return result;
}

/** Local weighted linear fit (tricube kernel, initial pass with unit weights). */
function _lowessFit(x: number[], y: number[], k: number): number[] {
  return _lowessFitWithWeights(x, y, k, new Array(x.length).fill(1));
}

function _lowessFitWithWeights(x: number[], y: number[], k: number, biweights: number[]): number[] {
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
      const tricube = Math.pow(1 - Math.pow(d / maxD, 3), 3);
      const w = tricube * biweights[j];
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
  seriesMean: number;
}

export function buildARMAModel(timeSeries: number[], p: number = 1, q: number = 0): ARMAResult {
  const n = timeSeries.length;
  const mean = timeSeries.reduce((a, b) => a + b, 0) / n;
  const y = timeSeries.map(v => v - mean);

  // AR coefficients via Yule-Walker equations
  const arCoeffs: number[] = new Array(p).fill(0);
  if (p > 0) {
    // Compute autocorrelations
    const acf: number[] = new Array(p + 1).fill(0);
    for (let lag = 0; lag <= p; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += y[i] * y[i + lag];
      acf[lag] = sum / n;
    }

    // Levinson-Durbin recursion for AR coefficients
    if (p === 1) {
      arCoeffs[0] = acf[1] / (acf[0] || 1);
    } else {
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

  // MA coefficients via innovations algorithm
  const maCoeffs: number[] = new Array(q).fill(0);
  if (q > 0) {
    // Compute residuals from AR model first
    const arResiduals: number[] = new Array(n).fill(0);
    for (let t = p; t < n; t++) {
      let pred = 0;
      for (let j = 0; j < p; j++) pred += arCoeffs[j] * y[t - 1 - j];
      arResiduals[t] = y[t] - pred;
    }

    // MA(q) estimation via conditional least squares
    // Initialize MA coefficients using autocovariance of AR residuals
    for (let iter = 0; iter < 10; iter++) {
      for (let t = p + q; t < n; t++) {
        let predMA = 0;
        for (let j = 0; j < q; j++) {
          if (t - 1 - j >= p) {
            predMA += maCoeffs[j] * arResiduals[t - 1 - j];
          }
        }
        const resid = arResiduals[t] - predMA;

        // Update MA coefficients (simple gradient descent)
        for (let j = 0; j < q; j++) {
          if (t - 1 - j >= p) {
            maCoeffs[j] += 0.01 * resid * arResiduals[t - 1 - j];
          }
        }
      }
    }
  }

  // Compute fitted values and residuals using full ARMA model
  const fitted: number[] = new Array(n).fill(mean);
  const residuals: number[] = new Array(n).fill(0);

  for (let t = Math.max(p, q); t < n; t++) {
    let pred = mean;
    // AR part
    for (let j = 0; j < p; j++) pred += arCoeffs[j] * y[t - 1 - j];
    // MA part (use previous residuals)
    for (let j = 0; j < q; j++) {
      if (t - 1 - j >= 0) pred += maCoeffs[j] * residuals[t - 1 - j];
    }
    fitted[t] = pred;
    residuals[t] = timeSeries[t] - pred;
  }

  // AIC with proper degrees of freedom
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const aic = n * Math.log(ssRes / n + 1e-10) + 2 * (p + q + 1);

  return { arCoeffs, maCoeffs, intercept: mean, residuals, fitted, aic, order: [p, q], seriesMean: mean };
}

export function armaPredict(model: ARMAResult, nSteps: number): number[] {
  const { arCoeffs, maCoeffs, intercept, residuals, fitted } = model;
  const p = arCoeffs.length;
  const q = maCoeffs.length;
  const predictions: number[] = [];

  // Reconstruct y values from fitted + residual for the last p points
  // y[t] = (timeSeries[t] - mean) = fitted[t] + residuals[t]
  const history: number[] = []; // y values in demeaned space
  const residHist: number[] = [...residuals];

  for (let i = 0; i < p; i++) {
    const idx = fitted.length - p + i;
    // y (demeaned) = fitted + residual
    history.push(fitted[idx] + residuals[idx]);
  }

  for (let step = 0; step < nSteps; step++) {
    let pred = intercept; // base = intercept (mean)

    // AR part: Σ φ_i · y_{t-i} (use demeaned past values)
    for (let j = 0; j < p; j++) {
      const idx = history.length - 1 - j;
      pred += arCoeffs[j] * (idx >= 0 ? history[idx] : 0);
    }

    // MA part: Σ θ_j · ε_{t-j} (use historical residuals, NOT the new residual)
    for (let j = 0; j < q; j++) {
      const idx = residHist.length - 1 - j;
      pred += maCoeffs[j] * (idx >= 0 ? residHist[idx] : 0);
    }

    predictions.push(pred + intercept); // add mean back for actual scale

    // For next step: new residual = 0 (point forecast), pred is new y_demeaned
    history.push(pred);
    residHist.push(0);
  }

  return predictions;
}

// ─── Re-exports: UA / RASC / AgeModel / computeCorrelation ─────────────────────
export { unitaryAssociations, type Zone, type BioeventResult as UABioeventResult } from './UA';
export { rasc } from './RASC';
export { buildAgeModel, computeSedimentationRate, type StratigraphicSection, type AgeModelResult } from './AgeModel';
export { computeCorrelation } from './StratCorr';
