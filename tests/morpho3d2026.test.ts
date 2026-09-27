/**
 * Regression tests for the 3-D morphometrics defects found while validating
 * core/analysis/morpho3d before considering whether to wire it into the UI.
 *
 * Test names state the OLD behaviour, per AGENTS.md.
 */
import { describe, it, expect } from './runner.ts';
import { tps3dFit, transformPoints, computeNormals, meshArea, computeVolume, computeEdges, slideLandmarks } from '../entry/src/main/core/analysis/morpho3d/index.ts';

describe('audit: morpho3d numerical validation', () => {
  it('TPS bending energy is no longer negative for every real deformation', () => {
    // The raw quadratic form came out negative for all 20 random warps tested
    // (smallest -22.75), and a 5-point zigzag reported -0.5. A bending energy is
    // non-negative by definition, and TPSDialog's "Energy > 0.1: localized"
    // threshold could therefore never fire.
    const src = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]];
    const tgt = [[0, 0, 0], [1, 0.5, 0], [2, 0, 0], [3, 0.5, 0], [4, 0, 0]];
    expect(tps3dFit(src, tgt).bendingEnergy >= 0).toBe(true);

    // 20 pseudo-random warps, all kernels.
    let s = 12345;
    const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (const kernel of ['thin_plate', 'cubic', 'multiquadric', 'gaussian'] as const) {
      for (let t = 0; t < 10; t++) {
        const a: number[][] = [], b: number[][] = [];
        for (let i = 0; i < 8; i++) {
          a.push([rnd() * 3, rnd() * 3, rnd() * 3]);
          b.push([rnd() * 3, rnd() * 3, rnd() * 3]);
        }
        expect(tps3dFit(a, b, { kernel }).bendingEnergy >= 0).toBe(true);
      }
    }
  });

  it('a straight-line fit still has exactly zero bending weight', () => {
    // Guards against "fixing" the sign by breaking the solve: a similarity of a
    // line is linear, so it lies in the TPS function space and all bending
    // weights must vanish.
    const src = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]];
    const tgt = [[0, 0, 0], [2, 0, 0], [4, 0, 0], [6, 0, 0], [8, 0, 0]];
    const r = tps3dFit(src, tgt);
    const maxW = Math.max(...r.weights.flat().map(Math.abs));
    expect(maxW < 1e-10).toBe(true);
    expect(Math.abs(r.bendingEnergy) < 1e-12).toBe(true);
  });

  it('TPS still interpolates its control points exactly', () => {
    const src = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [1, 0, 1], [0.4, 0.7, 0.2]];
    const tgt = [[0.1, 0, 0], [1.2, 0.1, 0], [0, 0.9, 0.1], [0, 0, 1.1], [1.1, 1.0, 1.2], [1.0, 0.2, 1.0], [0.5, 0.6, 0.3]];
    const out = transformPoints(tps3dFit(src, tgt), src);
    let worst = 0;
    for (let i = 0; i < src.length; i++) for (let k = 0; k < 3; k++) {
      worst = Math.max(worst, Math.abs(out[i][k] - tgt[i][k]));
    }
    expect(worst < 1e-9).toBe(true);
  });

  it('computeNormals returns unit vectors (they were scaled by the area weight)', () => {
    // The final step divided the accumulated normal by the accumulated AREA
    // instead of by its own length, so a unit cube vertex came back as
    // [-0.2, -0.4, -0.4] — magnitude 0.6, not a unit vector at all.
    const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    const f = [[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const n = computeNormals({ vertices: v, faces: f });
    expect(n.length).toBe(8);
    for (const x of n) expect(Math.abs(Math.hypot(x[0], x[1], x[2]) - 1)).toBeLessThan(1e-12);
    // A planar patch must come out exactly along +/-z.
    const flat = computeNormals({
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], faces: [[0, 1, 2], [0, 2, 3]],
    });
    for (const x of flat) {
      expect(Math.abs(Math.abs(x[2]) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(x[0])).toBeLessThan(1e-12);
      expect(Math.abs(x[1])).toBeLessThan(1e-12);
    }
  });

  it('mesh area, volume and edge extraction agree with the unit cube', () => {
    // These were already correct — pinned so a future refactor cannot regress
    // them alongside the normal-vector fix.
    const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    const f = [[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const mesh = { vertices: v, faces: f };
    expect(Math.abs(meshArea(mesh) - 6)).toBeLessThan(1e-9);
    expect(Math.abs(computeVolume(mesh) - 1)).toBeLessThan(1e-9);
    // 12 cube edges + 6 face diagonals (this triangulation has them).
    expect(computeEdges(mesh).length).toBe(18);
  });

  it('semilandmark sliding keeps fixed endpoints and lands points on the curve', () => {
    const landmarks = [[0, 0], [1, 0.4], [2, 0.3], [3, 0.5], [4, 0.2]];
    const curve = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    const r = slideLandmarks(landmarks, curve, [1, 2, 3], 'MEC', 20);
    expect(r.slidLandmarks.length).toBe(5);
    expect(Math.abs(r.slidLandmarks[0][0])).toBeLessThan(1e-8);
    expect(Math.abs(r.slidLandmarks[4][1] - 0.2)).toBeLessThan(1e-8);
    for (let i = 1; i <= 3; i++) expect(Math.abs(r.slidLandmarks[i][1])).toBeLessThan(1e-8);
  });
});
