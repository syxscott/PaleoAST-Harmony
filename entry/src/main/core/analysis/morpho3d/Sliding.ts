/**
 * Semi-landmark sliding algorithms — replaces morpho3d/sliding.py
 *
 * Implements two sliding protocols for curves and surfaces:
 * 1. MEC (Minimum Bending Energy) — Gunz et al. (2005)
 * 2. PAM (Minimum Procrustes Distance) — Perez et al. (2006)
 *
 * Also provides the multi-specimen SemiLandmarkSlider system (port of
 * morpho3d/sliding.py::SemiLandmarkSlider): joint GPA iteration over all
 * specimens with bending-energy / Procrustes sliding criteria and a
 * sliding history.
 *
 * References:
 * - Gunz, P., Mitteroecker, P. & Bookstein, F.L. (2005). "Semilandmarks: a
 *   method for quantifying curves and surfaces." Hunter College 31 Jan 2005.
 * - Perez, S.I., Bernal, V. & Gonzalez, P.N. (2006). "Differences between
 *   sliding semi-landmark methods in geometric morphometrics." J. Anat. 208: 769-784.
 * - Bookstein, F.L. (1997). "Landmark methods for forms without landmarks."
 *   Math. Methods Biomed. Image Biol.: 131-172.
 * - Rohlf, F.J. & Slice, D. (1990). Syst. Zool. 39: 40-59.
 */

import { buildKernelMatrix, bendingEnergy } from '../morphometrics/tpsKernel';
import { Matrix } from '../../math/Matrix';
import { svd } from '../../math/linalg';
import { gpa3d } from './GPA3D';

/**
 * Sliding mode for semi-landmark optimization.
 * - 'MEC': Minimum Bending Energy (Gunz et al. 2005)
 * - 'PAM': Minimum Procrustes Distance (Perez et al. 2006)
 */
export type SlidingMode = 'MEC' | 'PAM';

/** Sliding criterion for the multi-specimen slider (Python naming). */
export type SlidingCriterion = 'bending_energy' | 'procrustes';

export interface SlideResult {
  slidLandmarks: number[][];
  finalBendingEnergy: number;
  nIterations: number;
}

/**
 * Slide semi-landmarks along curve/surface to minimize bending energy or
 * Procrustes distance from the mean configuration.
 *
 * @param landmarks     Full landmark configuration including semi-landmarks (nLM × 3)
 * @param curvePoints    Curve/surface points defining the slide path (nCP × 3)
 * @param semiIndices    Indices of landmarks that are semi-landmarks
 * @param slidingMode    'MEC' (default) or 'PAM'
 * @param nIterations    Maximum iterations (default 20)
 * @param tolerance      Convergence tolerance for gradient norm (default 1e-6)
 * @param referenceLM    Fixed reference landmarks (non-sliding, for PAM mode)
 * @param slidingAlpha   Step size along the projected gradient (default 0.1)
 */
