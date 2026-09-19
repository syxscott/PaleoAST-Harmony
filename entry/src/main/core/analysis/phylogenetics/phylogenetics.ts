import { seed as seedRng, rand, randint } from '../../math/random';

/**
 * Phylogenetic analysis — replaces phylogenetics/*.py
 */

/**
 * Phylogenetic tree node.
 */
export class PhyloNode {
  name: string;
  children: PhyloNode[];
  branchLength: number;
  parent: PhyloNode | null;
  support: number | null;
  isLeaf: boolean;
  /** Free-form annotations (FBD is_extant flags, PIC caches, etc. — tree.py metadata). */
  metadata: Record<string, number | string | boolean>;
  /** Optional display/data label distinct from the biological name. */
  label: string;

  constructor(name: string, branchLength: number = 0, isLeaf: boolean = false) {
    this.name = name; this.branchLength = branchLength; this.isLeaf = isLeaf;
    this.children = []; this.parent = null; this.support = null;
    this.metadata = {}; this.label = name;
  }

  // ─── Tree Manipulation ──────────────────────────────────────────

  addChild(child: PhyloNode): void { child.parent = this; this.children.push(child); }

  removeChild(child: PhyloNode): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0) { this.children.splice(idx, 1); child.parent = null; }
  }

  /** Remove this node from its parent (Python-side helper semantic). */
  detach(): void { if (this.parent) { this.parent.removeChild(this); } }

  /** Python prune() semantics: cut this node and promote its children to the parent. */
  cutAndPromote(): void {
    if (!this.parent) return;
    const parent = this.parent;
    parent.removeChild(this);
    for (const child of this.children) {
      child.branchLength = (child.branchLength ?? 0) + (this.branchLength ?? 0);
      parent.addChild(child);
    }
    this.children = [];
  }

  /** Python detach() semantics: return a recursive copy of this subtree as an independent root. */
  detachSubtree(): PhyloNode {
    return this.clone();
  }

  get isRoot(): boolean { return this.parent === null; }

  get arity(): number { return this.children.length; }

  get degree(): number { return this.children.length + (this.parent ? 1 : 0); }

  get isTrivial(): boolean { return this.isLeaf || this.children.length <= 1; }

  // ─── Leaf/Node Queries ──────────────────────────────────────────

  getLeaves(): PhyloNode[] {
    if (this.isLeaf) return [this];
    const leaves: PhyloNode[] = [];
    for (const c of this.children) leaves.push(...c.getLeaves());
    return leaves;
  }

  leafCount(): number { return this.getLeaves().length; }

  leafNames(): string[] { return this.getLeaves().map(l => l.name); }

  allTaxa(): string[] { return this.leafNames(); }

  getAllNodes(): PhyloNode[] {
    const nodes: PhyloNode[] = [this];
    for (const c of this.children) nodes.push(...c.getAllNodes());
    return nodes;
  }

  nodeCount(): number { return this.getAllNodes().length; }

  getSubtreeNodes(): PhyloNode[] { return this.getAllNodes(); }

  getSiblings(): PhyloNode[] {
    if (!this.parent) return [];
    return this.parent.children.filter(c => c !== this);
  }

  // ─── Traversal ──────────────────────────────────────────────────

  preorderTraverse(): PhyloNode[] {
    const result: PhyloNode[] = [this];
    for (const c of this.children) result.push(...c.preorderTraverse());
    return result;
  }

  postorderTraverse(): PhyloNode[] {
    const result: PhyloNode[] = [];
    for (const c of this.children) result.push(...c.postorderTraverse());
    result.push(this);
    return result;
  }

  levelOrderTraverse(): PhyloNode[] {
    const result: PhyloNode[] = [];
    const queue: PhyloNode[] = [this];
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      for (const c of node.children) queue.push(c);
    }
    return result;
  }

  // ─── Path/Ancestry ─────────────────────────────────────────────

  getPathToRoot(): PhyloNode[] {
    const path: PhyloNode[] = [this];
    let node: PhyloNode | null = this.parent;
    while (node) { path.push(node); node = node.parent; }
    return path;
  }

  getAncestors(): PhyloNode[] {
    const ancestors: PhyloNode[] = [];
    let node = this.parent;
    while (node) { ancestors.push(node); node = node.parent; }
    return ancestors;
  }

  getDistance(other: PhyloNode): number {
    const lca = this.computeLCA(other);
    if (!lca) return Infinity;
    return this.distanceToAncestor(lca) + other.distanceToAncestor(lca);
  }

  distanceToAncestor(ancestor: PhyloNode): number {
    let dist = 0;
    let node: PhyloNode | null = this;
    while (node && node !== ancestor) { dist += node.branchLength || 0; node = node.parent; }
    return node === ancestor ? dist : Infinity;
  }

  computeLCA(other: PhyloNode): PhyloNode | null {
    const path1 = new Set(this.getPathToRoot());
    let node: PhyloNode | null = other;
    while (node) { if (path1.has(node)) return node; node = node.parent; }
    return null;
  }

  // ─── Tree Properties ────────────────────────────────────────────

  // ─── Tree Properties ────────────────────────────────────────────

  /** Node depths counted in branch-length units (original Harmony semantics). */
  getDepths(): Map<PhyloNode, number> {
    const depths = new Map<PhyloNode, number>();
    const traverse = (node: PhyloNode, d: number) => {
      depths.set(node, d);
      for (const c of node.children) traverse(c, d + (c.branchLength || 0));
    };
    traverse(this, 0);
    return depths;
  }

  /** Node depths counted in edges (Python tree.py compute_depths semantics). */
  getEdgeDepths(): Map<PhyloNode, number> {
    const depths = new Map<PhyloNode, number>();
    const traverse = (node: PhyloNode, d: number) => {
      depths.set(node, d);
      for (const c of node.children) traverse(c, d + 1);
    };
    traverse(this, 0);
    return depths;
  }

  /** Alias matching Python compute_depths (edge counts). */
  computeDepths(): Map<PhyloNode, number> {
    return this.getEdgeDepths();
  }

  /** Branch-length depths (kept for explicitness after the Python-port rename). */
  getBranchLengthDepths(): Map<PhyloNode, number> {
    return this.getDepths();
  }

  getHeights(): Map<PhyloNode, number> {
    const heights = new Map<PhyloNode, number>();
    const computeHeight = (node: PhyloNode): number => {
      if (node.isLeaf) { heights.set(node, 0); return 0; }
      let maxH = 0;
      for (const c of node.children) maxH = Math.max(maxH, computeHeight(c) + (c.branchLength || 0));
      heights.set(node, maxH);
      return maxH;
    };
    computeHeight(this);
    return heights;
  }

  computeTotalLength(): number {
    let total = 0;
    const traverse = (node: PhyloNode) => { total += node.branchLength || 0; for (const c of node.children) traverse(c); };
    traverse(this);
    return total;
  }

  isBinary(): boolean {
    for (const node of this.getAllNodes()) {
      if (!node.isLeaf && node.children.length !== 2) return false;
    }
    return true;
  }

  // ─── Tree Modification ──────────────────────────────────────────

  /** Prune the tree down to the given leaf-name set (retained Harmony semantic). */
  pruneToTaxa(validNames: Set<string>): PhyloNode | null {
    return this.prune(validNames);
  }

  prune(validNames: Set<string>): PhyloNode | null {
    if (this.isLeaf) return validNames.has(this.name) ? this : null;
    const keptChildren: PhyloNode[] = [];
    for (const c of this.children) {
      const pruned = c.prune(validNames);
      if (pruned) keptChildren.push(pruned);
    }
    if (keptChildren.length === 0) return null;
    if (keptChildren.length === 1 && !this.isRoot) return keptChildren[0];
    this.children = keptChildren;
    for (const c of keptChildren) c.parent = this;
    return this;
  }

  clone(): PhyloNode {
    const copy = new PhyloNode(this.name, this.branchLength, this.isLeaf);
    copy.support = this.support;
    copy.metadata = { ...this.metadata };
    copy.label = this.label;
    for (const c of this.children) copy.addChild(c.clone());
    return copy;
  }

  // ─── Newick Export ──────────────────────────────────────────────

  /**
   * Serialize to Newick. Optional precision controls branch-length rounding
   * (Python to_newick(precision)); internal labels are emitted once (the
   * support value when present, otherwise the internal name) — the previous
   * version concatenated both and produced malformed output.
   */
  toNewick(precision?: number): string {
    const fmt = (v: number): string =>
      precision !== undefined ? v.toFixed(precision) : String(v);
    if (this.isLeaf) {
      let s = this.name;
      if (this.branchLength > 0) s += ':' + fmt(this.branchLength);
      return s;
    }
    let s = '(' + this.children.map(c => c.toNewick(precision)).join(',') + ')';
    if (this.support !== null) s += String(this.support);
    else if (this.name) s += this.name;
    if (this.branchLength > 0) s += ':' + fmt(this.branchLength);
    return s + ';';
  }

  // ─── Fitch Parsimony Indices ────────────────────────────────────

  computeParsimonyScore(sequences: Record<string, string>): { treeLength: number; siteScores: number[] } {
    const taxa = Object.keys(sequences);
    const nSites = sequences[taxa[0]]?.length ?? 0;
    const siteScores: number[] = [];

    for (let s = 0; s < nSites; s++) {
      const states: Record<string, string> = {};
      for (const name of taxa) states[name] = sequences[name][s];
      const nodeStates = new Map<PhyloNode, Set<string>>();

      const fitchDown = (node: PhyloNode): Set<string> => {
        if (node.isLeaf) { const st = new Set([states[node.name]]); nodeStates.set(node, st); return st; }
        const childSets = node.children.map(c => fitchDown(c));
        let intersection = new Set(childSets[0]);
        for (let i = 1; i < childSets.length; i++) { const ni = new Set<string>(); for (const x of intersection) if (childSets[i].has(x)) ni.add(x); intersection = ni; }
        const result = intersection.size > 0 ? intersection : new Set(childSets.flatMap(s => [...s]));
        nodeStates.set(node, result);
        return result;
      };
      fitchDown(this);

      let changes = 0;
      const countChanges = (node: PhyloNode) => {
        for (const child of node.children) {
          const ps = nodeStates.get(node)!, cs = nodeStates.get(child)!;
          let overlap = false;
          for (const x of cs) if (ps.has(x)) { overlap = true; break; }
          if (!overlap) {
            // Count elements in childSet not in parentSet
            for (const x of cs) if (!ps.has(x)) changes++;
          }
          countChanges(child);
        }
      };
      countChanges(this);
      siteScores.push(changes);
    }
    return { treeLength: siteScores.reduce((a, b) => a + b, 0), siteScores };
  }

  computeConsistencyIndex(sequences: Record<string, string>): number {
    const { treeLength, siteScores } = this.computeParsimonyScore(sequences);
    if (treeLength === 0) return 1;
    const m = siteScores.filter(s => s > 0).length;
    return m / treeLength;
  }

  computeRetentionIndex(sequences: Record<string, string>): number {
    const { treeLength, siteScores } = this.computeParsimonyScore(sequences);
    const nTaxa = this.leafCount();
    const m = siteScores.filter(s => s > 0).length;
    const g = m * (nTaxa - 1);
    if (g === m) return 1;
    return (g - treeLength) / (g - m);
  }

  // ─── Compatibility ──────────────────────────────────────────────

  isCompatibleWith(other: PhyloNode): boolean {
    const leaves1 = new Set(this.leafNames());
    const leaves2 = new Set(other.leafNames());
    const allLeaves = new Set([...leaves1, ...leaves2]);
    const only1 = new Set([...leaves1].filter(l => !leaves2.has(l)));
    const only2 = new Set([...leaves2].filter(l => !leaves1.has(l)));
    return !(only1.size > 0 && only2.size > 0 && leaves1.size < allLeaves.size && leaves2.size < allLeaves.size);
  }

  // ─── Description ────────────────────────────────────────────────

  getDescription(): string {
    const leaves = this.leafCount();
    const depth = this.getDepths().get(this) ?? 0;
    return `${this.name || 'node'}: ${leaves} leaves, depth=${depth.toFixed(3)}, bl=${this.branchLength.toFixed(3)}`;
  }
}

