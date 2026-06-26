/**
 * 3D Mesh ¡ª replaces morpho3d/mesh.py
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