export function slideLandmarks(
  landmarks: number[][],
  curvePoints: number[][],
  semiIndices: number[],
  slidingMode: SlidingMode = 'MEC',
  nIterations: number = 20,
  tolerance: number = 1e-6,
  referenceLM?: number[][],
  slidingAlpha: number = 0.1
): SlideResult {
  // Clone landmarks to avoid mutation
  let currentLM = landmarks.map(p => [...p]);
  const nLM = currentLM.length;
  const dim = 3;
  // Clamp alpha into the sane sliding range (mirrors the Python slider)
  const alpha = Math.max(0.01, Math.min(1.0, slidingAlpha));

  // Build the fixed reference configuration (all landmarks at current positions)
  // For MEC: curve points define the target surface
  // For PAM: reference is the current mean shape

  let finalBE = 0;
  let nIter = 0;

  for (let iter = 0; iter < nIterations; iter++) {
    nIter++;
    let totalGradientNorm = 0;

    if (slidingMode === 'MEC') {
      // MEC sliding: minimize bending energy relative to curve/surface
      // Algorithm from Gunz et al. (2005):
      // 1. Compute TPS from current semi-landmark positions to curve points
      // 2. Compute bending energy gradient ∂E/∂x for each semi-landmark
      // 3. Project gradient onto tangent direction
      // 4. Slide semi-landmark along tangent

      // Build curve parameterization with uniform spacing
      const curveParams = _computeCurveParameters(curvePoints);
      const tangents = _computeTangents(curvePoints);

      for (const idx of semiIndices) {
        // Find nearest curve point and parameter
        const nearest = _findNearestCurvePoint(currentLM[idx], curvePoints);
        const t = nearest.t; // parameter value
        void t;
        const tangent = tangents[nearest.idx];

        // Compute TPS kernel matrix using all semi-landmark positions
        const semiPositions = semiIndices.map(i => currentLM[i]);
        const K = buildKernelMatrix(semiPositions, 2); // 2D curve, but positions are 3D

        // Get the gradient direction from TPS bending energy
        const gradient = _computeBendingEnergyGradient(
          currentLM, semiIndices, idx, curvePoints, K
        );

        // Project gradient onto tangent direction (only tangent component slides)
        const tangentNorm = Math.sqrt(tangent[0]**2 + tangent[1]**2 + tangent[2]**2);
        if (tangentNorm < 1e-10) continue;

        const tangentUnit = [
          tangent[0] / tangentNorm,
          tangent[1] / tangentNorm,
          tangent[2] / tangentNorm
        ];

        // Project gradient onto tangent: (g · t) * t
        const gradDotT = gradient[0] * tangentUnit[0] +
                         gradient[1] * tangentUnit[1] +
                         gradient[2] * tangentUnit[2];

        const projectedGrad = [
          gradDotT * tangentUnit[0],
          gradDotT * tangentUnit[1],
          gradDotT * tangentUnit[2]
        ];

        const gradNorm = Math.sqrt(
          projectedGrad[0]**2 + projectedGrad[1]**2 + projectedGrad[2]**2
        );
        totalGradientNorm += gradNorm;

        // Slide along tangent: step size = slidingAlpha (now actually used)
        currentLM[idx][0] -= alpha * gradDotT * tangentUnit[0];
        currentLM[idx][1] -= alpha * gradDotT * tangentUnit[1];
        currentLM[idx][2] -= alpha * gradDotT * tangentUnit[2];

        // Snap back to curve (project onto nearest curve point)
        const onCurve = _projectOntoCurve(currentLM[idx], curvePoints, curveParams);
        currentLM[idx] = [...onCurve];
      }

      // Compute bending energy for convergence check
      const semiPositions = semiIndices.map(i => currentLM[i]);
      const K = buildKernelMatrix(semiPositions, 2);
      const weights = _estimateTPSWeights(semiPositions, curvePoints, K);
      finalBE = bendingEnergy(K, weights, 2);

    } else {
      // PAM sliding: minimize Procrustes distance to reference
      // Perez et al. (2006): slide along tangent in direction that minimizes
      // Procrustes distance between specimen and reference mean

      if (!referenceLM) {
        throw new Error('PAM sliding requires referenceLM (mean shape)');
      }

      const tangents = _computeTangents(curvePoints);

      for (const idx of semiIndices) {
        // Find nearest curve point
        const nearest = _findNearestCurvePoint(currentLM[idx], curvePoints);
        const tangent = tangents[nearest.idx];

        // Compute Procrustes distance gradient
        const gradient = _computeProcrustesGradient(
          currentLM, referenceLM, idx, nLM
        );

        // Project onto tangent
        const tangentNorm = Math.sqrt(tangent[0]**2 + tangent[1]**2 + tangent[2]**2);
        if (tangentNorm < 1e-10) continue;

        const tangentUnit = [
          tangent[0] / tangentNorm,
          tangent[1] / tangentNorm,
          tangent[2] / tangentNorm
        ];

        const gradDotT = gradient[0] * tangentUnit[0] +
                         gradient[1] * tangentUnit[1] +
                         gradient[2] * tangentUnit[2];

        const gradNorm = Math.abs(gradDotT);
        totalGradientNorm += gradNorm;

        // Slide along tangent: step size = slidingAlpha (now actually used)
        currentLM[idx][0] -= alpha * gradDotT * tangentUnit[0];
        currentLM[idx][1] -= alpha * gradDotT * tangentUnit[1];
        currentLM[idx][2] -= alpha * gradDotT * tangentUnit[2];

        // Project onto curve
        const curveParams = _computeCurveParameters(curvePoints);
        const onCurve = _projectOntoCurve(currentLM[idx], curvePoints, curveParams);
        currentLM[idx] = [...onCurve];
      }
    }

    // Check convergence: gradient norm below tolerance
    if (totalGradientNorm < tolerance) break;
  }

  return {
    slidLandmarks: currentLM,
    finalBendingEnergy: finalBE,
    nIterations: nIter
  };
}

/**
 * Convenience wrapper: slide all landmarks in a configuration assuming
 * curvePoints are the full curve/surface and some landmarks are fixed.
 * The ``slidingAlpha`` parameter is forwarded to the sliding step size.
 */
export function slideLandmarksSimple(
  landmarks: number[][],
  curvePoints: number[][],
  nIterations: number = 20,
  slidingAlpha: number = 0.5,
  slidingMode: SlidingMode = 'MEC'
): number[][] {
  // Find semi-landmark indices (assuming first N are fixed, rest are semi)
  const nFixed = Math.floor(landmarks.length * 0.3); // heuristic: 30% fixed
  const semiIndices: number[] = [];
  for (let i = nFixed; i < landmarks.length; i++) semiIndices.push(i);

  const result = slideLandmarks(
    landmarks, curvePoints, semiIndices, slidingMode, nIterations,
    1e-6, undefined, slidingAlpha
  );
  return result.slidLandmarks;
}