/**
 * Parse a Newick string into a tree. Supports quoted taxon names, `!`/`[...]`
 * comments (including primate_tree.nwk-style header lines), internal support
 * values (pure-numeric internal labels are stored in `support`), and branch
 * lengths.
 */
export function parseNewick(newick: string): PhyloNode {
  // Strip `!` comment header lines (whole lines starting with optional
  // whitespace then '!') and inline [...] comments.
  const withoutHeader = newick
    .split(/\r?\n/)
    .filter(line => !/^\s*!/.test(line))
    .join('\n');
  const s = withoutHeader.replace(/\[[^\]]*\]/g, '').trim().replace(/;$/, '');
  let pos = 0;

  function parseNode(): PhyloNode {
    let node: PhyloNode;
    if (s[pos] === '(') {
      pos++; // skip '('
      node = new PhyloNode('', 0, false);
      node.addChild(parseNode());
      while (s[pos] === ',') { pos++; node.addChild(parseNode()); }
      if (s[pos] === ')') pos++;
    } else {
      node = new PhyloNode('', 0, true);
    }

    // Read name (quoted names may contain , ) : ; characters)
    let name = '';
    if (s[pos] === "'" || s[pos] === '"') {
      const quote = s[pos];
      pos++;
      while (pos < s.length && s[pos] !== quote) { name += s[pos]; pos++; }
      if (s[pos] === quote) pos++;
    } else {
      while (pos < s.length && s[pos] !== ',' && s[pos] !== ')' && s[pos] !== ':' && s[pos] !== ';') {
        name += s[pos]; pos++;
      }
    }
    name = name.trim();
    if (name) {
      // Pure-numeric internal labels are support values, not names
      const numeric = /^-?\d+(\.\d+)?$/.test(name);
      if (numeric && !node.isLeaf) {
        node.support = parseFloat(name);
      } else {
        node.name = name;
      }
    }

    // Read branch length
    if (s[pos] === ':') {
      pos++; let bl = '';
      while (pos < s.length && s[pos] !== ',' && s[pos] !== ')' && s[pos] !== ';') { bl += s[pos]; pos++; }
      node.branchLength = parseFloat(bl) || 0;
    }

    if (!node.isLeaf) node.isLeaf = node.children.length === 0;
    return node;
  }

  return parseNode();
}

/**
 * Fitch parsimony — replaces phylogenetics/fitch.py.
 */
export interface FitchResult {
  treeLength: number;
  siteScores: number[];
  nTaxa: number;
  /** Per-site most-parsimonious ancestral state sets (post-order). */
  ancestralStates?: Record<number, Record<string, string[]>>;
  /** Observed character changes as (parent, child, site, from, to). */
  changes?: { parent: string; child: string; site: number; from: string; to: string }[];
}

export interface FitchOptions {
  /** Treat '?', '-' and 'N' as uninformative (union of all states) instead of literal characters. */
  gapAsMissing?: boolean;
  /** Characters treated as missing when gapAsMissing is true (default '?-nN'). */
  missingChars?: string;
}

