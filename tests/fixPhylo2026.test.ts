/**
 * Regression tests for the phylogenetics / state-machine defects found in the
 * 2026-10-19 review.
 *
 * Every test name states the OLD behaviour that was broken, so a failure
 * points straight at the defect that came back.
 *
 * Reference for the numbers:
 *   - Kluge, J.W. & Farris, J.S. (1979) "A simple method for displaying the
 *     most parsimonious trees", Syst. Zool. 28:156-166 (CI / RI).
 *   - Felsenstein, J. (1985) "Confidence limits on phylogenies", Evolution
 *     39:783-789 (PIC).
 *   - Robinson, D.F. & Foulds, L.R. (1981) "Comparison of the total tree
 *     structure of a systematic tree with some other trees", Syst. Zool.
 *     30:545-577 (RF distance).
 */
import { describe, it, expect } from './runner.ts';
import {
  parseNewick,
  strictConsensus,
  majorityRuleConsensus,
  computeRFDistance,
  pic,
  heuristicSearch,
  phylogeneticSignal,
  setupTipDating,
  type PhyloNode,
} from '../entry/src/main/core/analysis/phylogenetics/index.ts';
import { brownianVCV, blombergKFromVCV } from '../entry/src/main/core/analysis/phylogenetics/vcv.ts';
import { seed, randint } from '../entry/src/main/core/math/random.ts';
import { createBasicLexer, RegexCompiler } from '../entry/src/main/core/state_machine/Automaton.ts';
import { TokenType } from '../entry/src/main/core/state_machine/Tokenizer.ts';

/** Leaf names below a node, sorted. */
function leafSet(node: PhyloNode): string {
  return node.getLeaves().map(l => l.name).sort().join(',');
}

/** Does the tree contain a clade with exactly these leaves? */
function hasClade(root: PhyloNode, names: string[]): boolean {
  const want = [...names].sort().join(',');
  for (const n of root.getAllNodes()) {
    if (leafSet(n) === want) return true;
  }
  return false;
}