// ═══════════════════════════════════════════════════════════════════
// Multi-specimen slider (port of morpho3d/sliding.py::SemiLandmarkSlider)
// ═══════════════════════════════════════════════════════════════════

export interface SlidingResult {
  /** Aligned full configurations after the final GPA (n × kLM × 3). */
  alignedConfigs: number[][][];
  /** Mean configuration of the aligned set. */
  meanConfig: number[][];
  /** Per-iteration trace: iteration index, mean shape, bending energy. */
  slidingHistory: { iteration: number; meanShape: number[][]; bendingEnergy: number }[];
  nIterations: number;
  finalBendingEnergy: number;
  convergenceError: number;
}

export interface SemiLandmarkSliderOptions {
  /** Sliding criterion (default 'bending_energy'). */
  criterion?: SlidingCriterion;
  /** Sliding factor λ ∈ (0, 1] scaling each slide step (default 0.1). */
  slidingFactor?: number;
  /** Maximum sliding iterations (default 100). */
  maxIterations?: number;
  /** Convergence tolerance on the semilandmark mean change (default 1e-8). */
  tolerance?: number;
  /** Indices of fixed landmarks (required before slide()). */
  fixedIndices?: number[];
  /** Indices of sliding semilandmarks (required before slide()). */
  semiIndices?: number[];
}

/**
 * Multi-specimen semilandmark slider.  Each iteration:
 *   1. GPA on the fixed landmarks; each specimen's transform
 *      (translation + scaling + rotation) is applied to the FULL config,
 *   2. semilandmarks slide along curve tangents / surface tangent planes
 *      by λ · (criterion displacement projected onto the sliding space),
 *   3. convergence on the mean semilandmark movement.
 *
 * Port of morpho3d/sliding.py::SemiLandmarkSlider.
 */
export class SemiLandmarkSlider {
  static readonly CRITERION_BENDING_ENERGY: SlidingCriterion = 'bending_energy';
  static readonly CRITERION_PROCRUSTES: SlidingCriterion = 'procrustes';

  private _criterion: SlidingCriterion;
  private _slidingFactor: number;
  private _maxIterations: number;
  private _tolerance: number;
  private _fixedIndices: number[] | null = null;
  private _semiIndices: number[] | null = null;
  private _curveTopology: 'open' | 'closed' = 'open';
  private _surfaceMesh: number[][] | null = null;

  constructor(options: SemiLandmarkSliderOptions = {}) {
    const criterion = options.criterion ?? 'bending_energy';
    if (criterion !== 'bending_energy' && criterion !== 'procrustes') {
      throw new Error(`Unknown criterion: ${criterion}`);
    }
    this._criterion = criterion;
    this._slidingFactor = Math.max(0.01, Math.min(1.0, options.slidingFactor ?? 0.1));
    this._maxIterations = options.maxIterations ?? 100;
    this._tolerance = options.tolerance ?? 1e-8;
    if (options.fixedIndices !== undefined && options.semiIndices !== undefined) {
      this.setLandmarks(options.fixedIndices, options.semiIndices);
    }
  }

  /** Set fixed and semilandmark indices; they must not overlap. */
  setLandmarks(fixedIndices: number[], semiIndices: number[]): SemiLandmarkSlider {
    const overlap = fixedIndices.filter(i => semiIndices.includes(i));
    if (overlap.length > 0) throw new Error(`Fixed and semi indices overlap: ${overlap}`);
    this._fixedIndices = fixedIndices.slice();
    this._semiIndices = semiIndices.slice();
    return this;
  }

  /** Set the curve topology ('open' or 'closed'); clears any surface mesh. */
  setCurveTopology(topology: 'open' | 'closed' = 'open'): SemiLandmarkSlider {
    if (topology !== 'open' && topology !== 'closed') {
      throw new Error(`Unknown topology: ${topology}`);
    }
    this._curveTopology = topology;
    this._surfaceMesh = null;
    return this;
  }

  /** Set the surface triangle mesh.  Face indices refer to the semilandmark list. */
  setSurfaceMesh(faces: number[][]): SemiLandmarkSlider {
    for (const f of faces) {
      if (f.length !== 3) throw new Error(`Faces must be (n, 3), got length ${f.length}`);
    }
    this._surfaceMesh = faces.map(f => f.slice());
    return this;
  }