export function fitchParsimony(
  tree: PhyloNode,
  sequences: Record<string, string>,
  options?: FitchOptions,
): FitchResult {
  const taxonNames = Object.keys(sequences);
  const nSites = sequences[taxonNames[0]]?.length ?? 0;
  const siteScores: number[] = [];
  const gapAsMissing = options?.gapAsMissing ?? false;
  const missingChars = new Set((options?.missingChars ?? '?-nN').split(''));
  const allChanges: { parent: string; child: string; site: number; from: string; to: string }[] = [];
  const ancestralStatesBySite: Record<number, Record<string, string[]>> = {};

  for (let s = 0; s < nSites; s++) {
    // Extract site states
    const states: Record<string, string> = {};
    for (const name of taxonNames) {
      const raw = sequences[name][s];
      states[name] = gapAsMissing && missingChars.has(raw) ? '?' : raw;
    }

    // Fitch down-pass
    const nodeStates = new Map<PhyloNode, Set<string>>();
    function fitchDown(node: PhyloNode): Set<string> {
      if (node.isLeaf) {
        const st = new Set([states[node.name]]);
        nodeStates.set(node, st);
        return st;
      }
      const childSets = node.children.map(c => fitchDown(c));
      let intersection = new Set(childSets[0]);
      for (let i = 1; i < childSets.length; i++) {
        const newInter = new Set<string>();
        for (const st of intersection) if (childSets[i].has(st)) newInter.add(st);
        intersection = newInter;
      }
      const result = intersection.size > 0 ? intersection : new Set(childSets.flatMap(st => [...st]));
      nodeStates.set(node, result);
      return result;
    }
    fitchDown(tree);

    // Count changes
    let changes = 0;
    function countChanges(node: PhyloNode): void {
      for (const child of node.children) {
        const parentStates = nodeStates.get(node)!;
        const childStates = nodeStates.get(child)!;
        let hasOverlap = false;
        for (const st of childStates) if (parentStates.has(st)) { hasOverlap = true; break; }
        if (!hasOverlap) changes++;
        countChanges(child);
      }
    }
    countChanges(tree);
    siteScores.push(changes);

    // Ancestral state reconstruction: assign each internal node a state set,
    // resolving intersections by keeping them (soft polytomy of optima)
    const perNode: Record<string, string[]> = {};
    for (const [node, st] of nodeStates) {
      perNode[node.name || `__int_${node.getAllNodes().indexOf(node)}`] = [...st].sort();
    }
    ancestralStatesBySite[s] = perNode;

    // Change list: representative (first alphabetical) state transition per edge
    const recordChanges = (node: PhyloNode): void => {
      for (const child of node.children) {
        const ps = nodeStates.get(node)!;
        const cs = nodeStates.get(child)!;
        let hasOverlap = false;
        for (const st of cs) if (ps.has(st)) { hasOverlap = true; break; }
        if (!hasOverlap) {
          const from = [...ps].sort()[0];
          const to = [...cs].sort()[0];
          allChanges.push({
            parent: node.name || '(internal)',
            child: child.name || '(internal)',
            site: s, from, to,
          });
        }
        recordChanges(child);
      }
    };
    recordChanges(tree);
  }

  return {
    treeLength: siteScores.reduce((a, b) => a + b, 0),
    siteScores,
    nTaxa: taxonNames.length,
    ancestralStates: ancestralStatesBySite,
    changes: allChanges,
  };
}

/**
 * Phylogenetic Independent Contrasts (PIC) — replaces statistics/pcm.py.
 */
export interface PICResult {
  contrasts: number[];
  standardErrors: number[];
  nContrasts: number;
  /** Node-name pairs contributing each contrast (pic.py contrast_pairs). */
  contrastPairs: { nodeA: string; nodeB: string }[];
  /** Root variance estimate (cumulative variance at the root). */
  rootVariance: number;
  /** Reconstructed trait at every named internal node (pic.py ancestral states). */
  nodeValues: Record<string, number>;
}

export function pic(
  root: PhyloNode,
  traitValues: Record<string, number>,
  rootVariance: number = 0.0,
): PICResult {
  const contrasts: number[] = [], seList: number[] = [];
  const contrastPairs: { nodeA: string; nodeB: string }[] = [];
  const nodeValues: Record<string, number> = {};

  // Felsenstein 1985 Phylogenetic Independent Contrasts (PIC)
  // Properly handles both binary and multifurcating (polytomy) nodes
  // via generalized least squares (GLS).

  function compute(node: PhyloNode): { value: number | null; cumVar: number } {
    if (node.isLeaf) {
      const val = traitValues[node.name];
      return { value: (val === undefined || !isFinite(val)) ? null : val, cumVar: 0 };
    }

    const childResults = node.children.map(c => compute(c)).filter(r => r.value !== null);
    if (childResults.length < 2) return { value: childResults[0]?.value ?? null, cumVar: 0 };

    // For each child, cumVar = variance from root to child tip (sum of branch lengths)
    const vars: number[] = [];
    for (let ci = 0; ci < node.children.length; ci++) {
      const cr = childResults[ci];
      const bl = node.children[ci].branchLength || 0;
      vars.push(cr.cumVar + bl);
    }

    if (node.children.length === 2) {
      // Binary node: Felsenstein 1985 Eq. (1) contrast = (x_a - x_b) / sqrt(v_a + v_b)
      const c1 = childResults[0], c2 = childResults[1];
      const v1 = vars[0], v2 = vars[1];
      const contrast = (c1.value! - c2.value!) / Math.sqrt(v1 + v2);
      const se = Math.sqrt(v1 + v2);
      contrasts.push(contrast);
      seList.push(se);
      contrastPairs.push({
        nodeA: node.children[0].name || '(internal)',
        nodeB: node.children[1].name || '(internal)',
      });

      // Reconstructed value at node: inverse-variance weighted mean
      const w1 = 1 / Math.max(v1, 1e-10), w2 = 1 / Math.max(v2, 1e-10);
      const recon = (w1 * c1.value! + w2 * c2.value!) / (w1 + w2);
      if (node.name) nodeValues[node.name] = recon;
      // cumVar semantics: variance of this node's RECONSTRUCTED value around
      // its true value, so a parent can add its own branch length to get the
      // child's variance around the parent (a tip therefore has cumVar = 0).
      // The reconstruction is an inverse-variance weighted mean, so its
      // variance is the harmonic form 1/(1/v1 + 1/v2) = v1·v2/(v1+v2) —
      // NOT v1+v2, which is the variance of the CONTRAST and inflates the
      // standard error of every higher-level contrast (by up to √2 per level).
      const nodeVar = (v1 * v2) / Math.max(v1 + v2, 1e-10);
      return { value: recon, cumVar: nodeVar };
    } else {
      // Polytomy: produce (k-1) independent contrasts via GLS
      // V = diag(v_1, ..., v_k) since independent tips under Brownian motion
      // C = (X'V^{-1}X)^{-1} X'V^{-1} t gives node value
      // contrasts are t_i - sum_j(C_j * t_j) standardized by sqrt(v_i * (1 - sum_j(C_j^2 * v_j)))
      // Simplified approach: treat polytomy as series of binary contrasts
      // using Helmert contrasts (Felsenstein 1985 Appendix)
      const k = node.children.length;
      // For k-way node, produce (k-1) orthogonal contrasts
      // Helmert matrix: each contrast is difference between one child and mean of remaining
      for (let ci = 0; ci < k - 1; ci++) {
        // Contrast: child_ci vs inverse-variance weighted mean of children ci+1..k-1
        const w_ci = 1 / Math.max(vars[ci], 1e-10);
        let w_others = 0, val_others = 0;
        for (let cj = ci + 1; cj < k; cj++) {
          w_others += 1 / Math.max(vars[cj], 1e-10);
          val_others += childResults[cj].value! / Math.max(vars[cj], 1e-10);
        }
        const mean_others = val_others / w_others; // inverse-variance weighted mean
        // Variance of the Helmert contrast = v_ci + v_others, where v_others is
        // the variance of the weighted mean of the remaining children.
        const v_others = 1 / Math.max(w_others, 1e-10);
        const v_contrast = vars[ci] + v_others;
        const contrast = (childResults[ci].value! - mean_others) / Math.sqrt(v_contrast);
        const se = Math.sqrt(v_contrast);
        contrasts.push(contrast);
        seList.push(se);
      }

      // Node reconstruction: weighted mean of all children
      let wSum = 0, wValSum = 0;
      for (let ci = 0; ci < k; ci++) {
        const w = 1 / Math.max(vars[ci], 1e-10);
        wSum += w;
        wValSum += w * childResults[ci].value!;
      }
      const recon = wValSum / wSum;
      if (node.name) nodeValues[node.name] = recon;
      // cumVar at node: variance of the inverse-variance weighted mean, i.e.
      // the harmonic combination 1/Σ(1/v_i) — NOT Σv_i (see the binary branch).
      return { value: recon, cumVar: 1 / Math.max(wSum, 1e-10) };
    }
  }

  const rootResult = compute(root);
  return {
    contrasts,
    standardErrors: seList,
    nContrasts: contrasts.length,
    contrastPairs,
    rootVariance: rootResult.cumVar + rootVariance,
    nodeValues,
  };
}

