/**
 * Regression tests for the morphometrics / morpho3d defects found in the
 * 2026-10-19 review round.
 *
 * Per AGENTS.md every test name STATES THE OLD BEHAVIOUR.  Every reference
 * value is either an exact mathematical identity (a rigid motion must be
 * removed by the Procrustes fit, so the residual is 0) or was checked
 * against an independent NumPy implementation in the conda `dev`
 * environment.
 *
 * These suites cover the files this agent owns:
 *   core/analysis/morphometrics/{morphometrics,PartialGPA,Integration,tpsKernel}.ts
 *   core/analysis/morpho3d/{Quaternion,Sliding}.ts
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import {
  gpa, allometry, tpsDeformation, divideConfigurationIntoBlocks,
} from '../entry/src/main/core/analysis/morphometrics/morphometrics.ts';
import { gpaAlign } from '../entry/src/main/core/analysis/morphometrics/PartialGPA.ts';
import { plsIntegration } from '../entry/src/main/core/analysis/morphometrics/Integration.ts';
import {
  buildKernelMatrix, buildKernelMatrix3D,
} from '../entry/src/main/core/analysis/morphometrics/tpsKernel.ts';
import { RotationMatrix } from '../entry/src/main/core/analysis/morpho3d/Quaternion.ts';
import { slideLandmarks } from '../entry/src/main/core/analysis/morpho3d/Sliding.ts';

/** Five 2D landmarks (x, y). */
const LM2D: number[][] = [
  [0, 0], [1, 0], [1.5, 0.8], [0.3, 1.4], [2, 1],
];

/** Encode a configuration in the module-wide COORDINATE-MAJOR layout. */
function flat2D(cfg: number[][]): number[] {
  const out: number[] = [];
  for (let d = 0; d < 2; d++) for (const p of cfg) out.push(p[d]);
  return out;
}

/** Rotate a 2D configuration by `angle` and translate it. */
function rigid2D(cfg: number[][], angle: number, tx: number, ty: number): number[][] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return cfg.map(([x, y]) => [c * x - s * y + tx, s * x + c * y + ty]);
}

/** Centre a configuration on its centroid. */
function center3D(cfg: number[][]): number[][] {
  const n = cfg.length;
  const mean = [0, 0, 0];
  for (const p of cfg) for (let d = 0; d < 3; d++) mean[d] += p[d] / n;
  return cfg.map(p => [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]]);
}

describe('audit: the Kabsch rotation was applied transposed, so no specimen ever stacked', () => {
  it('gpa superimposes a rigid pair (rotation + translation) exactly and converges', () => {
    // `_findRotation` returns the COLUMN-vector Kabsch rotation (p' = R·p),
    // but `_rotateConfig` applied it to the row vectors as cfg @ R instead of
    // cfg @ Rᵀ.  Every specimen was therefore rotated by the inverse of the
    // rotation it needed: a rigid pair came back with Procrustes distances
    // 0.2370 / 0.2370, `converged: false` and all 100 iterations burnt.  The
    // translation-only control case hid the bug completely (it scored
    // 1.58e-16 there), which is why the only pre-existing test passed.
    //
    // NumPy reference (numpy 2.2.6, conda `dev`): an independent GPA loop
    // over the same two configurations converges in 3 iterations with
    // sse = 2.26e-31 and Procrustes distances of 1.3e-16 / 1.8e-16, and
    // max|Xc @ R - Yc| = 2.5e-16 for the corrected rotation.
    const A = LM2D;
    const B = rigid2D(A, 0.85, 3, -2);
    const r = gpa(Matrix.from2D([flat2D(A), flat2D(B)]), 100, 1e-8, 5, 2);
    for (const d of r.procrustesDistances) expect(d).toBeWithin(0, 1e-9);
    expect(r.converged).toBe(true);
    expect(r.nIterations).toBeLessThan(20);
    expect(r.finalSSE).toBeWithin(0, 1e-16);
    // The two specimens are congruent, so the consensus is their (unit
    // centroid-size) shape and both distances vanish.
    expect(r.centroidSizes[0]).toBeWithin(r.centroidSizes[1], 1e-12);
  });

  it('gpa still superimposes a pure translation (the case the old test covered)', () => {
    const A = LM2D;
    const B = LM2D.map(([x, y]) => [x + 5, y - 7]);
    const r = gpa(Matrix.from2D([flat2D(A), flat2D(B)]), 100, 1e-8, 5, 2);
    for (const d of r.procrustesDistances) expect(d).toBeWithin(0, 1e-9);
    expect(r.converged).toBe(true);
  });

  it('PartialGPA.gpaAlign superimposes a rigid pair (sse -> 0)', () => {
    // The same transposition, copied verbatim into PartialGPA.rotateConfig:
    // `PartialGPA.gpaAlign(rigid pair)` reported sse = 0.14366 and
    // `converged: false` where the reference value is 0.
    const A = LM2D;
    const B = rigid2D(A, 0.85, 3, -2);
    const r = gpaAlign([A, B], 100, 1e-8);
    expect(r.sse).toBeWithin(0, 1e-14);
    expect(r.converged).toBe(true);
  });

  it('PartialGPA.gpaAlign keeps the unrotated case exact', () => {
    const A = LM2D;
    const B = LM2D.map(([x, y]) => [x + 5, y - 7]);
    const r = gpaAlign([A, B], 100, 1e-8);
    expect(r.sse).toBeWithin(0, 1e-14);
  });
});

