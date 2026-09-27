/**
 * Regression tests for two defects found in the last review pass
 * (2026-09-27, seventh pass).
 *
 * 1. A user-supplied component count was bounded from above only. `Math.min(
 *    nComponents ?? ...)` lets a negative through, and the four downstream uses
 *    of `nc` then disagree about what a negative means:
 *       while (len < nc)      -> does not run
 *       arr.slice(0, nc)      -> JS negative index: "all but the last |nc|"
 *       Matrix.sliceCols(0,nc)-> matrix semantics
 *       Matrix.zeros(k, nc)   -> degenerate width
 *    so the result was a plausible-looking plot of some *other* size instead of
 *    an error. LDADialog published its count with no clamping at all, so this
 *    was reachable: `parseInt(v) || 2` accepts -3.
 *
 * 2. `tools/structure_check.py` read sources with `errors='ignore'`, which
 *    silently discards undecodable bytes. Four files were sitting in the tree as
 *    invalid UTF-8 while every gate stayed green -- a GBK em dash (0xA1 0xAA) in
 *    place of U+2014. TypeScript and DevEco both read source as UTF-8, so this
 *    is a toolchain decode error and mojibake in any editor.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import {
  pca, pcoa, lda, computeDistanceMatrix,
} from '../entry/src/main/core/analysis/statistics/statistics.ts';
import { plsIntegration } from '../entry/src/main/core/analysis/morphometrics/Integration.ts';

const ROOT = 'D:/GIthub/PaleoAST-Harmony/';

// Deterministic data with a real two-group structure.
const N = 24;
const DATA = Matrix.from2D(
  Array.from({ length: N }, (_, i) =>
    Array.from({ length: 8 }, (_, j) => Math.sin(i * 0.7 + j * 1.3) * 3 + j)));
const BLOCK_B = Matrix.from2D(
  Array.from({ length: N }, (_, i) =>
    Array.from({ length: 5 }, (_, j) => Math.cos(i * 0.9 + j * 2.1) * 2 + 1)));
const GROUPS = Array.from({ length: N }, (_, i) => (i < 12 ? 0 : 1));
const DIST = computeDistanceMatrix(DATA, 'euclidean');

describe('audit: a negative component count produced a silently different result', () => {
  it('pca clamps a negative or zero count to one axis', () => {
    // Before: nc = Math.min(nComponents ?? maxComp, maxComp) had no lower
    // bound, so -1 and -5 reached sliceCols/eigenvector code directly.
    expect(pca(DATA, 3).scores.cols).toBe(3);
    for (const bad of [0, -1, -5, -1000]) {
      expect(pca(DATA, bad).scores.cols + ' for ' + bad).toBe('1 for ' + bad);
    }
  });

  it('pcoa clamps a negative or zero count to one axis', () => {
    expect(pcoa(DIST, 3).coordinates.cols).toBe(3);
    for (const bad of [0, -1, -5]) {
      expect(pcoa(DIST, bad).coordinates.cols + ' for ' + bad).toBe('1 for ' + bad);
    }
  });

  it('lda clamps a negative or zero count to one axis', () => {
    expect(lda(DATA, GROUPS, 1).scores.cols).toBe(1);
    for (const bad of [0, -1, -5]) {
      expect(lda(DATA, GROUPS, bad).scores.cols + ' for ' + bad).toBe('1 for ' + bad);
    }
  });

  it('plsIntegration still returns a result for a negative count', () => {
    // Before the fix this dimension went negative; now it is at least one and
    // the permutation-based p-value is still produced.
    const r = plsIntegration(DATA, BLOCK_B, -5);
    expect(r.singularValues.length > 0).toBe(true);
    expect(Number.isNaN(r.pValue)).toBe(false);
  });

  it('a valid count is unaffected: the clamp only ever raises a value to 1', () => {
    // The upper bound is untouched, so ordinary requests are unchanged.
    expect(pca(DATA, 4).scores.cols).toBe(4);
    expect(pca(DATA, 999).scores.cols).toBe(8);          // capped by maxComp
    expect(pcoa(DIST, 4).coordinates.cols).toBe(4);
    expect(lda(DATA, GROUPS, 1).scores.cols).toBe(1);
  });

  it('no analysis entry point bounds nComponents from above only', () => {
    // Three sibling sites already used the right form (Eigenshape.ts,
    // morphometrics.ts, statistics.ts). These five did not.
    const dirs = [ROOT + '/entry/src/main/core'];
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!name.endsWith('.ts')) continue;
        const lines = readFileSync(p, 'utf-8').split('\n');
        lines.forEach((l, i) => {
          if (l.includes('Math.min(nComponents') && !l.includes('Math.max(1')) {
            offenders.push(p.slice(ROOT.length + 1) + ':' + (i + 1) + ' ' + l.trim());
          }
        });
      }
    };
    for (const d of dirs) walk(d);
    expect(offenders.join(' | ')).toBe('');
  });

  it('LDADialog clamps the component count it publishes', () => {
    // The only numeric dialog input with no validation at all; every other
    // dialog (PCADialog, NMDS, EFADialog, Rarefaction, Extinction, ...) clamps.
    const dlg = readFileSync(
      ROOT + '/entry/src/main/ets/components/dialogs/LDADialog.ets', 'utf-8');
    expect(dlg.includes('this.n_components = Math.max(1, parseInt(v) || 2);')).toBe(true);
    expect(dlg.includes('this.n_components = parseInt(v) || 2;')).toBe(false);
  });
});

describe('audit: the structure gate discarded undecodable bytes instead of reporting them', () => {
  it('structure_check.py reads sources strictly instead of discarding bad bytes', () => {
    const sc = readFileSync(ROOT + '/tools/structure_check.py', 'utf-8');
    // Match the old read call rather than the bare string: check_encoding()'s
    // docstring has to name `errors='ignore'` to explain why it existed, so
    // asserting the string is absent would fail on the explanation.
    expect(sc.includes("src = open(path, encoding='utf-8', errors='ignore').read()")).toBe(false);
    expect(sc.includes("errors='strict'")).toBe(true);
    expect(sc.includes('def check_encoding(')).toBe(true);
  });

  it('every source file in the repo decodes as UTF-8', () => {
    // Node's utf-8 decoder substitutes U+FFFD for undecodable bytes rather than
    // throwing, so scanning for U+FFFD is the equivalent check. The repo has no
    // legitimate U+FFFD (those were repaired in a043604), so any hit is a byte
    // that is not valid UTF-8.
    const skip = new Set(['node_modules', 'build', 'oh_modules', '.git', '.hvigor']);
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (skip.has(name)) continue;
        const p = join(d, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|ets|js|mjs|json|md)$/.test(name)) continue;
        const text = readFileSync(p, 'utf-8');
        if (text.indexOf('\uFFFD') >= 0) bad.push(p.slice(ROOT.length + 1));
      }
    };
    walk(ROOT + '/entry/src');
    walk(ROOT + '/tests');
    walk(ROOT + '/tools');
    expect(bad.join(', ')).toBe('');
  });

  it('the four GBK files now hold a real em dash, not a GBK byte pair', () => {
    // 0xA1 0xAA is the GBK encoding of U+2014. One of these four was mixed --
    // a GBK dash in the header next to correctly encoded UTF-8 box drawing --
    // so it needed a byte-level fix rather than a whole-file transcoding pass.
    const files = [
      'entry/src/main/core/hpc/ProcessPool.ts',
      'entry/src/main/core/parsers/BinaryCache.ts',
      'entry/src/main/core/state_machine/Base.ts',
      'entry/src/main/core/app_infrastructure/ExceptionHandler.ts',
    ];
    for (const f of files) {
      const raw = readFileSync(ROOT + '/' + f);
      expect(raw.includes(Buffer.from([0xa1, 0xaa])) ? f + ' still has the GBK pair' : '')
        .toBe('');
      const text = raw.toString('utf-8');
      expect(text.indexOf('\u2014') >= 0 ? f : f + ' has no em dash').toBe(f);
    }
  });
});