/**
 * PIC with ancestral states in one call (pic.py compute_pic_with_ancestral_states).
 */
export function computePICWithAncestralStates(
  tree: PhyloNode,
  traitValues: Record<string, number>,
): { contrasts: number[]; standardErrors: number[]; nodeValues: Record<string, number> } {
  const r = pic(tree, traitValues);
  return { contrasts: r.contrasts, standardErrors: r.standardErrors, nodeValues: r.nodeValues };
}

/**
 * Validate the assumptions PIC makes about the input tree
 * (pic.py validate_pic_assumptions): rootedness, positive branch lengths,
 * polytomies, and trait coverage. Returns a list of human-readable warnings.
 */
export function validatePICAssumptions(
  tree: PhyloNode,
  traitValues: Record<string, number>,
): { ok: boolean; warnings: string[]; nPolytomies: number; unrooted: boolean; zeroBranchLengths: number } {
  const warnings: string[] = [];
  const nodes = tree.getAllNodes();

  if (tree.children.length < 2) {
    warnings.push('Tree appears unrooted or is a single node; PIC requires a rooted tree.');
  }
  const polytomies = nodes.filter(n => !n.isLeaf && n.children.length > 2).length;
  if (polytomies > 0) {
    warnings.push(`${polytomies} polytomy node(s) found; contrasts at these nodes are approximated (Helmert decomposition).`);
  }
  const zeroBL = nodes.filter(n => n !== tree && (n.branchLength ?? 0) <= 0).length;
  if (zeroBL > 0) {
    warnings.push(`${zeroBL} branch(es) with zero or negative length; zero-length branches inflate contrast variance (guarded at 1e-10).`);
  }
  const tips = tree.getLeaves();
  const missing = tips.filter(t => traitValues[t.name] === undefined || !isFinite(traitValues[t.name]));
  if (missing.length > 0) {
    warnings.push(`${missing.length} tip(s) missing trait values: ${missing.slice(0, 5).map(t => t.name).join(', ')}${missing.length > 5 ? '…' : ''}`);
  }
  return { ok: warnings.length === 0, warnings, nPolytomies: polytomies, unrooted: tree.children.length < 2, zeroBranchLengths: zeroBL };
}

// ═══════════════════════════════════════════════════════════════════
// Heuristic Tree Search (NNI/SPR)
// ═══════════════════════════════════════════════════════════════════

export interface SearchResult {
  bestTree: PhyloNode;
  bestScore: number;
  nTreesSearched: number;
  nRearrangements: number;
}

/**
 * Heuristic parsimony tree search (NNI + SPR) from random starting trees.
 *
 * @param rngSeed seed for the search's PRNG. The starting trees and every
 *   rearrangement are drawn from the repo's seeded generator, so a run is
 *   reproducible across sessions; it used to call Math.random() directly, which
 *   made the reported best tree impossible to reproduce (and therefore to
 *   publish). Default 42 matches the convention used elsewhere in this repo
 *   (e.g. coverageRarefaction).
 */
export function heuristicSearch(
  sequences: Record<string, string>,
  nReplicates: number = 10,
  maxRearrangements: number = 1000,
  rngSeed: number = 42,
): SearchResult {
  seedRng(rngSeed);
  const taxa = Object.keys(sequences);

  let bestTree: PhyloNode | null = null;
  let bestScore = Infinity;
  let totalTrees = 0;
  let totalRearr = 0;

  for (let rep = 0; rep < nReplicates; rep++) {
    // Build random starting tree
    let tree = buildRandomTree(taxa);
    let result = fitchParsimony(tree, sequences);
    let currentScore = result.treeLength;

    for (let rearr = 0; rearr < maxRearrangements; rearr++) {
      // NNI (Nearest Neighbor Interchange): Felsenstein / Swofford algorithm
      // For each internal edge, try both possible NNI moves and keep the best
      const internalEdges = getAllInternalEdges(tree);
      if (internalEdges.length === 0) break;

      let improved = false;
      for (const edge of internalEdges) {
        // edge = { parent, child } where child is an internal node
        const parent = edge.parent;
        if (parent.children.length !== 2) continue; // NNI only defined for binary nodes

        const [childA, childB] = parent.children;
        const siblingOfParent = parent.parent;

        if (!siblingOfParent) continue; // root has no sibling, skip

        // The two possible NNI rearrangements:
        // Current: sibling is attached to parent alongside childA
        // NNI-1: swap childA with sibling
        // NNI-2: swap childB with sibling

        for (let nniOpt = 0; nniOpt < 2; nniOpt++) {
          // Save current state for revert
          const siblingIdx = siblingOfParent.children.indexOf(parent);
          const parentIdx = parent.children.indexOf(childA);

          // Detach parent from sibling
          siblingOfParent.removeChild(parent);

          // For NNI option 1: childA becomes sibling's child, sibling becomes parent's child
          // For NNI option 2: childB becomes sibling's child, sibling becomes parent's child
          const detachChild = nniOpt === 0 ? childA : childB;

          parent.removeChild(detachChild);
          siblingOfParent.addChild(detachChild);
          parent.addChild(siblingOfParent);

          const newResult = fitchParsimony(tree, sequences);
          totalTrees++;
          totalRearr++;

          if (newResult.treeLength < currentScore) {
            currentScore = newResult.treeLength;
            improved = true;
            break; // accepted, try next edge
          } else {
            // Revert NNI
            siblingOfParent.removeChild(detachChild);
            parent.removeChild(siblingOfParent);
            siblingOfParent.addChild(parent);
            parent.addChild(detachChild);
          }
        }
        if (improved) break;
      }

      if (!improved) {
        // No improvement found in this pass, try random SPR as enhancement
        const improvedSPR = trySPR(tree, sequences);
        if (improvedSPR.newScore < currentScore) {
          currentScore = improvedSPR.newScore;
          tree = improvedSPR.newTree;
          totalTrees++;
          totalRearr++;
        } else {
          break; // no improvement possible, stop early
        }
      }
    }

    if (currentScore < bestScore) {
      bestScore = currentScore;
      bestTree = tree;
    }
  }

  return { bestTree: bestTree!, bestScore, nTreesSearched: totalTrees, nRearrangements: totalRearr };
}

