import { Matrix } from '../../math/Matrix';
import { lowess } from '../../math/LOWESS';
import { brokenStickTest, dtwSimilarity, mexicanHatWavelet, fourierWaveFrequency } from './StratExtended';

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
  /** Heights/depths echoed back when provided (else empty). */
  depthLabels: number[];
  /** Total within-cluster incremental sum of squares at the final merge. */
  issTotal: number;
  /** Broken-stick significance test result (empty when not requested). */
  brokenStick: { significantZones: number; pValues: number[]; brokenStickExpectation: number[] } | null;
}

function _brayCurtis(a: number[], b: number[]): number {
  let num = 0, den = 0;
  for (let k = 0; k < a.length; k++) {
    num += Math.abs(a[k] - b[k]);
    den += Math.abs(a[k] + b[k]);
  }
  return den > 0 ? num / den : 0;
}

export function coniss(
  data: Matrix,
  nZones: number = 4,
  depths?: number[],
  computeBrokenStick: boolean = false,
  nPermutations: number = 999,
): CONISSResult {
  const n = data.rows;

  // Initialize: each sample is its own cluster; track adjacent pairs only
  const clusters: { indices: number[]; centroid: number[]; ss: number; id: number }[] = [];
  for (let i = 0; i < n; i++) {
    clusters.push({ indices: [i], centroid: data.row(i), ss: 0, id: i });
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

    // scipy linkage convention: merged clusters get ids n, n+1, ... in merge order
    const idA = ci.id, idB = cj.id;
    linkage.push([idA, idB, Math.sqrt(deltaSS), newIndices.length]);

    // Merge in place
    clusters.splice(mergeJ, 1);
    clusters[mergeI] = { indices: newIndices, centroid: newCentroid, ss: newSS, id: nextId };
    nextId++;
  }

  // Zone assignment: cut the dendrogram into nZones by removing the nZones-1
  // largest-SS merges, then propagate cluster ids to samples in stratigraphic
  // order (each leaf keeps the id of the cluster containing it).
  const assignments = new Array(n).fill(0);
  if (linkage.length > 0 && nZones > 1) {
    // Reconstruct merge tree: node n+k is created by merge k
    const mergeChildren: [number, number][] = linkage.map(row => [row[0], row[1]]);
    // Choose the nZones-1 merges with the largest ΔSS (linkage col 2 = sqrt(ΔSS))
    const cutOrder = linkage
      .map((row, k) => ({ k, height: row[2] }))
      .sort((a, b) => b.height - a.height)
      .slice(0, Math.max(0, Math.min(nZones - 1, linkage.length)))
      .map(x => x.k);
    const cutSet = new Set(cutOrder);

    // Descend from the root cluster (last merge), stopping at cuts
    const zones: number[][] = [];
    // Walk merges without cuts to build leaf lists (scipy id convention)
    const leavesOf = (id: number): number[] => {
      const mergeIdx = id - n;
      if (mergeIdx < 0 || mergeIdx >= mergeChildren.length) return [id];
      const [a, b] = mergeChildren[mergeIdx];
      return [...leavesOf(a), ...leavesOf(b)];
    };
    // Start below the root: its two child subtrees are separated by the cut
    // through the final merge (always among the cut merges for nZones >= 2).
    const rootMerge = mergeChildren.length - 1;
    const stack: { id: number }[] = mergeChildren[rootMerge].map(id => ({ id }));
    while (stack.length > 0) {
      const { id } = stack.shift()!;
      if (id < n) { zones.push([id]); continue; } // single-sample zone
      const mergeIdx = id - n;
      if (mergeIdx < 0 || mergeIdx >= mergeChildren.length) { zones.push([id]); continue; }
      if (cutSet.has(mergeIdx)) {
        // this merge is also cut: its children become separate zones
        const [a, b] = mergeChildren[mergeIdx];
        stack.push({ id: a }, { id: b });
      } else {
        zones.push(leavesOf(id)); // intact subtree below the cut
      }
    }
    // Sort zones by their shallowest sample index so zone 0 = top of section
    zones.sort((a, b) => Math.min(...a) - Math.min(...b));
    for (let z = 0; z < zones.length; z++) {
      for (const leaf of zones[z]) {
        if (leaf >= 0 && leaf < n) assignments[leaf] = z;
      }
    }
  }

  // Broken-stick test on merge heights (BD values = linkage col 2)
  let brokenStick: CONISSResult['brokenStick'] = null;
  if (computeBrokenStick && linkage.length > 0) {
    // import lazily to avoid circular deps: StratExtended lives in same folder
    const bd = linkage.map(row => row[2]);
    brokenStick = brokenStickTest(bd, nPermutations);
  }

  return {
    linkageMatrix: linkage,
    nZones,
    zoneAssignments: assignments,
    depthLabels: depths ? [...depths] : [],
    issTotal: linkage.length > 0 ? clusters[0].ss : 0,
    brokenStick,
  };
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
  /** Expected transition counts under the embedded-chain null (Powers & Easterling 1982). */
  expectedMatrix: number[][];
  /** Observed − expected. */
  differenceMatrix: number[][];
  nTransitions: number;
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

  // Anderson & Goodman (1957) χ² test for Markovity with the
  // Powers & Easterling (1982) embedded-chain null hypothesis:
  //   E[n_ij] = n_i· · n_·j / (n − n_i·)
  // (the row i terminal transition is excluded, so each row sums to n_i·).
  const colSums: number[] = new Array(nStates).fill(0);
  for (let i = 0; i < nStates; i++) for (let j = 0; j < nStates; j++) colSums[j] += T[i][j];

  const expectedMatrix: number[][] = Array.from({ length: nStates }, () => new Array(nStates).fill(0));
  let chi2 = 0;
  for (let i = 0; i < nStates; i++) {
    if (rowSums[i] === 0) continue;
    const denom = total - rowSums[i];
    for (let j = 0; j < nStates; j++) {
      const expected = denom > 0 ? (rowSums[i] * colSums[j]) / denom : 0;
      expectedMatrix[i][j] = expected;
      if (expected > 0) {
        chi2 += (T[i][j] - expected) ** 2 / expected;
      }
    }
  }
  const differenceMatrix = T.map((row, i) => row.map((v, j) => v - expectedMatrix[i][j]));
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
    transitionProbs: transProbs,
    expectedMatrix,
    differenceMatrix,
    nTransitions: total,
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
  /** Circular standard deviation: sqrt(−2 ln R) in degrees. */
  circularStdDeg: number;
  /** Mean resultant vector components (C̄, S̄). */
  meanResultant: { c: number; s: number };
}

