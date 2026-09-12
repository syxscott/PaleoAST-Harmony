/**
 * Quaternion operations �� replaces morpho3d/quaternion.py
 * Used for 3D rotations in GPA and TPS.
 *
 * Mathematical foundation (see Python source):
 *   q = w + xi + yj + zk,  i² = j² = k² = ijk = −1
 *   Rotation quaternion: q = [cos(θ/2), sin(θ/2)·u] with unit axis u
 *   Rotation matrix from q:
 *     R = ┌ 1−2(y²+z²)   2(xy−wz)    2(xz+wy)  ┐
 *         │  2(xy+wz)    1−2(x²+z²)   2(yz−wx)  │
 *         └  2(xz−wy)     2(yz+wx)   1−2(x²+y²) ┘
 */

export class Quaternion {
  /**
   * Construct a quaternion.  Mirrors the Python ``__post_init__``: the
   * components are auto-normalized to a unit quaternion (after the
   * zero-norm guard), so ``new Quaternion(1, 2, 3, 4)`` yields a rotation.
   * Callers that need the raw components should use {@link Quaternion.fromRaw}.
   */
  constructor(public w: number, public x: number, public y: number, public z: number) {
    const norm = Math.sqrt(w * w + x * x + y * y + z * z);
    if (norm < 1e-10) throw new Error('Quaternion magnitude too small');
    this.w = w / norm;
    this.x = x / norm;
    this.y = y / norm;
    this.z = z / norm;
  }

  /**
   * Create a quaternion-like value WITHOUT automatic normalization, for
   * intermediate linear algebra (e.g. SLERP's linear fallback).
   * Port of morpho3d/quaternion.py::Quaternion.from_raw.
   */
  static fromRaw(w: number, x: number, y: number, z: number): Quaternion {
    const norm = Math.sqrt(w * w + x * x + y * y + z * z);
    if (norm < 1e-10) throw new Error('Quaternion magnitude too small');
    const q = Object.create(Quaternion.prototype) as Quaternion;
    q.w = w;
    q.x = x;
    q.y = y;
    q.z = z;
    return q;
  }

  /** Components [w, x, y, z] (port of the Python ``components`` property). */
  get components(): number[] {
    return [this.w, this.x, this.y, this.z];
  }

  /** Vector part [x, y, z] (port of the Python ``vector`` property). */
  get vector(): number[] {
    return [this.x, this.y, this.z];
  }

  /** |q| */
  get magnitude(): number {
    return Math.sqrt(this.w ** 2 + this.x ** 2 + this.y ** 2 + this.z ** 2);
  }

  /** Unit-norm copy. */
  normalize(): Quaternion {
    const n = this.magnitude;
    if (n < 1e-10) throw new Error('Quaternion magnitude too small');
    return new Quaternion(this.w / n, this.x / n, this.y / n, this.z / n);
  }

  /** Alias matching the Python ``normalized()`` name. */
  normalized(): Quaternion {
    return this.normalize();
  }

  /** q* = w − xi − yj − zk (unit quaternions: q* = q⁻¹). */
  conjugate(): Quaternion { return new Quaternion(this.w, -this.x, -this.y, -this.z); }

  /**
   * Quaternion inverse q⁻¹ = q* / |q|² (port of the Python ``inverse``
   * property).  For unit quaternions this equals the conjugate.
   */
  get inverse(): Quaternion {
    const normSq = this.w ** 2 + this.x ** 2 + this.y ** 2 + this.z ** 2;
    if (normSq < 1e-10) throw new Error('Quaternion magnitude too small for inversion');
    return new Quaternion(this.w / normSq, -this.x / normSq, -this.y / normSq, -this.z / normSq);
  }

  /**
   * Rotation angle θ ∈ [0, π] (port of the Python ``rotation_angle``
   * property).  q and −q describe the same rotation; angles are folded
   * into the non-negative half so 2·acos(w) never exceeds π.
   */
  get rotationAngle(): number {
    const c = Math.max(-1, Math.min(1, this.w));
    let angle = 2 * Math.acos(c);
    if (angle > Math.PI) angle = 2 * Math.PI - angle;
    return angle;
  }

  /** Unit rotation axis (port of the Python ``rotation_axis`` property). */
  get rotationAxis(): [number, number, number] {
    const sinHalf = Math.sqrt(Math.max(0, 1 - this.w * this.w));
    if (sinHalf < 1e-10) return [0, 0, 1];
    return [this.x / sinHalf, this.y / sinHalf, this.z / sinHalf];
  }