/** SPR (Subtree Pruning and Regrafting) - enhancement to NNI search.
 *  Reference: phangorn::pratchet / phytools::spr切片 */
function trySPR(tree: PhyloNode, sequences: Record<string, string>): { newTree: PhyloNode; newScore: number } {
  const internals = getAllInternalNodes(tree);
  if (internals.length === 0) return { newTree: tree, newScore: Infinity };

  // Pick a random internal node to prune
  const pruneNode = internals[randint(0, internals.length - 1)];
  if (pruneNode.parent === null) return { newTree: tree, newScore: Infinity };

  const parent = pruneNode.parent;
  const sibling = parent.children.find(c => c !== pruneNode)!;

  // Remove pruneNode from parent
  parent.removeChild(pruneNode);

  // Find all possible regraft locations (any internal node except pruneNode's descendants)
  const allNodes = tree.getAllNodes().filter(n => n !== pruneNode && !isDescendantOf(pruneNode, n));
  if (allNodes.length === 0) {
    parent.addChild(pruneNode);
    return { newTree: tree, newScore: Infinity };
  }

  // Pick random regraft location
  const regraftNode = allNodes[randint(0, allNodes.length - 1)];

  // For binary nodes, regraft as a new child; for polytomies, add to children
  pruneNode.branchLength = (regraftNode.branchLength || 0) * 0.5;
  if (regraftNode.children.length === 0) {
    regraftNode.addChild(pruneNode);
  } else if (regraftNode.children.length === 2) {
    // Split the edge by creating a new intermediate node
    const newParent = new PhyloNode('', (regraftNode.branchLength || 0) * 0.5, false);
    regraftNode.branchLength = (regraftNode.branchLength || 0) * 0.5;
    newParent.addChild(regraftNode);
    newParent.addChild(pruneNode);
    if (regraftNode.parent) {
      const idx = regraftNode.parent.children.indexOf(regraftNode);
      regraftNode.parent.children[idx] = newParent;
      newParent.parent = regraftNode.parent;
    }
  } else {
    regraftNode.addChild(pruneNode);
  }

  const newScore = fitchParsimony(tree, sequences).treeLength;
  return { newTree: tree, newScore };
}

function buildRandomTree(taxa: string[]): PhyloNode {
  // Build a random binary tree via sequential insertion
  const nodes = taxa.map(t => new PhyloNode(t, 0, true));
  while (nodes.length > 1) {
    const i = randint(0, nodes.length - 1);
    const node1 = nodes.splice(i, 1)[0];
    const j = randint(0, nodes.length - 1);
    const node2 = nodes.splice(j, 1)[0];
    const parent = new PhyloNode('', rand() * 0.5 + 0.1, false);
    node1.branchLength = rand() * 0.5 + 0.1;
    node2.branchLength = rand() * 0.5 + 0.1;
    parent.addChild(node1);
    parent.addChild(node2);
    nodes.push(parent);
  }
  return nodes[0];
}

function getAllInternalNodes(node: PhyloNode): PhyloNode[] {
  const result: PhyloNode[] = [];
  if (!node.isLeaf && node.children.length >= 2) result.push(node);
  for (const c of node.children) result.push(...getAllInternalNodes(c));
  return result;
}

/** Get all internal edges (parent-child pairs where parent is internal). Used by NNI. */
function getAllInternalEdges(node: PhyloNode): { parent: PhyloNode; child: PhyloNode }[] {
  const edges: { parent: PhyloNode; child: PhyloNode }[] = [];
  if (node.isLeaf) return edges;
  for (const child of node.children) {
    if (!child.isLeaf) {
      edges.push({ parent: node, child });
      edges.push(...getAllInternalEdges(child));
    }
  }
  return edges;
}

// ═══════════════════════════════════════════════════════════════════
// Strict Consensus
// ═══════════════════════════════════════════════════════════════════

export function strictConsensus(trees: PhyloNode[]): PhyloNode {
  if (trees.length === 0) throw new Error('No trees provided');
  if (trees.length === 1) return trees[0].clone();

  // Get all leaves from first tree
  const firstTreeLeaves = trees[0].getLeaves();
  const leafNames = firstTreeLeaves.map(l => l.name).sort();

  // Get all bipartitions from each tree
  const allBipartitions: Set<string>[] = [];
  for (const tree of trees) {
    allBipartitions.push(getBipartitions(tree));
  }

  // Keep only bipartitions present in ALL trees (strict consensus)
  const common: string[] = [];
  for (const bip of allBipartitions[0]) {
    let inAll = true;
    for (let i = 1; i < allBipartitions.length; i++) {
      if (!allBipartitions[i].has(bip)) { inAll = false; break; }
    }
    if (inAll) common.push(bip);
  }

  // Build consensus tree from common bipartitions
  // Create leaf nodes for all taxa
  const leafNodes: Map<string, PhyloNode> = new Map();
  for (const name of leafNames) {
    leafNodes.set(name, new PhyloNode(name, 0, true));
  }

  // If no common bipartitions, return star tree
  if (common.length === 0) {
    const root = new PhyloNode('', 0, false);
    for (const leaf of leafNodes.values()) {
      root.addChild(leaf);
    }
    return root;
  }

  // Parse bipartitions to build tree structure
  // Each bipartition splits leaves into two groups
  const groupA: Set<string>[] = [];
  for (const bip of common) {
    const sides = bip.split('|');
    const sideA = new Set(sides[0].split(','));
    groupA.push(sideA);
  }

  // Build tree by iteratively grouping
  let currentGroups: Set<string>[] = [new Set(leafNames)];
  let nodes: Map<string, PhyloNode> = new Map(leafNodes);

  for (const group of groupA.reverse()) {
    // Find if this group is a subset of any current group
    for (let i = 0; i < currentGroups.length; i++) {
      const superSet = currentGroups[i];
      let isSubset = true;
      for (const elem of group) {
        if (!superSet.has(elem)) { isSubset = false; break; }
      }
      if (isSubset && group.size < superSet.size) {
        // Create internal node for this group
        const internalNode = new PhyloNode('', 0, false);
        for (const name of group) {
          const node = nodes.get(name);
          if (node) internalNode.addChild(node);
        }
        // Replace superSet with two subgroups
        const remaining = new Set<string>();
        for (const name of superSet) {
          if (!group.has(name)) remaining.add(name);
        }
        currentGroups.splice(i, 1, remaining, group);
        for (const name of group) nodes.set(name, internalNode);
        break;
      }
    }
  }

  // Build final tree from remaining groups
  const root = new PhyloNode('', 0, false);
  for (const node of nodes.values()) {
    if (node.parent === undefined || node.parent === null) {
      root.addChild(node);
    }
  }

  return root;
}

function getBipartitions(tree: PhyloNode): Set<string> {
  const leaves = tree.getLeaves();
  const leafNames = new Set(leaves.map(l => l.name));
  const bipartitions = new Set<string>();

  function traverse(node: PhyloNode): Set<string> {
    if (node.isLeaf) return new Set([node.name]);
    const descendantLeaves = new Set<string>();
    for (const child of node.children) {
      const childLeaves = traverse(child);
      for (const l of childLeaves) descendantLeaves.add(l);
    }
    // Create bipartition: {descendants} vs {all - descendants}
    // Fixed: check if this is the root node (has no parent), skip root from bipartitions
    if (node.parent !== undefined && node.parent !== null) {
      const sideA = [...descendantLeaves].sort().join(',');
      const sideB = [...leafNames].filter(l => !descendantLeaves.has(l)).sort().join(',');
      bipartitions.add([sideA, sideB].sort().join('|'));
    }
    return descendantLeaves;
  }

  traverse(tree);
  return bipartitions;
}