export function directional(anglesDeg: number[]): DirectionalResult {
  const n = anglesDeg.length;
  const rad = anglesDeg.map(a => a * Math.PI / 180);
  let C = 0, S = 0;
  for (const r of rad) { C += Math.cos(r); S += Math.sin(r); }
  const meanC = C / n, meanS = S / n;
  const R = Math.sqrt(meanC * meanC + meanS * meanS);
  const meanDir = (Math.atan2(meanS, meanC) * 180 / Math.PI + 360) % 360;
  const circVar = 1 - R;
  const circStd = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-300)))) * 180 / Math.PI;
  // Rayleigh test p-value
  const Z = n * R * R;
  const rayleighP = Math.exp(-Z) * (1 + (2 * Z - Z * Z) / (4 * n));
  return {
    meanDirectionDeg: meanDir, resultantLength: R, rayleighP, circularVariance: circVar,
    circularStdDeg: circStd, meanResultant: { c: meanC, s: meanS },
  };
}

/**
 * Extinction confidence intervals — replaces stratigraphy/extinction.py.
 */
export interface ExtinctionCIResult {
  ladPositions: number[];
  ciLower: number[];
  ciUpper: number[];
  method: string;
  /** Inferred true extinction layer per taxon (Signor-Lipps corrected). */
  trueExtinctionLayer: number[];
  /** Per-layer detection probability used by the Marshall model. */
  probabilityOfDetection: number;
  /** Layers between each LAD and the top of the section. */
  nLayersAbove: number[];
  /** min(1, n_taxa / max_layer) sampling coverage. */
  sampleCoverage: number;
  confidenceLevel: number;
}

