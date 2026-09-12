/**
 * Partial Generalized Procrustes Analysis with semilandmark sliding.
 *
 * Port of morphometrics/gpa.py::partial_gpa and its helper functions
 * (_slide_semilandmarks, _slide_2d_curve, _slide_3d_surface,
 * _compute_curve_tangents, _compute_surface_tangents_and_normals,
 * _compute_bending_energy, _compute_local_bending_energy,
 * _prepare_configurations).  This is the multi-specimen system: all
 * specimens are slid jointly against a common consensus.
 *
 * Semilandmark sliding follows Bookstein (1997) and Gunz et al. (2005):
 * - Fixed landmarks are aligned via standard GPA
 * - Semilandmarks slide along their curve/surface to minimize bending energy
 * - Iterative refinement until convergence
 *
 * Bending Energy Function (Bookstein 1997):
 *     B(f) = ∫∫ (∂²f/∂x²)² + 2(∂²f/∂x∂y)² + (∂²f/∂y²)² dx dy
 *
 * The sliding objective is
 *     objective = Procrustes_distance + λ * bending_energy
 * where λ is the sliding weight (typically 1.0).
 *
 * References:
 * - Bookstein, F.L. (1997). Morphometric tools for landmark data.
 *   Cambridge University Press. Chapter 8.
 * - Bookstein, F.L. (1989). "Principal warps: thin-plate splines and the
 *   decomposition of deformations." IEEE TPAMI 11(6): 567-585.
 * - Gunz, P., Mitteroecker, P. & Bookstein, F.L. (2005). "Semilandmarks in
 *   three dimensions." Anatomical Record 293(4): 613-625.
 * - Rohlf, F.J. (1999). "Shape statistics: Procrustes superimposition and
 *   tangent spaces." Taxon 48: 213-227.
 * - Dryden, I.L. & Mardia, K.V. (2016). Statistical Shape Analysis, 2nd ed.
 */
import { Matrix } from '../../math/Matrix';
import { svd } from '../../math/linalg';
import { MorphometricsError } from '../../utils/Exceptions';

/** A single landmark configuration (n_landmarks × n_dims). */
export type Configuration = number[][];
/** A set of configurations (n_specimens × n_landmarks × n_dims). */
export type ConfigurationSet = number[][][];

export interface PartialGPAResult {
  /** Aligned configurations (n_specimens × n_landmarks × n_dims). */
  alignedConfigurations: ConfigurationSet;
  /** Consensus (mean) configuration (n_landmarks × n_dims). */
  consensus: Configuration;
  /** Procrustes distance of each specimen to the consensus. */
  procrustesDistances: number[];
  /** Bending energy of each specimen relative to the consensus. */
  bendingEnergies: number[];
  /** Number of sliding iterations performed. */
  slidingIterations: number;
  converged: boolean;
  finalSSE: number;
}

