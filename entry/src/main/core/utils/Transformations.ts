import { Matrix } from "../math/Matrix";

/**
 * The ONE definition of "this cell has no value".
 *
 * `analyzeMissing` counted `null` as missing while the `impute*` functions
 * only looked at `isNaN`, so a `null` cell survived imputation untouched and
 * then entered the KNN distance arithmetic as a plain 0 — a silent change of
 * the data. Every missing-data routine in this module and in
 * `core/config/Imputation.ts` now goes through this predicate.
 *
 * `undefined` counts as missing too: it is what a sparse row/column access
 * produces, and it is exactly as unusable as NaN.
 */
export function isMissingValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return typeof v === 'number' && isNaN(v);
}

export function logTransform(data: Matrix, base: number = 10, offset: number = 1.0): Matrix {
  const r = data.clone(); for(let i=0;i<r.length;i++){const v=r.data[i]+offset; r.data[i]=v>0?(base===Math.E?Math.log(v):Math.log(v)/Math.log(base)):NaN;} return r;
}
export function sqrtTransform(data: Matrix): Matrix {
  for(let i=0;i<data.length;i++) if(data.data[i]<0) throw new Error("sqrt requires non-negative data"); return data.sqrt();
}
export function zscoreStandardize(data: Matrix, axis: number = 0): Matrix {
  const m=data.meanAxis(axis); const s=data.stdAxis(axis); const r=data.clone();
  if(axis===0){for(let i=0;i<r.rows;i++)for(let j=0;j<r.cols;j++)r.data[i*r.cols+j]=(data.get(i,j)-m.get(0,j))/(s.get(0,j)||1);}
  else{for(let i=0;i<r.rows;i++)for(let j=0;j<r.cols;j++)r.data[i*r.cols+j]=(data.get(i,j)-m.get(i,0))/(s.get(i,0)||1);}
  return r;
}
/**
 * Relative-abundance ("percent") standardization.
 *
 * AXIS SEMANTICS (the same convention as `zscoreStandardize` above and
 * `MatrixOps.standardizeMatrix`):
 *   axis 0 -> each COLUMN is normalised to sum to 1 (column = one sample);
 *   axis 1 -> each ROW is normalised to sum to 1 (row = one sample).
 *
 * The default is axis 0. `DataController.transformPercent` normalises ROWS
 * and therefore corresponds to `percentStandardize(data, 1)` — the two
 * functions are NOT the same transform under the same name; the axis has to
 * be stated.
 */
export function percentStandardize(data: Matrix, axis: number = 0): Matrix {
  const totals=data.sumAxis(axis); const r=data.clone();
  if(axis===0){for(let i=0;i<r.rows;i++)for(let j=0;j<r.cols;j++)r.data[i*r.cols+j]=data.get(i,j)/(totals.get(0,j)||1);}
  else{for(let i=0;i<r.rows;i++){const t=totals.get(i,0)||1;for(let j=0;j<r.cols;j++)r.data[i*r.cols+j]=data.get(i,j)/t;}}
  return r;
}
export function hellingerTransform(data: Matrix): Matrix {
  const rs=data.sumAxis(1); const r=data.clone();
  for(let i=0;i<r.rows;i++){const t=rs.get(i,0)||1;for(let j=0;j<r.cols;j++)r.data[i*r.cols+j]=Math.sqrt(Math.max(0,data.get(i,j))/t);}
  return r;
}
export function wisconsinDoubleStandardize(data: Matrix): Matrix {
  const colMax=new Float64Array(data.cols); for(let j=0;j<data.cols;j++){let mx=-Infinity;for(let i=0;i<data.rows;i++)mx=Math.max(mx,data.get(i,j));colMax[j]=mx||1;}
  const s1=new Float64Array(data.length); for(let i=0;i<data.rows;i++)for(let j=0;j<data.cols;j++)s1[i*data.cols+j]=data.get(i,j)/colMax[j];
  const r=new Float64Array(data.length); for(let i=0;i<data.rows;i++){let s=0;for(let j=0;j<data.cols;j++)s+=s1[i*data.cols+j];s=s||1;for(let j=0;j<data.cols;j++)r[i*data.cols+j]=s1[i*data.cols+j]/s;}
  return new Matrix(r,data.rows,data.cols);
}