// ═══════════════════════════════════════════════════════════════════
// Distance-based Tree Building (NJ/UPGMA)
// ═══════════════════════════════════════════════════════════════════

export function neighborJoining(distMatrix: number[][], taxonNames: string[]): PhyloNode {
  const n = distMatrix.length;
  const D = distMatrix.map(row => [...row]);
  const nodes: PhyloNode[] = taxonNames.map(name => new PhyloNode(name, 0, true));
  const active = Array.from({ length: n }, (_, i) => i);

  while (active.length > 3) {
    const m = active.length;
    // Compute Q matrix
    const rowSums: number[] = [];
    for (const i of active) { let s = 0; for (const j of active) s += D[i][j]; rowSums.push(s); }

    let minQ = Infinity, mini = 0, minj = 1;
    for (let ai = 0; ai < m; ai++) for (let aj = ai + 1; aj < m; aj++) {
      const i = active[ai], j = active[aj];
      const Q = (m - 2) * D[i][j] - rowSums[ai] - rowSums[aj];
      if (Q < minQ) { minQ = Q; mini = ai; minj = aj; }
    }

    const i = active[mini], j = active[minj];
    const di = (D[i][j] + (rowSums[mini] - rowSums[minj]) / (m - 2)) / 2;
    const dj = D[i][j] - di;

    const newNode = new PhyloNode('', 0, false);
    nodes[i].branchLength = Math.max(0, di);
    nodes[j].branchLength = Math.max(0, dj);
    newNode.addChild(nodes[i]);
    newNode.addChild(nodes[j]);
    nodes[i] = newNode;

    // Save minj index before splice
    const minIdx = minj;

    // Update distance matrix
    for (const k of active) {
      if (k === i || k === j) continue;
      const newDist = (D[i][k] + D[j][k] - D[i][j]) / 2;
      D[i][k] = D[k][i] = newDist;
    }

    active.splice(minIdx, 1);
  }

  // Final step: when 3 taxa remain, NJ attaches all three to a trifurcating
  // root with the standard NJ branch lengths (distance_methods.py);
  // when 2 remain, they join through a binary root.
  if (active.length === 3) {
    const [a, b, c] = active;
    const dab = D[a][b], dac = D[a][c], dbc = D[b][c];
    const root = new PhyloNode('', 0, false);
    const la = Math.max(0, (dab + dac - dbc) / 2);
    const lb = Math.max(0, (dab + dbc - dac) / 2);
    const lc = Math.max(0, (dac + dbc - dab) / 2);
    nodes[a].branchLength = la;
    nodes[b].branchLength = lb;
    nodes[c].branchLength = lc;
    root.addChild(nodes[a]);
    root.addChild(nodes[b]);
    root.addChild(nodes[c]);
    return root;
  }

  // Connect last two
  const last1 = active[0], last2 = active[1];
  const root = new PhyloNode('', 0, false);
  nodes[last1].branchLength = Math.max(0, D[last1][last2] / 2);
  nodes[last2].branchLength = Math.max(0, D[last1][last2] / 2);
  root.addChild(nodes[last1]);
  root.addChild(nodes[last2]);

  return root;
}

// ═══════════════════════════════════════════════════════════════════
// UPGMA (Unweighted Pair Group Method with Arithmetic Mean)
// ═══════════════════════════════════════════════════════════════════

export function buildUPGMA(distMatrix: number[][], taxonNames: string[]): PhyloNode {
  const n = distMatrix.length;
  const D = distMatrix.map(row => [...row]);
  const nodes: PhyloNode[] = taxonNames.map(name => new PhyloNode(name, 0, true));
  const sizes: number[] = new Array(n).fill(1);
  const active = Array.from({ length: n }, (_, i) => i);
  let nextId = n;

  while (active.length > 1) {
    // Find closest pair
    let minDist = Infinity, mi = 0, mj = 1;
    for (let ai = 0; ai < active.length; ai++) {
      for (let aj = ai + 1; aj < active.length; aj++) {
        if (D[active[ai]][active[aj]] < minDist) { minDist = D[active[ai]][active[aj]]; mi = ai; mj = aj; }
      }
    }

    const i = active[mi], j = active[mj];
    const height = minDist / 2;
    const bl_i = height - getUPGMAHeight(nodes[i]);
    const bl_j = height - getUPGMAHeight(nodes[j]);

    const newNode = new PhyloNode('', 0, false);
    nodes[i].branchLength = Math.max(0, bl_i);
    nodes[j].branchLength = Math.max(0, bl_j);
    newNode.addChild(nodes[i]);
    newNode.addChild(nodes[j]);

    // Update distance matrix (weighted average)
    const newSize = sizes[i] + sizes[j];
    nodes[nextId] = newNode;
    sizes[nextId] = newSize;

    // Fixed: properly expand D matrix if needed
    while (D.length < nextId + 1) {
      D.push(new Array(D.length + 1).fill(0));
    }
    for (let k = 0; k < D.length; k++) {
      if (k === i || k === j) continue;
      const newDist = (D[i][k] * sizes[i] + D[j][k] * sizes[j]) / newSize;
      D[nextId][k] = D[k][nextId] = newDist;
    }

    // Fixed: rebuild active array properly after splice
    const newActive: number[] = [];
    for (const idx of active) {
      if (idx === i || idx === j) continue;
      newActive.push(idx);
    }
    newActive.push(nextId);
    active.length = 0;
    active.push(...newActive);
    nextId++;
  }

  return nodes[active[0]];
}

function getUPGMAHeight(node: PhyloNode): number {
  if (node.isLeaf) return 0;
  // Fixed: average heights of all children, not just the first
  let totalHeight = 0;
  for (const child of node.children) {
    totalHeight += getUPGMAHeight(child) + (child.branchLength || 0);
  }
  return totalHeight / node.children.length;
}

// ═══════════════════════════════════════════════════════════════════
// Pagel's λ — phylogenetic signal (Pagel 1999)
// References: Pagel, M. (1999). Inferring the historical patterns of
//   biological evolution. Nature 401: 877–884.
//   See also: phytools::phylosig
// ═══════════════════════════════════════════════════════════════════

export interface PagelLambdaResult {
  /** ML estimate of λ (0 = no signal, 1 = Brownian motion) */
  lambda: number;
  /** Log-likelihood at ML λ */
  logLik: number;
  /** Log-likelihood at λ = 0 (no phylogenetic signal) */
  logLik0: number;
  /** Log-likelihood at λ = 1 (Brownian motion) */
  logLik1: number;
  /** LRT statistic vs λ = 0 */
  LRT0: number;
  /** p-value for λ = 0 (is there phylogenetic signal?) */
  pValue0: number;
  /** LRT statistic vs λ = 1 */
  LRT1: number;
  /** p-value for λ = 1 (is λ < 1?) */
  pValue1: number;
}

/**
 * Compute the phylogenetic variance-covariance matrix (VCV) from a tree in
 * the standard ape/_core/vcv.py convention:
 *   V[i,i] = root→tip distance (tip variance)
 *   V[i,j] = root→LCA(i,j) distance (shared covariance)
 * (The previous implementation produced V[i,i] = 0, collapsing the
 * covariance matrix toward singularity and biasing Pagel-λ estimates.)
 */
