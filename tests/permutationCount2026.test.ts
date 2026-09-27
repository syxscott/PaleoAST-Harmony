/**
 * Regression tests: a negative permutation count answered a question nobody
 * asked (2026-09-27, seventh pass).
 *
 * `for (let perm = 0; perm < nPermutations; perm++)` with a negative count runs
 * zero times, and the Phipson & Smyth add-one formula then reports the result of
 * a test that never happened:
 *
 *   phylogeneticSignal  p = (count + 1) / (n + 1)   -> n = -3 gives 1 / -2 = -0.5,
 *                                                       which is not a probability
 *   phyloANOVA          p = nValidPerms > 0 ? ... : 1.0  -> p = 1.0, i.e.
 *                                                       "no significant difference"
 *
 * PhyloSignalDialog and PhyloAnovaDialog were the only two permutation dialogs
 * with no validation at all (`parseInt(v) || 999`), so this was reachable from
 * the UI. AnosimDialog / NullModelDialog / PermanovaDialog already clamp to
 * 99..9999; anosim() and permanova() are bounded as well so the family cannot
 * reopen through another caller.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { parseNewick } from '../entry/src/main/core/analysis/phylogenetics/index.ts';
import {
  phylogeneticSignal, phyloANOVA, anosim, permanova, computeDistanceMatrix,
} from '../entry/src/main/core/analysis/statistics/statistics.ts';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';

const ROOT = 'D:/GIthub/PaleoAST-Harmony/';
const TREE = parseNewick('((A:0.1,B:0.1):0.1,(C:0.1,D:0.1):0.1,(E:0.1,F:0.1):0.1);');
const TRAITS = { A: 1.2, B: 2.1, C: 3.4, D: 2.8, E: 5.1, F: 4.3 };
const GROUPS = { A: 'g1', B: 'g1', C: 'g2', D: 'g2', E: 'g3', F: 'g3' };

const DIST = computeDistanceMatrix(Matrix.from2D([
  [1, 2, 3], [1.1, 2.2, 2.9], [0.9, 1.8, 3.1],
  [5, 6, 7], [5.2, 5.9, 7.1], [4.8, 6.2, 6.9],
]), 'euclidean');
const G = [0, 0, 0, 1, 1, 1];

const isProbability = (p: number) => p >= 0 && p <= 1;

describe('audit: a negative permutation count produced an impossible or unearned p-value', () => {
  it('phylogeneticSignal no longer returns a negative p-value', () => {
    // Before: (count + 1) / (nRandomizations + 1) with n = -3 -> 1 / -2 = -0.5.
    for (const bad of [0, -3, -1000]) {
      const r = phylogeneticSignal(TREE, TRAITS, bad, 42);
      expect(r.pValue >= 0 && r.pValue <= 1 ? 'ok' : 'p=' + r.pValue).toBe('ok');
      expect(r.nRandomizations >= 1 ? 'ok' : 'n=' + r.nRandomizations).toBe('ok');
    }
  });

  it('phyloANOVA no longer reports p = 1.0 for a test that never ran', () => {
    // Before: the loop body never executed, nValidPerms stayed 0, and the
    // `nValidPerms > 0 ? ... : 1.0` branch answered "no significant difference".
    for (const bad of [0, -3, -1000]) {
      const r = phyloANOVA(TREE, TRAITS, GROUPS, bad, 42);
      expect(r.nPermutations >= 1 ? 'ok' : 'n=' + r.nPermutations).toBe('ok');
      expect(isProbability(r.pValue) ? 'ok' : 'p=' + r.pValue).toBe('ok');
    }
  });

  it('anosim and permanova are bounded too, not just the two phylo tests', () => {
    for (const bad of [0, -3]) {
      const a = anosim(DIST, G, bad, 42);
      const p = permanova(DIST, G, bad, 42);
      expect(a.nPermutations >= 1 && isProbability(a.pValue) ? 'ok' : 'anosim').toBe('ok');
      expect(p.nPermutations >= 1 && isProbability(p.pValue) ? 'ok' : 'permanova').toBe('ok');
    }
  });

  it('a valid permutation count is unchanged', () => {
    // The clamp only ever raises a value, so ordinary requests must be identical.
    const sig = phylogeneticSignal(TREE, TRAITS, 199, 42);
    expect(sig.nRandomizations).toBe(199);
    expect(sig.pValue > 0 && sig.pValue < 1).toBe(true);
    expect(phyloANOVA(TREE, TRAITS, GROUPS, 199, 42).nPermutations).toBe(199);
    expect(anosim(DIST, G, 199, 42).nPermutations).toBe(199);
    expect(permanova(DIST, G, 199, 42).nPermutations).toBe(199);
    // And the default is still 999.
    expect(phylogeneticSignal(TREE, TRAITS, undefined, 42).nRandomizations).toBe(999);
  });

  it('the two permutation dialogs now clamp like their three siblings', () => {
    // AnosimDialog, NullModelDialog and PermanovaDialog use this exact bound.
    for (const f of ['PhyloAnovaDialog', 'PhyloSignalDialog']) {
      const t = readFileSync(
        ROOT + 'entry/src/main/ets/components/dialogs/' + f + '.ets', 'utf-8');
      expect(t.includes('Math.max(99, Math.min(9999, parseInt(v) || 999))') ? f : f + ' unclamped')
        .toBe(f);
    }
  });

  it('no add-one permutation p-value divides by a raw caller-supplied count', () => {
    // Guards the whole family: the DIVISOR of `(count + 1) / (x + 1)` must be a
    // clamped local, never the parameter itself. Check only the divisor -- the
    // result object legitimately still names the field `nPermutations`, so
    // matching the whole line produces false positives.
    const stats = readFileSync(
      ROOT + 'entry/src/main/core/analysis/statistics/statistics.ts', 'utf-8');
    const offenders: string[] = [];
    stats.split('\n').forEach((line, i) => {
      const m = line.match(/\(count \+ 1\) \/ \(([^)]+)\)/);
      if (m && /nPermutations|nRandomizations/.test(m[1])) {
        offenders.push((i + 1) + ': divisor ' + m[1].trim());
      }
    });
    expect(offenders.join(' | ')).toBe('');
  });
});
