/**
 * 3D Mesh �� replaces morpho3d/mesh.py
 */

import { rand } from '../../math/random';

export interface Mesh3D {
  vertices: number[][];
  faces: number[][];
  normals: number[][];
}

/** Undirected edge as an index pair (min, max). */
export type MeshEdge = [number, number];

/**
 * Compute the unique edge list of the mesh (port of
 * morpho3d/mesh.py::Mesh3D.edges / _compute_edges).  Each triangle
 * contributes its three edges; duplicates are removed by ordering each
 * pair (min, max).
 */
export function computeEdges(mesh: Mesh3D): MeshEdge[] {
  const seen = new Set<string>();
  const edges: MeshEdge[] = [];
  for (const face of mesh.faces) {
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(a < b ? [a, b] : [b, a]);
      }
    }
  }
  return edges;
}

/** Face areas (0.5 · |cross(e1, e2)| per triangle). */
function _faceAreas(mesh: Mesh3D): number[] {
  return mesh.faces.map(face => {
    const v0 = mesh.vertices[face[0]], v1 = mesh.vertices[face[1]], v2 = mesh.vertices[face[2]];
    const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
    const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  });
}

/**
 * Compute the enclosed volume of a closed triangle mesh using the
 * divergence theorem (port of morpho3d/mesh.py::Mesh3D.compute_volume):
 *
 *     V = |Σ_faces det(v₀, v₁, v₂)| / 6
 *
 * where each triangle forms a tetrahedron with the origin
 * (tetra volume = (1/6)·v₀·(v₁×v₂)).  The result is valid only for
 * watertight, consistently oriented surfaces; the absolute value removes
 * the dependence on orientation.
 */
export function computeVolume(mesh: Mesh3D): number {
  let total = 0;
  for (const face of mesh.faces) {
    const v0 = mesh.vertices[face[0]], v1 = mesh.vertices[face[1]], v2 = mesh.vertices[face[2]];
    // (1/6)·v₀·(v₁×v₂)
    const cx = v1[1] * v2[2] - v1[2] * v2[1];
    const cy = v1[2] * v2[0] - v1[0] * v2[2];
    const cz = v1[0] * v2[1] - v1[1] * v2[0];
    total += v0[0] * cx + v0[1] * cy + v0[2] * cz;
  }
  return Math.abs(total) / 6.0;
}

/**
 * Sample n points on the mesh surface with area-weighted face selection
 * and barycentric uniform sampling within each triangle (port of
 * morpho3d/mesh.py::Mesh3D.sample_points).
 *
 * Uses the seeded PRNG from math/random — pass ``rng`` (e.g. from
 * createSeededRNG) for reproducible sampling; defaults to the global
 * seeded stream.
 *
 * @param mesh  triangle mesh
 * @param n     number of sample points
 * @param rng   optional uniform [0,1) generator
 * @returns sampled points (n × 3)
 */
export function samplePoints(mesh: Mesh3D, n: number, rng: (() => number) = rand): number[][] {
  const areas = _faceAreas(mesh);
  const totalArea = areas.reduce((a, b) => a + b, 0);
  if (totalArea <= 0) throw new Error('samplePoints: mesh has zero surface area');

  // Cumulative distribution over faces for area-weighted selection
  const cum: number[] = new Array(areas.length);
  let acc = 0;
  for (let i = 0; i < areas.length; i++) { acc += areas[i] / totalArea; cum[i] = acc; }

  const points: number[][] = [];
  for (let i = 0; i < n; i++) {
    // Area-weighted face pick via inverse-CDF on a single uniform draw
    const u = rng();
    let faceIdx = areas.length - 1;
    for (let f = 0; f < cum.length; f++) {
      if (u <= cum[f]) { faceIdx = f; break; }
    }
    const face = mesh.faces[faceIdx];
    const v0 = mesh.vertices[face[0]], v1 = mesh.vertices[face[1]], v2 = mesh.vertices[face[2]];

    // Barycentric sampling uniform over the triangle:
    //   r1 = √ξ₁, u = 1−r1, v = r1(1−ξ₂), w = r1·ξ₂
    const r1 = Math.sqrt(rng());
    const r2 = rng();
    const a = 1 - r1, b = r1 * (1 - r2), c = r1 * r2;
    points.push([
      a * v0[0] + b * v1[0] + c * v2[0],
      a * v0[1] + b * v1[1] + c * v2[1],
      a * v0[2] + b * v1[2] + c * v2[2],
    ]);
  }
  return points;
}

export function computeNormals(mesh: Mesh3D): number[][] {
  // Area-weighted vertex normals ( Botsch et al. 2010, "Polygon Mesh Processing" )
  // n_vertex = Σ (n_face * area_face) / Σ area_face
  // where n_face is the unit face normal and area_face is the triangle area.
  const normals: number[][] = mesh.vertices.map(() => [0, 0, 0]);
  const weights: number[] = mesh.vertices.map(() => 0); // accumulated area weight

  for (const face of mesh.faces) {
    const v0 = mesh.vertices[face[0]], v1 = mesh.vertices[face[1]], v2 = mesh.vertices[face[2]];
    const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
    const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
    // Cross product = 2 * area * n_face
    const cpx = ay*bz - az*by, cpy = az*bx - ax*bz, cpz = ax*by - ay*bx;
    const area = 0.5 * Math.sqrt(cpx*cpx + cpy*cpy + cpz*cpz);
    // Unit normal
    const nl = Math.sqrt(cpx*cpx + cpy*cpy + cpz*cpz);
    if (nl < 1e-15) continue; // degenerate face
    const nx = cpx/nl, ny = cpy/nl, nz = cpz/nl;
    // Accumulate area-weighted normal and weight
    for (const vi of face) {
      normals[vi][0] += nx * area;
      normals[vi][1] += ny * area;
      normals[vi][2] += nz * area;
      weights[vi] += area;
    }
  }
  return normals.map((n, i) => {
    const w = weights[i];
    if (w < 1e-15) return [0, 0, 1];
    return [n[0]/w, n[1]/w, n[2]/w];
  });
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
    if (nx <= 1 || ny <= 1)
      throw new Error(`interpolateGrid: nx (${nx}) and ny (${ny}) must be ≥ 2`);
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