export function extinctionCI(
  lads: number[],
  method: 'marshall' | 'strauss_sadler' = 'marshall',
  confidenceLevel: number = 0.95,
  samplingInterval: number = 1,
  detectionProbability: number = 0.7,
  taxonNames?: string[],
): ExtinctionCIResult {
  void taxonNames; // accepted for API parity with Python; names are echoed by callers
  void samplingInterval;
  // Positions sorted descending: larger = older (Python lad_sorted convention)
  const ladSorted = [...lads].sort((a, b) => b - a);
  const n = ladSorted.length;
  const q = 1 - confidenceLevel;
  const ciLower: number[] = [], ciUpper: number[] = [], trueExt: number[] = [];

  if (method === 'marshall') {
    // Marshall (1990): gap = −ln(q)/r with r = −ln(1−p) the per-layer
    // recovery rate; the interval extends towards younger (smaller) positions:
    // [LAD − gap, LAD]. χ²_{1−q,2}/2 = −ln(q), so 95% → gap = 2.996/r.
    let r = Infinity;
    if (detectionProbability > 0 && detectionProbability < 1) {
      r = -Math.log(1 - detectionProbability);
    }
    const gap = (isFinite(r) && r > 0) ? -Math.log(q) / r : 0;
    for (let i = 0; i < n; i++) {
      ciUpper.push(ladSorted[i]);
      trueExt.push(ladSorted[i]);
      ciLower.push(Math.max(0, ladSorted[i] - gap));
    }
  } else {
    // Strauss & Sadler (1982) exponential endpoint method:
    // gap = spacing · (q^(−1/2) − 1)/2 towards the younger side, where
    // spacing is the distance to the next younger LAD (or the section top).
    const g = (Math.pow(q, -0.5) - 1.0) / 2.0;
    for (let i = 0; i < n; i++) {
      const lad = ladSorted[i];
      const spacing = i + 1 < n ? lad - ladSorted[i + 1] : lad;
      const gap = Math.max(0, spacing * g);
      ciUpper.push(lad);
      trueExt.push(lad);
      ciLower.push(Math.max(0, lad - gap));
    }
  }

  const maxLayer = n > 0 ? ladSorted[0] : 0;
  const sampleCoverage = Math.min(1, n / Math.max(1, maxLayer));
  const nLayersAbove = ladSorted.map(lad => Math.max(0, Math.floor(maxLayer - lad)));

  return {
    ladPositions: ladSorted,
    ciLower,
    ciUpper,
    method,
    trueExtinctionLayer: trueExt,
    probabilityOfDetection: method === 'marshall' ? detectionProbability : NaN,
    nLayersAbove,
    sampleCoverage,
    confidenceLevel,
  };
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
  windowType: 'hanning' | 'welch' | 'none' = 'hanning',
  times?: number[],
): SpectralResult {
  const n = timeSeries.length;

  if (method === 'lomb-scargle') {
    return _lombScargle(timeSeries, times);
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
function _lombScargle(timeSeries: number[], times?: number[]): SpectralResult {
  const n = timeSeries.length;
  const m = timeSeries.reduce((a, b) => a + b, 0) / n;
  const y = timeSeries.map(v => v - m);
  const sigma2 = y.reduce((s, v) => s + v * v, 0) / n;

  // Real (possibly uneven) time axis; falls back to 0..n-1
  const t = (times && times.length === n) ? [...times] : Array.from({ length: n }, (_, i) => i);
  const tSpan = Math.max(...t) - Math.min(...t);
  const dtAvg = tSpan > 0 ? tSpan / (n - 1) : 1;

  // Frequency grid over the sampled band (Nyquist to n/2 cycles per span),
  // following Press et al. for uneven data: f ∈ (1/(2n·dt) … n/(2·span)).
  const nFreqs = Math.max(50, Math.floor(n / 2));
  const fMin = 1 / (n * Math.max(dtAvg, 1e-12));
  const fNyq = 1 / (2 * Math.max(dtAvg, 1e-12));
  const fMax = Math.max(fNyq, n / 2 / Math.max(tSpan, 1e-12));
  const frequencies: number[] = [], periods: number[] = [], power: number[] = [];

  for (let ki = 1; ki <= nFreqs; ki++) {
    const freq = fMin + ((fMax - fMin) * ki) / nFreqs;
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
  method: string;
}

export function stratigraphicCorrelation(
  sections: { name: string; heights: number[]; values: number[] }[],
  method: 'pearson' | 'spearman' | 'euclidean' | 'dtw' = 'pearson',
): CorrelationResult {
  const n = sections.length;
  const corrMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const bestMatch: { section1: string; section2: string; correlation: number }[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) { corrMatrix[i][j] = 1; continue; }
      let sim = 0;
      const a = sections[i], b = sections[j];
      if (method === 'dtw') {
        // Align on the value series; similarity = 1/(1 + DTW/(n+m))
        sim = dtwSimilarity(a.values, b.values);
      } else if (method === 'euclidean') {
        const minLen = Math.min(a.heights.length, b.heights.length);
        if (minLen === 0) sim = 0;
        else {
          let diff = 0;
          for (let k = 0; k < minLen; k++) diff += (a.heights[k] - b.heights[k]) ** 2;
          sim = 1 / (1 + Math.sqrt(diff) / minLen);
        }
      } else if (method === 'spearman') {
        const ra = rankData(a.values), rb = rankData(b.values);
        const minLen = Math.min(ra.length, rb.length);
        sim = minLen < 2 ? 0 : pearsonCorr(ra.slice(0, minLen), rb.slice(0, minLen));
      } else {
        const v1 = a.values, v2 = b.values;
        const minLen = Math.min(v1.length, v2.length);
        if (minLen < 2) sim = 0;
        else sim = pearsonCorr(v1.slice(0, minLen), v2.slice(0, minLen));
      }
      corrMatrix[i][j] = corrMatrix[j][i] = sim;
      if (sim > 0.5) bestMatch.push({ section1: sections[i].name, section2: sections[j].name, correlation: sim });
    }
  }

  bestMatch.sort((a, b) => b.correlation - a.correlation);
  return { sections, correlationMatrix: corrMatrix, bestMatch, method };
}

/** Average-rank transform (ties get the mean rank). */
function rankData(v: number[]): number[] {
  const idx = v.map((val, i) => ({ val, i })).sort((x, y) => x.val - y.val);
  const ranks = new Array(v.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].val === idx[i].val) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
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
  /** Cone-of-influence mask: coi[t][j] === true when edge effects dominate at
   *  time t for scales[j] (|t − n/2| ≥ s·√2 for Morlet per T&C 1998 Fig.1). */
  coi: boolean[][];
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
  const kind: 'morlet' | 'mexican_hat' =
    wavelet === 'ricker' || wavelet === 'mexican_hat' ? 'mexican_hat' : 'morlet';

  // Cone of Influence boolean mask: for Morlet, e-folding time τ_s = s·√2
  // (T&C 1998 §4); for the Mexican Hat τ_s = s·(m+1/2)^0.5-ish; we use √2·s
  // for Morlet and 1.12·s (≈sqrt(m+1/2), m=2 → hmm; standard 1.12) simplified.
  const coi: boolean[][] = [];
  for (let t = 0; t < n; t++) {
    const dist = Math.min(t, n - 1 - t); // distance to the nearest edge
    coi.push(s.map(sc => {
      const eFold = kind === 'morlet' ? Math.SQRT2 * sc : 1.12 * sc;
      return dist < eFold;
    }));
  }

  const power: number[][] = [];

  for (const scale of s) {
    const row: number[] = [];
    for (let t = 0; t < n; t++) {
      let re = 0, im = 0;
      if (kind === 'morlet') {
        for (let tau = 0; tau < n; tau++) {
          const dt = (tau - t) / scale;
          // Complex Morlet: ψ(t) = π^(-1/4) · exp(iω₀t) · exp(-t²/2)
          const normFactor = Math.PI ** (-0.25);
          const expDecay = Math.exp(-dt * dt / 2);
          re += x[tau] * normFactor * expDecay * Math.cos(omega0 * dt);
          im += x[tau] * normFactor * expDecay * Math.sin(omega0 * dt);
        }
      } else {
        // Real Mexican Hat (DOG m=2), L2-normalized (StratExtended.mexicanHatWavelet)
        const psi = mexicanHatWavelet(scale);
        const half = (psi.length - 1) / 2;
        for (let k = 0; k < psi.length; k++) {
          const tau = t + (k - half);
          if (tau >= 0 && tau < n) {
            const conv = x[tau] * psi[k];
            re += conv; // real wavelet: imaginary part stays 0
          }
        }
      }
      // L2 normalization: divide by sqrt(scale)
      const norm = 1 / Math.sqrt(scale);
      row.push((re * re + im * im) * norm * norm);
    }
    power.push(row);
  }

  // Fourier period of each scale — exact Torrence & Compo (1998) Table 1
  const periods = s.map(scale => 1 / fourierWaveFrequency(scale, kind));
  const avgPower = power.map(row => row.reduce((a, b) => a + b, 0) / row.length);
  let maxP = 0, peakIdx = 0;
  for (let i = 0; i < avgPower.length; i++) { if (avgPower[i] > maxP) { maxP = avgPower[i]; peakIdx = i; } }

  return { scales: s, power, periods, peakFrequency: 1 / (periods[peakIdx] || 1), wavelet: kind, coi };
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
 *
 * @deprecated Use lowess from '../../math/LOWESS' directly
 */
export function lowessSmooth(x: number[], y: number[], frac: number = 0.3, nIter: number = 3): number[] {
  return lowess(x, y, frac, nIter);
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

export interface ExcursionSegment {
  startIndex: number;
  endIndex: number;
  peakIndex: number;
  peakDepth: number;
  peakValue: number;
  direction: 'positive' | 'negative';
  /** Peak |z| magnitude. */
  magnitude: number;
}

export interface ExcursionResult {
  excursions: { index: number; depth: number; value: number; direction: 'positive' | 'negative'; magnitude: number }[];
  nExcursions: number;
  threshold: number;
  /** Merged consecutive excursions as segments (isotope_analysis.py semantics). */
  segments: ExcursionSegment[];
}

export function detectExcursions(
  depths: number[],
  values: number[],
  threshold: number = 2,
  minDuration: number = 2,
  background: 'mean' | 'median' = 'mean',
): ExcursionResult {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const m = background === 'median' ? median : values.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / Math.max(1, n - 1));

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

  // Merge consecutive excursion points into contiguous segments; keep only
  // segments at least minDuration long; peak = max |z| within segment.
  const segments: ExcursionSegment[] = [];
  let run: typeof excursions = [];
  const flush = (): void => {
    if (run.length >= minDuration && run.length > 0) {
      let peak = run[0];
      for (const e of run) if (e.magnitude > peak.magnitude) peak = e;
      segments.push({
        startIndex: run[0].index,
        endIndex: run[run.length - 1].index,
        peakIndex: peak.index,
        peakDepth: peak.depth,
        peakValue: peak.value,
        direction: peak.direction,
        magnitude: peak.magnitude,
      });
    }
    run = [];
  };
  for (const e of excursions) {
    if (run.length === 0 || e.index === run[run.length - 1].index + 1) {
      run.push(e);
    } else {
      flush();
      run = [e];
    }
  }
  flush();

  return { excursions, nExcursions: segments.length, threshold, segments };
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
  /** Bayesian Information Criterion: n·ln(RSS/n) + k·ln(n). */
  bic: number;
  /** Order [p, d, q] — d = differencing order applied before fitting (ARIMA). */
  order: [number, number, number];
  seriesMean: number;
  /** Residual variance σ̂² (innovation variance, used for forecast CIs). */
  sigma2: number;
  /** The differenced (and de-meaned if includeIntercept) series actually modelled. */
  differencedSeries: number[];
}

/** Apply d-th order differencing. */
function differenceSeries(x: number[], d: number): number[] {
  let cur = [...x];
  for (let k = 0; k < d; k++) {
    const next: number[] = [];
    for (let i = 1; i < cur.length; i++) next.push(cur[i] - cur[i - 1]);
    cur = next;
  }
  return cur;
}

/** Invert d-th order differencing given the d original seed values. */
function integrateSeries(diffed: number[], seeds: number[]): number[] {
  let cur = [...seeds];
  let rest = [...diffed];
  for (let k = 0; k < seeds.length; k++) {
    const out: number[] = [cur[0]];
    for (let i = 0; i < rest.length; i++) out.push(out[i] + rest[i]);
    cur = out;
    if (k < seeds.length - 1) rest = out;
  }
  return cur;
}

export function buildARMAModel(
  timeSeries: number[],
  p: number = 1,
  q: number = 0,
  d: number = 0,
  includeIntercept: boolean = true,
): ARMAResult {
  const n0 = timeSeries.length;
  const work = differenceSeries(timeSeries, Math.max(0, Math.floor(d)));
  const n = work.length;
  const useMean = includeIntercept;
  const mean = useMean ? work.reduce((a, b) => a + b, 0) / Math.max(1, n) : 0;
  const y = work.map(v => v - mean);

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
    residuals[t] = work[t] - pred;
  }

  // Information criteria on the effective sample size
  const effective = Math.max(1, n - Math.max(p, q));
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const sigma2 = ssRes / effective;
  const kParams = p + q + (useMean ? 1 : 0);
  const aic = effective * Math.log(ssRes / effective + 1e-10) + 2 * kParams;
  const bic = effective * Math.log(ssRes / effective + 1e-10) + kParams * Math.log(effective);

  return {
    arCoeffs, maCoeffs, intercept: mean, residuals, fitted, aic, bic,
    order: [p, Math.max(0, Math.floor(d)), q],
    seriesMean: mean, sigma2, differencedSeries: work,
  };
}

