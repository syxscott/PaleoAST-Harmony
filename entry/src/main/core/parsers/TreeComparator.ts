/**
 * Newick tree comparator — replaces parsers/newick_parser.py::TreeComparator.
 *
 * Works with any tree-like object whose nodes expose `.children`, `.name`,
 * and optionally `.branchLength` (e.g. NewickNode or PhyloNode).
 *
 * Implements:
 *  - Robinson-Foulds (RF) distance
 *  - Normalised RF in [0, 1]
 *  - Weighted RF using branch lengths
 *  - Split / bipartition encoding (restricted to common leaves)
 */
export interface ComparableTree {
  name: string;
  children: ComparableTree[];
  branchLength?: number;
  isLeaf?: boolean;
}

/** A bipartition defined by one side's leaf set. */
export interface Split {
  leaves: Set<string>;
  size: number;
}

export class TreeComparator {
  /**
   * Compute Robinson-Foulds distance between two trees.
   * Restricted to common leaves (standard convention).
   */
  static robinsonFoulds<T extends ComparableTree>(a: T, b: T): number {
    const sa = new Set<string>();
    TreeComparator._collectLeaves(a).forEach(l => sa.add(l));
    const sb = new Set<string>();
    TreeComparator._collectLeaves(b).forEach(l => sb.add(l));
    const common = new Set<string>([...sa].filter(x => sb.has(x)));
    if (common.size === 0) return 0;

    const splitsA = TreeComparator._splits(a, common);
    const splitsB = TreeComparator._splits(b, common);
    let onlyA = 0, onlyB = 0;
    for (const s of splitsA) if (!splitsB.has(s)) onlyA++;
    for (const s of splitsB) if (!splitsA.has(s)) onlyB++;
    return onlyA + onlyB;
  }

  /** Normalised RF distance in [0, 1]. */
  static normalisedRF<T extends ComparableTree>(a: T, b: T): number {
    const sa = new Set<string>();
    const sb = new Set<string>();
    TreeComparator._collectLeaves(a).forEach(l => sa.add(l));
    TreeComparator._collectLeaves(b).forEach(l => sb.add(l));
    const common = new Set<string>([...sa].filter(x => sb.has(x)));
    if (common.size <= 3) return 0;
    const maxSplits = common.size - 3;
    return TreeComparator.robinsonFoulds(a, b) / (2 * maxSplits);
  }

  /** Weighted RF using branch lengths. */
  static weightedRF<T extends ComparableTree>(a: T, b: T): number {
    const splitsA = TreeComparator._weightedSplits(a);
    const splitsB = TreeComparator._weightedSplits(b);
    let s = 0;
    for (const k of new Set([...splitsA.keys(), ...splitsB.keys()])) {
      const wa = splitsA.get(k) ?? 0;
      const wb = splitsB.get(k) ?? 0;
      s += Math.abs(wa - wb);
    }
    return s / 2;
  }

  /** Collect all leaves. */
  static _collectLeaves<T extends ComparableTree>(node: T): string[] {
    const out: string[] = [];
    const walk = (n: T) => {
      if (!n.children || n.children.length === 0) {
        if (n.name) out.push(n.name);
        return;
      }
      for (const c of n.children) walk(c);
    };
    walk(node);
    return out;
  }

  /** Compute canonical split keys for one tree. */
  static _splits<T extends ComparableTree>(tree: T, common: Set<string>): Set<string> {
    const splits = new Set<string>();
    const visit = (n: T): Set<string> => {
      const leaves = new Set<string>();
      const isLeaf = !n.children || n.children.length === 0;
      if (isLeaf) {
        if (n.name && common.has(n.name)) leaves.add(n.name);
        return leaves;
      }
      for (const c of n.children) {
        const cl = visit(c);
        cl.forEach(l => leaves.add(l));
      }
      if (leaves.size > 0 && leaves.size < common.size) {
        const sorted = Array.from(leaves).sort();
        splits.add(sorted.join('|'));
      }
      return leaves;
    };
    visit(tree);
    return splits;
  }

  /** Weighted splits keyed by split string → branch length. */
  static _weightedSplits<T extends ComparableTree>(tree: T): Map<string, number> {
    const map = new Map<string, number>();
    const all = new Set<string>();
    TreeComparator._collectLeaves(tree).forEach(l => all.add(l));
    const visit = (n: T): Set<string> => {
      const leaves = new Set<string>();
      const isLeaf = !n.children || n.children.length === 0;
      if (isLeaf) {
        if (n.name) leaves.add(n.name);
        return leaves;
      }
      for (const c of n.children) {
        const cl = visit(c);
        cl.forEach(l => leaves.add(l));
      }
      if (leaves.size > 0 && leaves.size < all.size) {
        const sorted = Array.from(leaves).sort();
        map.set(sorted.join('|'), n.branchLength ?? 0);
      }
      return leaves;
    };
    visit(tree);
    return map;
  }
}
