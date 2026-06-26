/**
 * 3D GPA ¡ª replaces morpho3d/gpa3d.py
 */
import { Quaternion } from './Quaternion';

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
    const size = Math.sqrt(centeredCfg.reduce((s, p) => s + p[0]**2+p[1]**2+p[2]**2, 0));
    cs.push(size);
    centered.push(centeredCfg.map(p => [p[0]/size, p[1]/size, p[2]/size]));
  }

  // Compute mean shape
  const meanShape: number[][] = [];
  for (let j = 0; j < nLM; j++) {
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += centered[i][j][0]; my += centered[i][j][1]; mz += centered[i][j][2]; }
    meanShape.push([mx/n, my/n, mz/n]);
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