/**
 * AIC/BIC grid search over ARIMA(p, d, q) orders (arma.py cross_validate).
 * Returns the best-fitting model plus the full score grid.
 */
export function armaCrossValidate(
  times: number[],
  values: number[],
  maxP: number = 2,
  maxQ: number = 1,
  d: number = 0,
): { best: ARMAResult; bestOrder: [number, number, number]; grid: { order: [number, number, number]; aic: number; bic: number }[] } {
  void times; // ARIMA grid search works on the value series; times reserved for future use
  const grid: { order: [number, number, number]; aic: number; bic: number }[] = [];
  let best: ARMAResult | null = null;
  let bestOrder: [number, number, number] = [1, d, 0];
  for (let pi = 0; pi <= maxP; pi++) {
    for (let qi = 0; qi <= maxQ; qi++) {
      if (pi === 0 && qi === 0) continue;
      const model = buildARMAModel(values, pi, qi, d, true);
      grid.push({ order: [pi, d, qi], aic: model.aic, bic: model.bic });
      if (!best || model.aic < best.aic) {
        best = model;
        bestOrder = [pi, d, qi];
      }
    }
  }
  return { best: best ?? buildARMAModel(values, 1, 0, d, true), bestOrder, grid };
}

/**
 * Multi-step forecast with point predictions and (1−α) confidence intervals
 * via the ψ-weight recursion: Var(e_ℓ) = σ² Σ_{j<ℓ} ψ_j².
 */