describe('phylogenetics: consensus trees, distances and signal (2026-10-19 review)', () => {
  it('strictConsensus duplicated every taxon instead of listing it once', () => {
    // Before: strictConsensus([T, T.clone(), T.clone()]) on
    // "(((A,B),(C,D)),(E,F));" produced "(((A,B,C,D),(A,B,C,D)),E,F)" - six
    // input taxa, ten leaves in the output, A/B/C/D each twice.
    const T = parseNewick('(((A,B),(C,D)),(E,F));');
    const out = strictConsensus([T, T.clone(), T.clone()]);
    const names = out.leafNames();
    expect(names.length).toBe(6);
    expect(new Set(names).size).toBe(6);
    expect([...names].sort().join(',')).toBe('A,B,C,D,E,F');
    // The two cherries have to survive as cherries.
    expect(hasClade(out, ['A', 'B'])).toBe(true);
    expect(hasClade(out, ['C', 'D'])).toBe(true);
    expect(hasClade(out, ['E', 'F'])).toBe(true);
  });

  it('strictConsensus turned a binary tree into a polytomy', () => {
    // Before: the grouping loop skipped every group of the same size as its
    // parent, so "((A,B),(C,D))" came back as "((A,B),C,D)".
    const T = parseNewick('((A,B),(C,D));');
    const out = strictConsensus([T, T.clone(), T.clone()]);
    expect(out.leafNames().length).toBe(4);
    expect(hasClade(out, ['A', 'B'])).toBe(true);
    expect(hasClade(out, ['C', 'D'])).toBe(true);
    // No node may have more than two children any more.
    for (const n of out.getAllNodes()) {
      if (!n.isLeaf) expect(n.children.length <= 2).toBe(true);
    }
  });

  it('majorityRuleConsensus lost the split that every tree supported', () => {
    // Before: the bipartition was read as "one clade with all the members of
    // both sides", so the 3/3-supported split {A,B}|{C,D} vanished and the
    // result was a single multifurcation "((A,B,C,D)1;)" whose split set was
    // empty.
    const T = parseNewick('((A,B),(C,D));');
    const out = majorityRuleConsensus([T, T.clone(), T.clone()], 0.5);
    const names = out.leafNames();
    expect(names.length).toBe(4);
    expect(new Set(names).size).toBe(4);
    // The supported split has to be in the result, as two sister groups.
    expect(hasClade(out, ['A', 'B'])).toBe(true);
    expect(hasClade(out, ['C', 'D'])).toBe(true);
    // ... and the support value has to be the frequency of the split.
    const cherries = out.getAllNodes().filter(n => !n.isLeaf && leafSet(n) === 'A,B');
    expect(cherries.length).toBe(1);
    expect(cherries[0].support).toBeWithin(1, 1e-12);
  });

  it('computeRFDistance was twice the true distance and could exceed 1', () => {
    // Before: the split key used the descendant set only, so both halves of
    // one split were counted separately: rfDistance = 4 and normalized = 2
    // for two 4-taxon trees. The maximum normalized RF distance is 1.
    const t1 = parseNewick('((A,B),(C,D));');
    const t2 = parseNewick('((A,C),(B,D));');
    const r = computeRFDistance(t1, t2, true);
    expect(r.rfDistance).toBe(2);              // one split only in t1, one only in t2
    expect(r.normalized!).toBeWithin(1, 1e-12);
    expect(r.normalized! <= 1).toBe(true);
    // Identical trees are still at distance 0.
    const same = computeRFDistance(t1, parseNewick('((A,B),(C,D));'), true);
    expect(same.rfDistance).toBe(0);
    expect(same.normalized!).toBeWithin(0, 1e-12);
  });

  it('brownianVCV mixed up two tips that carry the same name', () => {
    // Before: the node key was the node NAME, so two tips called "A" shared
    // one key; the depth map was overwritten and the LCA scan matched the
    // tip itself instead of the LCA, which put the tip's own distance to the
    // root into the off-diagonal. Fossil data is full of "indet." / "cf.
    // sp." labels, so this has to fail loudly instead of quietly.
    let message = '';
    try {
      brownianVCV(parseNewick('((A:1,X:1):1,A:2);'), 1.0);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message.length > 0).toBe(true);
    expect(message.indexOf('duplicate tip name') >= 0).toBe(true);
  });

  it('brownianVCV still produces the ape matrix for a normal tree', () => {
    // "((A:1,X:1):1,B:2)": root-to-tip = 2, 2, 2; the shared path of A and
    // X is the internal node (depth 1); A and B only share the root (0).
    const { V, tipNames } = brownianVCV(parseNewick('((A:1,X:1):1,B:2);'), 1.0);
    expect(tipNames.join(',')).toBe('A,X,B');
    expect(V[0][0]).toBeWithin(2, 1e-12);
    expect(V[1][1]).toBeWithin(2, 1e-12);
    expect(V[2][2]).toBeWithin(2, 1e-12);
    expect(V[0][1]).toBeWithin(1, 1e-12);
    expect(V[0][2]).toBeWithin(0, 1e-12);
  });

  it('blombergKFromVCV turned a constant trait into K = 1.5', () => {
    // Before: [5,5,5] gave 1.5000000001062503 - the ratio of two ~1e-30
    // quantities, i.e. floating-point noise that reads as "strong signal".
    // A constant trait has no signal at all, so this has to fail loudly.
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let message = '';
    let value = Number.NaN;
    try {
      value = blombergKFromVCV([5, 5, 5], V);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message.length > 0).toBe(true);
    expect(message.indexOf('zero variance') >= 0).toBe(true);
    expect(value === 1.5).toBe(false);
  });

  it('blombergKFromVCV reported a missing trait as K = 0 (no signal)', () => {
    // Before: a NaN trait, a singular V and n < 3 all returned 0, and K = 0
    // is the legitimate value for "no phylogenetic signal" - a failure was
    // indistinguishable from a conclusion.
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let message = '';
    try {
      blombergKFromVCV([1, Number.NaN, 3], V);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message.length > 0).toBe(true);
    expect(message.indexOf('non-finite') >= 0 || message.indexOf('missing') >= 0).toBe(true);
  });

  it('pic crashed on a polytomy with a missing trait', () => {
    // Before: "TypeError: Cannot read properties of undefined (reading
    // 'cumVar')" - the child results were filtered but still indexed by the
    // child position.
    const tree = parseNewick('(A:0.1,B:0.1,C:0.1);');
    const r = pic(tree, { A: 1, B: 2 });
    // Two tips carry a value, so there is exactly one contrast.
    expect(r.nContrasts).toBe(1);
    expect(r.contrasts[0]).toBeWithin(-2.2360679, 1e-6);
  });

  it('pic compared the wrong pair of children when a trait was missing', () => {
    // Before: with A missing, the root contrast came out as -3 (the branch
    // length of the missing tip had been dropped, so the variance was wrong);
    // the correct value is -1.5 / sqrt(0.2 + 0.15) = -2.5354628.
    const tree = parseNewick('((A:0.1,B:0.1):0.1,(C:0.1,D:0.1):0.1);');
    const r = pic(tree, { B: 2, C: 3, D: 4 });
    // The (A,B) node has only one informative child, so it produces no
    // contrast; (C,D) and the root do.
    expect(r.nContrasts).toBe(2);
    expect(r.contrasts[0]).toBeWithin(-2.2360679, 1e-6);
    expect(r.contrasts[1]).toBeWithin(-2.5354628, 1e-6);
    expect(r.contrasts[1] === -3).toBe(false);
  });

  it('heuristicSearch lost whole subtrees and scored the broken tree better', () => {
    // Before: the NNI surgery detached a subtree from the tree, and the SPR
    // grafted onto a tip, so the search converged on trees with fewer taxa
    // (and a lower, meaningless parsimony score).
    const seqs = { A: '00', B: '01', C: '10', D: '11', E: '00', F: '01' };
    const r = heuristicSearch(seqs, 5, 60, 42);
    const names = r.bestTree.leafNames().sort();
    expect(names.length).toBe(6);
    expect(names.join(',')).toBe('A,B,C,D,E,F');
    expect(isFinite(r.bestScore)).toBe(true);
    // The score has to be the parsimony score of the tree that is returned:
    // 3 steps for this data set, and a tree with fewer taxa would score less.
    expect(r.bestScore).toBeGreaterThanOrEqual(3);
  });

  it('setupTipDating attached the ages to the wrong nodes', () => {
    // Before: the clone was paired with the original by NAME, and a Newick
    // internal node has an empty name, so both internal nodes matched the
    // first empty-named clone: the (C,D) age landed on the (A,B) node and
    // three nodes ended up with no age at all.
    const tree = parseNewick('((A:0.1,B:0.1):0.1,(C:0.05,D:0.05):0.05);');
    const r = setupTipDating(tree, { A: 10.5, B: 10.2, C: 5.0, D: 5.0 });
    const nodes = r.tree.getAllNodes();
    expect(nodes.length).toBe(7);
    expect(r.nodeAgesArray.length).toBe(7);
    const aged = nodes.filter(n => typeof (n as unknown as { age?: number }).age === 'number');
    expect(aged.length).toBe(7);
    // The two internal nodes must not share one age.
    const ab = nodes.find(n => leafSet(n) === 'A,B') as unknown as { age?: number };
    const cd = nodes.find(n => leafSet(n) === 'C,D') as unknown as { age?: number };
    expect(ab.age !== undefined).toBe(true);
    expect(cd.age !== undefined).toBe(true);
    expect(Math.abs((ab.age ?? 0) - (cd.age ?? 0)) > 0.01).toBe(true);
  });

  it('toNewick put a semicolon behind every internal node', () => {
    // Before: "((A:0.100,B:0.100):0.100;,(C:0.100,D:0.100):0.100;);" - every
    // standard Newick parser stops at the first ";", and this repo's own
    // parseNewick kept only 2 of the 6 taxa.
    const tree = parseNewick('((A:0.1,B:0.1):0.1,(C:0.1,D:0.1):0.1,(E:0.2,F:0.2):0.2);');
    const nwk = tree.toNewick(3);
    expect(nwk.indexOf(';') === nwk.length - 1).toBe(true);
    expect(nwk.split(';').length - 1).toBe(1);
    const back = parseNewick(nwk);
    expect(back.leafNames().length).toBe(6);
    expect(back.leafNames().sort().join(',')).toBe('A,B,C,D,E,F');
  });

  it('parseNewick accepted an empty string and silently dropped trailing junk', () => {
    // Before: parseNewick('') returned one nameless leaf and
    // parseNewick('(A,B))garbage') returned the tree (A,B).
    let emptyMessage = '';
    try { parseNewick(''); } catch (e) { emptyMessage = e instanceof Error ? e.message : String(e); }
    expect(emptyMessage.indexOf('empty') >= 0).toBe(true);
    let tailMessage = '';
    try { parseNewick('(A,B))garbage'); } catch (e) { tailMessage = e instanceof Error ? e.message : String(e); }
    expect(tailMessage.indexOf('trailing') >= 0).toBe(true);
  });

  it('phylogeneticSignal truncated a trait vector to the shorter length', () => {
    // Before: n = Math.min(tipNames.length, traitValues.length) cut a
    // 4-tip tree down to 3 values, and the 4x4 V was then inverted as if it
    // were 3x3 (the upper-left block of an inverse is not the inverse of that
    // block), so K = 0.9333 had no meaning at all.
    let message = '';
    try {
      phylogeneticSignal(parseNewick('((A:1,B:1):1,(C:1,D:1):1);'), [1, 2, 3], 99, 42);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message.length > 0).toBe(true);
    expect(message.indexOf('one for one') >= 0 || message.indexOf('match') >= 0).toBe(true);
  });
});