export interface PartialGPAOptions {
  /** Dimensions per landmark: 2 (default) or 3. */
  nDims?: 2 | 3;
  /** Weight λ of the bending energy in the sliding objective (default 1.0). */
  slidingWeight?: number;
  /** Maximum number of sliding iterations (default 20). */
  nIterations?: number;
  /** Convergence tolerance on the SSE change (default 1e-6). */
  tolerance?: number;
  /** Number of landmarks, required to disambiguate flat (2D-matrix) input. */
  nLandmarks?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Input preparation (port of gpa.py::_prepare_configurations, flat case)
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize input to a (n_specimens, n_landmarks, n_dims) set.
 *
 * Accepts either an already-3D set or a flat 2D matrix
 * (n_specimens × n_landmarks*n_dims, landmark-major layout:
 * [x0, y0, x1, y1, ...]).  For ambiguous flat widths (divisible by both
 * 2 and 3) an explicit ``nLandmarks`` is required, matching the Python
 * heuristic in gpa.py::_prepare_configurations.
 */
export function prepareConfigurations(
  configurations: ConfigurationSet | number[][],
  nLandmarks?: number,
  nDims: 2 | 3 = 2,
): ConfigurationSet {
  if (configurations.length === 0) {
    throw new MorphometricsError('Partial GPA requires at least one configuration');
  }
  const first = configurations[0];
  if (Array.isArray(first[0])) {
    // Already (n, k, m)
    const set = configurations as ConfigurationSet;
    const m = set[0][0].length;
    if (m !== 2 && m !== 3) throw new MorphometricsError('Configurations must be 2D or 3D');
    if (nDims && set[0][0].length !== nDims) {
      throw new MorphometricsError(`Explicit nDims=${nDims} does not match configuration dimension ${m}`);
    }
    return set.map(cfg => cfg.map(p => p.slice()));
  }
  // Flat (n_specimens × k*m), landmark-major
  const flat = configurations as number[][];
  const flatDim = flat[0].length;
  let k: number, m: number;
  if (nLandmarks !== undefined) {
    const inferred = flatDim / nLandmarks;
    if (!Number.isInteger(inferred) || (inferred !== 2 && inferred !== 3)) {
      throw new MorphometricsError(
        `flat_dim=${flatDim} is not divisible into ${nLandmarks} landmarks of 2D/3D coordinates`,
      );
    }
    k = nLandmarks; m = inferred as 2 | 3;
  } else if (flatDim % nDims === 0 && (flatDim % 3 !== 0 || nDims === 3)) {
    k = flatDim / nDims; m = nDims;
  } else if (flatDim % 3 === 0 && flatDim % 2 !== 0) {
    k = flatDim / 3; m = 3;
  } else {
    throw new MorphometricsError(
      `Ambiguous flat_dim=${flatDim}: provide nLandmarks to disambiguate (could be ` +
      `${flatDim / 2} landmarks × 2D or ${flatDim / 3} landmarks × 3D)`,
    );
  }
  const out: ConfigurationSet = [];
  for (const row of flat) {
    const cfg: Configuration = [];
    for (let j = 0; j < k; j++) {
      const p: number[] = [];
      for (let d = 0; d < m; d++) p.push(row[j * m + d]);
      cfg.push(p);
    }
    out.push(cfg);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Standard GPA on (n, k, m) sets (port of gpa.py::GPAAnalyzer.analyze)
// ═══════════════════════════════════════════════════════════════════

/** Internal GPA result on landmark-major (n, k, m) configuration sets. */
export interface SimpleGPAResult {
  aligned: ConfigurationSet;
  consensus: Configuration;
  sse: number;
  nIterations: number;
  converged: boolean;
}

/** Centroid size sqrt(Σ|x − x̄|²) of one configuration. */
function centroidSize(cfg: Configuration): number {
  const k = cfg.length, m = cfg[0].length;
  const mean = new Array<number>(m).fill(0);
  for (const p of cfg) for (let d = 0; d < m; d++) mean[d] += p[d] / k;
  let s = 0;
  for (const p of cfg) for (let d = 0; d < m; d++) { const v = p[d] - mean[d]; s += v * v; }
  return Math.sqrt(s);
}

/**
 * Optimal Kabsch rotation R (m×m) with ``R @ target ≈ reference`` under
 * left multiplication, i.e. ``target @ Rᵀ`` for row-vector (k×m) configs.
 * Port of gpa.py::_find_rotation including the det = +1 correction
 * (flip the last row of Vt; Bookstein 1989, Dryden & Mardia 2016).
 */
function findRotation(reference: Configuration, target: Configuration): number[][] {
  const k = target.length, m = target[0].length;
  // H = targetᵀ @ reference  (m × m)
  const H = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < k; i++) {
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) H[a][b] += target[i][a] * reference[i][b];
    }
  }
  const { U, Vt } = svd(new Matrix(Float64Array.from(H.flat()), m, m));
  // R = Vtᵀ @ Uᵀ
  const applyDet = (): number[][] => {
    const R = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let a = 0; a < m; a++) s += Vt.get(a, i) * U.get(j, a);
        R[i][j] = s;
      }
    return R;
  };
  let R = applyDet();
  if (_det(R) < 0) {
    // Flip the last row of Vt and recompute
    const Vt2 = Vt.clone();
    for (let j = 0; j < m; j++) Vt2.set(m - 1, j, -Vt2.get(m - 1, j));
    const R2 = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let a = 0; a < m; a++) s += Vt2.get(a, i) * U.get(j, a);
        R2[i][j] = s;
      }
    R = R2;
  }
  return R;
}

function _det(R: number[][]): number {
  const n = R.length;
  if (n === 2) return R[0][0] * R[1][1] - R[0][1] * R[1][0];
  return R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
       - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
       + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
}

