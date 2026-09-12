/**
 * 3D GPA — replaces morpho3d/gpa3d.py
 *
 * Iteratively aligns 3D landmark configurations by removing translation,
 * isotropic scaling (optional) and rotation, converging on the mean shape.
 *
 * Mathematical theory (see Python source for full derivation):
 *   - Translation:  X'_i = X_i − centroid(X_i)
 *   - Scaling:      X''_i = X'_i / CS_i,  CS = √(trace(X'ᵀX'))
 *   - Rotation:     SVD-based optimal rotation (Kabsch), det(R) = +1
 *   - Convergence:  ‖X̄^(t) − X̄^(t−1)‖_F / ‖X̄^(t−1)‖_F < tol
 */
import { RotationMatrix } from './Quaternion';

export interface GPA3DResult {
  /** Aligned configurations (n_samples × n_landmarks × 3). */
  aligned: number[][][];
  /** Consensus (mean) configuration. */
  meanShape: number[][];
  /** Original centroid size of each sample (Bookstein definition). */
  centroidSizes: number[];
  /** Procrustes distance of each sample to the consensus. */
  procrustesDistances: number[];
  /** Per-sample optimal rotation matrices (3 × 3). */
  rotations: number[][][];
  /** Real number of iterations performed. */
  nIterations: number;
  /** Final mean squared spread around the consensus. */
  finalSpread: number;
  /** Pairwise Procrustes distance matrix (n × n). */
  procrustesDistanceMatrix: number[][];
}

export interface GPA3DOptions {
  /**
   * Fixed reference configuration (n_landmarks × 3).  When given, every
   * specimen is rotated onto the (centered, scaled) reference instead of
   * the running consensus (port of gpa3d.py::GPA3D.analyze(reference=...)).
   */
  reference?: number[][];
  /**
   * Whether to rescale each configuration to unit centroid size
   * (default true; port of gpa3d.py::GPA3D(scale=...)).
   */
  scale?: boolean;
}