describe('state machine: the basic lexer matched nothing (2026-10-19 review)', () => {
  it('createBasicLexer emitted UNKNOWN for every character', () => {
    // Before: the compiler treated every character of a pattern as a
    // literal, so "[0-9]+" matched the literal text "[0-9]+" and the whole
    // input came out as single-character UNKNOWN tokens.
    const tokens = createBasicLexer().tokenize('3.14 2.5e-3 x');
    const kinds = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(kinds.indexOf(TokenType.UNKNOWN) === -1).toBe(true);
    const numbers = tokens.filter(t => t.type === TokenType.NUMBER).map(t => t.lexeme);
    expect(numbers.join(',')).toBe('3.14,2.5e-3');
    const words = tokens.filter(t => t.type === TokenType.STRING).map(t => t.lexeme);
    expect(words.join(',')).toBe('x');
  });

  it('the longest match stopped at the first failing extension', () => {
    // Before: the scan tried every prefix and stopped at the first failure
    // once a match had been found, so "a(ab)?" matched "aab" as "a".
    const re = new RegexCompiler('a(ab)?');
    expect(re.longestMatch('aab', 0)).toBe('aab');
  });
});

describe('random sampling: the last candidate of a list was unreachable (2026-10-19 review)', () => {
  it('the index of the last element could never be drawn', () => {
    // randint(lo, hi) is [lo, hi) - a half-open interval. The SPR and the
    // random tree builder used to pass hi = len - 1, which cut the last
    // element off a second time: randint(0, 3) could only return 0..2, so
    // the last internal node was never pruned and the last element was never
    // a merge partner. The call sites now pass hi = len, so the last index
    // (len - 1) is reachable.
    seed(20261019);
    const len = 4;
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(randint(0, len));
    expect(seen.has(len - 1)).toBe(true);
    // ... and with the broken bound the last index was unreachable.
    const seenBroken = new Set<number>();
    for (let i = 0; i < 5000; i++) seenBroken.add(randint(0, len - 1));
    expect(seenBroken.has(len - 1)).toBe(false);
  });
});