describe('audit: the 3D Procrustes rotation was V·U instead of V·Uᵀ', () => {
  it('RotationMatrix.procrustes superimposes a rigid 3D pair exactly', () => {
    // `R[i][j] += V[i][k] * U[k][j]` is V·U, the transpose of the product the
    // comment asks for.  Both are orthogonal with det = +1, so the matrix
    // looked healthy while rotating the specimen the wrong way: on this
    // point set the residual max|apply(R, A) − B| was 0.759 (the review
    // measured 7.7e-1 on another) instead of 0.  NumPy: with R = V·Uᵀ the
    // residual is 2.2e-16 and max|R − R_true| = 3.3e-16.
    const A = center3D([
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0.4, 0.7, 0.2],
    ]);
    const Rtrue = RotationMatrix.fromAxisAngle([0.2, 0.5, 0.84], 0.73);
    const B = A.map(p => RotationMatrix.apply(Rtrue, p as [number, number, number]));

    const R = RotationMatrix.procrustes(A, B);
    let worst = 0;
    for (let i = 0; i < A.length; i++) {
      const rp = RotationMatrix.apply(R, A[i] as [number, number, number]);
      for (let d = 0; d < 3; d++) worst = Math.max(worst, Math.abs(rp[d] - B[i][d]));
    }
    expect(worst).toBeWithin(0, 1e-10);
    expect(RotationMatrix.verifySpecial(R)).toBe(true);
  });
});

describe('audit: the block division called a helper that no longer existed', () => {
  it('divideConfigurationIntoBlocks no longer throws ReferenceError', () => {
    // Commit 3a78612 deleted the definition of `_selectColumns` (with its
    // comment) but kept the two call sites, so the DEFAULT mode — the one
    // behind the UI quick action "Centroid Configuration Blocks" — died with
    // `ReferenceError: _selectColumns is not defined` 100% of the time.
    const rows = [
      [0, 1, 2, 3, 10, 11, 12, 13],
      [4, 5, 6, 7, 14, 15, 16, 17],
    ];
    const M = Matrix.from2D(rows);
    const [a, b] = divideConfigurationIntoBlocks(M, 'anterior_posterior');
    expect(a.cols).toBe(4);
    expect(b.cols).toBe(4);
    // Coordinate-major layout (the one `gpa` produces): landmark j owns the
    // columns j and nLandmarks + j, so the first half of the landmarks is
    // columns 0, 1, 4, 5.
    expect(a.get(0, 0)).toBe(0);
    expect(a.get(0, 1)).toBe(1);
    expect(a.get(0, 2)).toBe(10);
    expect(a.get(0, 3)).toBe(11);
    expect(b.get(0, 0)).toBe(2);
    expect(b.get(0, 1)).toBe(3);
    expect(b.get(0, 2)).toBe(12);
    expect(b.get(0, 3)).toBe(13);
  });

  it('the random division also works and is reproducible', () => {
    const rows = [
      [0, 1, 2, 3, 10, 11, 12, 13],
      [4, 5, 6, 7, 14, 15, 16, 17],
    ];
    const M = Matrix.from2D(rows);
    const [a1, b1] = divideConfigurationIntoBlocks(M, 'random', 7);
    const [a2, b2] = divideConfigurationIntoBlocks(M, 'random', 7);
    expect(a1.cols).toBe(4);
    expect(b1.cols).toBe(4);
    for (let i = 0; i < a1.rows; i++)
      for (let j = 0; j < a1.cols; j++) expect(a1.get(i, j)).toBe(a2.get(i, j));
  });
});