  /** Run the joint sliding over all specimens (port of SemiLandmarkSlider.slide). */
  slide(configs: number[][][]): SlidingResult {
    if (this._fixedIndices === null || this._semiIndices === null) {
      throw new Error('Must call setLandmarks() first');
    }
    const nSamples = configs.length;
    const semiIndices = this._semiIndices;

    // Initialize configurations (deep copy)
    const currentConfigs: number[][][] = configs.map(cfg => cfg.map(p => [...p]));

    const history: SlidingResult['slidingHistory'] = [];
    let prevMean: number[][] | null = null;
    let semiMeanDiff = 0.0;
    let nIterations = 0;

    for (let iteration = 0; iteration < this._maxIterations; iteration++) {
      nIterations = iteration + 1;

      // Step 1: GPA on fixed landmarks, transform applied to full configs
      const gpaResult = this._gpaWithFixedLandmarks(currentConfigs);

      // Step 2: current mean shape; convergence on the semilandmark motion
      const currentMean = gpaResult.meanConfig;
      if (prevMean !== null) {
        semiMeanDiff = 0;
        for (const idx of semiIndices) {
          const dx = currentMean[idx][0] - prevMean[idx][0];
          const dy = currentMean[idx][1] - prevMean[idx][1];
          const dz = currentMean[idx][2] - prevMean[idx][2];
          semiMeanDiff += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        if (semiMeanDiff < this._tolerance) break;
      }
      prevMean = currentMean.map(p => [...p]);

      // Step 3: slide the semilandmarks of every specimen
      for (let i = 0; i < nSamples; i++) {
        const newSemi = this._surfaceMesh !== null
          ? this._slideSurfacePoints(currentConfigs[i], gpaResult.aligned[i], currentMean)
          : this._slideCurvePoints(currentConfigs[i], gpaResult.aligned[i], currentMean);
        for (let s = 0; s < semiIndices.length; s++) {
          currentConfigs[i][semiIndices[s]] = newSemi[s];
        }
      }

      // Step 4: record history
      history.push({
        iteration,
        meanShape: currentMean.map(p => [...p]),
        bendingEnergy: this._computeBendingEnergy(currentConfigs, currentMean),
      });
    }

    // Final GPA and bending energy
    const finalGpa = this._gpaWithFixedLandmarks(currentConfigs);
    const finalBe = this._computeBendingEnergy(currentConfigs, finalGpa.meanConfig);

    return {
      alignedConfigs: finalGpa.aligned,
      meanConfig: finalGpa.meanConfig,
      slidingHistory: history,
      nIterations,
      finalBendingEnergy: finalBe,
      convergenceError: prevMean !== null ? semiMeanDiff : 0.0,
    };
  }

  /**
   * GPA on the fixed landmarks with each specimen's transform (translation
   * + scaling + rotation) applied to the full configuration.
   * Port of sliding.py::SemiLandmarkSlider._gpa_with_fixed_landmarks.
   */
  private _gpaWithFixedLandmarks(configs: number[][][]): { aligned: number[][][]; meanConfig: number[][] } {
    const fixed = this._fixedIndices as number[];
    const fixedConfigs = configs.map(cfg => fixed.map(idx => cfg[idx]));
    const result = gpa3d(fixedConfigs, 100, this._tolerance, { scale: true });

    const alignedFull: number[][][] = configs.map((config, i) => {
      const fixedPts = fixed.map(idx => config[idx]);
      const n = fixedPts.length;
      const c = [0, 0, 0];
      for (const p of fixedPts) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
      let centered = config.map(p => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
      const cs = result.centroidSizes[i];
      if (cs > 1e-10) centered = centered.map(p => [p[0] / cs, p[1] / cs, p[2] / cs]);
      return centered.map(p => RotationApply(result.rotations[i], p));
    });

    // Mean of the aligned full configurations
    const nLM = alignedFull[0].length;
    const meanFull: number[][] = [];
    for (let j = 0; j < nLM; j++) {
      let mx = 0, my = 0, mz = 0;
      for (const cfg of alignedFull) { mx += cfg[j][0]; my += cfg[j][1]; mz += cfg[j][2]; }
      meanFull.push([mx / alignedFull.length, my / alignedFull.length, mz / alignedFull.length]);
    }
    return { aligned: alignedFull, meanConfig: meanFull };
  }

  /** Curve sliding of one specimen's semilandmarks (port of _slide_curve_points). */
  private _slideCurvePoints(
    original: number[][],
    aligned: number[][],
    meanShape: number[][],
  ): number[][] {
    const semi = this._semiIndices as number[];
    const fixed = this._fixedIndices as number[];
    const nSemi = semi.length;
    const nTotal = original.length;

    const semiOriginal = semi.map(idx => [...original[idx]]);
    const semiAligned = semi.map(idx => aligned[idx]);
    const semiMean = semi.map(idx => meanShape[idx]);

    const semiPositions = semi.map(idx => idx - Math.min(...fixed));
    const tangents = this._computeCurveTangents(semiMean, semiPositions, nTotal);

    for (let i = 0; i < nSemi; i++) {
      let displacement: number[];
      if (this._criterion === 'bending_energy') {
        // Minimum bending energy (discrete curvature proxy): match the
        // specimen's semilandmark-curve curvature (second differences) to
        // the consensus curvature.  Tangential and does not pull the
        // semilandmarks onto the consensus.
        const im = i > 0 ? i - 1 : (nSemi > 1 ? i + 1 : i);
        const ip = i < nSemi - 1 ? i + 1 : (nSemi > 1 ? i - 1 : i);
        if (im === i || ip === i || im === ip || nSemi < 3) {
          displacement = [0, 0, 0];
        } else {
          displacement = [0, 1, 2].map(d =>
            (semiMean[im][d] - 2.0 * semiMean[i][d] + semiMean[ip][d])
            - (semiAligned[im][d] - 2.0 * semiAligned[i][d] + semiAligned[ip][d]));
        }
      } else {
        // Minimum Procrustes distance: slide toward the consensus
        displacement = [0, 1, 2].map(d => semiMean[i][d] - semiAligned[i][d]);
      }

      // Project onto the tangent: d_proj = (d·t) t
      const t = tangents[i];
      const dot = displacement[0] * t[0] + displacement[1] * t[1] + displacement[2] * t[2];
      semiOriginal[i][0] += this._slidingFactor * dot * t[0];
      semiOriginal[i][1] += this._slidingFactor * dot * t[1];
      semiOriginal[i][2] += this._slidingFactor * dot * t[2];
    }
    return semiOriginal;
  }

  /** Surface sliding of one specimen's semilandmarks (port of _slide_surface_points). */
  private _slideSurfacePoints(
    original: number[][],
    aligned: number[][],
    meanShape: number[][],
  ): number[][] {
    if (this._surfaceMesh === null) throw new Error('Surface mesh not set');
    const semi = this._semiIndices as number[];
    const nSemi = semi.length;

    const semiOriginal = semi.map(idx => [...original[idx]]);
    const semiAligned = semi.map(idx => aligned[idx]);
    const semiMean = semi.map(idx => meanShape[idx]);

    const normals = this._computeSurfaceNormals(semiOriginal);

    for (let i = 0; i < nSemi; i++) {
      // Criterion displacement toward the consensus
      const displacement = [0, 1, 2].map(d => semiMean[i][d] - semiAligned[i][d]);

      // Project into the tangent plane: d_proj = d − (d·n)n
      const n = normals[i];
      const dot = displacement[0] * n[0] + displacement[1] * n[1] + displacement[2] * n[2];
      semiOriginal[i][0] += this._slidingFactor * (displacement[0] - dot * n[0]);
      semiOriginal[i][1] += this._slidingFactor * (displacement[1] - dot * n[1]);
      semiOriginal[i][2] += this._slidingFactor * (displacement[2] - dot * n[2]);
    }
    return semiOriginal;
  }

  /** Unit curve tangents with central differences (port of _compute_curve_tangents). */
  private _computeCurveTangents(points: number[][], _positions: number[], nTotal: number): number[][] {
    void _positions; void nTotal;
    const n = points.length;
    const tangents: number[][] = [];
    for (let i = 0; i < n; i++) {
      let prevPoint: number[], nextPoint: number[];
      if (this._curveTopology === 'closed' && n > 2) {
        prevPoint = points[(i - 1 + n) % n];
        nextPoint = points[(i + 1) % n];
      } else {
        prevPoint = i > 0 ? points[i - 1] : _extendBackward(points);
        nextPoint = i < n - 1 ? points[i + 1] : _extendForward(points);
      }
      const t = [nextPoint[0] - prevPoint[0], nextPoint[1] - prevPoint[1], nextPoint[2] - prevPoint[2]];
      const norm = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
      tangents.push(norm > 1e-10 ? [t[0] / norm, t[1] / norm, t[2] / norm] : [1, 0, 0]);
    }
    return tangents;
  }

  /** Vertex normals averaged over incident faces (port of _compute_surface_normals). */
  private _computeSurfaceNormals(vertices: number[][]): number[][] {
    const n = vertices.length;
    const normals: number[][] = Array.from({ length: n }, () => [0, 0, 0]);
    if (this._surfaceMesh === null) return normals;

    const mesh = this._surfaceMesh;
    for (let v = 0; v < n; v++) {
      let normal = [0, 0, 0];
      let count = 0;
      for (const face of mesh) {
        if (!face.includes(v)) continue;
        const others = face.filter(idx => idx !== v);
        if (others.length !== 2) continue;
        const v0 = vertices[v], v1 = vertices[others[0]], v2 = vertices[others[1]];
        const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
        const fn = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const fnNorm = Math.sqrt(fn[0] * fn[0] + fn[1] * fn[1] + fn[2] * fn[2]);
        if (fnNorm > 1e-10) {
          normal = [normal[0] + fn[0] / fnNorm, normal[1] + fn[1] / fnNorm, normal[2] + fn[2] / fnNorm];
          count++;
        }
      }
      const norm = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
      normals[v] = count > 0 && norm > 1e-10
        ? [normal[0] / norm, normal[1] / norm, normal[2] / norm]
        : [0, 0, 1];
    }
    return normals;
  }

  /** Total TPS bending energy of all specimens vs the consensus fixed points. */
  private _computeBendingEnergy(configs: number[][][], meanShape: number[][]): number {
    const fixed = this._fixedIndices as number[];
    let total = 0;
    for (const config of configs) {
      const srcPts = fixed.map(idx => meanShape[idx]);
      const dstPts = fixed.map(idx => config[idx]);
      total += _tpsBendingEnergy3D(srcPts, dstPts);
    }
    return total;
  }
}

/** Convenience multi-specimen curve sliding (port of slide_curve_semi_landmarks). */
export function slideCurveSemiLandmarks(
  configs: number[][][],
  fixedIndices: number[],
  semiIndices: number[],
  criterion: SlidingCriterion = 'bending_energy',
  slidingFactor: number = 0.1,
): SlidingResult {
  const slider = new SemiLandmarkSlider({ criterion, slidingFactor });
  slider.setLandmarks(fixedIndices, semiIndices);
  slider.setCurveTopology('open');
  return slider.slide(configs);
}

/** Convenience multi-specimen surface sliding (port of slide_surface_semi_landmarks). */
export function slideSurfaceSemiLandmarks(
  configs: number[][][],
  fixedIndices: number[],
  semiIndices: number[],
  faces: number[][],
  criterion: SlidingCriterion = 'bending_energy',
  slidingFactor: number = 0.1,
): SlidingResult {
  const slider = new SemiLandmarkSlider({ criterion, slidingFactor });
  slider.setLandmarks(fixedIndices, semiIndices);
  slider.setSurfaceMesh(faces);
  return slider.slide(configs);
}

/**
 * Multi-specimen sliding entry point:
 *     slideLandmarksMulti(configs, curveTopology, mesh?, criterion?, options?)
 *
 * Jointly slides semilandmarks across all specimens (SemiLandmarkSlider
 * semantics): per-iteration joint GPA on the fixed landmarks, tangential
 * sliding with the 'bending_energy' or 'procrustes' criterion, and a full
 * sliding history in the result.
 *
 * @param configs        specimen configurations (n × nLandmarks × 3)
 * @param curveTopology  'open' (default) or 'closed' curve topology
 * @param mesh           optional triangle faces (n_faces × 3) indexing the
 *                       semilandmark list — switches to surface sliding
 * @param criterion      'bending_energy' (default) or 'procrustes'
 * @param options        fixedIndices / semiIndices (required), slidingFactor,
 *                       maxIterations, tolerance
 */
export function slideLandmarksMulti(
  configs: number[][][],
  curveTopology: 'open' | 'closed' = 'open',
  mesh?: number[][],
  criterion: SlidingCriterion = 'bending_energy',
  options: SemiLandmarkSliderOptions = {},
): SlidingResult {
  const slider = new SemiLandmarkSlider({
    criterion,
    slidingFactor: options.slidingFactor,
    maxIterations: options.maxIterations,
    tolerance: options.tolerance,
  });
  const fixed = options.fixedIndices;
  const semi = options.semiIndices;
  if (!fixed || !semi) {
    throw new Error('slideLandmarksMulti requires options.fixedIndices and options.semiIndices');
  }
  slider.setLandmarks(fixed, semi);
  if (mesh && mesh.length > 0) {
    slider.setSurfaceMesh(mesh);
  } else {
    slider.setCurveTopology(curveTopology);
  }
  return slider.slide(configs);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function RotationApply(R: number[][], p: number[]): number[] {
  return [
    R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2],
    R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2],
    R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2],
  ];
}

