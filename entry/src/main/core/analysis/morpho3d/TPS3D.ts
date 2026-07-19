/**
 * 3D TPS �� replaces morpho3d/tps3d.py
 */

export interface TPS3DResult {
  weights: number[][];
  bendingEnergy: number;
  affineCoefs: number[];
}

export function tps3dFit(sourceLandmarks: number[][], targetLandmarks: number[][]): TPS3DResult {
  const n = sourceLandmarks.length;
  // Build Bookstein kernel matrix U(r) = r² log(r)
  const K: number[][] = Array.from({length: n}, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) { K[i][j] = 0; continue; }
    const dx = sourceLandmarks[i][0]-sourceLandmarks[j][0];
    const dy = sourceLandmarks[i][1]-sourceLandmarks[j][1];
    const dz = sourceLandmarks[i][2]-sourceLandmarks[j][2];
    const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
    K[i][j] = r > 0 ? r * r * Math.log(r) : 0;  // Bookstein kernel U(r) = r² log(r)
  }
  // Build augmented system: [K | P; P^T | 0] [w; a] = [Y; 0]
  const dim = n + 4;
  const aug: number[][] = Array.from({length: dim}, (_, i) => new Array(dim).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) aug[i][j] = K[i][j];
  for (let i = 0; i < n; i++) {
    aug[i][n+0] = 1; aug[i][n+1] = sourceLandmarks[i][0];
    aug[i][n+2] = sourceLandmarks[i][1]; aug[i][n+3] = sourceLandmarks[i][2];
    aug[n+0][i] = 1; aug[n+1][i] = sourceLandmarks[i][0];
    aug[n+2][i] = sourceLandmarks[i][1]; aug[n+3][i] = sourceLandmarks[i][2];
  }
  // Target coordinates stacked as [Yx, Yy, Yz]
  const Yx = targetLandmarks.map(p => p[0]);
  const Yy = targetLandmarks.map(p => p[1]);
  const Yz = targetLandmarks.map(p => p[2]);
  const solveAug = (Y: number[]): number[] => {
    const b = [...Y, 0, 0, 0, 0];
    return _solveLinear(aug, b);
  };
  const wx = solveAug(Yx), wy = solveAug(Yy), wz = solveAug(Yz);
  const weights: number[][] = [[], [], []];
  for (let i = 0; i < n; i++) {
    weights[0].push(wx[i]); weights[1].push(wy[i]); weights[2].push(wz[i]);
  }
  const affineCoefs = [wx[n], wx[n+1], wx[n+2], wx[n+3], wy[n], wy[n+1], wy[n+2], wy[n+3], wz[n], wz[n+1], wz[n+2], wz[n+3]];
  // Bending energy = trace(W^T K W)
  let be = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    be += (weights[0][i]*weights[0][j] + weights[1][i]*weights[1][j] + weights[2][i]*weights[2][j]) * K[i][j];
  }
  return { weights, bendingEnergy: be, affineCoefs };
}

function _solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-300) continue;
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let k = col; k <= n; k++) aug[row][k] -= factor * aug[col][k];
    }
  }
  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i];
  }
  return x;
}

export function tps3DDeform(point: number[], sourceLandmarks: number[][], weights: number[][], affineCoefs: number[]): number[] {
  const n = sourceLandmarks.length;
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < n; i++) {
    const d0 = point[0]-sourceLandmarks[i][0], d1 = point[1]-sourceLandmarks[i][1], d2 = point[2]-sourceLandmarks[i][2];
    const r = Math.sqrt(d0*d0 + d1*d1 + d2*d2);
    const U = r > 0 ? r * r * Math.log(r) : 0;  // Bookstein kernel U(r) = r² log(r)
    dx += weights[0][i] * U;
    dy += weights[1][i] * U;
    dz += weights[2][i] * U;
  }
  // Apply affine transformation: [1, x, y, z] @ affine_coefs
  const ax = affineCoefs.slice(0, 4), ay = affineCoefs.slice(4, 8), az = affineCoefs.slice(8, 12);
  const affX = ax[0] + ax[1]*point[0] + ax[2]*point[1] + ax[3]*point[2];
  const affY = ay[0] + ay[1]*point[0] + ay[2]*point[1] + ay[3]*point[2];
  const affZ = az[0] + az[1]*point[0] + az[2]*point[1] + az[3]*point[2];
  return [point[0]+dx+affX, point[1]+dy+affY, point[2]+dz+affZ];
}