/** Rotate one configuration: cfg' = cfg @ Rᵀ. */
function rotateConfig(cfg: Configuration, R: number[][]): Configuration {
  const k = cfg.length, m = cfg[0].length;
  const out: Configuration = [];
  for (let i = 0; i < k; i++) {
    const p = new Array<number>(m).fill(0);
    for (let a = 0; a < m; a++)
      for (let b = 0; b < m; b++) p[b] += cfg[i][a] * R[a][b];
    out.push(p);
  }
  return out;
}

/**
 * Generalized Procrustes analysis on a (n, k, m) configuration set.
 * Mirrors gpa.py::GPAAnalyzer.analyze: iteratively translate to centroids,
 * rescale to unit centroid size, and rotate onto the consensus.
 */
export function gpaAlign(
  configurations: ConfigurationSet,
  nIterations: number = 100,
  tolerance: number = 1e-8,
): SimpleGPAResult {
  const n = configurations.length;
  const aligned: ConfigurationSet = configurations.map(cfg => cfg.map(p => p.slice()));
  let consensus: Configuration = aligned[0];
  let prevSSE = Infinity;
  let sse = Infinity;
  let iter = 0;
  let converged = false;

  for (iter = 0; iter < nIterations; iter++) {
    // Step 1: translate to centroids
    for (let i = 0; i < n; i++) {
      const k = aligned[i].length, m = aligned[i][0].length;
      const c = new Array<number>(m).fill(0);
      for (const p of aligned[i]) for (let d = 0; d < m; d++) c[d] += p[d] / k;
      for (const p of aligned[i]) for (let d = 0; d < m; d++) p[d] -= c[d];
    }
    // Step 2: scale to unit centroid size
    for (let i = 0; i < n; i++) {
      const size = centroidSize(aligned[i]);
      if (size > 1e-12) {
        for (const p of aligned[i]) for (let d = 0; d < p.length; d++) p[d] /= size;
      }
    }
    // Step 3: consensus
    const k = aligned[0].length, m = aligned[0][0].length;
    consensus = Array.from({ length: k }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < k; j++)
        for (let d = 0; d < m; d++) consensus[j][d] += aligned[i][j][d] / n;
    // Step 4: rotate each specimen onto the consensus
    for (let i = 0; i < n; i++) {
      const R = findRotation(consensus, aligned[i]);
      aligned[i] = rotateConfig(aligned[i], R);
    }
    // SSE of Procrustes distances to consensus
    sse = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++)
        for (let d = 0; d < m; d++) {
          const v = aligned[i][j][d] - consensus[j][d];
          sse += v * v;
        }
    }
    if (Math.abs(prevSSE - sse) < tolerance) {
      converged = true;
      iter += 1;
      break;
    }
    prevSSE = sse;
  }

  return {
    aligned,
    consensus,
    sse,
    nIterations: converged ? iter : nIterations,
    converged,
  };
}

/** Frobenius norm of the difference between two configurations. */
function configDiffNorm(a: Configuration, b: Configuration): number {
  let s = 0;
  for (let i = 0; i < a.length; i++)
    for (let d = 0; d < a[i].length; d++) { const v = a[i][d] - b[i][d]; s += v * v; }
  return Math.sqrt(s);
}

// ═══════════════════════════════════════════════════════════════════
// Partial GPA with semilandmark sliding (port of gpa.py::partial_gpa)
// ═══════════════════════════════════════════════════════════════════

/**
 * Perform Partial GPA with semilandmark sliding.
 *
 * Implements the Bookstein (1997) and Gunz et al. (2005) algorithm for
 * sliding semilandmarks along curves (2D) or surfaces (3D) to minimize
 * bending energy while maintaining Procrustes alignment with fixed
 * landmarks.
 *
 * @param configurations  (n_specimens, n_landmarks, n_dims) set, or a flat
 *                        (n_specimens, n_landmarks*n_dims) matrix
 * @param fixedLandmarks  indices of landmarks that do not slide
 * @param curveIndices    2D curves: arrays of semilandmark indices per curve
 * @param surfaceIndices  3D surfaces: arrays of semilandmark indices per patch
 * @param options         nDims / slidingWeight / nIterations / tolerance /
 *                        nLandmarks
 */