/** Extrapolated "previous" point for open-curve endpoint tangents. */
function _extendBackward(points: number[][]): number[] {
  if (points.length < 2) return points[0];
  return [
    2 * points[0][0] - points[1][0],
    2 * points[0][1] - points[1][1],
    2 * points[0][2] - points[1][2],
  ];
}

/** Extrapolated "next" point for open-curve endpoint tangents. */
function _extendForward(points: number[][]): number[] {
  const n = points.length;
  if (n < 2) return points[0];
  return [
    2 * points[n - 1][0] - points[n - 2][0],
    2 * points[n - 1][1] - points[n - 2][1],
    2 * points[n - 1][2] - points[n - 2][2],
  ];
}

/** Compute cumulative chord-length parameterization of a curve. */
function _computeCurveParameters(curve: number[][]): number[] {
  const t: number[] = [0];
  for (let i = 1; i < curve.length; i++) {
    const dx = curve[i][0] - curve[i-1][0];
    const dy = curve[i][1] - curve[i-1][1];
    const dz = curve[i][2] - curve[i-1][2];
    t.push(t[i-1] + Math.sqrt(dx*dx + dy*dy + dz*dz));
  }
  return t;
}

/** Compute unit tangent vectors at each curve point. */
function _computeTangents(curve: number[][]): number[][] {
  const tangents: number[][] = [];
  for (let i = 0; i < curve.length; i++) {
    let tx: number, ty: number, tz: number;
    if (i === 0) {
      tx = curve[1][0] - curve[0][0];
      ty = curve[1][1] - curve[0][1];
      tz = curve[1][2] - curve[0][2];
    } else if (i === curve.length - 1) {
      tx = curve[i][0] - curve[i-1][0];
      ty = curve[i][1] - curve[i-1][1];
      tz = curve[i][2] - curve[i-1][2];
    } else {
      tx = curve[i+1][0] - curve[i-1][0];
      ty = curve[i+1][1] - curve[i-1][1];
      tz = curve[i+1][2] - curve[i-1][2];
    }
    const len = Math.sqrt(tx*tx + ty*ty + tz*tz);
    if (len < 1e-10) {
      tangents.push([0, 0, 0]);
    } else {
      tangents.push([tx/len, ty/len, tz/len]);
    }
  }
  return tangents;
}