/** Centroid size CS = √(Σ ‖x − x̄‖²) of one configuration. */
function _centroidSize(config: number[][]): number {
  const n = config.length;
  const c = [0, 0, 0];
  for (const p of config) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
  let s = 0;
  for (const p of config) {
    const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
    s += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(s);
}

function _centroid(config: number[][]): [number, number, number] {
  const n = config.length;
  const c = [0, 0, 0];
  for (const p of config) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return [c[0] / n, c[1] / n, c[2] / n];
}

/**
 * Core 3D GPA iteration (port of morpho3d/gpa3d.py::GPA3D.analyze).
 *
 * @param configs  list of configurations, each (n_landmarks, 3)
 * @param options  maxIter / tol / reference / scale
 */
export function gpa3d(
  configs: number[][][],
  maxIter: number = 100,
  tol: number = 1e-8,
  options: GPA3DOptions = {},
): GPA3DResult {
  const scale = options.scale ?? true;
  const reference = options.reference;

  const n = configs.length;
  if (n === 0) throw new Error('No configurations provided');
  const nLM = configs[0].length;
  for (let i = 0; i < n; i++) {
    const cfg = configs[i];
    if (cfg.length !== nLM || cfg[0].length !== 3) {
      throw new Error(`Config ${i} has invalid shape (${cfg.length}, ${cfg[0]?.length ?? 0}), expected (${nLM}, 3)`);
    }
  }

  // Initialize: original centroid sizes (Bookstein), rotations = identity
  const aligned: number[][][] = configs.map(cfg => cfg.map(p => [p[0], p[1], p[2]]));
  const centroidSizes = aligned.map(cfg => _centroidSize(cfg));
  const rotations: number[][][] = aligned.map(() => RotationMatrix.identity());

  let prevMean: number[][] | null = null;
  let nIterations = 0;
  let converged = false;

  for (let iteration = 0; iteration < maxIter; iteration++) {
    nIterations = iteration + 1;

    // Step 1: current mean
    const currentMean: number[][] = [];
    for (let j = 0; j < nLM; j++) {
      let mx = 0, my = 0, mz = 0;
      for (let i = 0; i < n; i++) { mx += aligned[i][j][0]; my += aligned[i][j][1]; mz += aligned[i][j][2]; }
      currentMean.push([mx / n, my / n, mz / n]);
    }

    // Step 2: convergence on the mean-shape change
    if (prevMean !== null) {
      let diff = 0, prevNorm = 0;
      for (let j = 0; j < nLM; j++)
        for (let d = 0; d < 3; d++) {
          const v = currentMean[j][d] - prevMean[j][d];
          diff += v * v;
          prevNorm += prevMean[j][d] * prevMean[j][d];
        }
      const diffNorm = Math.sqrt(diff) / (Math.sqrt(prevNorm) + 1e-10);
      if (diffNorm < tol) { converged = true; break; }
    }
    prevMean = currentMean.map(p => [p[0], p[1], p[2]]);

    // Step 3: align every configuration to the target
    // Target = centered (and optionally unit-scaled) reference or consensus
    let target = reference !== null && reference !== undefined
      ? reference.map(p => [p[0], p[1], p[2]])
      : currentMean.map(p => [p[0], p[1], p[2]]);
    {
      const tc = _centroid(target);
      target = target.map(p => [p[0] - tc[0], p[1] - tc[1], p[2] - tc[2]]);
      if (scale) {
        const csTarget = _centroidSize(target);
        if (csTarget > 1e-10) target = target.map(p => [p[0] / csTarget, p[1] / csTarget, p[2] / csTarget]);
      }
    }

    for (let i = 0; i < n; i++) {
      // Translation to the centroid
      const mc = _centroid(aligned[i]);
      let worked = aligned[i].map(p => [p[0] - mc[0], p[1] - mc[1], p[2] - mc[2]]);

      // Isotropic scaling to unit centroid size
      if (scale) {
        const cs = _centroidSize(worked);
        if (cs > 1e-10) worked = worked.map(p => [p[0] / cs, p[1] / cs, p[2] / cs]);
        // Only record on the first iteration: from the second round on the
        // translated configs are already ~unit size and would overwrite the
        // original centroid sizes (mirrors the Python guard).
        if (nIterations === 1) centroidSizes[i] = cs;
      }

      // SVD rotation onto the target (fallback to identity on failure)
      let R: number[][];
      try {
        R = RotationMatrix.procrustes(worked, target);
      } catch {
        R = RotationMatrix.identity();
      }
      rotations[i] = R;
      aligned[i] = worked.map(p => RotationMatrix.apply(R, p as [number, number, number]));
    }
  }

  // Final spread and consensus
  const finalMean: number[][] = [];
  for (let j = 0; j < nLM; j++) {
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += aligned[i][j][0]; my += aligned[i][j][1]; mz += aligned[i][j][2]; }
    finalMean.push([mx / n, my / n, mz / n]);
  }
  let spread = 0;
  for (const cfg of aligned) {
    for (let j = 0; j < nLM; j++) {
      const dx = cfg[j][0] - finalMean[j][0];
      const dy = cfg[j][1] - finalMean[j][1];
      const dz = cfg[j][2] - finalMean[j][2];
      spread += dx * dx + dy * dy + dz * dz;
    }
  }
  const finalSpread = spread / n;

  // Distances to the consensus + pairwise Procrustes distance matrix
  const procDists: number[] = aligned.map(cfg => {
    let dist = 0;
    for (let j = 0; j < nLM; j++) {
      const dx = cfg[j][0] - finalMean[j][0];
      const dy = cfg[j][1] - finalMean[j][1];
      const dz = cfg[j][2] - finalMean[j][2];
      dist += dx * dx + dy * dy + dz * dz;
    }
    return Math.sqrt(dist);
  });
  const distMatrix = computeProcrustesDistanceMatrix(aligned);

  return {
    aligned,
    meanShape: finalMean,
    centroidSizes,
    procrustesDistances: procDists,
    rotations,
    nIterations,
    finalSpread,
    procrustesDistanceMatrix: distMatrix,
  };
}

/**
 * Class wrapper mirroring morpho3d/gpa3d.py::GPA3D.
 *
 * Example:
 *     const gpa = new GPA3D({ tolerance: 1e-8, maxIterations: 100 });
 *     const result = gpa.analyze(configs);
 */
export class GPA3D {
  private _tolerance: number;
  private _maxIter: number;
  private _scale: boolean;

  constructor(options: GPA3DOptions & { tolerance?: number; maxIterations?: number; scale?: boolean } = {}) {
    this._tolerance = options.tolerance ?? 1e-8;
    this._maxIter = options.maxIterations ?? 100;
    this._scale = options.scale ?? true;
  }

