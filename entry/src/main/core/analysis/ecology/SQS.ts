/**
 * Shareholder Quorum Subsampling (SQS) — replaces ecology/sqs.py.
 *
 * SQS is a fossil-sampling standardisation method that draws a random "股份"
 * (share = 1/N per individual) from each sampling event until a quorum threshold
 * q is reached, then compares the expected species count to a theoretical
 * coverage-based estimate.
 *
 * Algorithm (Alroy 2010 "The shifting balance of diversity"):
 * 1. For each occurrence list (sampling event), compute the share per individual:
 *      share_i = 1 / N_i   (N_i = total specimens at event i)
 * 2. Pool all shares and randomly draw without replacement until the cumulative
 *      fraction reaches the quorum q.
 * 3. Count how many species are represented in the drawn share — this is the
 *      expected species richness at that quorum level.
 * 4. Repeat over many iterations to get a mean expected species count at each
 *      quorum level.
 *
 * The resulting SQS curve plots quorum level vs expected species and is used
 * to compare diversity trajectories across sampled sections with different
 * sampling intensities.
 *
 * References:
 * - Alroy, J. (2010). "The shifting balance of diversity among marine taxa
 *   through the Paleozoic." Science 329: 1152-1155.  doi:10.1126/science.1189912
 * - Alroy, J. (2010). "Geographical, environmental and intrinsic biotic
 *   controls on Phanerozoic marine diversification." Palaeontology 53(6): 1211-1235.
 *   [SQS method details]
 * - Foote, M. et al. (2015). "Rise and fall of species' occupancy in the
 *   Phanerozoic." J. Biogeography 42: 1575-1584.  [SQS applications]
 * - Alroy's original SQS R code: https://www.macroevolution.net/software
 */
import { Matrix } from '../../math/Matrix';
import { seed, rand } from '../../math/random';

/**
 * Options for SQS computation.
 */
export interface SQSOptions {
  /** Random seed for reproducibility. */
  seed?: number;
  /** Sampling method: 'random' (default Alroy) or 'rarefaction' (standard Hurlbert rarefaction). */
  method?: 'random' | 'rarefaction';
}

export interface SQSResult {
  /** Quorum levels evaluated. */
  quorumLevels: number[];
  /** Mean expected species count at each quorum level. */
  expectedSpecies: number[];
  /** Observed (raw) species count per sampling event. */
  observedSpecies: number[];
  /** Number of sampling events. */
  nEvents: number;
  /** Total individuals across all events. */
  totalIndividuals: number;
  /** Method used ('alroy_sqs' or 'rarefaction'). */
  method: string;
}

function toArray(v: number[] | Matrix): number[] {
  return Array.isArray(v) ? v : v.toArray();
}

/**
 * Compute the SQS species accumulation curve.
 *
 * @param occurrences   N × S matrix where N[i][j] = count of species j at event i.
 * @param quorumRange  Range of quorum levels to evaluate (default [0.3, 0.95]).
 * @param nPoints      Number of quorum levels to evaluate (default 20).
 * @param options      Optional seed and method ('random' or 'rarefaction').
 * @returns SQS curve data (quorum levels vs expected and observed species).
 */
export function sqs(
  occurrences: Matrix | number[][],
  quorumRange: [number, number] = [0.3, 0.95],
  nPoints: number = 20,
  options: SQSOptions = {},
): SQSResult {
  const rngSeed = options.seed ?? 42;
  const method = options.method ?? 'random';
  seed(rngSeed);

  // ── Convert to 2D array if needed ─────────────────────────────────────────
  let occ2d: number[][];
  if (occurrences instanceof Matrix) {
    const n = occurrences.rows, p = occurrences.cols;
    occ2d = Array.from({ length: n }, (_, i) => {
      const row = occurrences.row(i);
      return Array.isArray(row) ? row : (row as unknown as number[]).slice();
    });
  } else {
    occ2d = occurrences;
  }

  const nEvents = occ2d.length;
  const nSpecies = occ2d[0]?.length ?? 0;
  if (nEvents === 0 || nSpecies === 0) {
    return {
      quorumLevels: [], expectedSpecies: [], observedSpecies: [],
      nEvents: 0, totalIndividuals: 0, method: method === 'random' ? 'alroy_sqs' : 'rarefaction',
    };
  }

  // ── Pre-compute per-event totals and shares ────────────────────────────────
  const eventTotals: number[] = occ2d.map(row => row.reduce((a, b) => a + b, 0));
  const totalIndividuals = eventTotals.reduce((a, b) => a + b, 0);
  const observedSpecies: number[] = occ2d.map(row => row.filter(v => v > 0).length);

  // ── Build quorum levels ───────────────────────────────────────────────────
  const [qMin, qMax] = quorumRange;
  const quorumLevels: number[] = [];
  for (let i = 0; i < nPoints; i++) {
    quorumLevels.push(qMin + (qMax - qMin) * i / (nPoints - 1));
  }

  // ── Compute expected species at each quorum level ─────────────────────────
  const nIter = 50; // iterations per quorum (Alroy 2010 uses ≥50)
  const expectedSpecies: number[] = [];

  for (const q of quorumLevels) {
    let totalExpected = 0;

    for (let iter = 0; iter < nIter; iter++) {
      totalExpected += _sqsSingleIteration(occ2d, eventTotals, q, method);
    }

    expectedSpecies.push(totalExpected / nIter);
  }

  return {
    quorumLevels,
    expectedSpecies,
    observedSpecies,
    nEvents,
    totalIndividuals,
    method: method === 'random' ? 'alroy_sqs' : 'rarefaction',
  };
}

