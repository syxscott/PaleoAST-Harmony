/**
 * Regression test: the Bray-Curtis denominator was missing its absolute value
 * (2026-09-27, eighth pass).
 *
 * Both copies of the metric were written as
 *
 *     num += Math.abs(a[k] - b[k]);
 *     den += a[k] + b[k];          // no abs
 *
 * so a vector pair whose components sum to zero or less makes `den <= 0`, the
 * `den > 0 ? ... : 0` guard fires, and two clearly different samples come back
 * at distance 0 -- i.e. IDENTICAL to NMDS / PCoA / ANOSIM / PERMANOVA / SIMPER,
 * with no error anywhere. Measured before the fix: [-1,-2] vs [-3,-4] gave
 * 0.0 where scipy gives 0.4.
 *
 * scipy's own docstring (scipy 1.15.3) gives the definition:
 *
 *     \sum{|u_i - v_i|} / \sum{|u_i + v_i|}
 *
 * so the abs belongs around the SUM. The textbook ecological form
 * sum(|u_i| + |v_i|) is NOT what scipy computes -- it disagrees on 2 of the 6
 * cases below -- and picking it from memory would have been wrong. Every
 * expected value here was produced by running scipy, not derived by hand.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { computeDistanceMatrix } from '../entry/src/main/core/analysis/statistics/statistics.ts';
import { rowDistance } from '../entry/src/main/core/scipy/DistanceCluster.ts';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';

const ROOT = 'D:/GIthub/PaleoAST-Harmony/';
const source = (rel: string) => readFileSync(ROOT + rel, 'utf-8');

// [a, b, scipy's answer] -- all six verified against scipy 1.15.3.
const CASES: [number[], number[], number][] = [
  [[1, 2, 3], [4, 5, 6], 9 / 21],            // all non-negative: 0.4285714286
  [[1, -2, 3], [4, 5, -6], 19 / 11],         // negatives: 1.7272727273
  [[1, -1], [0.5, -0.5], 1 / 3],             // sum is exactly 0: 0.3333333333
  [[-1, -2], [-3, -4], 4 / 10],              // both all-negative: 0.4
  [[2, -5, 3], [-4, 6, 1], 19 / 7],          // 2.7142857143
  [[10, -1], [1, -10], 18 / 22],             // 0.8181818182
];

const close = (a: number, b: number) => Math.abs(a - b) < 1e-12;

describe('audit: the Bray-Curtis denominator was missing its absolute value', () => {
  it('matches scipy on all six cases, including the signed ones', () => {
    for (const [a, b, want] of CASES) {
      const got = rowDistance(a, b, 'braycurtis');
      expect(close(got, want) ? 'ok' : `${a} vs ${b}: got ${got}, scipy ${want}`).toBe('ok');
    }
  });

  it('the live computeDistanceMatrix agrees with the scipy mirror', () => {
    for (const [a, b, want] of CASES) {
      const M = Matrix.from2D([a, b]);
      expect(close(computeDistanceMatrix(M, 'bray_curtis').get(0, 1), want) ? 'ok' : 'mismatch').toBe('ok');
      // symmetry
      expect(close(computeDistanceMatrix(M, 'bray_curtis').get(1, 0), want) ? 'ok' : 'asymmetric').toBe('ok');
    }
  });

  it('two different samples are no longer reported as identical', () => {
    // The failure mode: `den > 0 ? num / den : 0` returning 0.0, which every
    // downstream consumer reads as "these two specimens are the same".
    const d = rowDistance([-1, -2], [-3, -4], 'braycurtis');
    expect(d > 0 ? 'positive' : 'still 0 -- reported identical').toBe('positive');
    expect(close(d, 0.4) ? 'ok' : 'value').toBe('ok');
  });

  it('all-non-negative data is unchanged, so existing results still hold', () => {
    // Abundance / count / length data is the common case, and there all three
    // candidate denominators agree -- so nothing about existing results moves.
    const M = Matrix.from2D([[1, 2, 3], [4, 5, 6]]);
    expect(close(computeDistanceMatrix(M, 'bray_curtis').get(0, 1), 9 / 21) ? 'ok' : 'changed').toBe('ok');
    const rows = Matrix.from2D([[0, 1, 2], [3, 4, 5], [6, 7, 8]]);
    const D = computeDistanceMatrix(rows, 'bray_curtis');
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(D.get(i, j) > 0 || i === j ? 'ok' : 'zero distance off-diagonal').toBe('ok');
      }
    }
  });

  it('both copies use the same formula', () => {
    // The bug existed in two places, so it is fixed in two places. If a third
    // copy is ever added, this is the assertion that should catch the drift.
    const stats = source('entry/src/main/core/analysis/statistics/statistics.ts');
    const scipy = source('entry/src/main/core/scipy/DistanceCluster.ts');
    expect(stats.includes('den += Math.abs(a[k] + b[k]);') ? 'stats' : 'stats wrong').toBe('stats');
    expect(scipy.includes('den += Math.abs(a[k] + b[k]);') ? 'scipy' : 'scipy wrong').toBe('scipy');
    expect(stats.includes('den += a[k] + b[k];') ? 'stats still old' : '').toBe('');
    expect(scipy.includes('den += a[k] + b[k];') ? 'scipy still old' : '').toBe('');
  });
});
