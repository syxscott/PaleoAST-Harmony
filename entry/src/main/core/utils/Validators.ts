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
  // Symmetry + non-negativity + zero diagonal (validators.py)
  const tol = 1e-9;
  for (let i = 0; i < D.rows; i++) {
    if (Math.abs(D.get(i, i)) > tol) throw new ValidationError('Distance matrix diagonal must be zero');
    for (let j = i + 1; j < D.cols; j++) {
      const a = D.get(i, j), b = D.get(j, i);
      if (isNaN(a) || isNaN(b)) throw new ValidationError('Distance matrix contains NaN');
      if (a < 0 || b < 0) throw new ValidationError('Distance matrix must be non-negative');
      if (Math.abs(a - b) > tol * Math.max(1, Math.abs(a))) {
        throw new ValidationError(`Distance matrix not symmetric at (${i},${j}): ${a} vs ${b}`);
      }
    }
  }
}

export function validateGroups(groups: number[], n: number): void {
  if (groups.length !== n) throw new ValidationError('Groups length mismatch');
  if (new Set(groups).size < 2) throw new ValidationError('Need at least 2 groups');
  if (groups.some(g => isNaN(g))) throw new ValidationError('Groups contain NaN');
}

/** Validate a general numeric matrix for shape and finiteness (validators.py). */
export function validateMatrix(data: Matrix, options?: { minRows?: number; minCols?: number; allowNaN?: boolean; name?: string }): void {
  const name = options?.name ?? 'matrix';
  const minRows = options?.minRows ?? 1;
  const minCols = options?.minCols ?? 1;
  if (data.rows < minRows) throw new MatrixDimensionError(`${name}: need ≥ ${minRows} rows, got ${data.rows}`);
  if (data.cols < minCols) throw new MatrixDimensionError(`${name}: need ≥ ${minCols} cols, got ${data.cols}`);
  if (!options?.allowNaN && data.anyNaN()) throw new ValidationError(`${name}: contains NaN`);
}

/** Basic Newick syntax sanity check (validators.py validate_newick_string). */
export function validateNewickString(newick: string): void {
  if (!newick || newick.trim().length === 0) throw new ValidationError('Newick string is empty');
  const trimmed = newick.trim();
  if (!trimmed.endsWith(';')) throw new ValidationError('Newick string must end with ;');
  let depth = 0;
  for (const ch of trimmed) {
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < 0) throw new ValidationError('Newick has unbalanced parentheses'); }
  }
  if (depth !== 0) throw new ValidationError('Newick has unbalanced parentheses');
}

/** Column-name hygiene (validators.py validate_column_name). */
export function validateColumnName(name: string): void {
  if (!name || name.trim().length === 0) throw new ValidationError('Column name is empty');
  if (name.length > 128) throw new ValidationError('Column name exceeds 128 characters');
}
