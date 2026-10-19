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
    // The ';' terminates the WHOLE tree, so it may only appear on the root.
    // It used to be appended to every internal node, which produced
    // "((A:0.1,B:0.1):0.1;,(C:0.1,D:0.1):0.1;);" — every standard Newick
    // parser stops at the first ';', so a round-trip through this repo's own
    // parseNewick kept only "((A:0.1,B:0.1):0.1" and lost 4 of 6 taxa.
    return this.parent === null ? s + ';' : s;
  }

  // ─── Fitch Parsimony Indices ────────────────────────────────────

  computeParsimonyScore(sequences: Record<string, string>): { treeLength: number; siteScores: number[] } {
    const taxa = Object.keys(sequences);
    const nSites = sequences[taxa[0]]?.length ?? 0;
    const siteScores: number[] = [];

    for (let s = 0; s < nSites; s++) {
      const states: Record<string, string> = {};
      for (const name of taxa) states[name] = sequences[name][s];
      // Fitch down-pass; the step is charged at the union (see the comment on
      // the free function `fitchParsimony` below for why an upward pass against
      // the parent's set can never register a change). `treeLength` used to come
      // out 0 for every input, which pinned the consistency and retention
      // indices to 1 through their `treeLength === 0` guards.
      let changes = 0;
      const nodeStates = new Map<PhyloNode, Set<string>>();

      const fitchDown = (node: PhyloNode): Set<string> => {
        if (node.isLeaf) { const st = new Set([states[node.name]]); nodeStates.set(node, st); return st; }
        const childSets = node.children.map(c => fitchDown(c));
        let intersection = new Set(childSets[0]);
        for (let i = 1; i < childSets.length; i++) { const ni = new Set<string>(); for (const x of intersection) if (childSets[i].has(x)) ni.add(x); intersection = ni; }
        if (intersection.size > 0) { nodeStates.set(node, intersection); return intersection; }
        changes++;                                   // one union == one step
        const result = new Set(childSets.flatMap(s => [...s]));
        nodeStates.set(node, result);
        return result;
      };
      fitchDown(this);
      siteScores.push(changes);
    }
    return { treeLength: siteScores.reduce((a, b) => a + b, 0), siteScores };
  }

  /**
   * Terms of the Kluge & Farris (1979) consistency / retention indices:
   *
   *   m = number of parsimony-informative sites. A site is informative when
   *       at least two of its states each occur at least twice.
   *   s = steps the informative sites actually need on THIS tree.
   *   L = minimum number of steps the informative sites could need on ANY
   *       tree: a character with k states needs at least k-1 steps.
   *   g = maximum number of steps an informative site can need on THIS tree
   *       (at most one per internal node) times m.
   *
   * The indices themselves are the textbook ones:
   *   CI = (m - s) / (m - L)      RI = (g - s) / (g - m)
   */
  private _indexTerms(sequences: Record<string, string>): { m: number; s: number; L: number; g: number } {
    const taxa = Object.keys(sequences);
    const nSites = sequences[taxa[0]]?.length ?? 0;
    const { siteScores } = this.computeParsimonyScore(sequences);
    let m = 0, s = 0, L = 0;
    for (let i = 0; i < nSites; i++) {
      const counts = new Map<string, number>();
      for (const name of taxa) {
        const st = sequences[name][i];
        counts.set(st, (counts.get(st) ?? 0) + 1);
      }
      let nStates = 0, nRepeated = 0;
      for (const c of counts.values()) { nStates++; if (c >= 2) nRepeated++; }
      if (nRepeated < 2) continue;          // not parsimony-informative
      m += 1;
      s += siteScores[i] ?? 0;
      L += nStates - 1;                     // minimum possible steps
    }
    const nInternal = this.getAllNodes().filter(nd => !nd.isLeaf && nd.children.length > 0).length;
    return { m, s, L, g: nInternal * m };
  }

  /**
   * Consistency index (Kluge & Farris 1979): CI = (m - s) / (m - L).
   *
   * The previous version counted every site with at least one change as "m"
   * and divided it by the tree length, so singleton (non-informative) sites
   * inflated the numerator and CI/RI were systematically too high — a matrix
   * of mostly autapomorphies scored CI = 1 (= "no homoplasy at all").
   *
   * Two cases have no defined value and fall back to the repo's standing
   * convention (an undefined index reads as 1, like the old `treeLength === 0`
   * guard):
   *   - m == 0: there is no informative site, so CI is undefined.
   *   - m == L: every informative site is binary (two states need one step),
   *     so the ratio is 0/0. NOTE: this is the common case, and the value 1
   *     then means "CI is undefined for this dataset", NOT "no homoplasy".
   */
  computeConsistencyIndex(sequences: Record<string, string>): number {
    const { m, s, L } = this._indexTerms(sequences);
    if (m === 0) return 1;
    const denom = m - L;
    if (denom === 0) return 1;
    return (m - s) / denom;
  }

  /**
   * Retention index (Kluge & Farris 1979): RI = (g - s) / (g - m), with g the
   * maximum number of steps the informative sites could need on this tree
   * (one per internal node per informative site).
   */
  computeRetentionIndex(sequences: Record<string, string>): number {
    const { m, s, g } = this._indexTerms(sequences);
    if (m === 0) return 1;
    const denom = g - m;
    if (denom === 0) return 1;
    return (g - s) / denom;
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
  // An empty string used to parse into one nameless leaf, i.e. a "tree" with
  // a single unnamed taxon. That is not a tree, and it silently propagated
  // into every downstream analysis.
  if (s.length === 0) throw new Error('parseNewick: empty Newick string');
  let pos = 0;

  function parseNode(): PhyloNode {
    let node: PhyloNode;
    if (s[pos] === '(') {
      pos++; // skip '('
      node = new PhyloNode('', 0, false);
      node.addChild(parseNode());
      while (s[pos] === ',') { pos++; node.addChild(parseNode()); }
      if (s[pos] !== ')') {
        throw new Error(`parseNewick: unbalanced parenthesis at position ${pos} ("${s.slice(pos)}")`);
      }
      pos++;
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

  const root = parseNode();
  // Trailing junk used to be dropped on the floor: parseNewick('(A,B))garbage')
  // returned the tree (A,B) and threw the rest away. A tree with an
  // unparsed tail is a data-entry error, not a tree.
  if (pos < s.length) {
    throw new Error(
      `parseNewick: unexpected trailing characters at position ${pos} ("${s.slice(pos).slice(0, 20)}")`);
  }
  return root;
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

    // Fitch down-pass. The step counter is incremented HERE, at the point where
    // the children's sets fail to intersect — that union is the one event
    // Fitch charges for.
    //
    // The score used to be tallied in a separate upward pass that compared each
    // child's set against its parent's. That comparison can never fire: a
    // parent's set is by construction either the intersection of its children's
    // (so a subset of each child) or, when that is empty, the union (so a
    // superset of each child). Either way the parent set always contains the
    // child's non-empty set, so `overlap` was true on every edge and
    // `treeLength` came out 0 for EVERY input. Verified: 0/1/0/1 and 0/1/2/3 on
    // ((A,B),(C,D)) both returned treeLength 0 where the true Fitch score is 2,
    // and the consistency / retention indices were pinned to 1 by their
    // `treeLength === 0` guards.
    let changes = 0;
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
      if (intersection.size > 0) {
        nodeStates.set(node, intersection);
        return intersection;
      }
      changes++;                                   // one union == one step
      const result = new Set(childSets.flatMap(st => [...st]));
      nodeStates.set(node, result);
      return result;
    }
    fitchDown(tree);

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
      const ps = nodeStates.get(node);
      if (!ps) return;
      for (const child of node.children) {
        const cs = nodeStates.get(child);
        // A child can be missing from `nodeStates` when the tree was changed
        // after the down-pass (the SPR used to graft a subtree onto a tip
        // whose `isLeaf` flag was still true, so the down-pass never visited
        // that subtree). Skip it instead of dereferencing undefined — the
        // crash was "cs is not iterable" and it killed the whole search.
        if (!cs) continue;
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

    // The child results MUST stay aligned with `node.children`. The old code
    // filtered the children without a trait value out of `childResults` and
    // then indexed the survivors by the child position, so a missing trait
    // silently compared the WRONG pair of children (the root contrast of
    // ((A,B),(C,D)) with A missing came out as -3 instead of -2.535) and a
    // polytomy with one missing tip crashed with
    // "Cannot read properties of undefined (reading 'cumVar')".
    const childResults = node.children.map(c => compute(c));
    const informative: number[] = [];
    for (let i = 0; i < childResults.length; i++) {
      if (childResults[i].value !== null) informative.push(i);
    }

    if (informative.length < 2) {
      // Not enough information for a contrast. The single informative child
      // still carries its variance: the old code returned cumVar = 0 here and
      // dropped the branch length, which changed the dimension of every
      // contrast further up the tree.
      if (informative.length === 1) {
        const i = informative[0];
        return {
          value: childResults[i].value,
          cumVar: childResults[i].cumVar + (node.children[i].branchLength || 0),
        };
      }
      return { value: null, cumVar: 0 };
    }

    // Variance of every informative child's estimate around this node.
    const xs: number[] = [];
    const vars: number[] = [];
    for (const i of informative) {
      xs.push(childResults[i].value!);
      vars.push(childResults[i].cumVar + (node.children[i].branchLength || 0));
    }
    const k = informative.length;

    // Felsenstein 1985: a contrast needs two estimates. With k == 2 this is
    // the classic binary contrast (x1 - x2)/sqrt(v1 + v2); with k > 2 the
    // Helmert decomposition of the polytomy gives k - 1 orthogonal contrasts.
    for (let ci = 0; ci < k - 1; ci++) {
      let wOthers = 0, valOthers = 0;
      for (let cj = ci + 1; cj < k; cj++) {
        wOthers += 1 / Math.max(vars[cj], 1e-10);
        valOthers += xs[cj] / Math.max(vars[cj], 1e-10);
      }
      const meanOthers = valOthers / wOthers;   // inverse-variance weighted mean
      // Variance of the Helmert contrast = v_ci + v_others, where v_others is
      // the variance of the weighted mean of the remaining children.
      const vOthers = 1 / Math.max(wOthers, 1e-10);
      const vContrast = vars[ci] + vOthers;
      const contrast = (xs[ci] - meanOthers) / Math.sqrt(vContrast);
      const se = Math.sqrt(vContrast);
      contrasts.push(contrast);
      seList.push(se);
      if (k === 2) {
        contrastPairs.push({
          nodeA: node.children[informative[0]].name || '(internal)',
          nodeB: node.children[informative[1]].name || '(internal)',
        });
      }
    }

    // Node reconstruction: inverse-variance weighted mean of the informative
    // children. The reconstruction's variance is the harmonic form
    // 1/sum(1/v_i) — NOT sum(v_i), which is the variance of the CONTRAST and
    // inflated the standard error of every higher-level contrast.
    let wSum = 0, wValSum = 0;
    for (let ci = 0; ci < k; ci++) {
      const w = 1 / Math.max(vars[ci], 1e-10);
      wSum += w;
      wValSum += w * xs[ci];
    }
    const recon = wValSum / wSum;
    if (node.name) nodeValues[node.name] = recon;
    return { value: recon, cumVar: 1 / Math.max(wSum, 1e-10) };
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
        // The edge runs from `p` (the parent) down to `c` (an internal node);
        // the NNI rearranges the THREE subtrees that meet at that edge: p's
        // other child and c's two children.
        //
        // The old code worked on the edge between `parent` and its OWN parent
        // (the grandparent) and never put the grandparent's child slot back,
        // so accepting one move detached a whole subtree from the tree. The
        // detached taxa stopped contributing to the parsimony score, the
        // score dropped, and the move was accepted as an "improvement" — the
        // search converged on progressively more broken trees, and the
        // reported bestTree was missing taxa.
        const p = edge.parent;
        const c = edge.child;
        if (p.children.length !== 2 || c.children.length !== 2) continue;
        const other = p.children[0] === c ? p.children[1] : p.children[0];
        const pKids = [...p.children];
        const cKids = [...c.children];

        for (const swap of cKids) {
          const keep = cKids[0] === swap ? cKids[1] : cKids[0];
          setChildren(p, [c, swap]);
          setChildren(c, [other, keep]);

          const newResult = fitchParsimony(tree, sequences);
          totalTrees++;
          totalRearr++;

          if (newResult.treeLength < currentScore) {
            currentScore = newResult.treeLength;
            improved = true;
            break; // accepted, try next edge
          }
          // Revert NNI
          setChildren(p, pKids);
          setChildren(c, cKids);
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

/** Replace a node's children, keeping the parent pointers consistent. */
function setChildren(node: PhyloNode, kids: PhyloNode[]): void {
  node.children = kids.slice();
  for (const k of node.children) k.parent = node;
}

/** SPR (Subtree Pruning and Regrafting) - enhancement to NNI search.
 *  Reference: phangorn::pratchet / phytools::spr切片 */
function trySPR(tree: PhyloNode, sequences: Record<string, string>): { newTree: PhyloNode; newScore: number } {
  const internals = getAllInternalNodes(tree);
  if (internals.length === 0) return { newTree: tree, newScore: Infinity };

  // randint(lo, hi) is [lo, hi) — passing `len - 1` cut the last candidate
  // off, so the last internal node could never be pruned and the last
  // candidate could never receive the subtree.
  const pruneIdx = randint(0, internals.length);

  // Work on a COPY. The SPR is a candidate move: when it does not improve
  // the score the caller keeps the old tree, so mutating the tree in place
  // left the accepted score describing a tree that no longer existed.
  const working = tree.clone();
  const workInternals = getAllInternalNodes(working);
  const pruneNode = workInternals[pruneIdx];
  if (!pruneNode || pruneNode.parent === null) return { newTree: tree, newScore: Infinity };

  const parent = pruneNode.parent;
  parent.removeChild(pruneNode);

  // The regraft target must be an INTERNAL node. Grafting onto a tip left
  // that tip with `isLeaf === true`, so the Fitch down-pass never visited
  // the grafted subtree and `recordChanges` dereferenced an undefined state
  // set ("cs is not iterable") — the whole search died on the first SPR.
  const candidates = working.getAllNodes().filter(n =>
    n !== pruneNode && !n.isLeaf && n.children.length > 0 && !isDescendantOf(pruneNode, n));
  if (candidates.length === 0) {
    return { newTree: tree, newScore: Infinity };
  }

  const regraftNode = candidates[randint(0, candidates.length)];

  // The tree root can move: regrafting onto the ROOT inserts a new node
  // between the root and the tree. The old code left the tree object
  // pointing at the former root, so the score was computed on a subtree that
  // no longer contained the grafted taxa -- the pruned taxa silently
  // stopped counting and the tree "improved" by losing them.
  let root = working;

  pruneNode.branchLength = (regraftNode.branchLength || 0) * 0.5;
  if (regraftNode.children.length === 2) {
    // Split the edge by creating a new intermediate node.
    //
    // The old parent and the child slot have to be captured BEFORE the
    // re-parenting: `newParent.addChild(regraftNode)` sets
    // regraftNode.parent = newParent, so looking the parent up afterwards
    // found the NEW parent and replaced the new node with ITSELF. The
    // grafted subtree was then unreachable from the root: its taxa stopped
    // counting towards the parsimony score, the score dropped, and the move
    // was accepted as an "improvement".
    const newParent = new PhyloNode('', (regraftNode.branchLength || 0) * 0.5, false);
    regraftNode.branchLength = (regraftNode.branchLength || 0) * 0.5;
    const oldParent = regraftNode.parent;
    const oldIndex = oldParent ? oldParent.children.indexOf(regraftNode) : -1;
    newParent.addChild(regraftNode);
    newParent.addChild(pruneNode);
    if (oldParent && oldIndex >= 0) {
      oldParent.children[oldIndex] = newParent;
      newParent.parent = oldParent;
    } else {
      root = newParent;
    }
  } else {
    regraftNode.addChild(pruneNode);
    regraftNode.isLeaf = false;
  }

  const newScore = fitchParsimony(root, sequences).treeLength;
  return { newTree: root, newScore };
}

function buildRandomTree(taxa: string[]): PhyloNode {
  // Build a random binary tree via sequential insertion
  const nodes = taxa.map(t => new PhyloNode(t, 0, true));
  while (nodes.length > 1) {
    // randint(lo, hi) is [lo, hi): the old `len - 1` made the last element of
    // `nodes` unreachable as a merge partner, which biased the distribution of
    // the random starting trees.
    const i = randint(0, nodes.length);
    const node1 = nodes.splice(i, 1)[0];
    const j = randint(0, nodes.length);
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

/**
 * A bipartition of the taxon set: the two complementary groups of a split.
 *
 * `side` is the CANONICAL side (fewer taxa; ties broken lexicographically),
 * so one split always produces one key no matter which of its two sides a
 * tree happened to expose. The old key was `[sideA, sideB].sort().join('|')`
 * — a lexicographic sort of the two SIDES — which folded the two
 * complementary halves of one split into a single key and mixed them up with
 * the halves of a different split.
 */
interface Bipartition {
  side: string[];
  other: string[];
  /** Support: 1 for a strict consensus, the tree frequency for a majority rule. */
  support: number;
}

/** Key of a bipartition: its canonical side, sorted. */
function splitKey(side: string[]): string {
  return [...side].sort().join(',');
}

/** Canonical form of a bipartition: the smaller group first (ties: lexicographic). */
function canonicalBipartition(a: Set<string>, b: Set<string>): { side: string[]; other: string[] } {
  const sa = [...a].sort();
  const sb = [...b].sort();
  if (sa.length !== sb.length) {
    return sa.length < sb.length ? { side: sa, other: sb } : { side: sb, other: sa };
  }
  const ka = sa.join(','), kb = sb.join(',');
  return ka <= kb ? { side: sa, other: sb } : { side: sb, other: sa };
}

/** Every non-trivial split of a tree, keyed by the canonical side. */
function getTreeBipartitions(tree: PhyloNode, allTaxa: Set<string>): Map<string, Bipartition> {
  const out = new Map<string, Bipartition>();
  const walk = (node: PhyloNode): Set<string> => {
    const desc = new Set<string>();
    if (node.isLeaf) {
      if (allTaxa.has(node.name)) desc.add(node.name);
      return desc;
    }
    for (const child of node.children) {
      for (const l of walk(child)) desc.add(l);
    }
    // The root does not define a split (its complement is empty).
    if (node.parent !== null && node.parent !== undefined) {
      const comp = new Set<string>();
      for (const t of allTaxa) if (!desc.has(t)) comp.add(t);
      const canon = canonicalBipartition(desc, comp);
      // Trivial splits (a single taxon on one side) say nothing about the topology.
      if (canon.side.length > 1 && canon.other.length > 1) {
        out.set(splitKey(canon.side), { side: canon.side, other: canon.other, support: 1 });
      }
    }
    return desc;
  };
  walk(tree);
  return out;
}

/** Two splits are compatible when one of the four intersections is empty. */
function bipartitionsCompatible(a: Bipartition, b: Bipartition): boolean {
  const A = new Set(a.side), Ap = new Set(a.other);
  const B = new Set(b.side), Bp = new Set(b.other);
  const empty = (x: Set<string>, y: Set<string>): boolean => {
    for (const t of x) if (y.has(t)) return false;
    return true;
  };
  return empty(A, B) || empty(A, Bp) || empty(Ap, B) || empty(Ap, Bp);
}

/**
 * Build a tree from a set of MUTUALLY COMPATIBLE splits.
 *
 * A split {A | Aᶜ} is a pair of sister groups, so it is realised as TWO
 * complementary nodes that end up as children of the same parent. The old
 * majority-rule code instead pushed every member of BOTH sides into one
 * node, i.e. it read a bipartition as "a clade containing all its members":
 * the supported split disappeared from the result completely.
 *
 * `rootSplit` decides where the root goes; `null` means "the root is a
 * polytomy of the maximal supported clades".
 */
function buildConsensusTree(
  taxa: string[],
  splits: Bipartition[],
  rootSplit: Bipartition | null,
  withSupport: boolean,
): PhyloNode {
  const all = new Set(taxa);
  const bySide = new Map<string, Bipartition>();
  for (const s of splits) bySide.set(splitKey(s.side), s);

  const isProperSubset = (a: Set<string>, b: Set<string>): boolean => {
    if (a.size >= b.size) return false;
    for (const t of a) if (!b.has(t)) return false;
    return true;
  };

  const buildGroup = (members: Set<string>): PhyloNode => {
    // Candidate clades: the canonical side of every split that fits inside.
    const candidates: Bipartition[] = [];
    for (const s of bySide.values()) {
      if (isProperSubset(new Set(s.side), members)) candidates.push(s);
    }
    // Keep only the maximal candidates (none contained in another one).
    const maximal = candidates.filter(c1 =>
      !candidates.some(c2 => c1 !== c2 && isProperSubset(new Set(c1.side), new Set(c2.side))));
    // Of those, the pairwise-disjoint ones with the highest support.
    const chosen: Bipartition[] = [];
    const covered = new Set<string>();
    const ordered = maximal.slice().sort((x, y) =>
      y.support - x.support || splitKey(x.side).localeCompare(splitKey(y.side)));
    for (const c of ordered) {
      let overlap = false;
      for (const t of c.side) if (covered.has(t)) { overlap = true; break; }
      if (overlap) continue;
      chosen.push(c);
      for (const t of c.side) covered.add(t);
    }
    const children: PhyloNode[] = [];
    for (const c of chosen) {
      const child = buildGroup(new Set(c.side));
      if (withSupport) child.support = c.support;
      children.push(child);
    }
    // Taxa that no supported clade covers hang off this group directly.
    for (const t of members) {
      if (!covered.has(t)) children.push(new PhyloNode(t, 0, true));
    }
    if (children.length === 1) return children[0];
    const node = new PhyloNode('', 0, false);
    for (const ch of children) node.addChild(ch);
    return node;
  };

  if (rootSplit) {
    const root = new PhyloNode('', 0, false);
    const a = buildGroup(new Set(rootSplit.side));
    const b = buildGroup(new Set(rootSplit.other));
    if (withSupport) { a.support = rootSplit.support; b.support = rootSplit.support; }
    root.addChild(a);
    root.addChild(b);
    return root;
  }
  return buildGroup(all);
}

/**
 * The split below a binary root, or null for a polytomy root.
 *
 * The root itself has no complement (its descendants are every taxon), so the
 * root split is the partition of the taxon set by the root's TWO children.
 */
function treeRootSplit(tree: PhyloNode, allTaxa: Set<string>): Bipartition | null {
  if (tree.children.length !== 2) return null;
  const left = new Set<string>();
  for (const l of tree.children[0].getLeaves()) if (allTaxa.has(l.name)) left.add(l.name);
  const right = new Set<string>();
  for (const l of tree.children[1].getLeaves()) if (allTaxa.has(l.name)) right.add(l.name);
  if (left.size === 0 || right.size === 0) return null;
  const canon = canonicalBipartition(left, right);
  return { side: canon.side, other: canon.other, support: 1 };
}

/** Look a split up in an accepted set (by canonical key). */
function findAccepted(accepted: Bipartition[], split: Bipartition | null): Bipartition | null {
  if (!split) return null;
  const key = splitKey(split.side);
  for (const a of accepted) if (splitKey(a.side) === key) return a;
  return null;
}

export function strictConsensus(trees: PhyloNode[]): PhyloNode {
  if (trees.length === 0) throw new Error('No trees provided');
  if (trees.length === 1) return trees[0].clone();

  // The taxon universe is the union over all trees: the splits of every tree
  // have to be expressed in the SAME universe, otherwise two trees with
  // different taxa produce incomparable keys.
  const allTaxa = new Set<string>();
  for (const tree of trees) for (const l of tree.getLeaves()) allTaxa.add(l.name);
  const taxa = [...allTaxa].sort();

  const perTree = trees.map(t => getTreeBipartitions(t, allTaxa));

  // Keep only the splits present in ALL trees (strict consensus)
  const common: Bipartition[] = [];
  for (const [key, bip] of perTree[0]) {
    let inAll = true;
    for (let i = 1; i < perTree.length; i++) {
      if (!perTree[i].has(key)) { inAll = false; break; }
    }
    if (inAll) common.push(bip);
  }

  // No common split -> star tree
  if (common.length === 0) {
    const root = new PhyloNode('', 0, false);
    for (const name of taxa) root.addChild(new PhyloNode(name, 0, true));
    return root;
  }

  // Root the consensus on the root split of the first tree when that split
  // is shared by all of them; otherwise the root is a polytomy of the
  // maximal shared clades.
  const rootSplit = findAccepted(common, treeRootSplit(trees[0], allTaxa));
  return buildConsensusTree(taxa, common, rootSplit, false);
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
  const allTaxa = new Set<string>();
  for (const tree of trees) for (const l of tree.getLeaves()) allTaxa.add(l.name);
  const taxa = [...allTaxa].sort();

  // Count the splits over all trees
  const counts = new Map<string, number>();
  const bips = new Map<string, Bipartition>();
  for (const tree of trees) {
    for (const [key, bip] of getTreeBipartitions(tree, allTaxa)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!bips.has(key)) bips.set(key, bip);
    }
  }

  // Keep the splits above the threshold
  const kept: Bipartition[] = [];
  for (const [key, count] of counts) {
    const freq = count / nTrees;
    if (freq >= threshold) {
      const bip = bips.get(key)!;
      kept.push({ side: bip.side, other: bip.other, support: freq });
    }
  }

  // Two splits that cross each other cannot be drawn in one tree. They are
  // added in decreasing support, so the better supported split wins and the
  // conflicting one is dropped — a consensus tree is a TREE, not a set of
  // incompatible constraints.
  kept.sort((a, b) => b.support - a.support || splitKey(a.side).localeCompare(splitKey(b.side)));
  const accepted: Bipartition[] = [];
  for (const cand of kept) {
    let compatible = true;
    for (const acc of accepted) {
      if (!bipartitionsCompatible(cand, acc)) { compatible = false; break; }
    }
    if (compatible) accepted.push(cand);
  }

  if (accepted.length === 0) {
    const root = new PhyloNode('', 0, false);
    for (const name of taxa) root.addChild(new PhyloNode(name, 0, true));
    return root;
  }

  // Root the consensus on the root split of the first tree when that split is
  // supported, otherwise on the best supported split.
  const rootSplit = findAccepted(accepted, treeRootSplit(trees[0], allTaxa)) ?? accepted[0];
  return buildConsensusTree(taxa, accepted, rootSplit, true);
}

function isDescendantOf(node: PhyloNode, potentialAncestor: PhyloNode): boolean {
  if (node === potentialAncestor) return true;
  for (const child of node.children) {
    if (isDescendantOf(child, potentialAncestor)) return true;
  }
  return false;
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
      // A split is the PAIR {descendants | complement}. The old key used the
      // descendant set only, so the two halves of one split were counted as
      // two different splits and every RF distance came out exactly twice the
      // true value (4 instead of 2 for two 4-taxon trees; a normalised value
      // of 2 where 1 is the maximum).
      if (leaves.size > 1) {
        const complement = new Set<string>();
        for (const t of shared) if (!leaves.has(t)) complement.add(t);
        if (complement.size > 1) {
          const canon = canonicalBipartition(leaves, complement);
          splits.add(splitKey(canon.side));
        }
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
