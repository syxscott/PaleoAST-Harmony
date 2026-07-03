/**
 * Compute correlation (Pearson / Spearman) — replaces
 * stratigraphy/isotope_analysis.py::compute_correlation.
 *
 * Returns (r, p-value).
 */
import { ComputationError } from '../../utils/Exceptions';
import { pnorm, rankdata } from '../../math/stats';

export function computeCorrelation(
  x: number[],
  y: number[],
  method: 'pearson' | 'spearman' = 'pearson'
): { r: number; pValue: number; method: string } {
  if (x.length !== y.length) throw new ComputationError('x and y length mismatch');
  const n = x.length;
  if (n < 3) throw new ComputationError('Need ≥ 3 observations');

  let a = x, b = y;
  if (method === 'spearman') {
    a = rankdata(x);
    b = rankdata(y);
  }
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i] - ma, dy = b[i] - mb;
    num += dx * dy;
    da += dx * dx;
    db += dy * dy;
  }
  const denom = Math.sqrt(da * db);
  const r = denom > 0 ? num / denom : 0;

  // p-value via t-test  t = r sqrt((n-2)/(1-r²))
  let pValue: number;
  if (Math.abs(r) >= 1) pValue = 0;
  else {
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    pValue = 2 * (1 - pnorm(t, 0, 1));
  }
  return { r, pValue, method };
}