  static fromAxisAngle(axis: [number, number, number], angle: number): Quaternion {
    const half = angle / 2;
    const s = Math.sin(half);
    const norm = Math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2);
    // Guard against zero-length axis: return identity quaternion
    // Ref: Shoemake (1985), "Animating rotation with quaternion curves"
    if (norm < 1e-15) return new Quaternion(1, 0, 0, 0);
    return new Quaternion(Math.cos(half), axis[0]*s/norm, axis[1]*s/norm, axis[2]*s/norm);
  }

  static fromRotationMatrix(R: number[][]): Quaternion {
    const trace = R[0][0] + R[1][1] + R[2][2];
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      return new Quaternion(0.25/s, (R[2][1]-R[1][2])*s, (R[0][2]-R[2][0])*s, (R[1][0]-R[0][1])*s);
    }
    // Branch 2: R[0][0] largest
    if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
      const s = 2 * Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]);
      return new Quaternion(0.25*s, (R[2][1]-R[1][2])/s, (R[0][1]+R[1][0])/s, (R[0][2]+R[2][0])/s);
    }
    // Branch 3: R[1][1] largest
    if (R[1][1] > R[2][2]) {
      const s = 2 * Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]);
      return new Quaternion((R[0][2]-R[2][0])/s, (R[0][1]+R[1][0])/s, 0.25*s, (R[1][2]+R[2][1])/s);
    }
    // Branch 4: R[2][2] largest
    const s = 2 * Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]);
    return new Quaternion((R[1][0]-R[0][1])/s, (R[0][2]+R[2][0])/s, (R[1][2]+R[2][1])/s, 0.25*s);
  }

  toRotationMatrix(): number[][] {
    const {w,x,y,z} = this;
    return [
      [1-2*(y*y+z*z), 2*(x*y-w*z), 2*(x*z+w*y)],
      [2*(x*y+w*z), 1-2*(x*x+z*z), 2*(y*z-w*x)],
      [2*(x*z-w*y), 2*(y*z+w*x), 1-2*(x*x+y*y)],
    ];
  }

  /**
   * Convert to ZYZ Euler angles (α, β, γ) in radians.
   * Port of morpho3d/quaternion.py::Quaternion.to_zyz_euler.
   */
  toZYZEuler(): [number, number, number] {
    const { w, x, y, z } = this;
    const cosBeta = w * w + z * z - x * x - y * y;
    const beta = Math.acos(Math.max(-1, Math.min(1, cosBeta)));

    if (Math.abs(Math.sin(beta)) < 1e-10) {
      // Gimbal lock
      const alpha = 0.0;
      const gamma = 2 * Math.atan2(w, z);
      return [alpha, beta, gamma];
    }
    const alpha = Math.atan2(2 * (w * x + y * z), w * w - x * x - y * y + z * z);
    const gamma = Math.atan2(2 * (w * z + x * y), w * w + x * x - y * y - z * z);
    return [alpha, beta, gamma];
  }

  multiply(q: Quaternion): Quaternion {
    return new Quaternion(
      this.w*q.w - this.x*q.x - this.y*q.y - this.z*q.z,
      this.w*q.x + this.x*q.w + this.y*q.z - this.z*q.y,
      this.w*q.y - this.x*q.z + this.y*q.w + this.z*q.x,
      this.w*q.z + this.x*q.y - this.y*q.x + this.z*q.w,
    );
  }

  slerp(q: Quaternion, t: number): Quaternion {
    let dot = this.w*q.w + this.x*q.x + this.y*q.y + this.z*q.z;
    if (dot < 0) { q = new Quaternion(-q.w, -q.x, -q.y, -q.z); dot = -dot; }
    if (dot > 0.9995) {
      const r = Quaternion.fromRaw(this.w+t*(q.w-this.w), this.x+t*(q.x-this.x), this.y+t*(q.y-this.y), this.z+t*(q.z-this.z));
      return r.normalize();
    }
    const theta = Math.acos(dot);
    const sinT = Math.sin(theta);
    const a = Math.sin((1-t)*theta) / sinT;
    const b = Math.sin(t*theta) / sinT;
    return new Quaternion(a*this.w+b*q.w, a*this.x+b*q.x, a*this.y+b*q.y, a*this.z+b*q.z);
  }

  /**
   * Rotate a 3D point/vector by this quaternion.
   *
   * Implemented with the expanded form (avoids constructing the pure
   * quaternion (0, p), which the auto-normalizing constructor would
   * project onto the unit sphere, losing |p| — the same trap documented in
   * the Python rotate_vector):
   *   t = 2·(q_vec × p);  p' = p + w·t + q_vec × t
   */
  rotatePoint(p: [number, number, number]): [number, number, number] {
    const qv = [this.x, this.y, this.z];
    const t = [
      2 * (qv[1] * p[2] - qv[2] * p[1]),
      2 * (qv[2] * p[0] - qv[0] * p[2]),
      2 * (qv[0] * p[1] - qv[1] * p[0]),
    ];
    const crossQT = [
      qv[1] * t[2] - qv[2] * t[1],
      qv[2] * t[0] - qv[0] * t[2],
      qv[0] * t[1] - qv[1] * t[0],
    ];
    return [
      p[0] + this.w * t[0] + crossQT[0],
      p[1] + this.w * t[1] + crossQT[1],
      p[2] + this.w * t[2] + crossQT[2],
    ];
  }
}

