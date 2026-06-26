import { Matrix } from '../math/Matrix';
import { ValidationError, MatrixDimensionError } from './Exceptions';

export function validateDataArray(data: unknown, allowNaN = false, name = 'data'): Matrix {
  if (data === null || data === undefined) throw new ValidationError(name + ': null/undefined');
  if (data instanceof Matrix) {
    if (!allowNaN && data.anyNaN()) throw new ValidationError(name + ': contains NaN');
    return data;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) throw new ValidationError(name + ': empty');
    if (Array.isArray(data[0])) {
      const nr = data.length, nc = (data[0] as number[]).length;
      const d = new Float64Array(nr * nc);
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) d[i * nc + j] = Number(data[i][j]);
      const m = new Matrix(d, nr, nc);
      if (!allowNaN && m.anyNaN()) throw new ValidationError(name + ': contains NaN');
      return m;
    }
    const d = new Float64Array(data.length);
    for (let i = 0; i < data.length; i++) d[i] = Number(data[i]);
    const m = new Matrix(d, data.length, 1);
    if (!allowNaN && m.anyNaN()) throw new ValidationError(name + ': contains NaN');
    return m;
  }
  throw new ValidationError(name + ': unsupported type');
}

export function validateDistanceMatrix(D: Matrix): void {
  if (D.rows !== D.cols) throw new MatrixDimensionError('Must be square');
}

export function validateGroups(groups: number[], n: number): void {
  if (groups.length !== n) throw new ValidationError('Groups length mismatch');
  if (new Set(groups).size < 2) throw new ValidationError('Need at least 2 groups');
}