// ─── Box-Cox ───────────────────────────────────────────────────────────────────

/**
 * Profile log-likelihood of the Box-Cox transform, in the form scipy uses
 * (`scipy.stats.boxcox_llf`):
 *
 *     llf(λ) = (λ − 1)·Σ log(x_i) − (n/2)·log( Σ (y_i − ȳ)² / n )
 *     y_i = (x_i^λ − 1)/λ   (log x_i when λ = 0)
 *
 * The first term is the Jacobian of the transform and the second is the
 * variance term of the profile likelihood. BOTH are required: the previous
 * objective was only `Σ (x^λ − 1)/λ`, which grows monotonically with λ and
 * therefore always picked the top of the search grid.
 */
function boxcoxLogLikelihood(lambda: number, x: number[], sumLogX: number): number {
  const n = x.length;
  const y = new Array<number>(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = lambda === 0 ? Math.log(x[i]) : (Math.pow(x[i], lambda) - 1) / lambda;
    if (!isFinite(v)) return -Infinity;
    y[i] = v; sum += v;
  }
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (y[i] - mean) ** 2;
  if (!(ss > 0)) return -Infinity;
  const ll = (lambda - 1) * sumLogX - 0.5 * n * Math.log(ss / n);
  return isFinite(ll) ? ll : -Infinity;
}

/**
 * Golden-section maximisation of a unimodal function on [a, b].
 *
 * The two branches are the textbook ones: if f(x1) < f(x2) the maximum lies
 * in [x1, b] and the LEFT end shrinks; otherwise it lies in [a, x2] and the
 * RIGHT end shrinks.
 */
function goldenSectionMax(f: (x: number) => number, a: number, b: number): { x: number; f: number } {
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let lo = a, hi = b;
  let x1 = hi - invPhi * (hi - lo);
  let x2 = lo + invPhi * (hi - lo);
  let f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 200 && hi - lo > 1e-13; i++) {
    if (f1 < f2) {
      lo = x1; x1 = x2; f1 = f2;
      x2 = lo + invPhi * (hi - lo); f2 = f(x2);
    } else {
      hi = x2; x2 = x1; f2 = f1;
      x1 = hi - invPhi * (hi - lo); f1 = f(x1);
    }
  }
  const x = (lo + hi) / 2;
  const fx = f(x);
  return { x, f: fx };
}

/**
 * Maximum-likelihood λ for a Box-Cox transform of strictly positive data.
 *
 * The search is a coarse scan (to bracket the maximum) followed by a
 * golden-section refinement, so it finds the interior optimum instead of
 * sticking to the edge of a grid. `scipy.stats.boxcox` uses Brent's method
 * on the same objective and reaches the same value.
 */
function estimateBoxCoxLambda(x: number[]): number {
  const n = x.length;
  let sumLogX = 0;
  for (let i = 0; i < n; i++) sumLogX += Math.log(x[i]);
  const ll = (l: number): number => boxcoxLogLikelihood(l, x, sumLogX);

  const scan = (lo: number, hi: number, step: number): { best: number; bestLL: number } => {
    let best = lo, bestLL = -Infinity;
    const steps = Math.max(1, Math.round((hi - lo) / step));
    for (let i = 0; i <= steps; i++) {
      const l = lo + (i * (hi - lo)) / steps;
      const v = ll(l);
      if (v > bestLL) { bestLL = v; best = l; }
    }
    return { best, bestLL };
  };

  // First pass over the range that covers every realistic λ; a maximum on
  // the very edge means the optimum is further out, so widen once.
  let coarse = scan(-10, 10, 0.1);
  if (coarse.best <= -10 + 1e-9 || coarse.best >= 10 - 1e-9) {
    const wide = scan(-100, 100, 0.5);
    if (wide.bestLL > coarse.bestLL) coarse = wide;
  }
  if (!isFinite(coarse.bestLL)) {
    // Degenerate data (every value identical → zero variance): λ is not
    // identifiable. λ = 1 is the identity-shaped transform (x − 1).
    return 1;
  }
  const step = 0.1;
  const refined = goldenSectionMax(ll, coarse.best - step, coarse.best + step);
  if (isFinite(refined.f) && refined.f >= coarse.bestLL) return refined.x;
  return coarse.best;
}