export function partialGPA(
  configurations: ConfigurationSet | number[][],
  fixedLandmarks: number[],
  curveIndices?: number[][],
  surfaceIndices?: number[][],
  options: PartialGPAOptions = {},
): PartialGPAResult {
  const nDims = options.nDims ?? 2;
  const slidingWeight = options.slidingWeight ?? 1.0;
  const nIterations = options.nIterations ?? 20;
  const tolerance = options.tolerance ?? 1e-6;

  const set = prepareConfigurations(configurations, options.nLandmarks, nDims);
  if (set.length < 2) {
    throw new MorphometricsError('Partial GPA requires at least 2 specimens');
  }

  const allSliding: number[] = [];
  if (curveIndices) for (const c of curveIndices) allSliding.push(...c);
  if (surfaceIndices) for (const s of surfaceIndices) allSliding.push(...s);
  const hasSliding = allSliding.length > 0 && (curveIndices !== undefined || surfaceIndices !== undefined);

  // Iterative partial GPA with sliding
  let current: ConfigurationSet = set.map(cfg => cfg.map(p => p.slice()));
  let aligned: ConfigurationSet = current;
  let prevSSE = Infinity;
  let iteration = 0;

  for (iteration = 0; iteration < nIterations; iteration++) {
    // Step 1: standard GPA alignment
    const g = gpaAlign(current, 100, tolerance);
    aligned = g.aligned;
    const consensus = g.consensus;
    const sse = g.sse;

    // Step 2: slide semilandmarks
    if (hasSliding) {
      aligned = slideSemilandmarks(
        aligned, consensus, fixedLandmarks, curveIndices, surfaceIndices, nDims, slidingWeight,
      );
    }

    // Step 3: convergence check on the GPA SSE change
    if (Math.abs(prevSSE - sse) < tolerance) break;
    prevSSE = sse;
    current = aligned;
  }

  // Final GPA alignment
  const finalG = gpaAlign(aligned, 100, tolerance);
  const consensus = finalG.consensus;

  const bendingEnergies = finalG.aligned.map(
    spec => computeBendingEnergy(spec, consensus, fixedLandmarks, nDims),
  );

  return {
    alignedConfigurations: finalG.aligned,
    consensus,
    procrustesDistances: finalG.aligned.map(spec => configDiffNorm(spec, consensus)),
    bendingEnergies,
    slidingIterations: iteration + 1,
    converged: Math.abs(prevSSE - finalG.sse) < tolerance,
    finalSSE: finalG.sse,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Sliding primitives (port of gpa.py::_slide_semilandmarks et al.)
// ═══════════════════════════════════════════════════════════════════

/**
 * Slide semilandmarks along their tangent directions to minimize bending
 * energy.  2D curves slide along curve tangents; 3D surface points slide
 * within their tangent planes.  Port of gpa.py::_slide_semilandmarks.
 */
export function slideSemilandmarks(
  aligned: ConfigurationSet,
  consensus: Configuration,
  fixedLandmarks: number[],
  curveIndices?: number[][],
  surfaceIndices?: number[][],
  nDims: 2 | 3 = 2,
  slidingWeight: number = 1.0,
): ConfigurationSet {
  let result: ConfigurationSet = aligned.map(cfg => cfg.map(p => p.slice()));
  if (nDims === 2 && curveIndices) {
    for (const curve of curveIndices) {
      result = slide2DCurve(result, consensus, curve, fixedLandmarks, slidingWeight);
    }
  } else if (nDims === 3 && surfaceIndices) {
    for (const surface of surfaceIndices) {
      result = slide3DSurface(result, consensus, surface, fixedLandmarks, slidingWeight);
    }
  }
  return result;
}

/**
 * Slide semilandmarks along a 2D curve.  For each semilandmark the optimal
 * position along the consensus tangent is found on a 21-point grid over
 * [-0.1, 0.1] minimizing ||cfg − consensus|| + λ·bendingEnergy.
 * Port of gpa.py::_slide_2d_curve.
 */
export function slide2DCurve(
  configs: ConfigurationSet,
  consensus: Configuration,
  curve: number[],
  fixedLandmarks: number[],
  slidingWeight: number,
): ConfigurationSet {
  const n = configs.length;
  const result: ConfigurationSet = configs.map(cfg => cfg.map(p => p.slice()));
  const tangents = computeCurveTangents(consensus, curve);

  for (let i = 0; i < curve.length; i++) {
    const lmIdx = curve[i];
    let tangent = tangents[i];
    const tNorm = _vecNorm(tangent);
    if (tNorm < 1e-10) continue;
    tangent = tangent.map(v => v / tNorm);

    for (let spec = 0; spec < n; spec++) {
      const currentPos = result[spec][lmIdx].slice();
      let bestPos = currentPos.slice();
      let bestScore = Infinity;

      // Grid search along the tangent (mirrors np.linspace(-0.1, 0.1, 21))
      for (let step = 0; step <= 20; step++) {
        const delta = -0.1 + (0.2 * step) / 20;
        const test = result[spec].map(p => p.slice());
        test[lmIdx] = currentPos.map((v, d) => v + delta * tangent[d]);

        const procDist = configDiffNorm(test, consensus);
        const bend = computeLocalBendingEnergy(test, consensus, lmIdx, fixedLandmarks);
        const score = procDist + slidingWeight * bend;
        if (score < bestScore) { bestScore = score; bestPos = test[lmIdx].slice(); }
      }
      result[spec][lmIdx] = bestPos;
    }
  }
  return result;
}

/**
 * Slide semilandmarks across a 3D surface patch.  Each point moves within
 * its tangent plane on an 11×11 grid over [-0.1, 0.1]².
 * Port of gpa.py::_slide_3d_surface.
 */
export function slide3DSurface(
  configs: ConfigurationSet,
  consensus: Configuration,
  surface: number[],
  fixedLandmarks: number[],
  slidingWeight: number,
): ConfigurationSet {
  const n = configs.length;
  const result: ConfigurationSet = configs.map(cfg => cfg.map(p => p.slice()));
  const { normals, tangentBasis } = computeSurfaceTangentsAndNormals(consensus, surface);

  for (let i = 0; i < surface.length; i++) {
    const lmIdx = surface[i];
    let normal = normals[i];
    if (_vecNorm(normal) < 1e-10) continue;
    normal = normal.map(v => v / _vecNorm(normal));
    const basis = tangentBasis[i];

    for (let spec = 0; spec < n; spec++) {
      const currentPos = result[spec][lmIdx].slice();
      let bestPos = currentPos.slice();
      let bestScore = Infinity;

      // Search in the tangent plane (2D grid, mirrors linspace(-0.1,0.1,11))
      for (let su = 0; su <= 10; su++) {
        const du = -0.1 + (0.2 * su) / 10;
        for (let sv = 0; sv <= 10; sv++) {
          const dv = -0.1 + (0.2 * sv) / 10;
          const test = result[spec].map(p => p.slice());
          test[lmIdx] = currentPos.map((v, d) => v + du * basis[0][d] + dv * basis[1][d]);

          const procDist = configDiffNorm(test, consensus);
          const bend = computeLocalBendingEnergy(test, consensus, lmIdx, fixedLandmarks);
          const score = procDist + slidingWeight * bend;
          if (score < bestScore) { bestScore = score; bestPos = test[lmIdx].slice(); }
        }
      }
      result[spec][lmIdx] = bestPos;
    }
  }
  return result;
}

/**
 * Compute tangent directions for points on a curve, from the consensus.
 * Interior points use the central difference; endpoints use the one-sided
 * difference.  Port of gpa.py::_compute_curve_tangents.
 */
export function computeCurveTangents(consensus: Configuration, curve: number[]): number[][] {
  const nPoints = curve.length;
  const m = consensus[0].length;
  const tangents: number[][] = Array.from({ length: nPoints }, () => new Array<number>(m).fill(0));

  for (let i = 0; i < nPoints; i++) {
    const idx = curve[i];
    if (i === 0) {
      if (nPoints > 1) {
        const nextIdx = curve[1];
        for (let d = 0; d < m; d++) tangents[i][d] = consensus[nextIdx][d] - consensus[idx][d];
      }
    } else if (i === nPoints - 1) {
      const prevIdx = curve[i - 1];
      for (let d = 0; d < m; d++) tangents[i][d] = consensus[idx][d] - consensus[prevIdx][d];
    } else {
      const prevIdx = curve[i - 1];
      const nextIdx = curve[i + 1];
      for (let d = 0; d < m; d++) tangents[i][d] = (consensus[nextIdx][d] - consensus[prevIdx][d]) / 2;
    }
  }
  return tangents;
}

/**
 * Compute surface normals and tangent-plane bases for surface semilandmarks
 * from the consensus configuration.  Returns the unit normal per point and
 * two tangent vectors spanning the plane.
 * Port of gpa.py::_compute_surface_tangents_and_normals.
 */
export function computeSurfaceTangentsAndNormals(
  consensus: Configuration,
  surface: number[],
): { normals: number[][]; tangentBasis: number[][][] } {
  const nPoints = surface.length;
  const normals: number[][] = Array.from({ length: nPoints }, () => [0, 0, 0]);
  const tangentBasis: number[][][] = Array.from({ length: nPoints }, () => [[1, 0, 0], [0, 1, 0]]);

  for (let i = 0; i < nPoints; i++) {
    const idx = surface[i];
    const neighbors = surface.filter(j => j !== idx);

    if (neighbors.length < 2) {
      normals[i] = [0, 0, 1];
      tangentBasis[i] = [[1, 0, 0], [0, 1, 0]];
      continue;
    }

    // Normal as the accumulated cross product of neighbour vectors
    // (first three neighbours, mirroring the Python implementation).
    let normal = [0, 0, 0];
    const ref = surface[0] !== idx ? surface[0] : surface[1];
    for (let t = 0; t < Math.min(3, neighbors.length); t++) {
      const j = neighbors[t];
      const v1: number[] = consensus[j].map((v, d) => v - consensus[idx][d]);
      const v2: number[] = consensus[ref].map((v, d) => v - consensus[idx][d]);
      const c = _cross(v1, v2);
      normal = [normal[0] + c[0], normal[1] + c[1], normal[2] + c[2]];
    }
    const nrm = _vecNorm(normal);
    normals[i] = nrm > 1e-10 ? normal.map(v => v / nrm) : [0, 0, 1];

    // Orthonormal basis in the tangent plane
    const helper = Math.abs(normals[i][2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    let t0 = _cross(normals[i], helper);
    const t0n = _vecNorm(t0);
    t0 = t0n > 1e-12 ? t0.map(v => v / t0n) : [1, 0, 0];
    const t1 = _cross(normals[i], t0);
    tangentBasis[i] = [t0, t1];
  }
  return { normals, tangentBasis };
}

// ═══════════════════════════════════════════════════════════════════
// Bending energy (port of gpa.py::_compute_bending_energy and
// _compute_local_bending_energy)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the TPS bending energy of a specimen relative to the consensus.
 *
 * Solves the Bookstein (1989) constrained TPS system on the fixed landmarks
 * and returns the non-affine bending energy E = tr(Wᵀ K W) = wᵀKw.
 * 2D kernel: K_ij = r² log r (biharmonic); 3D kernel: K_ij = r (Laplacian
 * fundamental solution, consistent with morpho3d tps3d thin_plate).
 *
 * References:
 * - Bookstein, F.L. (1989). IEEE TPAMI 11(6): 567-585.
 * - Dryden, I.L. & Mardia, K.V. (2016). Statistical Shape Analysis.
 */
export function computeBendingEnergy(
  specimen: Configuration,
  consensus: Configuration,
  fixedLandmarks: number[],
  nDims: 2 | 3 = 2,
): number {
  const nFixed = fixedLandmarks.length;
  if (nFixed < 3) return 0.0;

  const fixedCoords = fixedLandmarks.map(idx => consensus[idx]);
  const m = consensus[0].length;

  // Kernel matrix
  const K: number[][] = Array.from({ length: nFixed }, () => new Array<number>(nFixed).fill(0));
  for (let i = 0; i < nFixed; i++) {
    for (let j = 0; j < nFixed; j++) {
      if (i === j) continue;
      const r = Math.sqrt(_sqDist(fixedCoords[i], fixedCoords[j]));
      if (r > 1e-10) K[i][j] = nDims === 2 ? r * r * Math.log(r) : r;
    }
  }

  // Affine basis P = [1, x, (y), (z)]
  const P: number[][] = fixedCoords.map(p => [1, ...p.slice(0, m)]);
  const nAffine = P[0].length;

  // Block TPS system  [[K, P], [Pᵀ, 0]] [w; a] = [targetDiff; 0]
  const nTotal = nFixed + nAffine;
  const L: number[][] = Array.from({ length: nTotal }, () => new Array<number>(nTotal).fill(0));
  for (let i = 0; i < nFixed; i++) {
    for (let j = 0; j < nFixed; j++) L[i][j] = K[i][j];
    for (let j = 0; j < nAffine; j++) { L[i][nFixed + j] = P[i][j]; L[nFixed + j][i] = P[i][j]; }
  }

  const wAll: number[][] = Array.from({ length: nTotal }, () => new Array<number>(m).fill(0));
  for (let d = 0; d < m; d++) {
    const rhs = new Array<number>(nTotal).fill(0);
    for (let i = 0; i < nFixed; i++) rhs[i] = specimen[fixedLandmarks[i]][d] - consensus[fixedLandmarks[i]][d];
    const sol = _solveLinearSystem(L, rhs);
    for (let i = 0; i < nTotal; i++) wAll[i][d] = sol[i];
  }

  const w = wAll.slice(0, nFixed);
  // Bending energy: Σ_d w_dᵀ K w_d
  let energy = 0;
  for (let d = 0; d < m; d++) {
    for (let i = 0; i < nFixed; i++) {
      let s = 0;
      for (let j = 0; j < nFixed; j++) s += K[i][j] * w[j][d];
      energy += w[i][d] * s;
    }
  }
  return energy;
}

/**
 * Compute the TPS bending energy of the warp consensus → config, used as
 * the Bookstein (1997) sliding criterion.  A smooth slide along the curve
 * has low bending energy; only "creases" are penalized.
 * Port of gpa.py::_compute_local_bending_energy (r² log r kernel).
 */
export function computeLocalBendingEnergy(
  config: Configuration,
  consensus: Configuration,
  _lmIdx: number,
  _fixedLandmarks: number[],
): number {
  const nLandmarks = config.length;
  const nDims = config[0].length;
  if (nLandmarks < 3) return 0.0;

  // Kernel matrix over the consensus configuration (warp source)
  const K: number[][] = Array.from({ length: nLandmarks }, () => new Array<number>(nLandmarks).fill(0));
  for (let i = 0; i < nLandmarks; i++) {
    for (let j = i + 1; j < nLandmarks; j++) {
      const r = Math.sqrt(_sqDist(consensus[i], consensus[j]));
      if (r > 1e-10) {
        const val = r * r * Math.log(r);
        K[i][j] = val; K[j][i] = val;
      }
    }
  }

  const P: number[][] = consensus.map(p => [1, ...p.slice(0, nDims)]);
  const nAffine = P[0].length;
  const nTotal = nLandmarks + nAffine;
  const L: number[][] = Array.from({ length: nTotal }, () => new Array<number>(nTotal).fill(0));
  for (let i = 0; i < nLandmarks; i++) {
    for (let j = 0; j < nLandmarks; j++) L[i][j] = K[i][j];
    for (let j = 0; j < nAffine; j++) { L[i][nLandmarks + j] = P[i][j]; L[nLandmarks + j][i] = P[i][j]; }
  }

  let energy = 0;
  for (let d = 0; d < nDims; d++) {
    const rhs = new Array<number>(nTotal).fill(0);
    for (let i = 0; i < nLandmarks; i++) rhs[i] = config[i][d] - consensus[i][d];
    const sol = _solveLinearSystem(L, rhs);
    for (let i = 0; i < nLandmarks; i++) {
      let s = 0;
      for (let j = 0; j < nLandmarks; j++) s += K[i][j] * sol[j];
      energy += sol[i] * s;
    }
  }
  return Math.max(energy, 0);
}

// ─── small numeric helpers ─────────────────────────────────────────────────────

function _sqDist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const v = a[i] - b[i]; s += v * v; }
  return s;
}

function _vecNorm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function _cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Gaussian elimination with partial pivoting; on a singular system a tiny
 * ridge is added and the solve is retried (lstsq fallback, mirroring the
 * np.linalg.solve → lstsq fallback in the Python source).
 */
function _solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const solveWith = (M: number[][]): number[] => {
    const aug = M.map((row, i) => [...row, b[i]]);
    let singular = false;
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
      }
      if (maxRow !== col) { const t = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = t; }
      const pivot = aug[col][col];
      if (Math.abs(pivot) < 1e-12) { singular = true; continue; }
      for (let row = col + 1; row < n; row++) {
        const f = aug[row][col] / pivot;
        if (f === 0) continue;
        for (let k = col; k <= n; k++) aug[row][k] -= f * aug[col][k];
      }
    }
    if (singular) throw new Error('singular TPS block system');
    const x = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = aug[i][n];
      for (let j = i + 1; j < n; j++) s -= aug[i][j] * x[j];
      x[i] = Math.abs(aug[i][i]) < 1e-300 ? 0 : s / aug[i][i];
    }
    return x;
  };
  try {
    return solveWith(A);
  } catch {
    const M = A.map(row => row.slice());
    for (let i = 0; i < n; i++) M[i][i] += 1e-8;
    return solveWith(M);
  }
}
