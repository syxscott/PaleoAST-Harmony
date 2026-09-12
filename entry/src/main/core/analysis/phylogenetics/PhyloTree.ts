/**
 * PhyloTree container and pairwise distance utilities — port of
 * phylogenetics/tree.py::PhyloTree and phylogenetics/distance_methods.py::DistanceMatrix.
 */
import { PhyloNode, parseNewick } from './phylogenetics';

/** Container class mirroring Python's PhyloTree convenience API. */
export class PhyloTree {
  root: PhyloNode;

  constructor(root: PhyloNode) {
    this.root = root;
  }

  static fromNewick(newick: string): PhyloTree {
    return new PhyloTree(parseNewick(newick));
  }

  toNewick(precision?: number): string {
    return this.root.toNewick(precision);
  }

  get leafCount(): number {
    return this.root.leafCount();
  }

  get leafNames(): string[] {
    return this.root.leafNames();
  }

  get nodeCount(): number {
    return this.root.nodeCount();
  }

  /** Average pairwise patristic (branch-length) distance between all tips. */
  getDistanceMatrix(): { names: string[]; distances: number[][] } {
    const leaves = this.root.getLeaves();
    const names = leaves.map(l => l.name ?? 'tip');
    const n = leaves.length;
    const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = leaves[i].getDistance(leaves[j]);
        D[i][j] = D[j][i] = d;
      }
    }
    return { names, distances: D };
  }
}

/**
 * Pairwise distance container (distance_methods.py DistanceMatrix):
 * supports labelled lookup, matrix/array conversion, sequence p-distances.
 */
export class DistanceMatrix {
  names: string[];
  private _m: number[][];

  constructor(names: string[], matrix: number[][]) {
    const n = names.length;
    if (matrix.length !== n || matrix.some(row => row.length !== n)) {
      throw new Error('DistanceMatrix: matrix must be n×n matching names');
    }
    this.names = [...names];
    this._m = matrix.map(row => [...row]);
  }

  /** p-distance (proportion of differing sites) between aligned strings. */
  static fromSequences(names: string[], sequences: string[]): DistanceMatrix {
    const n = names.length;
    if (sequences.length !== n) throw new Error('DistanceMatrix.fromSequences: length mismatch');
    const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = sequences[i], b = sequences[j];
        const len = Math.min(a.length, b.length);
        if (len === 0) { M[i][j] = M[j][i] = 0; continue; }
        let diff = 0;
        for (let k = 0; k < len; k++) if (a[k] !== b[k]) diff++;
        M[i][j] = M[j][i] = diff / len;
      }
    }
    return new DistanceMatrix(names, M);
  }

  static fromArray(matrix: number[][], names?: string[]): DistanceMatrix {
    const n = matrix.length;
    return new DistanceMatrix(names ?? Array.from({ length: n }, (_, i) => `T${i + 1}`), matrix);
  }

  static fromDict(d: Record<string, Record<string, number>>): DistanceMatrix {
    const names = Object.keys(d);
    const M = names.map(a => names.map(b => d[a][b] ?? 0));
    return new DistanceMatrix(names, M);
  }

  getDistance(a: string, b: string): number {
    const i = this.names.indexOf(a), j = this.names.indexOf(b);
    if (i < 0 || j < 0) throw new Error(`DistanceMatrix: unknown taxon ${a}/${b}`);
    return this._m[i][j];
  }

  toMatrix(): number[][] {
    return this._m.map(row => [...row]);
  }

  get size(): number {
    return this.names.length;
  }
}
