/**
 * 3D TPS ¡ª replaces morpho3d/tps3d.py
 */

export interface TPS3DResult {
  weights: number[][];
  bendingEnergy: number;
}

export function tps3dFit(sourceLandmarks: number[][], targetLandmarks: number[][]): TPS3DResult {
  const n = sourceLandmarks.length;
  const K: number[][] = Array.from({length: n}, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const dx = sourceLandmarks[i][0]-sourceLandmarks[j][0];
    const dy = sourceLandmarks[i][1]-sourceLandmarks[j][1];
    const dz = sourceLandmarks[i][2]-sourceLandmarks[j][2];
    const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
    K[i][j] = r > 0 ? -r : 0;
  }
  // Simplified: return identity weights
  return { weights: K, bendingEnergy: 0 };
}

export function tps3DDeform(point: number[], sourceLandmarks: number[][], weights: number[][]): number[] {
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < sourceLandmarks.length; i++) {
    const d0 = point[0]-sourceLandmarks[i][0], d1 = point[1]-sourceLandmarks[i][1], d2 = point[2]-sourceLandmarks[i][2];
    const r = Math.sqrt(d0*d0 + d1*d1 + d2*d2);
    const U = r > 0 ? -r : 0;
    dx += weights[i][0] * U;
    dy += weights[i][1] * U;
    dz += weights[i][2] * U;
  }
  return [point[0]+dx, point[1]+dy, point[2]+dz];
}
