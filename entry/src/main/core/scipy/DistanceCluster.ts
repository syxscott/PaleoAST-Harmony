import { Matrix } from '../math/Matrix';

/**
 * Distance metrics — replaces scipy.spatial.distance.
 */

export type DistanceMetric = 'euclidean' | 'braycurtis' | 'cosine' | 'jaccard' | 'canberra' | 'cityblock' | 'correlation' | 'hamming';

/** Pairwise distance matrix between rows of X. */
export function cdist(X: Matrix, metric: DistanceMetric = 'euclidean'): Matrix {
  const n = X.rows, D = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = rowDistance(X.row(i), X.row(j), metric);
    D.set(i, j, d); D.set(j, i, d);
  }
  return D;
}

/** Distance between two vectors. */
export function rowDistance(a: number[], b: number[], metric: DistanceMetric): number {
  switch (metric) {
    case 'euclidean': {
      let s = 0; for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2; return Math.sqrt(s);
    }
    case 'braycurtis': {
      let num = 0, den = 0;
      for (let k = 0; k < a.length; k++) { num += Math.abs(a[k] - b[k]); den += a[k] + b[k]; }
      return den > 0 ? num / den : 0;
    }
    case 'cosine': {
      let dot = 0, na = 0, nb = 0;
      for (let k = 0; k < a.length; k++) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2; }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      return denom > 0 ? 1 - dot / denom : 1;
    }
    case 'jaccard': {
      let num = 0, den = 0;
      for (let k = 0; k < a.length; k++) { if (a[k] !== 0 || b[k] !== 0) { den++; if (a[k] !== b[k]) num++; } }
      return den > 0 ? num / den : 0;
    }
    case 'canberra': {
      let s = 0;
      for (let k = 0; k < a.length; k++) { const denom = Math.abs(a[k]) + Math.abs(b[k]); s += denom > 0 ? Math.abs(a[k] - b[k]) / denom : 0; }
      return s;
    }
    case 'cityblock': {
      let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); return s;
    }
    case 'correlation': {
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      let dot = 0, na = 0, nb = 0;
      for (let k = 0; k < a.length; k++) { const da = a[k] - ma, db = b[k] - mb; dot += da * db; na += da * da; nb += db * db; }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      return denom > 0 ? 1 - dot / denom : 1;
    }
    case 'hamming': {
      let s = 0; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) s++; return s / a.length;
    }
    default: throw new Error(`Unknown metric: ${metric}`);
  }
}

/**
 * Hierarchical clustering — replaces scipy.cluster.hierarchy.
 */
export type LinkageMethod = 'ward' | 'complete' | 'average' | 'single';

export function linkage(D: Matrix, method: LinkageMethod = 'ward'): number[][] {
  const n = D.rows;
  const clusters: { indices: number[]; size: number }[] = Array.from({ length: n }, (_, i) => ({ indices: [i], size: 1 }));
  const linkageMatrix: number[][] = [];
  const distMatrix = D.clone();

  let nextId = n;
  const active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);

  while (active.size > 1) {
    // Find closest pair
    let minDist = Infinity, mergeI = -1, mergeJ = -1;
    const activeArr = [...active];
    for (let ai = 0; ai < activeArr.length; ai++) {
      for (let aj = ai + 1; aj < activeArr.length; aj++) {
        const i = activeArr[ai], j = activeArr[aj];
        if (distMatrix.get(i, j) < minDist) { minDist = distMatrix.get(i, j); mergeI = i; mergeJ = j; }
      }
    }

    if (mergeI === -1) break;

    // Record merge
    linkageMatrix.push([mergeI, mergeJ, minDist, clusters[mergeI].size + clusters[mergeJ].size]);

    // Create new cluster
    const newIdx = nextId++;
    clusters.push({ indices: [...clusters[mergeI].indices, ...clusters[mergeJ].indices], size: clusters[mergeI].size + clusters[mergeJ].size });

    // Update distance matrix (expand if needed)
    if (newIdx >= distMatrix.rows) {
      const newDist = Matrix.zeros(newIdx + 1, newIdx + 1);
      for (let i = 0; i < distMatrix.rows; i++) for (let j = 0; j < distMatrix.cols; j++) newDist.set(i, j, distMatrix.get(i, j));
      // Use Object.assign to replace data reference
      Object.assign(distMatrix, { data: newDist.data, rows: newDist.rows, cols: newDist.cols });
    }

    // Compute distances to new cluster
    for (const k of active) {
      if (k === mergeI || k === mergeJ) continue;
      let newDist: number;
      if (method === 'single') newDist = Math.min(distMatrix.get(mergeI, k), distMatrix.get(mergeJ, k));
      else if (method === 'complete') newDist = Math.max(distMatrix.get(mergeI, k), distMatrix.get(mergeJ, k));
      else newDist = (distMatrix.get(mergeI, k) * clusters[mergeI].size + distMatrix.get(mergeJ, k) * clusters[mergeJ].size) / (clusters[mergeI].size + clusters[mergeJ].size);
      distMatrix.set(newIdx, k, newDist);
      distMatrix.set(k, newIdx, newDist);
    }

    active.delete(mergeI);
    active.delete(mergeJ);
    active.add(newIdx);
  }

  return linkageMatrix;
}

/**
 * Cut linkage into k clusters.
 */
export function fcluster(linkageMatrix: number[][], nClusters: number): number[] {
  const n = linkageMatrix.length + 1;
  // Union-find
  const parent = Array.from({ length: 2 * n }, (_, i) => i);
  function find(x: number): number { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a: number, b: number): void { parent[find(a)] = find(b); }

  // Merge until we have nClusters groups
  const nMerges = n - nClusters;
  for (let i = 0; i < nMerges && i < linkageMatrix.length; i++) {
    union(linkageMatrix[i][0], linkageMatrix[i][1]);
  }

  // Assign labels
  const roots = new Map<number, number>();
  let label = 0;
  const labels: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!roots.has(r)) roots.set(r, label++);
    labels.push(roots.get(r)!);
  }
  return labels;
}