function _matmul3(A: number[][], B: number[][]): number[][] {
  const C: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j];
  return C;
}

// ─── 3×3 Rotation matrix utilities (port of morpho3d/quaternion.py::RotationMatrix) ─
export class RotationMatrix {
  /** Identity matrix. */
  static identity(): number[][] {
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  }

  /** Rotation matrix from axis-angle (Rodrigues' form). */
  static fromAxisAngle(axis: [number, number, number], angle: number): number[][] {
    const norm = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const x = axis[0] / norm, y = axis[1] / norm, z = axis[2] / norm;
    const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
    return [
      [c + x * x * C,       x * y * C - z * s,   x * z * C + y * s],
      [y * x * C + z * s,   c + y * y * C,       y * z * C - x * s],
      [z * x * C - y * s,   z * y * C + x * s,   c + z * z * C      ]
    ];
  }

  /** Compute the best-fit rotation aligning two point sets (Procrustes SVD). */
  static procrustes(A: number[][], B: number[][]): number[][] {
    if (A.length !== B.length || A.length === 0) throw new Error('procrustes: empty or mismatched sets');
    for (const p of A) if (p.length !== 3) throw new Error('procrustes: 3D sets only');
    for (const p of B) if (p.length !== 3) throw new Error('procrustes: 3D sets only');
    // Centre both
    const meanA = [0, 0, 0], meanB = [0, 0, 0];
    for (let i = 0; i < A.length; i++) { meanA[0] += A[i][0]; meanA[1] += A[i][1]; meanA[2] += A[i][2]; }
    for (let i = 0; i < B.length; i++) { meanB[0] += B[i][0]; meanB[1] += B[i][1]; meanB[2] += B[i][2]; }
    for (let k = 0; k < 3; k++) { meanA[k] /= A.length; meanB[k] /= A.length; }
    const Ac: number[][] = A.map(p => [p[0] - meanA[0], p[1] - meanA[1], p[2] - meanA[2]]);
    const Bc: number[][] = B.map(p => [p[0] - meanB[0], p[1] - meanB[1], p[2] - meanB[2]]);
    // H = Aᵀ B
    const H: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      for (let k = 0; k < A.length; k++) H[i][j] += Ac[k][i] * Bc[k][j];
    }
    // SVD of H ≈ U S Vᵀ; R = V Uᵀ (single-sided Jacobi — fallback inline)
    const svd = _jacobiSVD3x3(H);
    // If det(VUᵀ) < 0, multiply the last column of V by -1 before computing R.
    // This applies diag(1,1,-1) to V so that R = V @ diag(1,1,-1) @ Uᵀ = V*Uᵀ
    // has det > 0 (proper rotation, not a reflection).  Per Bookstein 1991
    // and Rohlf & Slice 1990 the correction is applied to V before forming R.
    const V = svd.V, U = svd.U;
    const R: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    // Compute R = V @ Uᵀ; if det < 0, apply diag(1,1,-1) to V first
    if (det3(V) * det3(U) < 0) {
      // Flip last column of V (equivalent to V @ diag(1,1,-1))
      for (let i = 0; i < 3; i++) V[i][2] = -V[i][2];
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) R[i][j] += V[i][k] * U[k][j];  // V@U^T
    }
    return R;
  }

  /** Apply rotation to a 3-vector. */
  static apply(R: number[][], v: [number, number, number]): [number, number, number] {
    return [
      R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
      R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
      R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]
    ];
  }

  /** Transpose. */
  static transpose(R: number[][]): number[][] {
    return [
      [R[0][0], R[1][0], R[2][0]],
      [R[0][1], R[1][1], R[2][1]],
      [R[0][2], R[1][2], R[2][2]]
    ];
  }

  /**
   * Verify orthogonality R·Rᵀ = I (port of
   * quaternion.py::RotationMatrix.verify_orthogonal).
   */
  static verifyOrthogonal(R: number[][], atol: number = 1e-8): boolean {
    if (!R || R.length !== 3 || R[0].length !== 3) return false;
    const RRT = _matmul3(R, RotationMatrix.transpose(R));
    const I = RotationMatrix.identity();
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (Math.abs(RRT[i][j] - I[i][j]) > atol) return false;
    return true;
  }

  /**
   * Verify membership in SO(3): orthogonal with det = +1 (port of
   * quaternion.py::RotationMatrix.verify_special).
   */
  static verifySpecial(R: number[][], atol: number = 1e-8): boolean {
    if (!RotationMatrix.verifyOrthogonal(R, atol)) return false;
    return Math.abs(det3(R) - 1.0) <= atol;
  }

  /**
   * Compose rotation matrices; rotations are applied right-to-left
   * (port of quaternion.py::RotationMatrix.compose).
   */
  static compose(...rotations: number[][][]): number[][] {
    if (rotations.length === 0) return RotationMatrix.identity();
    let result = RotationMatrix.identity();
    for (const R of rotations) result = _matmul3(R, result);
    return result;
  }

  /** Inverse (= transpose) of a rotation matrix. */
  static inverse(R: number[][]): number[][] {
    return RotationMatrix.transpose(R);
  }
}

