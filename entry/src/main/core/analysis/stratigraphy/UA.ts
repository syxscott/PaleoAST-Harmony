/**
 * Unitary Associations biostratigraphy — replaces stratigraphy/biostratigraphy.py::UAAnalyzer.
 *
 * Builds the overlap graph (Guex 1991):
 *   - Vertex i appears in section j iff event i has a FAD ≤ FAD_j ≤ LAD_j ≤ LAD_i in section j.
 *   - Two events are co-occurring in section j iff their intervals intersect.
 *   - Find maximal cliques → biozones (Unitary Associations).
 */
import { ComputationError } from '../../utils/Exceptions';

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
}

/**
 * Compute Unitary Associations via maximal clique enumeration.
 *
 * @param fadMatrix  n_sections × n_events (NaN means absent)
 * @param ladMatrix  n_sections × n_events (NaN means absent)
 * @param sectionNames optional names for sections
 * @param eventNames   optional names for events
 */
export function unitaryAssociations(
  fadMatrix: number[][],
  ladMatrix: number[][],
  sectionNames?: string[],
  eventNames?: string[]
): BioeventResult {
  if (!Array.isArray(fadMatrix) || fadMatrix.length === 0)
    throw new ComputationError('Empty FAD matrix');
  if (fadMatrix.length !== ladMatrix.length) throw new ComputationError('FAD/LAD mismatch rows');
  const nSec = fadMatrix.length;
  const nEv = fadMatrix[0].length;
  if (nEv === 0) throw new ComputationError('FAD matrix has no events');
  for (const row of ladMatrix) if (row.length !== nEv)
    throw new ComputationError('LAD matrix column count differs from FAD');

  const sections = sectionNames ?? Array.from({ length: nSec }, (_, i) => `Section_${i + 1}`);
  const events = eventNames ?? Array.from({ length: nEv }, (_, i) => `Event_${i + 1}`);

  // Co-occurrence matrix: cofreq[i][j] = number of sections where events i and j co-occur
  const cofreq: number[][] = [];
  for (let i = 0; i < nEv; i++) cofreq.push(new Array(nEv).fill(0));
  for (let s = 0; s < nSec; s++) {
    for (let i = 0; i < nEv; i++) {
      const fi = fadMatrix[s][i], li = ladMatrix[s][i];
      if (isNaN(fi) || isNaN(li)) continue;
      for (let j = i + 1; j < nEv; j++) {
        const fj = fadMatrix[s][j], lj = ladMatrix[s][j];
        if (isNaN(fj) || isNaN(lj)) continue;
        // Co-occur if intervals intersect
        const lo = Math.max(fi, fj), hi = Math.min(li, lj);
        if (hi >= lo) { cofreq[i][j]++; cofreq[j][i]++; }
      }
    }
  }

  // Find maximal cliques (Bron-Kerbosch with pivot)
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
        if (isNaN(fadMatrix[s][e]) || isNaN(ladMatrix[s][e])) { ok = false; break; }
      }
      if (ok) shared.push(s);
    }
    zones.push({
      name: `UAZ ${idx + 1}`,
      events: clique.map(e => events[e]),
      sections: shared
    });
  });

  // Optional: merge consecutive zones with ≥80% similarity into Unitary Association Zones
  const uaz = _mergeToUAZ(zones, events);

  return {
    sections,
    events,
    zones,
    fadMatrix,
    ladMatrix,
    method: 'ua',
    uazGroups: uaz
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
 * Implements Guex (1991) "Biochronological Correlations" Section 3.3:
 *   - UA zones are the "co-recovery" units derived from maximal cliques.
 *   - Two maximal cliques belong to the same UAZ if their intersection
 *     is non-empty (they share at least one event).
 *   - This is NOT simply merging by similarity threshold.
 *
 * The algorithm:
 *   1. Sort maximal cliques by their "base level" (minimum LAD in the zone).
 *   2. Build a graph where nodes = maximal cliques.
 *   3. Connect two cliques if they share events (intersection non-empty).
 *   4. Connected components = UAZs.
 */
function _mergeToUAZ(
  zones: Zone[],
  _allEvents: string[]
): { uazId: number; uazName: string; zoneIndices: number[]; eventUnion: string[] }[] {
  if (zones.length === 0) return [];

  // Compute base level (minimum LAD index) for each zone to sort
  const baseLevels = zones.map(z => {
    // Find the minimum "stratigraphic level" among events in this zone
    // Using section co-occurrence count as proxy
    return z.sections.length;
  });

  // Sort zones by base level (ascending)
  const sorted = zones
    .map((z, i) => ({ zone: z, idx: i, level: baseLevels[i] }))
    .sort((a, b) => b.level - a.level); // descending = older first

  // Build co-occurrence graph: connect zones sharing at least one event
  const n = sorted.length;
  const adj: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Check if zones i and j share any event
      const eventsI = new Set(sorted[i].zone.events);
      const shared = sorted[j].zone.events.filter(e => eventsI.has(e));
      if (shared.length > 0) {
        adj[i][j] = adj[j][i] = true;
      }
    }
  }

  // Find connected components (UAZs)
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

    // Union of events in this UAZ
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
