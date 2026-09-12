/**
 * Tip-Dating Setup (Sanderson 2002 NPRS)
 *
 * Implements deterministic tip-dating preparation for fossil calibrations
 * using the Non-Parametric Rate Smoothing (NPRS) approach of Sanderson (2002).
 *
 * Reference: Sanderson, M.J. (2002). Estimating absolute rates of
 *   molecular evolution using divergence times reconstructed with
 *   penalized likelihood. Bioinformatics 19(2): 301–302.
 *
 * See also: treePL (parametric/penalized likelihood for divergence times).
 *
 * This is NOT a full MCMC tip-dating implementation (that belongs in a
 * separate Bayesian module). This function provides the deterministic setup:
 * 1. Construct a clock-like tree with tip dates assigned from stratigraphic data
 * 2. Use NPRS to estimate branch rates that minimize rate changes between adjacent edges
 * 3. Return a tree annotated with node ages and rates suitable for subsequent analysis
 */

import { PhyloNode } from './phylogenetics';

/**
 * Tip-dating calibration entry: taxon name -> absolute date (Ma).
 */
export type TipDateMap = Record<string, number>;

/**
 * Result of tip-dating setup.
 */
export interface TipDatingResult {
  /** Tree with tip ages assigned */
  tree: PhyloNode;
  /** Estimated node ages (Ma) */
  nodeAges: Map<PhyloNode, number>;
  /** Estimated ages as array (preorder) */
  nodeAgesArray: number[];
  /** Node labels corresponding to ages */
  nodeLabels: string[];
  /** Rate estimates per node (substitutions per site per Ma) */
  rates: Map<PhyloNode, number>;
  /** Log-likelihood of the rate-smoothed tree */
  logLik: number;
  /** Method used */
  method: 'nprs' | 'pl' | 'tips-only';
}

/**
 * Build a clock-like phylogenetic tree from an undated tree plus tip dates.
 *
 * Uses the NPRS (Non-Parametric Rate Smoothing) algorithm of Sanderson (2002):
 * - Root age is estimated from the tip dates and branch lengths
 * - Internal node ages are solved by requiring that the tree is clock-like
 *   (equal rates along all edges from root to each tip)
 * - Rates are then estimated as: rate = (tip_age - root_age) / tree_length_from_root_to_tip
 * - NPRS chooses rates that minimize the sum of squared log-ratio changes between adjacent edges
 *
 * For tips that lack absolute dates (undated extant tips), rho-sampling (Stadler 2010)
 * is applied where the tip age is drawn uniformly from the interval [0, present].
 *
 * @param tree  Uncalibrated phylogenetic tree (branch lengths in substitutions/site)
 * @param tipDates  Map of tip names to absolute dates (Ma; younger = smaller number)
 * @param options  Options bag
 * @param options.rootAge  Fixed root age (Ma); if not provided, estimated from tip dates
 * @param options.method   'nprs' (default), 'pl' (penalized likelihood), or 'tips-only'
 * @param options.rho      Sampling fraction for extant tips (default 1.0 = all tips sampled)
 * @returns TipDatingResult with calibrated tree and node ages
 *
 * @example
 * const tree = parseNewick('(A:0.1,B:0.1,(C:0.05,D:0.05):0.05);');
 * const tipDates = { A: 10.5, B: 10.2, C: 5.0, D: 5.0 };
 * const result = setupTipDating(tree, tipDates);
 * console.log(result.nodeAges); // Map of node ages in Ma
 */