/**
 * Box-Cox transform of a strictly positive vector.
 *
 * `lambda === null` asks for the maximum-likelihood λ, which is the profile
 * log-likelihood maximised in `boxcoxLogLikelihood` (scipy-compatible).
 * Non-positive or missing entries are transformed to NaN: Box-Cox is
 * undefined for them, and NaN keeps that visible instead of hiding it.
 */
export function boxcoxTransform(arr: number[], lambda: number | null = null): { result: number[]; lambda: number } {
  const valid = arr.filter(v => !isMissingValue(v) && v > 0);
  if(valid.length < 2) return { result: [...arr], lambda: 1 };
  if(lambda === null) lambda = estimateBoxCoxLambda(valid);
  const result = arr.map(v => (!isMissingValue(v) && v > 0) ? (lambda===0?Math.log(v):((Math.pow(v,lambda)-1)/lambda)) : NaN);
  return { result, lambda };
}

// ─── Imputation ───────────────────────────────────────────────────────────────

/**
 * K-nearest-neighbour imputation over rows.
 *
 * Missing cells are the ones `isMissingValue` reports (NaN, null, undefined).
 *
 * A column that is ENTIRELY missing has no neighbour value and no column
 * mean: those cells stay missing (NaN) instead of being filled with 0. A 0
 * would be a fabricated observation that then participates in every mean and
 * variance as if it had been measured.
 */
export function imputeKNN(data: number[][], k: number = 5): number[][] {
  const r=data.map(r=>[...r]); const nR=data.length, nC=data[0]?.length??0;
  for(let i=0;i<nR;i++){const miss:number[]=[];for(let j=0;j<nC;j++)if(isMissingValue(r[i][j]))miss.push(j);if(!miss.length)continue;
   const obs:number[]=[];for(let j=0;j<nC;j++)if(!isMissingValue(r[i][j]))obs.push(j);
   if(!obs.length){for(const j of miss){r[i][j]=columnMean(data,j);}continue;}
   const dists:{idx:number,d:number}[]=[];for(let r2=0;r2<nR;r2++){if(r2===i)continue;let d=0,c=0;for(const j of obs)if(!isMissingValue(data[r2][j])){d+=(data[i][j]-data[r2][j])**2;c++;}dists.push({idx:r2,d:c>0?Math.sqrt(d):Infinity});}
   dists.sort((a,b)=>a.d-b.d); const nbrs=dists.slice(0,k).map(d=>d.idx);
   for(const j of miss){const vals=nbrs.map(n=>data[n][j]).filter(v=>!isMissingValue(v));r[i][j]=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:columnMean(data,j);}}
  return r;
}

/**
 * Mean imputation over columns.
 *
 * KNOWN COST (not a bug, stated so nobody re-derives it): the imputed cells
 * are set to the column mean, so the variance of the column is UNDER-estimated
 * after imputation (6 observations with variance 5.6000 become variance
 * 4.6667). That is inherent to mean imputation. `imputeKNN`,
 * `removeRowsWithNaN` and `removeColumnsWithNaN` are the alternatives.
 *
 * A column that is entirely missing keeps its missing cells: there is no
 * column mean to impute, and 0 would be a fabricated observation.
 */
export function imputeMean(data: number[][]): number[][] {
  const r=data.map(r=>[...r]); const nC=data[0]?.length??0;
  for(let j=0;j<nC;j++){const m=columnMean(data,j);for(let i=0;i<data.length;i++)if(isMissingValue(r[i][j]))r[i][j]=m;}
  return r;
}

/**
 * Mean of a column over its OBSERVED cells, or NaN when the whole column is
 * missing. Shared by the two imputation functions above so that they cannot
 * drift apart again.
 */
function columnMean(data: number[][], col: number): number {
  let s = 0, c = 0;
  for (let i = 0; i < data.length; i++) if (!isMissingValue(data[i][col])) { s += data[i][col]; c++; }
  return c > 0 ? s / c : NaN;
}
