/**
 * 3D Mesh �� replaces morpho3d/mesh.py
 */

export interface Mesh3D {
  vertices: number[][];
  faces: number[][];
  normals: number[][];
}

export function computeNormals(mesh: Mesh3D): number[][] {
  const normals: number[][] = mesh.vertices.map(() => [0, 0, 0]);
  for (const face of mesh.faces) {
    const v0 = mesh.vertices[face[0]], v1 = mesh.vertices[face[1]], v2 = mesh.vertices[face[2]];
    const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
    const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
    const nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
    for (const vi of face) { normals[vi][0] += nx; normals[vi][1] += ny; normals[vi][2] += nz; }
  }
  return normals.map(n => { const l = Math.sqrt(n[0]**2+n[1]**2+n[2]**2); return l > 0 ? [n[0]/l, n[1]/l, n[2]/l] : [0,0,1]; });
}

export function meshArea(mesh: Mesh3D): number {
  let area = 0;
  for (const face of mesh.faces) {
    const v0 = mesh.vertices[face[0]], v1 = mesh.vertices[face[1]], v2 = mesh.vertices[face[2]];
    const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
    const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
    const nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
    area += 0.5 * Math.sqrt(nx*nx + ny*ny + nz*nz);
  }
  return area;
}

// ─── Surface interpolator (port of morpho3d/mesh.py::SurfaceInterpolator) ──────
export class SurfaceInterpolator {
  private points: number[][];
  private values: number[];

  constructor(points: number[][], values: number[]) {
    if (points.length !== values.length) throw new Error('point/value count mismatch');
    this.points = points;
    this.values = values;
  }

  /**
   * Inverse-distance weighted interpolation (Shepard's method).
   */
  interpolate(q: number[], power: number = 2): number {
    if (this.points.length === 0) return NaN;
    let num = 0, den = 0;
    for (let i = 0; i < this.points.length; i++) {
      let sq = 0;
      for (let k = 0; k < q.length; k++) {
        const d = this.points[i][k] - q[k];
        sq += d * d;
      }
      const w = sq < 1e-300 ? 1 : 1 / Math.pow(sq, power / 2);
      num += w * this.values[i];
      den += w;
    }
    return num / den;
  }

  /** Bilinear interpolation in a regular 2D grid (uses IDW fallback otherwise). */
  interpolateGrid(xMin: number, xMax: number, yMin: number, yMax: number,
                  nx: number, ny: number): number[][] {
    const grid: number[][] = [];
    for (let j = 0; j < ny; j++) {
      const y = yMin + (j / (ny - 1)) * (yMax - yMin);
      const row: number[] = [];
      for (let i = 0; i < nx; i++) {
        const x = xMin + (i / (nx - 1)) * (xMax - xMin);
        row.push(this.interpolate([x, y]));
      }
      grid.push(row);
    }
    return grid;
  }
}