/**
 * Single SQS iteration: draw shares until quorum is reached and count species.
 *
 * Alroy (2010) original algorithm:
 *   1. Build a master list of shares: each individual in event i contributes
 *      (species_name, 1/N_i) to the list.
 *   2. Shuffle the master list.
 *   3. Draw shares sequentially, accumulating the quorum fraction.
 *   4. When quorum is reached, count unique species in the drawn shares.
 *
 * This is O(N_total) per iteration and correct for the original method.
 */
function _sqsSingleIteration(
  occ2d: number[][],
  eventTotals: number[],
  quorum: number,
  method: 'random' | 'rarefaction',
): number {
  const nEvents = occ2d.length;
  const nSpecies = occ2d[0].length;

  if (method === 'rarefaction') {
    // Standard Hurlbert rarefaction at the sub-sample size that corresponds
    // to the quorum fraction of total individuals.
    const totalN = eventTotals.reduce((a, b) => a + b, 0);
    const targetN = Math.floor(quorum * totalN);
    return _rarefactionSingle(occ2d, targetN);
  }

  // ── Alroy SQS (share-based random draw) ──────────────────────────────────
  // Build master list of (species_index, share_weight) for every individual.
  // Each individual contributes a share of 1/N_i to the event it belongs to.
  const masterShares: { species: number; weight: number }[] = [];

  for (let i = 0; i < nEvents; i++) {
    const Ni = eventTotals[i];
    if (Ni === 0) continue;
    const share = 1 / Ni;
    const row = occ2d[i];
    for (let s = 0; s < nSpecies; s++) {
      const count = row[s];
      for (let k = 0; k < count; k++) {
        masterShares.push({ species: s, weight: share });
      }
    }
  }

  if (masterShares.length === 0) return 0;

  // Fisher-Yates shuffle (seeded RNG — reproducibility)
  for (let i = masterShares.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [masterShares[i], masterShares[j]] = [masterShares[j], masterShares[i]];
  }

  // Draw shares until quorum
  let quorumAccum = 0;
  const drawnSpecies = new Set<number>();

  for (const share of masterShares) {
    quorumAccum += share.weight;
    drawnSpecies.add(share.species);
    if (quorumAccum >= quorum) break;
  }

  return drawnSpecies.size;
}

/**
 * Single Hurlbert rarefaction iteration for the 'rarefaction' method.
 * Draws a random sub-sample of size m and counts unique species.
 */
function _rarefactionSingle(occ2d: number[][], m: number): number {
  const nEvents = occ2d.length;
  const nSpecies = occ2d[0].length;
  if (m <= 0) return 0;

  // Build individual-level list: each individual is tagged with its species index.
  const individuals: number[] = [];
  for (let i = 0; i < nEvents; i++) {
    const row = occ2d[i];
    for (let s = 0; s < nSpecies; s++) {
      for (let k = 0; k < row[s]; k++) {
        individuals.push(s);
      }
    }
  }

  const Ntotal = individuals.length;
  if (m >= Ntotal) return new Set(individuals).size;

  // Shuffle and take first m (seeded RNG — reproducibility)
  for (let i = Ntotal - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [individuals[i], individuals[j]] = [individuals[j], individuals[i]];
  }

  const seen = new Set<number>();
  for (let i = 0; i < m; i++) seen.add(individuals[i]);
  return seen.size;
}