function det3(R: number[][]): number {
  return R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
       - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
       + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
}

function _jacobiSVD3x3(M: number[][]): { U: number[][]; S: number[]; V: number[][] } {
  // Compute Hᵀ H then eigen-decompose via Jacobi; back out U, V.
  const HtH: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    for (let k = 0; k < 3; k++) HtH[i][j] += M[k][i] * M[k][j];
  }
  const eig = _jacobi3x3(HtH);
  const order = eig.values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).map(o => o.i);
  const sortedVals = order.map(i => Math.max(0, eig.values[i]));
  const S = sortedVals.map(v => Math.sqrt(v));
  // V columns = eigenvectors[:, order[k]]
  const V: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) V[j][k] = eig.vectors[j][order[k]];
  // U = M V S⁻¹
  const U: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 3; k++) {
    if (S[k] < 1e-300) continue;
    for (let i = 0; i < 3; i++) {
      let s = 0;
      for (let j = 0; j < 3; j++) s += M[i][j] * V[j][k];
      U[i][k] = s / S[k];
    }
  }
  return { U, S, V };
}

function _jacobi3x3(M: number[][]): { values: number[]; vectors: number[][] } {
  const n = 3;
  const A: number[][] = [M[0].slice(), M[1].slice(), M[2].slice()];
  let V: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 100; iter++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += Math.abs(A[i][j]);
    if (off < 1e-14) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = A[p][q];
        if (Math.abs(apq) < 1e-30) continue;
        const app = A[p][p], aqq = A[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const app2 = app - t * apq, aqq2 = aqq + t * apq;
        A[p][p] = app2; A[q][q] = aqq2;
        A[p][q] = 0; A[q][p] = 0;
        for (let i = 0; i < 3; i++) {
          if (i !== p && i !== q) {
            const aip = A[i][p], aiq = A[i][q];
            A[i][p] = c * aip - s * aiq;
            A[p][i] = A[i][p];
            A[i][q] = s * aip + c * aiq;
            A[q][i] = A[i][q];
          }
        }
        for (let i = 0; i < 3; i++) {
          const vip = V[i][p], viq = V[i][q];
          V[i][p] = c * vip - s * viq;
          V[i][q] = s * vip + c * viq;
        }
      }
    }
  }
  const values = [A[0][0], A[1][1], A[2][2]];
  return { values, vectors: V };
}