/** Find nearest point on curve and return its index and parameter value. */
function _findNearestCurvePoint(
  point: number[],
  curve: number[][]
): { idx: number; t: number } {
  let minDist = Infinity;
  let nearestIdx = 0;
  for (let i = 0; i < curve.length; i++) {
    const dx = point[0] - curve[i][0];
    const dy = point[1] - curve[i][1];
    const dz = point[2] - curve[i][2];
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (d < minDist) { minDist = d; nearestIdx = i; }
  }
  return { idx: nearestIdx, t: nearestIdx / (curve.length - 1) };
}

/** Project a point onto the nearest location on the curve. */
function _projectOntoCurve(
  point: number[],
  curve: number[][],
  tParams: number[]
): number[] {
  const { idx, t } = _findNearestCurvePoint(point, curve);

  // Linear interpolation between neighboring curve points
  if (idx === 0 || idx === curve.length - 1) {
    return [...curve[idx]];
  }

  // Interpolate based on parameter distance to neighbors
  const tCur = tParams[idx];
  const tPrev = tParams[idx - 1];
  const tNext = tParams[idx + 1];

  let u: number;
  if (t >= tCur) {
    u = (t - tCur) / (tNext - tCur);
    return [
      curve[idx][0] + u * (curve[idx+1][0] - curve[idx][0]),
      curve[idx][1] + u * (curve[idx+1][1] - curve[idx][1]),
      curve[idx][2] + u * (curve[idx+1][2] - curve[idx][2])
    ];
  } else {
    u = (t - tPrev) / (tCur - tPrev);
    return [
      curve[idx-1][0] + u * (curve[idx][0] - curve[idx-1][0]),
      curve[idx-1][1] + u * (curve[idx][1] - curve[idx-1][1]),
      curve[idx-1][2] + u * (curve[idx][2] - curve[idx-1][2])
    ];
  }
}

