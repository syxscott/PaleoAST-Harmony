/**
 * Sliding landmarks ¡ª replaces morpho3d/sliding.py
 * Semi-landmark sliding along curves/surfaces.
 */

export function slideLandmarks(
  landmarks: number[][],
  curvePoints: number[][],
  nIterations: number = 10,
): number[][] {
  const result = landmarks.map(p => [...p]);
  for (let iter = 0; iter < nIterations; iter++) {
    for (let i = 0; i < result.length; i++) {
      let minDist = Infinity, bestIdx = 0;
      for (let j = 0; j < curvePoints.length; j++) {
        const d = Math.sqrt(
          (result[i][0]-curvePoints[j][0])**2 +
          (result[i][1]-curvePoints[j][1])**2 +
          (result[i][2]-curvePoints[j][2])**2
        );
        if (d < minDist) { minDist = d; bestIdx = j; }
      }
      // Project onto nearest curve point
      result[i] = [...curvePoints[bestIdx]];
    }
  }
  return result;
}
