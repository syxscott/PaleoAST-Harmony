/**
 * Unitary Associations biostratigraphy — replaces stratigraphy/biostratigraphy.py::UAAnalyzer.
 *
 * Builds the overlap graph (Guex 1991):
 *   - Vertex i appears in section j iff event i has a FAD ≤ FAD_j ≤ LAD_j ≤ LAD_i in section j.
 *   - Two events are co-occurring in section j iff their intervals intersect.
 *   - Find maximal cliques → biozones (Unitary Associations).
 *
 * Pipeline (matching Python UAAnalyzer.analyze):
 *   1. Endemic-species filtering by min_section_occurrence.
 *   2. Cyclic FAD/LAD contradiction detection (enable_cyclic_check).
 *   3. Maximal clique enumeration (Bron-Kerbosch with pivot).
 *   4. UAZ aggregation of similar cliques (uaz_similarity_threshold,
 *      Sørensen-style: 2·|A∩B| / (|A|+|B|) ≥ threshold, Guex default 0.8).
 */
import { ComputationError } from '../../utils/Exceptions';
import { detectCyclicContradictions, type CyclicContradiction } from './StratExtended';

export interface Zone {
  name: string;
  events: string[];
  sections: number[];
}

export interface BioeventResult {
  sections: string[];
  events: string[];
  zones: Zone[];
  fadMatrix: number[][];
  ladMatrix: number[][];
  method: 'ua';
  uazGroups?: { uazId: number; uazName: string; zoneIndices: number[]; eventUnion: string[] }[];
  /** Events removed by endemic filtering (fewer than minSectionOccurrence sections). */
  endemicFiltered?: string[];
  /** FAD ordering contradictions detected across sections. */
  cyclicContradictions?: CyclicContradiction[];
}

/**
 * Compute Unitary Associations via maximal clique enumeration.
 *
 * @param fadMatrix  n_sections × n_events (NaN means absent)
 * @param ladMatrix  n_sections × n_events (NaN means absent)
 * @param sectionNames optional names for sections
 * @param eventNames   optional names for events
 * @param minSectionOccurrence minimum number of sections an event must appear
 *        in to be retained (endemic filter; Python default 2, use 1 to disable)
 * @param uazSimilarityThreshold Sørensen-style similarity for merging cliques
 *        into UAZ (Guex default 0.8; use ≤ 0 to merge on any shared event)
 * @param enableCyclicCheck run the O(N²) pairwise FAD inversion scan
 */
export function unitaryAssociations(
  fadMatrix: number[][],
  ladMatrix: number[][],
  sectionNames?: string[],
  eventNames?: string[],
  minSectionOccurrence: number = 2,
  uazSimilarityThreshold: number = 0.8,
  enableCyclicCheck: boolean = true,
): BioeventResult {
  if (!Array.isArray(fadMatrix) || fadMatrix.length === 0)
    throw new ComputationError('Empty FAD matrix');
  if (fadMatrix.length !== ladMatrix.length) throw new ComputationError('FAD/LAD mismatch rows');
  let nSec = fadMatrix.length;
  let nEv = fadMatrix[0].length;
  if (nEv === 0) throw new ComputationError('FAD matrix has no events');
  for (const row of ladMatrix) if (row.length !== nEv)
    throw new ComputationError('LAD matrix column count differs from FAD');

  let sections = sectionNames ?? Array.from({ length: nSec }, (_, i) => `Section_${i + 1}`);
  let events = eventNames ?? Array.from({ length: nEv }, (_, i) => `Event_${i + 1}`);

  // ── Step 1: endemic-species filtering (min_section_occurrence) ──────────
  let fad = fadMatrix, lad = ladMatrix;
  const endemicFiltered: string[] = [];
  if (minSectionOccurrence > 1) {
    const keep: number[] = [];
    for (let e = 0; e < nEv; e++) {
      let occ = 0;
      for (let s = 0; s < nSec; s++) {
        if (!isNaN(fad[s][e]) && !isNaN(lad[s][e])) occ++;
      }
      if (occ >= minSectionOccurrence) keep.push(e);
      else endemicFiltered.push(events[e]);
    }
    if (keep.length < nEv) {
      fad = fadMatrix.map(row => keep.map(e => row[e]));
      lad = ladMatrix.map(row => keep.map(e => row[e]));
      events = keep.map(e => events[e]);
      nEv = keep.length;
    }
  }

  // ── Step 2: cyclic contradiction detection ──────────────────────────────
  const cyclicContradictions = enableCyclicCheck
    ? detectCyclicContradictions(fad, events)
    : undefined;

  // ── Step 3: co-occurrence graph + maximal cliques ───────────────────────
  const cofreq: number[][] = [];
  for (let i = 0; i < nEv; i++) cofreq.push(new Array(nEv).fill(0));
  for (let s = 0; s < nSec; s++) {
    for (let i = 0; i < nEv; i++) {
      const fi = fad[s][i], li = lad[s][i];
      if (isNaN(fi) || isNaN(li)) continue;
      for (let j = i + 1; j < nEv; j++) {
        const fj = fad[s][j], lj = lad[s][j];
        if (isNaN(fj) || isNaN(lj)) continue;
        // Co-occur if intervals intersect
        const lo = Math.max(fi, fj), hi = Math.min(li, lj);
        if (hi >= lo) { cofreq[i][j]++; cofreq[j][i]++; }
      }
    }
  }

  const adjacency: Set<number>[] = [];
  for (let i = 0; i < nEv; i++) {
    const adj = new Set<number>();
    for (let j = 0; j < nEv; j++) if (j !== i && cofreq[i][j] > 0) adj.add(j);
    adjacency.push(adj);
  }
  const cliques: number[][] = [];
  _bronKerbosch(new Set(), new Set([...Array(nEv).keys()]), new Set(), adjacency, cliques);

  // For each clique, find sections that contain all events
  const zones: Zone[] = [];
  cliques.forEach((clique, idx) => {
    const shared: number[] = [];
    for (let s = 0; s < nSec; s++) {
      let ok = true;
      for (const e of clique) {
        if (isNaN(fad[s][e]) || isNaN(lad[s][e])) { ok = false; break; }
      }
      if (ok) shared.push(s);
    }
    zones.push({
      name: `UAZ ${idx + 1}`,
      events: clique.map(e => events[e]),
      sections: shared
    });
  });

  // ── Step 4: merge similar cliques into UAZ ──────────────────────────────
  const uaz = _mergeToUAZ(zones, events, uazSimilarityThreshold);

  return {
    sections,
    events,
    zones,
    fadMatrix,
    ladMatrix,
    method: 'ua',
    uazGroups: uaz,
    endemicFiltered,
    cyclicContradictions,
  };
}