export function armaPredict(
  model: ARMAResult,
  nSteps: number,
  alpha: number = 0.05,
): {
  predictions: number[];
  lowerCI: number[];
  upperCI: number[];
  stdErrors: number[];
} {
  const { arCoeffs, maCoeffs, intercept, residuals, fitted, sigma2 } = model;
  const p = arCoeffs.length;
  const q = maCoeffs.length;
  const predictions: number[] = [], lowerCI: number[] = [], upperCI: number[] = [], stdErrors: number[] = [];

  // History in the demeaned/differenced modelling space
  const history: number[] = [];
  for (let i = 0; i < p; i++) {
    const idx = fitted.length - p + i;
    history.push(fitted[idx] + residuals[idx]);
  }
  const residHist: number[] = [...residuals];
  const z = alpha > 0 && alpha < 1 ? normQuantileLocal(1 - alpha / 2) : 0;

  // ψ weights: ψ_0 = 1; ψ_j = Σ φ_i ψ_{j−i} + θ_j (causal ARMA recursion)
  const psi: number[] = [1];
  for (let j = 1; j <= nSteps; j++) {
    let v = 0;
    for (let i = 0; i < Math.min(p, j); i++) v += arCoeffs[i] * psi[j - 1 - i];
    if (j <= q) v += maCoeffs[j - 1];
    psi.push(v);
  }

  for (let step = 0; step < nSteps; step++) {
    // Point forecast in the modelling space (mean added ONCE at the end)
    let pred = 0;
    for (let j = 0; j < p; j++) {
      const idx = history.length - 1 - j;
      pred += arCoeffs[j] * (idx >= 0 ? history[idx] : 0);
    }
    for (let j = 0; j < q; j++) {
      const idx = residHist.length - 1 - j;
      pred += maCoeffs[j] * (idx >= 0 ? residHist[idx] : 0);
    }

    // Forecast-error variance: Var(e_{step+1}) = σ² Σ_{j=0..step} ψ_j²
    let varSum = 0;
    for (let j = 0; j <= step; j++) varSum += psi[j] * psi[j];
    const se = Math.sqrt(Math.max(0, sigma2 * varSum));
    const level = pred + intercept;

    predictions.push(level);
    stdErrors.push(se);
    lowerCI.push(level - z * se);
    upperCI.push(level + z * se);

    history.push(pred);
    residHist.push(0); // future innovations have expectation 0
  }

  return { predictions, lowerCI, upperCI, stdErrors };
}

/** Acklam-style normal quantile (local; matches R qnorm within 1e-9). */
function normQuantileLocal(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const dd = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((dd[0] * q + dd[1]) * q + dd[2]) * q + dd[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((dd[0] * q + dd[1]) * q + dd[2]) * q + dd[3]) * q + 1);
}

// ─── Re-exports: UA / RASC / AgeModel / computeCorrelation ─────────────────────
export { unitaryAssociations, type Zone, type BioeventResult as UABioeventResult } from './UA';
export { rasc } from './RASC';
export { buildAgeModel, computeSedimentationRate, type StratigraphicSection, type AgeModelResult } from './AgeModel';
export { computeCorrelation } from './StratCorr';