  /** Execute the 3D GPA analysis on a list of (n_landmarks, 3) configs. */
  analyze(configs: number[][][], options: GPA3DOptions = {}): GPA3DResult {
    return gpa3d(configs, this._maxIter, this._tolerance, {
      reference: options.reference, scale: options.scale ?? this._scale,
    });
  }

  /**
   * Partial GPA: align only the fixed landmarks (port of
   * gpa3d.py::GPA3D.partial_gpa).  Used as the preprocessing step for
   * semilandmark sliding; the returned configurations contain only the
   * fixed subset.
   */
  partialGpa(configs: number[][][], fixedIndices: number[]): GPA3DResult {
    const fixedConfigs = configs.map(cfg => fixedIndices.map(idx => cfg[idx]));
    return this.analyze(fixedConfigs);
  }

  /** Centroid size of a single configuration. */
  computeCentroidSize(config: number[][]): number {
    return _centroidSize(config);
  }
}

/**
 * Partial GPA convenience function (port of
 * morpho3d/gpa3d.py::compute_partial_gpa).
 */
export function partialGPA3D(
  configs: number[][][],
  fixedIndices: number[],
  tolerance: number = 1e-8,
): GPA3DResult {
  const gpa = new GPA3D({ tolerance });
  return gpa.partialGpa(configs, fixedIndices);
}

/** Alias kept for API parity with the Python name compute_partial_gpa. */
export const computePartialGPA = partialGPA3D;

/**
 * Full Procrustes analysis of two 3D configurations (port of
 * morpho3d/gpa3d.py::procrustes_distance_3d).
 *
 * Both configurations are centered and unit-scaled before the SVD rotation.
 *
 * @returns distance, rotation matrix and scale ratio s = CS₂/CS₁
 */
export function procrustesDistance3D(
  config1: number[][],
  config2: number[][],
): { distance: number; rotation: number[][]; scaleRatio: number } {
  const c1c = _centroid(config1);
  const c2c = _centroid(config2);
  const c1 = config1.map(p => [p[0] - c1c[0], p[1] - c1c[1], p[2] - c1c[2]]);
  const c2 = config2.map(p => [p[0] - c2c[0], p[1] - c2c[1], p[2] - c2c[2]]);

  const cs1 = _centroidSize(c1);
  const cs2 = _centroidSize(c2);

  const n1 = c1.map(p => [p[0] / cs1, p[1] / cs1, p[2] / cs1]);
  const n2 = c2.map(p => [p[0] / cs2, p[1] / cs2, p[2] / cs2]);

  const R = RotationMatrix.procrustes(n1, n2);

  // Rotated config at its original scale: cs1 · n1 @ Rᵀ
  let d = 0;
  for (let i = 0; i < n1.length; i++) {
    const rp = RotationMatrix.apply(R, n1[i] as [number, number, number]);
    const rx = cs1 * rp[0] - c2[i][0];
    const ry = cs1 * rp[1] - c2[i][1];
    const rz = cs1 * rp[2] - c2[i][2];
    d += rx * rx + ry * ry + rz * rz;
  }

  const s = cs1 > 1e-10 ? cs2 / cs1 : 1.0;
  return { distance: Math.sqrt(d), rotation: R, scaleRatio: s };
}

/**
 * Pairwise Procrustes distance matrix (port of
 * morpho3d/gpa3d.py::GPA3D._compute_distance_matrix).  Inputs are expected
 * to be Procrustes-aligned (as produced by {@link gpa3d}); the rotation is
 * computed without re-centering, mirroring the Python helper.
 */
export function computeProcrustesDistanceMatrix(configs: number[][][]): number[][] {
  const n = configs.length;
  const distMatrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Optimal rotation without re-centering (Python _procrustes_distance)
      const R = RotationMatrix.procrustes(configs[i], configs[j]);
      let d = 0;
      for (let k = 0; k < configs[i].length; k++) {
        const rp = RotationMatrix.apply(R, configs[i][k] as [number, number, number]);
        const dx = rp[0] - configs[j][k][0];
        const dy = rp[1] - configs[j][k][1];
        const dz = rp[2] - configs[j][k][2];
        d += dx * dx + dy * dy + dz * dz;
      }
      distMatrix[i][j] = Math.sqrt(d);
      distMatrix[j][i] = distMatrix[i][j];
    }
  }
  return distMatrix;
}
