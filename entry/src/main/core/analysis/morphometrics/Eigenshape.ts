/**
 * Eigenshape analysis — replaces morphometrics/efa.py::EigenshapeAnalyzer.
 *
 * Takes a list of EFA coefficient matrices and performs PCA on the
 * flattened coefficient vectors.
 */
import { Matrix } from '../../math/Matrix';
import * as linalg from '../../math/linalg';

export interface EigenshapeResult {
  scores: Matrix;
  eigenvalues: number[];
  explainedVariance: number[];
  cumulativeVariance: number[];
  nSpecimens: number;
  nComponents: number;
  /** Human-readable summary (top components with cumulative variance). */
  summary: string;
}

export function eigenshape(
  efaCoefficients: Matrix[] | number[][][],
  nComponents?: number
): EigenshapeResult {
  const flat: number[][] = efaCoefficients.map(c =>
    c instanceof Matrix ? c.toArray() : (c as number[][]).flat()
  );
  const nSpec = flat.length;
  if (nSpec < 2) throw new Error('Eigenshape requires ≥ 2 specimens');
  const nVar = flat[0].length;

  const data = new Float64Array(nSpec * nVar);
  for (let i = 0; i < nSpec; i++) for (let j = 0; j < nVar; j++) data[i * nVar + j] = flat[i][j];
  const M = new Matrix(data, nSpec, nVar);

  // Center
  const mean = M.meanAxis(0);
  const d = new Float64Array(M.length);
  for (let i = 0; i < M.rows; i++) for (let j = 0; j < M.cols; j++) d[i * M.cols + j] = M.get(i, j) - mean.get(0, j);
  const Mc = new Matrix(d, M.rows, M.cols);

  // Covariance, then eigh to get eigenvalues/vectors
  const cov = Mc.transpose().matmul(Mc).div(Math.max(1, M.rows - 1));
  const eig = linalg.eigh(cov);

  // Sort descending
  const order = eig.eigenvalues.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).map(o => o.i);
  const sortedVals = order.map(i => Math.max(0, eig.eigenvalues[i]));
  const nc = nComponents ?? Math.min(sortedVals.length, nVar);
  const sortedValsSlice = sortedVals.slice(0, nc);
  const totalVar = sortedVals.reduce((s, v) => s + v, 0) || 1;
  const explained = sortedValsSlice.map(v => v / totalVar);
  const cumulative: number[] = [];
  let acc = 0;
  for (const v of explained) { acc += v; cumulative.push(acc); }

  // Build V = eigenvectors[:, order[:nc]]
  const Vd = new Float64Array(nVar * nc);
  for (let k = 0; k < nc; k++)
    for (let j = 0; j < nVar; j++)
      Vd[j * nc + k] = eig.eigenvectors.data[j + order[k] * nVar];
  const V = new Matrix(Vd, nVar, nc);

  const scores = Mc.matmul(V);

  // Summary text (port of efa.py::EigenshapeResult.summary)
  const lines: string[] = ['Eigenshape Analysis', '==================================================',
    `Specimens: ${nSpec}`];
  let cumAcc = 0;
  for (let i = 0; i < Math.min(nc, 10); i++) {
    cumAcc += explained[i];
    lines.push(`ES${i + 1}: ${(explained[i] * 100).toFixed(2)}% (cum: ${(cumAcc * 100).toFixed(2)}%)`);
  }

  return { scores, eigenvalues: sortedValsSlice, explainedVariance: explained, cumulativeVariance: cumulative,
           nSpecimens: nSpec, nComponents: nc, summary: lines.join('\n') };
}
