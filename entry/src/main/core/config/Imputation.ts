/**
 * Missing value imputation — replaces config/imputation.py
 *
 * The imputation functions themselves live in `core/utils/Transformations.ts`
 * and are RE-EXPORTED here. They used to exist twice — once in this file and
 * once in `core/utils/Transformations.ts` — and the two copies had already
 * drifted apart: an entirely missing column was filled with 0 by
 * `config/Imputation.imputeMean` and `utils/Transformations.imputeKNN` but
 * left as NaN by `config/Imputation.imputeKNN`. One implementation, one
 * behaviour.
 *
 * "Missing" has exactly one meaning across the whole module: NaN, null or
 * undefined (`isMissingValue`). `analyzeMissing` used to count `null` as
 * missing while the imputers only looked at `isNaN`, so a `null` cell
 * survived imputation untouched and then entered the KNN distance arithmetic
 * as a plain 0 — a silent change of the data.
 */

import { isMissingValue, imputeKNN, imputeMean } from '../utils/Transformations';

export { isMissingValue, imputeKNN, imputeMean };

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
    for (let i = 0; i < nRows; i++) if (isMissingValue(data[i][j])) miss++;
    totalMissing += miss;
    perCol.push({ name: colNames?.[j] ?? 'Var_' + (j + 1), missing: miss, percent: nRows > 0 ? miss / nRows : 0 });
  }
  for (let i = 0; i < nRows; i++) {
    let miss = 0;
    for (let j = 0; j < nCols; j++) if (isMissingValue(data[i][j])) miss++;
    perRow.push({ index: i, missing: miss });
  }
  const total = nRows * nCols;
  return { totalCells: total, missingCells: totalMissing, missingPercent: total > 0 ? totalMissing / total : 0, perColumn: perCol, perRow: perRow };
}

// ─── Parity exports (imputation.py ImputationResult / array helpers) ────────

/** Standard imputation outcome (imputation.py ImputationResult). */
export interface ImputationResult {
  method: 'mean' | 'median' | 'knn' | 'remove_rows' | 'remove_columns';
  imputed: number[][];
  nImputed: number;
}

/**
 * Remove rows containing any missing value (NaN, null or undefined) from a
 * raw 2-D array.
 */
export function removeRowsWithNaN(data: number[][]): number[][] {
  return data.filter(row => !row.some(v => isMissingValue(v)));
}

/**
 * Remove columns containing any missing value (NaN, null or undefined) from a
 * raw 2-D array.
 */
export function removeColumnsWithNaN(data: number[][]): number[][] {
  if (data.length === 0) return data;
  const keep: number[] = [];
  const nCols = data[0].length;
  for (let j = 0; j < nCols; j++) {
    let hasMissing = false;
    for (let i = 0; i < data.length; i++) {
      if (isMissingValue(data[i][j])) { hasMissing = true; break; }
    }
    if (!hasMissing) keep.push(j);
  }
  return data.map(row => keep.map(j => row[j]));
}