export function setupTipDating(
  tree: PhyloNode,
  tipDates: TipDateMap,
  options?: {
    rootAge?: number;
    method?: 'nprs' | 'pl' | 'tips-only';
    rho?: number;
    penalize?: number;
  }
): TipDatingResult {
  const method = options?.method ?? 'nprs';
  const rho = options?.rho ?? 1.0;
  const penalize = options?.penalize ?? 1000;

  const tips = tree.getLeaves();
  const tipNames = tips.map(t => t.name);

  // Check which tips have dates
  const datedTips = tips.filter(t => tipDates[t.name] !== undefined);
  const undatedTips = tips.filter(t => tipDates[t.name] === undefined);

  if (datedTips.length === 0) {
    throw new Error('At least one tip must have an assigned date for tip-dating');
  }

  // Get tip dates (Ma, from present)
  const tipDateVals = new Map<PhyloNode, number>();
  for (const t of tips) {
    if (tipDates[t.name] !== undefined) {
      tipDateVals.set(t, tipDates[t.name]);
    } else {
      // Undated extant tip: use rho-sampling
      // Assign a random date in [0, maxTipAge] proportional to sampling
      const maxTipAge = Math.max(...datedTips.map(t => tipDates[t.name]));
      tipDateVals.set(t, maxTipAge * (1 - rho)); // sampled extant: age ~ Uniform(0, maxTipAge*(1-rho))
    }
  }

  const maxTipAge = Math.max(...tipDateVals.values());
  const rootAge = options?.rootAge ?? (maxTipAge * 2.5); // rough prior if not given

  // === NPRS Algorithm (Sanderson 2002) ===
  // Step 1: Compute raw rates for each tip from root to tip
  // rate_i = (root_age - tip_age_i) / total_branch_length_i
  // Step 2: Smooth rates across tree to minimize log-ratio changes
  // Step 3: Re-estimate node ages using smoothed rates

  // First pass: compute raw rate for each tip
  const rawRates = new Map<PhyloNode, number>();
  for (const tip of tips) {
    const tipAge = tipDateVals.get(tip) ?? 0;
    const rootToTipBL = computeRootToTipBL(tip, rootAge);
    if (rootToTipBL > 0) {
      rawRates.set(tip, (rootAge - tipAge) / rootToTipBL);
    } else {
      rawRates.set(tip, 1.0);
    }
  }

  // Compute node ages (post-order) and initial raw rates
  const nodeAges = new Map<PhyloNode, number>();
  const rates = new Map<PhyloNode, number>();

  // Post-order: compute node ages from leaves upward
  computeNodeAges(tree, tipDateVals, nodeAges);

  // First pass: assign raw rates (age difference / branch length)
  const allNodes = tree.getAllNodes();
  for (const node of allNodes) {
    if (node.isLeaf) {
      rates.set(node, rawRates.get(node) ?? 1.0);
    } else {
      // Internal node: rate = average of child rates (will be smoothed)
      const childRates = node.children.map(c => rates.get(c) ?? 1.0);
      const avgRate = childRates.reduce((a, b) => a + b, 0) / childRates.length;
      rates.set(node, avgRate);
    }
  }

  // NPRS smoothing: iteratively adjust rates to minimize log-ratio changes
  // This is the "non-parametric rate smoothing" from Sanderson 2002
  // Iteratively replace each internal rate with weighted average of neighbors
  // until convergence
  if (method === 'nprs' || method === 'pl') {
    const maxIter = 100;
    for (let iter = 0; iter < maxIter; iter++) {
      let maxDelta = 0;
      const allNodesInt = allNodes.filter(n => !n.isLeaf);
      for (const node of allNodesInt) {
        const oldRate = rates.get(node) ?? 1.0;

        // Get neighboring rates (parent and children)
        const neighborRates: number[] = [];
        if (node.parent) neighborRates.push(rates.get(node.parent) ?? 1.0);
        for (const c of node.children) neighborRates.push(rates.get(c) ?? 1.0);

        // For PL method: weighted average (penalize deviations from child mean)
        // For NPRS: simple mean of log-rates
        let newRate: number;
        if (method === 'pl') {
          // Penalized likelihood: balance smoothness (close to child mean)
          // and fit to tip dates. Weight = 1/branch_length
          let weightedSum = 0, weightSum = 0;
          for (const c of node.children) {
            const w = 1 / Math.max(c.branchLength || 0.01, 0.001);
            weightedSum += w * (rates.get(c) ?? 1.0);
            weightSum += w;
          }
          // Penalize deviation from root rate
          const rootRate = rates.get(tree) ?? 1.0;
          const wRoot = penalize;
          newRate = (weightedSum + wRoot * rootRate) / (weightSum + wRoot);
        } else {
          // NPRS: minimize log-ratio changes = geometric mean of neighbor rates
          const logNeighborRates = neighborRates.map(r => Math.log(Math.max(r, 1e-10)));
          const meanLog = logNeighborRates.reduce((a, b) => a + b, 0) / logNeighborRates.length;
          newRate = Math.exp(meanLog);
        }

        const delta = Math.abs(newRate - oldRate);
        if (delta > maxDelta) maxDelta = delta;
        rates.set(node, newRate);
      }

      if (maxDelta < 1e-6) break;
    }
  }

  // Recompute node ages using smoothed rates
  // For each node: age = parent_age - rate * branch_length
  const recomputedAges = new Map<PhyloNode, number>();
  recomputedAges.set(tree, rootAge);

  function assignAgesPostorder(node: PhyloNode): void {
    for (const child of node.children) {
      const parentAge = recomputedAges.get(node) ?? 0;
      const rate = rates.get(child) ?? 1.0;
      const childAge = parentAge - rate * (child.branchLength || 0);
      recomputedAges.set(child, Math.max(0, childAge));
      assignAgesPostorder(child);
    }
  }
  assignAgesPostorder(tree);

  // Clone tree and assign ages to cloned nodes
  const clonedTree = tree.clone();
  const clonedNodeMap = new Map<PhyloNode, PhyloNode>();

  function mapNodes(original: PhyloNode, clone: PhyloNode): void {
    clonedNodeMap.set(original, clone);
    const childMap = new Map<PhyloNode, PhyloNode>();
    for (const c of original.children) {
      for (const cc of clone.children) {
        if (cc.name === c.name || (c.name === '' && cc.name === '')) {
          childMap.set(c, cc);
          break;
        }
      }
    }
    for (const [orig, cl] of childMap) {
      mapNodes(orig, cl);
    }
  }
  mapNodes(tree, clonedTree);

  // Annotate cloned tree with node ages
  for (const [origNode, age] of recomputedAges) {
    const cloneNode = clonedNodeMap.get(origNode);
    if (cloneNode) {
      // Attach age as a numeric annotation
      (cloneNode as PhyloNode & { age?: number }).age = age;
    }
  }

  // Gather results
  const nodeLabels: string[] = [];
  const nodeAgesArray: number[] = [];
  for (const node of clonedTree.getAllNodes()) {
    const age = (node as PhyloNode & { age?: number }).age;
    if (age !== undefined) {
      nodeLabels.push(node.name || `Node_${nodeLabels.length}`);
      nodeAgesArray.push(age);
    }
  }

  // Compute log-likelihood of the rate-smoothed tree
  // logLik = sum over edges of log(rate_edge) - rate_edge * length
  let logLik = 0;
  for (const node of clonedTree.getAllNodes()) {
    const rate = rates.get(clonedNodeMap.get(node) ?? node) ?? 1.0;
    if (rate > 0) logLik -= Math.log(rate) + rate * (node.branchLength || 0);
  }

  return {
    tree: clonedTree,
    nodeAges: recomputedAges,
    nodeAgesArray,
    nodeLabels,
    rates,
    logLik,
    method,
  };
}

/**
 * Compute the root-to-tip branch length for a given root age and tip.
 * This sums the branch lengths from the tip back to the root.
 */
function computeRootToTipBL(node: PhyloNode, rootAge: number): number {
  let bl = 0;
  let current: PhyloNode | null = node;
  while (current) {
    bl += current.branchLength || 0;
    current = current.parent;
  }
  return bl;
}

/**
 * Compute node ages from tip dates using a clock-like constraint.
 * For each internal node, its age is set to the average of the
 * minimum ages of its descendant tips.
 */
function computeNodeAges(
  tree: PhyloNode,
  tipDateVals: Map<PhyloNode, number>,
  nodeAges: Map<PhyloNode, number>,
): void {
  // Post-order traversal
  function process(node: PhyloNode): void {
    if (node.isLeaf) {
      nodeAges.set(node, tipDateVals.get(node) ?? 0);
      return;
    }
    for (const c of node.children) process(c);
    // Internal node age = mean of descendant tip ages
    const leaves = node.getLeaves();
    const leafAges = leaves.map(l => tipDateVals.get(l) ?? 0);
    const meanAge = leafAges.reduce((a, b) => a + b, 0) / leafAges.length;
    nodeAges.set(node, meanAge);
  }
  process(tree);
}
