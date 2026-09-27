/**
 * Regression tests for the defects found while reviewing
 * core/analysis/morphometrics (2026-09-27, second pass).
 *
 * Per AGENTS.md and docs/code-style.md, every test name STATES THE OLD
 * BEHAVIOUR. Every "correct" value comes from scipy 1.15.3 / numpy 1.26.4 in the
 * conda `dev` environment, or from an independent NumPy block-solve.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { eigh } from '../entry/src/main/core/math/linalg.ts';
import {
  allometry, relativeWarps, eigenshape, tpsAnalyze, tpsWarpGrid,
} from '../entry/src/main/core/analysis/morphometrics/index.ts';
import { rmaRegression } from '../entry/src/main/core/analysis/morphometrics/RMA.ts';
import { buildKernelMatrix, buildKernelMatrix3D } from '../entry/src/main/core/analysis/morphometrics/tpsKernel.ts';

/** Deterministic LCG so the datasets below are reproducible byte-for-byte. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}

describe('audit: morphometrics ran a second, unfixed eigensolver', () => {
  const rnd = lcg(20260927);
  const rows: number[][] = [];
  for (let i = 0; i < 30; i++) {
    const row: number[] = [];
    for (let j = 0; j < 6; j++) row.push(rnd() * 10 + j * (i % 3));
    rows.push(row);
  }

  it('relativeWarps reports the true eigen-spectrum, not a wrong one', () => {
    // The module carried its own Jacobi solver (`eigh_local`) alongside the
    // verified one in math/linalg. On this 30x6 matrix it returned
    // [30.591, 12.351, 10.195] where the true spectrum is
    // [37.977, 10.508, 9.358], and eigenvectors that were nearly orthogonal to
    // the true ones (1 - |<v, v'>| = 0.97). Every relative warp axis, the
    // explained-variance table and getShapeAtWarp's reconstructions were built
    // on that. numpy.linalg.eigh reference:
    expect(relativeWarps(Matrix.from2D(rows), 3).eigenvalues[0]).toBeCloseTo(37.97717887200409, 9);
    expect(relativeWarps(Matrix.from2D(rows), 3).eigenvalues[1]).toBeCloseTo(10.50779022584282, 9);
    expect(relativeWarps(Matrix.from2D(rows), 3).eigenvalues[2]).toBeCloseTo(9.357915884986232, 9);
  });

  it('the explained-variance table matches numpy and stays monotonic', () => {
    const rw = relativeWarps(Matrix.from2D(rows), 3);
    const ref = [52.7639931644298, 14.599108941668865, 13.001518924111341];
    for (let i = 0; i < 3; i++) expect(rw.explainedVariance[i]).toBeCloseTo(ref[i], 9);
    // Reported against the FULL variance, so a truncated run does not hit 100%.
    expect(rw.cumulativeVariance[2]).toBeLessThan(100);
    for (let i = 1; i < 3; i++) {
      expect(rw.cumulativeVariance[i]).toBeGreaterThan(rw.cumulativeVariance[i - 1]);
    }
  });

  it('relativeWarps agrees with the verified math/linalg eigh on the same matrix', () => {
    const X = Matrix.from2D(rows);
    const Z = X.sub(X.meanAxis(0));
    const C = Z.transpose().matmul(Z).div(X.rows - 1);
    const ref = eigh(C);
    const rw = relativeWarps(X, 3);
    for (let i = 0; i < 3; i++) expect(rw.eigenvalues[i]).toBeCloseTo(ref.eigenvalues[i], 12);
    // |v| agreement is sign-invariant.
    for (let k = 0; k < 3; k++) {
      let dot = 0;
      for (let i = 0; i < 6; i++) dot += rw.eigenvectors.get(i, k) * ref.eigenvectors.get(i, k);
      expect(Math.abs(Math.abs(dot) - 1)).toBeLessThan(1e-9);
    }
  });
});

describe('audit: the allometry isometry test could never reject', () => {
  function allometricData(allometric: boolean): number[][] {
    const rnd = lcg(4242);
    const nLM = 8;
    const out: number[][] = [];
    for (let i = 0; i < 40; i++) {
      const size = 0.6 + i * 0.05;
      const s = allometric ? size : 1.0;
      const row: number[] = [];
      for (let j = 0; j < nLM; j++) row.push(s * Math.cos((j / nLM) * 2 * Math.PI) + (rnd() - 0.5) * 0.01);
      for (let j = 0; j < nLM; j++) row.push(s * Math.sin((j / nLM) * 2 * Math.PI) + (rnd() - 0.5) * 0.01);
      out.push(row);
    }
    return out;
  }

  it('isometryPValue is now the F upper tail, so allometry is rejected', () => {
    // The p-value went through a local `betainc_local` that summed the
    // ASCENDING hypergeometric series, i.e. the COMPLEMENTARY incomplete beta
    // (it decreases in x). The extra `1 -` cancelled that inversion, so the
    // test never rejected: a strongly allometric dataset (R2 = 0.966,
    // F = 67.2) came back with p = 1.0.
    // scipy: stats.f.sf(67.2138, 16, 38) = 7.0353e-23.
    const r = allometry(Matrix.from2D(allometricData(true)));
    expect(r.rSquared).toBeCloseTo(0.965871, 5);
    expect(r.fStatistic).toBeCloseTo(67.2138, 3);
    expect(r.isometryPValue).toBeLessThan(1e-15);
    expect(r.predictedShapes.anyNaN()).toBe(false);
    expect(r.residuals.anyNaN()).toBe(false);
  });

  it('a genuinely isometric dataset still fails to reject isometry', () => {
    // scipy: stats.f.sf(0.203526, 16, 38) = 0.999357136
    const r = allometry(Matrix.from2D(allometricData(false)));
    expect(r.fStatistic).toBeCloseTo(0.203526, 5);
    expect(r.isometryPValue).toBeCloseTo(0.999357136, 8);
    expect(r.isometryPValue).toBeGreaterThan(0.05);
  });
});

describe('audit: RMA quoted a confidence interval thousands of times too wide', () => {
  it('slopeCI is symmetric about the slope and uses the real t quantile', () => {
    // The module carried its own t quantile on top of a mistranscribed
    // Numerical Recipes 6.2C continued fraction (NR alternates TWO different
    // `aa` forms per iteration; the port merged them into one with the wrong
    // denominators). tCDF was wrong, Newton diverged, and a slope of 2.01 at
    // n = 12 got a 95% interval of [-388, 390] -- with the "lower" bound above
    // the "upper". For df > 100 it silently used the normal quantile.
    const rnd = lcg(99);
    const X: number[] = [], Y: number[] = [];
    for (let i = 0; i < 12; i++) { X.push(1 + i); Y.push(2 + 2 * i + (rnd() - 0.5) * 0.6); }
    const r = rmaRegression(X, Y);
    // scipy: t.ppf(0.975, 10) = 2.228138852
    expect((r.slopeCI[1] - r.slopeCI[0]) / 2 / r.slopeSE).toBeCloseTo(2.228138852, 9);
    expect((r.slopeCI[0] + r.slopeCI[1]) / 2).toBeCloseTo(r.slope, 12);
    expect(r.slopeCI[0]).toBeCloseTo(1.9877499376431589, 10);
    expect(r.slopeCI[1]).toBeCloseTo(2.0406509234126475, 10);
    expect(r.r).toBeCloseTo(0.999826305771, 10);
    // and the interval must actually contain the slope
    expect(r.slopeCI[0]).toBeLessThan(r.slope);
    expect(r.slopeCI[1]).toBeGreaterThan(r.slope);
  });

  it('the interval is no longer inverted for small samples either', () => {
    for (const n of [5, 8, 20, 40, 200]) {
      const rnd = lcg(7 + n);
      const X: number[] = [], Y: number[] = [];
      for (let i = 0; i < n; i++) { X.push(i + 1); Y.push(3 * (i + 1) + (rnd() - 0.5) * 2); }
      const r = rmaRegression(X, Y);
      expect(r.slopeCI[0]).toBeLessThan(r.slopeCI[1]);
      const half = (r.slopeCI[1] - r.slopeCI[0]) / 2;
      expect(half).toBeLessThan(Math.abs(r.slope));
      expect(half).toBeGreaterThan(0);
    }
  });
});

describe('audit: eigenshape indexed past the eigenvector matrix', () => {
  const rnd = lcg(11);
  const coefs: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const row: number[] = [];
    for (let j = 0; j < 3; j++) row.push(rnd() * 4 - 2);
    coefs.push(row);
  }

  it('asking for more components than variables is clamped, not NaN-filled', () => {
    // `nc` was `nComponents ?? min(len, nVar)`, so a request above nVar indexed
    // `order[k]` past the end of the eigenvalue array: the loading matrix and
    // the summary string filled with NaN.
    const r = eigenshape(coefs, 9);
    expect(r.nComponents).toBe(3);
    expect(r.scores.cols).toBe(3);
    expect(r.eigenvalues.length).toBe(3);
    for (const v of r.eigenvalues) expect(Number.isNaN(v)).toBe(false);
    expect(r.summary.includes('NaN')).toBe(false);
  });

  it('the legal component count still matches numpy', () => {
    const r = eigenshape(coefs, 3);
    // numpy.linalg.eigvalsh of the centred covariance
    expect(r.eigenvalues[0]).toBeCloseTo(1.2899543333633365, 10);
    expect(r.eigenvalues[1]).toBeCloseTo(1.0019850723870187, 10);
    expect(r.eigenvalues[2]).toBeCloseTo(0.0976806683012752, 10);
  });
});

describe('audit: the 3D TPS grid handed back NaN for every coordinate', () => {
  const src = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0.5, 0.5, 0.5]];
  const tgt = [[0, 0, 0], [1, 0.1, 0], [1, 1, 0.1], [0, 1, 0], [0.5, 0.5, 0.8]];

  it('tpsWarpGrid refuses a 3D fit instead of warping a planar lattice', () => {
    // The lattice was built as [x, y] pairs and then handed to a 3D warp,
    // which reads p[2] -- undefined -- so every warped coordinate came back
    // NaN. The 2D path is unaffected.
    const fit = tpsAnalyze(src, tgt);
    let msg = '';
    try { tpsWarpGrid(fit, 6, 6); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('only supports 2D');
    const fit2d = tpsAnalyze([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [1, 0.1], [1, 1], [0, 1]]);
    const g = tpsWarpGrid(fit2d, 5, 5);
    expect(g.warpedPoints.length).toBe(5);
    expect(g.warpedPoints[0].length).toBe(5);
    for (const row of g.warpedPoints) for (const p of row) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });

  it('a degenerate grid size is rejected rather than dividing by zero', () => {
    const fit2d = tpsAnalyze([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [1, 0.1], [1, 1], [0, 1]]);
    let msg = '';
    try { tpsWarpGrid(fit2d, 1, 5); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('at least 2 rows');
  });

  it('the 3D fit itself is right (bending energy matches a NumPy block solve)', () => {
    const fit = tpsAnalyze(src, tgt);
    // numpy: solve [[K P];[P^T 0]] with K = -|r| and take w'Kw
    expect(fit.bendingEnergy).toBeCloseTo(0.008535534, 9);
    expect(fit.nDims).toBe(3);
  });
});

describe('audit: buildKernelMatrix silently used the 2D kernel for dim = 3', () => {
  it('dim = 3 is refused, pointing at the 3D builder', () => {
    // The `dim` argument only limited the coordinate loop; the kernel was
    // always r^2 log r. A 3D request therefore got a planar-kernel matrix
    // with no diagnostic.
    let msg = '';
    try { buildKernelMatrix([[0, 0, 0], [1, 0, 0], [0, 1, 0]], 3); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('buildKernelMatrix3D');
  });

  it('both builders still produce the right kernel on the right dimension', () => {
    // r^2 log r: only the off-diagonals at distance 1 survive, r^2 ln r = ln 1 = 0
    const k2 = buildKernelMatrix([[0, 0], [1, 0], [0, 1]], 2);
    for (let i = 0; i < 9; i++) expect(k2.data[i]).toBeCloseTo(0, 12);
    // -|r|: unit distances give -1, the diagonal distance sqrt(2) gives -1.4142
    const k3 = buildKernelMatrix3D([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    const ref = [0, -1, -1, -1, 0, -Math.SQRT2, -1, -Math.SQRT2, 0];
    for (let i = 0; i < 9; i++) expect(k3.data[i]).toBeCloseTo(ref[i], 12);
  });
});