describe('audit: a zero-size specimen made the isometry test report p = 1', () => {
  it('allometry refuses a specimen whose landmarks all coincide', () => {
    // The third specimen has centroid size 0, so log(CS) = -Infinity went
    // into the design matrix; XᵀX then held ±Infinity, Gauss-Jordan
    // produced NaN, and the pivot guard `Math.abs(pivot) < 1e-15` never
    // fired (NaN comparisons are false).  The result was rSquared = NaN,
    // F = 0 and isometryPValue = 1.0 — a confident "no allometry" for a
    // regression that never ran.
    const rows = [
      [1, 0, 0, 1, 1, 1],
      [2, 0, 0, 2, 2, 2],
      [0, 0, 0, 0, 0, 0],
    ];
    let msg = '';
    try { allometry(Matrix.from2D(rows)); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('centroid size');
    expect(msg).toContain('specimen 2');
  });
});

describe('audit: a singular TPS system produced a garbage deformation grid', () => {
  it('tpsDeformation refuses collinear source landmarks', () => {
    // Four collinear landmarks make the affine basis P = [1, x, y] linearly
    // dependent, so the block system is singular.  The elimination SKIPPED
    // the singular column (`continue`) and solved the system anyway: every
    // point of the returned grid had x = -1.  The sibling implementations
    // (PartialGPA._solveLinearSystem, TPSAnalyzer._solveBlock) both throw.
    const src = [[0, 0], [1, 0], [2, 0], [3, 0]];
    const tgt = [[0, 0], [1, 0.5], [2, 0], [3, 0]];
    let msg = '';
    try { tpsDeformation(src, tgt, 5); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('singular');
  });

  it('tpsDeformation still warps a well-conditioned configuration', () => {
    const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const tgt = [[0, 0], [1, 0.1], [1, 1], [0, 1]];
    const r = tpsDeformation(src, tgt, 5);
    expect(r.deformedGrid.length).toBe(25);
    expect(r.bendingEnergy).toBeGreaterThan(0);
    for (const p of r.deformedGrid) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });

  it('tpsDeformation refuses 3D landmarks instead of truncating them', () => {
    const src = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let msg = '';
    try { tpsDeformation(src, src, 5); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('only supports 2D');
  });
});

describe('audit: the semilandmark weights were dim-major while bendingEnergy wanted n x dim', () => {
  it('slideLandmarks no longer throws a TypeError with four semi-landmarks', () => {
    // `_estimateTPSWeights` returned 3 x n (dim-major) but `bendingEnergy`
    // indexes weights[j][c]; with four or more semi-landmarks the index ran
    // off the end of the array ("Cannot read properties of undefined
    // (reading '0')").  With three semi-landmarks it did not crash, but the
    // energy was taken from the wrong coordinate components.
    const curve: number[][] = [];
    for (let i = 0; i < 9; i++) curve.push([i, 0, 0]);
    const landmarks: number[][] = [];
    for (let i = 0; i < 9; i++) landmarks.push([i, 0.25, 0]);
    const r = slideLandmarks(landmarks, curve, [5, 6, 7, 8], 'MEC', 2);
    expect(r.slidLandmarks.length).toBe(9);
    expect(Number.isFinite(r.finalBendingEnergy)).toBe(true);
    for (const p of r.slidLandmarks) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
      expect(Number.isFinite(p[2])).toBe(true);
    }
  });

  it('a semi-landmark is projected onto the point of the curve nearest to it', () => {
    // The old projection mixed two parameterizations — a normalized index
    // against a chord-length parameter — so a semi-landmark on a unit-spaced
    // line was dropped at 0.0 instead of 0.5, at 0.25 instead of 1.5, at
    // 0.5 instead of 2.5 and at 0.75 instead of 3.5.
    //
    // A single semi-landmark is used on purpose: the sliding gradient is
    // computed from the OTHER semi-landmarks, so with one of them the
    // gradient is exactly zero and the test observes the projection alone.
    const curve: number[][] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    for (const x of [0.5, 1.5, 2.5, 3.5]) {
      const landmarks: number[][] = [[0, 0], [x, 0.3], [1, 0], [2, 0], [3, 0], [4, 0]];
      const r = slideLandmarks(landmarks, curve, [1], 'MEC', 1);
      expect(r.slidLandmarks[1][0]).toBeWithin(x, 1e-9);
      expect(r.slidLandmarks[1][1]).toBeWithin(0, 1e-9);
    }
  });
});

describe('audit: the Escoufier RV coefficient was off by a factor of (n-1)^2', () => {
  it('two identical blocks score RV = 1', () => {
    // `C` was the cross-covariance AᵀB/(n-1) while `Saa`/`Sbb` were the
    // unscaled AᵀA / BᵀB, so the (n-1)² cancelled nowhere: identical blocks
    // scored 1/49 (n = 8) instead of 1.  NumPy: (C*C).sum() /
    // sqrt((Saa*Saa).sum() * (Sbb*Sbb).sum()) with all three blocks scaled
    // by 1/(n-1) gives exactly 1.0.
    const A = [
      [1, 2, 3, 4], [5, 3, 2, 1], [2, 6, 5, 3], [8, 1, 4, 2],
      [3, 3, 7, 1], [4, 9, 2, 6], [7, 2, 8, 5], [6, 5, 1, 3],
    ];
    const r = plsIntegration(Matrix.from2D(A), Matrix.from2D(A), 2, 99);
    expect(r.rvCoefficient).toBeWithin(1, 1e-9);
    // The integration index (mean |correlation|) was already correct and
    // must stay at 1 for identical blocks.
    expect(r.integrationIndex).toBeWithin(1, 1e-9);
  });

  it('unrelated blocks score RV well below 1', () => {
    const A = [[1, 2], [3, 5], [2, 1], [5, 3], [4, 6], [6, 2]];
    const B = [[6, 1], [1, 4], [5, 2], [2, 5], [3, 3], [4, 1]];
    const r = plsIntegration(Matrix.from2D(A), Matrix.from2D(B), 2, 99);
    expect(r.rvCoefficient).toBeLessThan(1);
    expect(r.rvCoefficient).toBeGreaterThanOrEqual(0);
  });
});

describe('audit: the 3D kernel was still the 2D one', () => {
  it('the 2D builder refuses dim = 3 and points at the 3D builder', () => {
    let msg = '';
    try { buildKernelMatrix([[0, 0, 0], [1, 0, 0], [0, 1, 0]], 3); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('buildKernelMatrix3D');
  });

  it('the 2D builder gives r^2 log r and the 3D builder gives -|r|', () => {
    // 2D: r^2 log r is 0 at r = 1, but NOT at r = sqrt(2) — there it is
    // 2 * log(sqrt(2)) = log 2 = 0.6931.  (The old expectation of an
    // all-zero matrix was wrong: the (1,0)-(0,1) pair sits at distance
    // sqrt(2).)
    const k2 = buildKernelMatrix([[0, 0], [1, 0], [0, 1]], 2);
    const ref2 = [0, 0, 0, 0, 0, Math.LN2, 0, Math.LN2, 0];
    for (let i = 0; i < 9; i++) expect(k2.data[i]).toBeWithin(ref2[i], 1e-12);
    // 3D: the thin-plate kernel of Bookstein (1991) is -|r|: -1 at r = 1 and
    // -sqrt(2) at the diagonal distance.
    const k3 = buildKernelMatrix3D([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    const ref3 = [0, -1, -1, -1, 0, -Math.SQRT2, -1, -Math.SQRT2, 0];
    for (let i = 0; i < 9; i++) expect(k3.data[i]).toBeWithin(ref3[i], 1e-12);
  });
});

describe('audit: gpa accepted a "nComponents" argument that meant something else entirely', () => {
  it('a dimensions-per-landmark value other than 2 or 3 is refused', () => {
    // The 6th argument is an alias of nDims (dimensions per landmark), while
    // the RESULT field `nComponents` is the total number of coordinates per
    // specimen — opposite meanings under the same name.  `gpa(data, 100,
    // 1e-8, undefined, undefined, 6)` was read as "6 dimensions per
    // landmark", and `_detSmall` then computed the determinant of the
    // leading 3x3 block of a 6x6 matrix, so the reflection correction
    // never fired.
    const rows = [[0, 1, 2, 3, 4, 5], [1, 0, 1, 2, 3, 4]];
    let msg = '';
    try { gpa(Matrix.from2D(rows), 100, 1e-8, undefined, undefined, 6); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('nDims must be 2 or 3');
  });
});