/**
 * Estimate TPS weights from semi-landmark positions to curve points.
 * Uses a true Moore–Penrose pseudoinverse (the previous implementation
 * returned a diagonal-only approximation, which is wrong for any
 * non-diagonal kernel matrix).
 */
function _estimateTPSWeights(
  semiPositions: number[][],
  curvePoints: number[][],
  K: Matrix
): number[][] {
  const n = semiPositions.length;
  const Kinv = _pseudoInverse(K, 1e-8);
  const weights: number[][] = [];

  for (let d = 0; d < 3; d++) {
    const target = curvePoints.slice(0, n).map(p => p[d]);
    const w: number[] = [];
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += Kinv.get(i, j) * target[j];
      w.push(s);
    }
    weights.push(w);
  }

  return weights;
}

/** Compute bending energy gradient for a semi-landmark. */
function _computeBendingEnergyGradient(
  landmarks: number[][],
  semiIndices: number[],
  semiIdx: number,
  curvePoints: number[][],
  K: Matrix
): number[] {
  // ∂E/∂x_i = sum_j K_ij * w_j (for each coordinate)
  // Simplified: gradient at semi-landmark i is proportional to
  // the sum of weighted influences from other semi-landmarks

  const n = semiIndices.length;
  const i = semiIndices.indexOf(semiIdx);

  if (i < 0) return [0, 0, 0];

  const gradient = [0, 0, 0];

  for (let j = 0; j < n; j++) {
    const kij = K.get(i, j);
    if (j === i) continue;

    const dx = landmarks[semiIndices[j]][0] - landmarks[semiIdx][0];
    const dy = landmarks[semiIndices[j]][1] - landmarks[semiIdx][1];
    const dz = landmarks[semiIndices[j]][2] - landmarks[semiIdx][2];

    // Gradient of bending energy: d/dr (r² log r) = 2r log r + r
    const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (r < 1e-10) continue;

    const dUdr = 2 * r * Math.log(r) + r;
    const scale = kij / r;

    gradient[0] += scale * dUdr * dx;
    gradient[1] += scale * dUdr * dy;
    gradient[2] += scale * dUdr * dz;
  }
  void curvePoints;

  return gradient;
}

