/**
 * Quaternion operations ¡ª replaces morpho3d/quaternion.py
 * Used for 3D rotations in GPA and TPS.
 */

export class Quaternion {
  constructor(public w: number, public x: number, public y: number, public z: number) {}

  static fromAxisAngle(axis: [number, number, number], angle: number): Quaternion {
    const half = angle / 2;
    const s = Math.sin(half);
    const norm = Math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2);
    return new Quaternion(Math.cos(half), axis[0]*s/norm, axis[1]*s/norm, axis[2]*s/norm);
  }

  static fromRotationMatrix(R: number[][]): Quaternion {
    const trace = R[0][0] + R[1][1] + R[2][2];
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      return new Quaternion(0.25/s, (R[2][1]-R[1][2])*s, (R[0][2]-R[2][0])*s, (R[1][0]-R[0][1])*s);
    }
    if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
      const s = 2 * Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]);
      return new Quaternion((R[2][1]-R[1][2])/s, 0.25*s, (R[0][1]+R[1][0])/s, (R[0][2]+R[2][0])/s);
    }
    if (R[1][1] > R[2][2]) {
      const s = 2 * Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]);
      return new Quaternion((R[0][2]-R[2][0])/s, (R[0][1]+R[1][0])/s, 0.25*s, (R[1][2]+R[2][1])/s);
    }
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

  multiply(q: Quaternion): Quaternion {
    return new Quaternion(
      this.w*q.w - this.x*q.x - this.y*q.y - this.z*q.z,
      this.w*q.x + this.x*q.w + this.y*q.z - this.z*q.y,
      this.w*q.y - this.x*q.z + this.y*q.w + this.z*q.x,
      this.w*q.z + this.x*q.y - this.y*q.x + this.z*q.w,
    );
  }

  conjugate(): Quaternion { return new Quaternion(this.w, -this.x, -this.y, -this.z); }
  norm(): number { return Math.sqrt(this.w**2 + this.x**2 + this.y**2 + this.z**2); }
  normalize(): Quaternion { const n = this.norm(); return new Quaternion(this.w/n, this.x/n, this.y/n, this.z/n); }

  slerp(q: Quaternion, t: number): Quaternion {
    let dot = this.w*q.w + this.x*q.x + this.y*q.y + this.z*q.z;
    if (dot < 0) { q = new Quaternion(-q.w, -q.x, -q.y, -q.z); dot = -dot; }
    if (dot > 0.9995) {
      const r = new Quaternion(this.w+t*(q.w-this.w), this.x+t*(q.x-this.x), this.y+t*(q.y-this.y), this.z+t*(q.z-this.z));
      return r.normalize();
    }
    const theta = Math.acos(dot);
    const sinT = Math.sin(theta);
    const a = Math.sin((1-t)*theta) / sinT;
    const b = Math.sin(t*theta) / sinT;
    return new Quaternion(a*this.w+b*q.w, a*this.x+b*q.x, a*this.y+b*q.y, a*this.z+b*q.z);
  }

  rotatePoint(p: [number, number, number]): [number, number, number] {
    const qp = new Quaternion(0, p[0], p[1], p[2]);
    const result = this.multiply(qp).multiply(this.conjugate());
    return [result.x, result.y, result.z];
  }
}