function _bronKerbosch(
  R: Set<number>, P: Set<number>, X: Set<number>,
  adj: Set<number>[], out: number[][]
): void {
  if (P.size === 0 && X.size === 0) {
    out.push(Array.from(R).sort((a, b) => a - b));
    return;
  }
  // Pivot
  const union = new Set([...P, ...X]);
  let pivot = -1, maxDeg = -1;
  for (const u of union) {
    const deg = adj[u].size;
    if (deg > maxDeg) { maxDeg = deg; pivot = u; }
  }
  const Pcopy = new Set(P);
  const Npivot = pivot >= 0 ? adj[pivot] : new Set<number>();
  const cand = new Set([...Pcopy].filter(v => !Npivot.has(v)));
  for (const v of cand) {
    const newR = new Set(R); newR.add(v);
    const newP = new Set([...P].filter(u => adj[v].has(u)));
    const newX = new Set([...X].filter(u => adj[v].has(u)));
    _bronKerbosch(newR, newP, newX, adj, out);
    P.delete(v);
    X.add(v);
  }
}

/**
 * Merge maximal cliques (zones) into Unitary Association Zones (UAZ).
 *
 * Following Python UAAnalyzer._merge_to_uaz: zones are ordered by base level
 * (supporting-section count as proxy), then connected components are formed
 * in the "similarity graph" where two cliques are connected when their
 * Sørensen-style similarity 2|A∩B| / (|A|+|B|) ≥ uaz_similarity_threshold
 * (Guex 1991 empirical default 0.8).
 */
function _mergeToUAZ(
  zones: Zone[],
  _allEvents: string[],
  similarityThreshold: number = 0.8,
): { uazId: number; uazName: string; zoneIndices: number[]; eventUnion: string[] }[] {
  if (zones.length === 0) return [];

  // Base level proxy: number of supporting sections (Python convention)
  const baseLevels = zones.map(z => z.sections.length);
  const sorted = zones
    .map((z, i) => ({ zone: z, idx: i, level: baseLevels[i] }))
    .sort((a, b) => b.level - a.level); // descending = older first

  const n = sorted.length;
  const adj: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const eventsI = new Set(sorted[i].zone.events);
      const shared = sorted[j].zone.events.filter(e => eventsI.has(e)).length;
      const unionSize = sorted[i].zone.events.length + sorted[j].zone.events.length;
      if (unionSize === 0) continue;
      const similarity = (2 * shared) / unionSize; // Sørensen/Dice coefficient
      if (similarity >= similarityThreshold) {
        adj[i][j] = adj[j][i] = true;
      }
    }
  }

  // Connected components (UAZs)
  const visited = new Array(n).fill(false);
  const out: { uazId: number; uazName: string; zoneIndices: number[]; eventUnion: string[] }[] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const component: number[] = [];
    const queue = [i];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited[curr]) continue;
      visited[curr] = true;
      component.push(curr);
      for (let j = 0; j < n; j++) {
        if (adj[curr][j] && !visited[j]) queue.push(j);
      }
    }

    const eventSet = new Set<string>();
    const zoneIndices: number[] = [];
    for (const ci of component) {
      zoneIndices.push(sorted[ci].idx);
      for (const e of sorted[ci].zone.events) eventSet.add(e);
    }

    out.push({
      uazId: out.length + 1,
      uazName: `UAZ ${out.length + 1}`,
      zoneIndices: zoneIndices.sort((a, b) => a - b),
      eventUnion: Array.from(eventSet)
    });
  }

  return out;
}
