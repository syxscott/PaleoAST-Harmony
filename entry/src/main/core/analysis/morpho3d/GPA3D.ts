/**
 * 3D GPA — replaces morpho3d/gpa3d.py
 */
import { Quaternion, RotationMatrix } from './Quaternion';

export interface GPA3DResult {
  aligned: number[][][];
  meanShape: number[][];
  centroidSizes: number[];
  procrustesDistances: number[];
}

export function gpa3d(configs: number[][][], maxIter = 100, tol = 1e-8): GPA3DResult {
  const n = configs.length;
  const nLM = configs[0].length;

  // Center and scale each specimen
  const centered: number[][][] = [];
  const cs: number[] = [];
  for (const cfg of configs) {
    const cx = cfg.reduce((s, p) => s + p[0], 0) / nLM;
    const cy = cfg.reduce((s, p) => s + p[1], 0) / nLM;
    const cz = cfg.reduce((s, p) => s + p[2], 0) / nLM;
    const centeredCfg = cfg.map(p => [p[0]-cx, p[1]-cy, p[2]-cz]);
    // Fixed: centroid size computed from original centered coords, not re-centered
    const size = Math.sqrt(centeredCfg.reduce((s, p) => s + p[0]**2+p[1]**2+p[2]**2, 0));
    cs.push(size);
    centered.push(centeredCfg.map(p => [p[0]/size, p[1]/size, p[2]/size]));
  }

  // Fixed: iterate GPA until convergence (was single pass only)
  let meanShape: number[][] = [];
  for (let iter = 0; iter < maxIter; iter++) {
    // Compute mean shape from current aligned configs
    const newMean: number[][] = [];
    for (let j = 0; j < nLM; j++) {
      let mx = 0, my = 0, mz = 0;
      for (let i = 0; i < n; i++) { mx += centered[i][j][0]; my += centered[i][j][1]; mz += centered[i][j][2]; }
      newMean.push([mx/n, my/n, mz/n]);
    }

    // Normalize mean shape
    const meanCx = newMean.reduce((s, p) => s + p[0], 0) / nLM;
    const meanCy = newMean.reduce((s, p) => s + p[1], 0) / nLM;
    const meanCz = newMean.reduce((s, p) => s + p[2], 0) / nLM;
    const meanSize = Math.sqrt(newMean.reduce((s, p) => {
      const dx = p[0]-meanCx, dy = p[1]-meanCy, dz = p[2]-meanCz;
      return s + dx*dx + dy*dy + dz*dz;
    }, 0));
    const normMean = newMean.map(p => [(p[0]-meanCx)/meanSize, (p[1]-meanCy)/meanSize, (p[2]-meanCz)/meanSize]);

    // Check convergence
    if (iter > 0) {
      let maxDiff = 0;
      for (let j = 0; j < nLM; j++) {
        const dx = normMean[j][0] - meanShape[j][0];
        const dy = normMean[j][1] - meanShape[j][1];
        const dz = normMean[j][2] - meanShape[j][2];
        maxDiff = Math.max(maxDiff, Math.sqrt(dx*dx + dy*dy + dz*dz));
      }
      if (maxDiff < tol) break;
    }
    meanShape = normMean;

    // Re-align each specimen to the updated mean shape
    for (let i = 0; i < n; i++) {
      // Re-center and re-scale aligned specimen
      const cx = centered[i].reduce((s, p) => s + p[0], 0) / nLM;
      const cy = centered[i].reduce((s, p) => s + p[1], 0) / nLM;
      const cz = centered[i].reduce((s, p) => s + p[2], 0) / nLM;
      centered[i] = centered[i].map(p => [p[0]-cx, p[1]-cy, p[2]-cz]);
      const si = Math.sqrt(centered[i].reduce((s, p) => s + p[0]**2+p[1]**2+p[2]**2, 0));
      if (si > 0) centered[i] = centered[i].map(p => [p[0]/si, p[1]/si, p[2]/si]);
      // Add Procrustes rotation to align with mean shape
      const R = RotationMatrix.procrustes(centered[i], meanShape);
      centered[i] = centered[i].map(p => RotationMatrix.apply(R, p as [number,number,number]));
    }
  }

  // Compute Procrustes distances
  const procDists: number[] = [];
  for (let i = 0; i < n; i++) {
    let dist = 0;
    for (let j = 0; j < nLM; j++) {
      const dx = centered[i][j][0] - meanShape[j][0];
      const dy = centered[i][j][1] - meanShape[j][1];
      const dz = centered[i][j][2] - meanShape[j][2];
      dist += dx*dx + dy*dy + dz*dz;
    }
    procDists.push(Math.sqrt(dist));
  }

  return { aligned: centered, meanShape, centroidSizes: cs, procrustesDistances: procDists };
}
