/**
 * Sliding landmarks �� replaces morpho3d/sliding.py
 * Semi-landmark sliding along curves/surfaces using tangent-direction
 * minimization with bending energy or distance-based sliding.
 */

export function slideLandmarks(
  landmarks: number[][],
  curvePoints: number[][],
  nIterations: number = 10,
  slidingAlpha: number = 0.5,
): number[][] {
  const result = landmarks.map(p => [...p]);
  // Build local parameterization for curve points (uniform spacing)
  const cps: number[][] = curvePoints.map(p => [...p]);
  // For each semi-landmark, find neighbors on curve and compute tangent
  for (let iter = 0; iter < nIterations; iter++) {
    for (let i = 0; i < result.length; i++) {
      // Find nearest curve point and its index
      let minDist = Infinity, nearestIdx = 0;
      for (let j = 0; j < cps.length; j++) {
        const d = Math.sqrt(
          (result[i][0]-cps[j][0])**2 +
          (result[i][1]-cps[j][1])**2 +
          (result[i][2]-cps[j][2])**2
        );
        if (d < minDist) { minDist = d; nearestIdx = j; }
      }
      // Compute tangent direction from neighboring curve points
      const prevIdx = Math.max(0, nearestIdx - 1);
      const nextIdx = Math.min(cps.length - 1, nearestIdx + 1);
      // Tangent vector (normalized)
      const tx = cps[nextIdx][0] - cps[prevIdx][0];
      const ty = cps[nextIdx][1] - cps[prevIdx][1];
      const tz = cps[nextIdx][2] - cps[prevIdx][2];
      const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz);
      if (tLen < 1e-10) continue;
      const nx = tx/tLen, ny = ty/tLen, nz = tz/tLen;
      // Project current semi-landmark onto nearest curve point
      const base = cps[nearestIdx];
      // Compute signed distance along tangent direction
      const dx = result[i][0] - base[0];
      const dy = result[i][1] - base[1];
      const dz = result[i][2] - base[2];
      // Slide along tangent: push semi-landmark in tangent direction
      const proj = dx*nx + dy*ny + dz*nz;
      // Move towards the tangent projection but not fully to curve
      result[i][0] = result[i][0] - slidingAlpha * (proj - 0) * nx;
      result[i][1] = result[i][1] - slidingAlpha * (proj - 0) * ny;
      result[i][2] = result[i][2] - slidingAlpha * (proj - 0) * nz;
    }
  }
  return result;
}