function buildVCV(tree: PhyloNode): { V: number[][]; tipNames: string[] } {
  const tips = tree.getLeaves();
  const tipNames = tips.map(t => t.name);
  const n = tips.length;
  const V: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    V[i][i] = tips[i].distanceToAncestor(tree);
    for (let j = i + 1; j < n; j++) {
      const lca = tips[i].computeLCA(tips[j]);
      const shared = lca ? tips[i].distanceToAncestor(lca) : 0;
      V[i][j] = V[j][i] = shared;
    }
  }
  return { V, tipNames };
}

/**
 * Multivariate normal density at x given mean=0 and covariance V.
 */
function mvnormLogDensity(x: number[], V: number[][]): number {
  const n = x.length;
  // log p(x|V) = -0.5 * (x^T V^-1 x + log|V| + n*log(2π))
  // Using Cholesky: V = L L^T, solve L y = x => y = L^-1 x, then y^T y = x^T V^-1 x
  const L: number[][] = Array.from({ length: n }, (_, i) => new Array(n).fill(0));
  // Cholesky decomposition
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = V[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return -Infinity;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  // Solve L y = x via forward substitution
  const y: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < i; j++) s += L[i][j] * y[j];
    y[i] = (x[i] - s) / L[i][i];
  }
  // quad = y^T y = x^T V^-1 x
  let quad = 0;
  for (let i = 0; i < n; i++) quad += y[i] * y[i];
  // log |V| = 2 * sum log L[i,i]
  let logDet = 0;
  for (let i = 0; i < n; i++) logDet += Math.log(L[i][i]);
  logDet *= 2;
  return -0.5 * (quad + logDet + n * Math.log(2 * Math.PI));
}

/**
 * Log-likelihood of trait data under Pagel's λ model.
 * Transforms tree VCV by scaling off-diagonal elements by λ (intra-node paths).
 * For λ=0: VCV becomes diag(X), giving logLik0.
 * For λ=1: VCV becomes standard Brownian-motion VCV.
 * For 0<λ<1: intermediate.
 *
 * @param lambda  Scaling factor for shared branch lengths
 * @param V       Original VCV matrix
 * @param traits  Trait values indexed to match VCV tip order
 */
function pagelLogLik(lambda: number, V: number[][], traits: number[]): number {
  if (lambda < 0) return -Infinity;
  const n = V.length;
  // Scale off-diagonal elements (shared path lengths)
  const Vscaled: number[][] = Array.from({ length: n }, (_, i) =>
    new Array(n).fill(0).map((_, j) =>
      i === j ? V[i][j] : lambda * V[i][j]
    )
  );
  // Add small diagonal jitter for numerical stability
  const jitter = 1e-8;
  for (let i = 0; i < n; i++) Vscaled[i][i] += jitter;
  return mvnormLogDensity(traits, Vscaled);
}

export function pagelLambda(
  tree: PhyloNode,
  traitData: Record<string, number>,
  options?: { gridStep?: number; optimMethod?: 'grid' | 'hybrid' }
): PagelLambdaResult {
  const { V, tipNames } = buildVCV(tree);
  const traits = tipNames.map(name => traitData[name] ?? 0);
  const n = tipNames.length;

  // Grid search: 0 to 1 with step 0.01
  const step = options?.gridStep ?? 0.01;
  let bestLambda = 0, bestLogLik = -Infinity;

  for (let lam = 0; lam <= 1 + step / 2; lam += step) {
    const ll = pagelLogLik(lam, V, traits);
    if (ll > bestLogLik) { bestLogLik = ll; bestLambda = lam; }
  }

  // Golden-section refinement around best grid point
  const phi = (1 + Math.sqrt(5)) / 2;
  let a = Math.max(0, bestLambda - step * phi);
  let b = Math.min(1, bestLambda + step * phi);
  for (let i = 0; i < 20; i++) {
    const x1 = b - (b - a) / phi;
    const x2 = a + (b - a) / phi;
    const f1 = pagelLogLik(x1, V, traits);
    const f2 = pagelLogLik(x2, V, traits);
    if (f1 > f2) { bestLambda = x1; bestLogLik = f1; b = x2; }
    else { bestLambda = x2; bestLogLik = f2; a = x1; }
  }

  const logLik0 = pagelLogLik(0, V, traits);
  const logLik1 = pagelLogLik(1, V, traits);

  // LRT: 2*(logLik - logLik0) ~ chi2(1) for λ=0
  const LRT0 = 2 * Math.max(0, bestLogLik - logLik0);
  const LRT1 = 2 * (logLik1 - bestLogLik);

  return {
    lambda: bestLambda,
    logLik: bestLogLik,
    logLik0,
    logLik1,
    LRT0,
    // λ=0 lies on the parameter boundary: p follows the 0.5·χ²₁ mixture
    // (Self & Liang 1987, boundary correction as in signal.py)
    pValue0: 0.5 * chi2PValue(LRT0, 1),
    LRT1,
    pValue1: chi2PValue(LRT1, 1),
  };
}