/** Compute Procrustes distance gradient for PAM sliding. */
function _computeProcrustesGradient(
  landmarks: number[][],
  reference: number[][],
  idx: number,
  nLM: number
): number[] {
  // Gradient of squared Procrustes distance w.r.t. landmark position:
  // ∂/∂x_i (d²) = -2 * (ref_i - specimen_i) / nLM

  const gradient = [
    (landmarks[idx][0] - reference[idx][0]) * 2 / nLM,
    (landmarks[idx][1] - reference[idx][1]) * 2 / nLM,
    (landmarks[idx][2] - reference[idx][2]) * 2 / nLM
  ];

  return gradient;
}

/**
 * Moore–Penrose pseudoinverse via SVD with tolerance-based truncation:
 *     K⁺ = V₊ · diag(1/s₊) · U₊ᵀ
 * over singular values s > tol · max(s).  (The previous implementation
 * returned a diagonal-only matrix, which is not a pseudoinverse.)
 */
function _pseudoInverse(K: Matrix, lambda: number): Matrix {
  const n = K.rows;
  const { U, S, Vt } = svd(K);
  const smax = S.length > 0 ? S[0] : 0;
  const cutoff = Math.max(lambda, 1e-12) * Math.max(smax, 1);
  const V = Vt.transpose();
  const Ut = U.transpose();
  // K⁺ = V · diag(1/s) · Uᵀ over retained singular values
  const out = Matrix.zeros(n, n);
  for (let k = 0; k < S.length; k++) {
    if (S[k] <= cutoff) continue;
    const invS = 1 / S[k];
    for (let i = 0; i < n; i++) {
      const vik = V.get(i, k) * invS;
      if (vik === 0) continue;
      for (let j = 0; j < n; j++) {
        out.data[i * n + j] += vik * Ut.get(k, j);
      }
    }
  }
  return out;
}

/**
 * Total TPS bending energy of the warp src → dst over fixed points,
 * using the 3D thin-plate (r) kernel with the constrained Bookstein
 * system (K | P; Pᵀ | 0).  Port of
 * sliding.py::SemiLandmarkSlider._compute_bending_energy.
 */
function _tpsBendingEnergy3D(srcPts: number[][], dstPts: number[][]): number {
  const n = srcPts.length;
  if (n < 4) return 0;
  // Kernel matrix K_ij = U(r) = r (3D thin plate)
  const K: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = srcPts[i][0] - srcPts[j][0];
      const dy = srcPts[i][1] - srcPts[j][1];
      const dz = srcPts[i][2] - srcPts[j][2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const val = r > 1e-10 ? r : 0;
      K[i][j] = val; K[j][i] = val;
    }
  }
  // Augmented system [K | P; Pᵀ | 0], P = [1, x, y, z]
  const total = n + 4;
  const A: number[][] = Array.from({ length: total }, () => new Array<number>(total).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = K[i][j];
    A[i][n] = 1; A[i][n + 1] = srcPts[i][0]; A[i][n + 2] = srcPts[i][1]; A[i][n + 3] = srcPts[i][2];
    A[n][i] = 1; A[n + 1][i] = srcPts[i][0]; A[n + 2][i] = srcPts[i][1]; A[n + 3][i] = srcPts[i][2];
  }
  let energy = 0;
  for (let d = 0; d < 3; d++) {
    const b = new Array<number>(total).fill(0);
    for (let i = 0; i < n; i++) b[i] = dstPts[i][d];
    const sol = _solveSym(A, b);
    // E_d = wᵀ K w
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += K[i][j] * sol[j];
      energy += sol[i] * s;
    }
  }
  return energy;
}

/** Gaussian elimination with partial pivoting (dense, small systems). */
function _solveSym(A: number[][], b: number[]): number[] {
  const n = b.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    if (maxRow !== col) { const t = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = t; }
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-300) continue;
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / pivot;
      for (let k = col; k <= n; k++) aug[row][k] -= f * aug[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = aug[i][n];
    for (let j = i + 1; j < n; j++) s -= aug[i][j] * x[j];
    x[i] = Math.abs(aug[i][i]) > 1e-300 ? s / aug[i][i] : 0;
  }
  return x;
}
