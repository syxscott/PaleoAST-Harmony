/**
 * Missing value imputation — replaces config/imputation.py
 */

export interface MissingReport {
  totalCells: number;
  missingCells: number;
  missingPercent: number;
  perColumn: { name: string; missing: number; percent: number }[];
  perRow: { index: number; missing: number }[];
}

export function analyzeMissing(data: number[][], colNames?: string[]): MissingReport {
  const nRows = data.length, nCols = data[0]?.length ?? 0;
  let totalMissing = 0;
  const perCol: { name: string; missing: number; percent: number }[] = [];
  const perRow: { index: number; missing: number }[] = [];

  for (let j = 0; j < nCols; j++) {
    let miss = 0;
    for (let i = 0; i < nRows; i++) if (isNaN(data[i][j]) || data[i][j] === null) miss++;
    totalMissing += miss;
    perCol.push({ name: colNames?.[j] ?? 'Var_' + (j + 1), missing: miss, percent: nRows > 0 ? miss / nRows : 0 });
  }
  for (let i = 0; i < nRows; i++) {
    let miss = 0;
    for (let j = 0; j < nCols; j++) if (isNaN(data[i][j]) || data[i][j] === null) miss++;
    perRow.push({ index: i, missing: miss });
  }
  const total = nRows * nCols;
  return { totalCells: total, missingCells: totalMissing, missingPercent: total > 0 ? totalMissing / total : 0, perColumn: perCol, perRow: perRow };
}

export function imputeKNN(data: number[][], k: number = 5): number[][] {
  const result = data.map(row => [...row]);
  const nRows = data.length, nCols = data[0]?.length ?? 0;
  for (let i = 0; i < nRows; i++) {
    const missing = [];
    for (let j = 0; j < nCols; j++) if (isNaN(result[i][j])) missing.push(j);
    if (missing.length === 0) continue;
    const observed = [];
    for (let j = 0; j < nCols; j++) if (!isNaN(result[i][j])) observed.push(j);
    if (observed.length === 0) {
      for (const j of missing) { const colMean = colMeanFn(data, j); result[i][j] = isNaN(colMean) ? 0 : colMean; }
      continue;
    }
    const dists: { idx: number; dist: number }[] = [];
    for (let r = 0; r < nRows; r++) {
      if (r === i) continue;
      let d = 0, cnt = 0;
      for (const j of observed) { if (!isNaN(data[r][j])) { d += (data[i][j] - data[r][j]) ** 2; cnt++; } }
      dists.push({ idx: r, dist: cnt > 0 ? Math.sqrt(d) : Infinity });
    }
    dists.sort((a, b) => a.dist - b.dist);
    const neighbors = dists.slice(0, k).map(d => d.idx);
    for (const j of missing) {
      const vals = neighbors.map(n => data[n][j]).filter(v => !isNaN(v));
      result[i][j] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : colMeanFn(data, j);
    }
  }
  return result;
}

export function imputeMean(data: number[][]): number[][] {
  const result = data.map(row => [...row]);
  const nCols = data[0]?.length ?? 0;
  for (let j = 0; j < nCols; j++) {
    const m = colMeanFn(data, j);
    for (let i = 0; i < data.length; i++) if (isNaN(result[i][j])) result[i][j] = isNaN(m) ? 0 : m;
  }
  return result;
}

function colMeanFn(data: number[][], col: number): number {
  let sum = 0, cnt = 0;
  for (let i = 0; i < data.length; i++) if (!isNaN(data[i][col])) { sum += data[i][col]; cnt++; }
  return cnt > 0 ? sum / cnt : NaN;
}

// ─── Parity exports (imputation.py ImputationResult / array helpers) ────────

/** Standard imputation outcome (imputation.py ImputationResult). */
export interface ImputationResult {
  method: 'mean' | 'median' | 'knn' | 'remove_rows' | 'remove_columns';
  imputed: number[][];
  nImputed: number;
}

/** Remove rows containing any NaN from a raw 2-D array. */
export function removeRowsWithNaN(data: number[][]): number[][] {
  return data.filter(row => !row.some(v => isNaN(v)));
}

/** Remove columns containing any NaN from a raw 2-D array. */
export function removeColumnsWithNaN(data: number[][]): number[][] {
  if (data.length === 0) return data;
  const keep: number[] = [];
  const nCols = data[0].length;
  for (let j = 0; j < nCols; j++) {
    let hasNaN = false;
    for (let i = 0; i < data.length; i++) {
      if (isNaN(data[i][j])) { hasNaN = true; break; }
    }
    if (!hasNaN) keep.push(j);
  }
  return data.map(row => keep.map(j => row[j]));
}