/** Approximate chi2 p-value using Wilson-Hilferty transformation. */
function chi2PValue(x: number, df: number): number {
  if (x <= 0) return 1;
  const z = (Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 2 * (1 - normCDF_pagel(Math.abs(z)));
}

function normCDF_pagel(z: number): number {
  return 0.5 * (1 + erf_pagel(z / Math.SQRT2));
}

function erf_pagel(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  return sign * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

// ═══════════════════════════════════════════════════════════════════
// Majority Rule Consensus
// ═══════════════════════════════════════════════════════════════════

export function majorityRuleConsensus(trees: PhyloNode[], threshold: number = 0.5): PhyloNode {
  if (trees.length === 0) throw new Error('No trees');
  if (trees.length === 1) return trees[0].clone();

  const nTrees = trees.length;
  const allLeaves = trees[0].getLeaves().map(l => l.name);

  // Count bipartitions across all trees
  const bipCounts = new Map<string, number>();

  for (const tree of trees) {
    const bips = getBipartitionsMR(tree, new Set(allLeaves));
    for (const bip of bips) {
      bipCounts.set(bip, (bipCounts.get(bip) || 0) + 1);
    }
  }

  // Keep bipartitions above threshold
  const keptBips: { bip: string; freq: number }[] = [];
  for (const [bip, count] of bipCounts) {
    const freq = count / nTrees;
    if (freq >= threshold) keptBips.push({ bip, freq });
  }

  // Build leaf nodes for all taxa
  const leafNodes: Map<string, PhyloNode> = new Map();
  for (const name of allLeaves) {
    leafNodes.set(name, new PhyloNode(name, 0, true));
  }

  // Build consensus tree from kept bipartitions using a Union-Find approach
  const parent = new Map<string, string | null>();
  for (const name of allLeaves) parent.set(name, null);

  // Track internal nodes by their leaf-set key (sorted comma-joined names)
  // This replaces dead code that tried to find internal nodes by .name (which is always '')
  const internalNodeMap = new Map<string, PhyloNode>();

  // Sort bipartitions by frequency (highest first) for stable tree building
  keptBips.sort((a, b) => b.freq - a.freq);

  for (const { bip } of keptBips) {
    const sides = bip.split('|');
    const groupA = new Set(sides[0].split(',').filter(s => s.length > 0));
    const groupB = new Set(sides[1].split(',').filter(s => s.length > 0));

    // Find representatives for each group (may be leaf or internal node)
    const findRep = (name: string): string => {
      const p = parent.get(name);
      if (p === null || p === undefined) return name;
      const root = findRep(p);
      parent.set(name, root);
      return root;
    };

    // Get all members of each group as flat arrays
    const groupAMembers = [...groupA];
    const groupBMembers = [...groupB];

    if (groupAMembers.length === 0 || groupBMembers.length === 0) continue;

    // Check if groups are already connected via parent pointers
    const repA = findRep(groupAMembers[0]);
    const repB = findRep(groupBMembers[0]);

    if (repA !== repB) {
      // Groups are in different components, create a new internal node joining them
      const newNode = new PhyloNode('', 0, false);
      newNode.support = keptBips.find(kb => kb.bip === bip)?.freq ?? threshold;

      // Key for this internal node: sorted union of both groups
      const allMembers = [...groupA, ...groupB].sort().join(',');
      internalNodeMap.set(allMembers, newNode);

      // Add all members of groupA
      for (const name of groupAMembers) {
        const node = leafNodes.get(name);
        if (node) newNode.addChild(node);
        else {
          // name might be an internal node identifier, find corresponding internal node
          // Look up by leaf-set key
          const internal = internalNodeMap.get(name);
          if (internal) newNode.addChild(internal);
        }
        parent.set(name, allMembers); // union-find: point to the new internal node's key
      }

      // Add all members of groupB
      for (const name of groupBMembers) {
        const node = leafNodes.get(name);
        if (node) newNode.addChild(node);
        else {
          const internal = internalNodeMap.get(name);
          if (internal) newNode.addChild(internal);
        }
        parent.set(name, allMembers);
      }
    }
  }

  // Build the root node from all top-level components
  const root = new PhyloNode('', 0, false);

  // Collect all nodes that have no parent (top-level)
  const hasParent = new Set<string>();
  for (const name of parent.keys()) {
    const p = parent.get(name);
    if (p !== null && p !== undefined && p !== name) {
      hasParent.add(name);
    }
  }

  // Find all roots (nodes that are not a child of any other node)
  for (const name of allLeaves) {
    if (!hasParent.has(name)) {
      const node = leafNodes.get(name);
      if (node) root.addChild(node);
    }
  }

  // Add any internal nodes that weren't attached as children
  for (const internal of internalNodeMap.values()) {
    if (internal.parent === null || internal.parent === undefined) {
      // Check if this internal node is already a descendant of root
      let isDescendant = false;
      for (const child of root.children) {
        if (isDescendantOf(child, internal)) {
          isDescendant = true;
          break;
        }
      }
      if (!isDescendant && internal.children.length > 0) {
        root.addChild(internal);
      }
    }
  }

  // If root has no children, build a star tree from all leaves
  if (root.children.length === 0) {
    for (const name of allLeaves) {
      const node = leafNodes.get(name);
      if (node) root.addChild(node);
    }
  }

  return root;
}

function isDescendantOf(node: PhyloNode, potentialAncestor: PhyloNode): boolean {
  if (node === potentialAncestor) return true;
  for (const child of node.children) {
    if (isDescendantOf(child, potentialAncestor)) return true;
  }
  return false;
}

function getBipartitionsMR(tree: PhyloNode, allLeaves: Set<string>): Set<string> {
  const bips = new Set<string>();

  function traverse(node: PhyloNode): Set<string> {
    if (node.isLeaf) return new Set([node.name]);
    const descendantLeaves = new Set<string>();
    for (const child of node.children) {
      const childLeaves = traverse(child);
      for (const l of childLeaves) descendantLeaves.add(l);
    }
    if (descendantLeaves.size > 0 && descendantLeaves.size < allLeaves.size) {
      const sideA = [...descendantLeaves].sort().join(',');
      const sideB = [...allLeaves].filter(l => !descendantLeaves.has(l)).sort().join(',');
      bips.add([sideA, sideB].sort().join('|'));
    }
    return descendantLeaves;
  }

  traverse(tree);
  return bips;
}

// ═══════════════════════════════════════════════════════════════════
// Splits, Robinson-Foulds distance, and multi-tree parsimony search
// (ported from strict_consensus.py Split and fitch.py)
// ═══════════════════════════════════════════════════════════════════

/** A binary split (bipartition) of the taxon set — strict_consensus.py Split. */
export class Split {
  /** One side of the split (the smaller side, canonically). */
  readonly side: Set<string>;
  /** All taxa, used to derive the complementary side. */
  readonly allTaxa: Set<string>;

  constructor(side: Iterable<string>, allTaxa: Iterable<string>) {
    this.side = new Set(side);
    this.allTaxa = new Set(allTaxa);
  }

  get complementary(): Set<string> {
    const comp = new Set<string>();
    for (const t of this.allTaxa) if (!this.side.has(t)) comp.add(t);
    return comp;
  }

  /** Trivial splits isolate a single taxon (uninformative). */
  get isTrivial(): boolean {
    return this.side.size <= 1 || this.complementary.size <= 1;
  }

  /**
   * Four-intersection compatibility test: splits A|A' and B|B' are compatible
   * iff at least one of A∩B, A∩B', A'∩B, A'∩B' is empty.
   */
  isCompatibleWith(other: Split): boolean {
    const a = this.side, ap = this.complementary;
    const b = other.side, bp = other.complementary;
    const interEmpty = (x: Set<string>, y: Set<string>): boolean => {
      for (const t of x) if (y.has(t)) return false;
      return true;
    };
    return interEmpty(a, b) || interEmpty(a, bp) || interEmpty(ap, b) || interEmpty(ap, bp);
  }
}

/**
 * Robinson-Foulds distance between two trees over their common leaf set
 * (fitch.py compute_distance_from_parsimony / RF metric): the count of
 * non-trivial splits present in exactly one of the two trees.
 * Normalized option divides by 2(n-3) (the maximum for n taxa).
 */
export function computeRFDistance(
  tree1: PhyloNode,
  tree2: PhyloNode,
  normalized: boolean = false,
): { rfDistance: number; normalized: number | null; nSharedTaxa: number } {
  const leaves1 = new Set(tree1.leafNames());
  const leaves2 = new Set(tree2.leafNames());
  const shared = new Set<string>();
  for (const t of leaves1) if (leaves2.has(t)) shared.add(t);
  const n = shared.size;
  if (n < 4) return { rfDistance: NaN, normalized: null, nSharedTaxa: n };

  const collectSplits = (tree: PhyloNode): Set<string> => {
    const splits = new Set<string>();
    const walk = (node: PhyloNode): Set<string> => {
      const leaves = new Set<string>();
      if (node.isLeaf) {
        if (shared.has(node.name)) leaves.add(node.name);
        return leaves;
      }
      for (const c of node.children) {
        for (const l of walk(c)) leaves.add(l);
      }
      if (leaves.size > 1 && leaves.size < n - 1) {
        const key = [...leaves].sort().join(',');
        splits.add(key);
      }
      return leaves;
    };
    walk(tree);
    return splits;
  };

  const s1 = collectSplits(tree1);
  const s2 = collectSplits(tree2);
  let only1 = 0;
  for (const s of s1) if (!s2.has(s)) only1++;
  let only2 = 0;
  for (const s of s2) if (!s1.has(s)) only2++;
  const rf = only1 + only2;
  return { rfDistance: rf, normalized: normalized ? rf / (2 * (n - 3)) : null, nSharedTaxa: n };
}

/**
 * Run multiple heuristic-search replicates and return all trees that tie for
 * the best parsimony score (fitch.py find_most_parsimonious_trees).
 */
export function findMostParsimoniousTrees(
  sequences: Record<string, string>,
  nReplicates: number = 10,
  maxRearrangements: number = 1000,
): { trees: PhyloNode[]; bestScore: number } {
  const search = heuristicSearch(sequences, nReplicates, maxRearrangements);
  const trees: PhyloNode[] = [search.bestTree];
  // Single-replicate searches expose only the winner; multi-tree ties require
  // rerunning with more replicates. Kept as a convenience wrapper so callers
  // have the Python-shaped API.
  return { trees, bestScore: search.bestScore };
}
