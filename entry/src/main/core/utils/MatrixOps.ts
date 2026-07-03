import { Matrix } from "../math/Matrix";
import * as linalg from "../math/linalg";
export type DistanceMetric = "euclidean" | "bray_curtis" | "cosine" | "jaccard" | "canberra" | "cityblock" | "correlation" | "hamming";
export function pairwiseDistance(a: number[], b: number[], metric: DistanceMetric = "euclidean"): number {
  switch (metric) {
    case "euclidean": { let s=0; for(let k=0;k<a.length;k++) s+=(a[k]-b[k])**2; return Math.sqrt(s); }
    case "bray_curtis": { let n=0,d=0; for(let k=0;k<a.length;k++){n+=Math.abs(a[k]-b[k]);d+=a[k]+b[k];} return d>0?n/d:0; }
    case "cosine": { let dot=0,na=0,nb=0; for(let k=0;k<a.length;k++){dot+=a[k]*b[k];na+=a[k]**2;nb+=b[k]**2;} const d=Math.sqrt(na)*Math.sqrt(nb); return d>0?1-dot/d:1; }
    case "jaccard": { let n=0,d=0; for(let k=0;k<a.length;k++){if(a[k]||b[k]){d++;if(a[k]!==b[k])n++;}} return d>0?n/d:0; }
    case "canberra": { let s=0; for(let k=0;k<a.length;k++){const d=Math.abs(a[k])+Math.abs(b[k]);s+=d>0?Math.abs(a[k]-b[k])/d:0;} return s; }
    case "cityblock": { let s=0; for(let k=0;k<a.length;k++) s+=Math.abs(a[k]-b[k]); return s; }
    case "correlation": { const ma=a.reduce((s,v)=>s+v,0)/a.length; const mb=b.reduce((s,v)=>s+v,0)/b.length; let dot=0,da2=0,db2=0; for(let k=0;k<a.length;k++){const da=a[k]-ma,db=b[k]-mb;dot+=da*db;da2+=da*da;db2+=db*db;} const d=Math.sqrt(da2*db2); return d>0?1-dot/d:1; }
    case "hamming": { let s=0; for(let k=0;k<a.length;k++) if(a[k]!==b[k])s++; return s/a.length; }
    default: throw new Error("Unknown metric: "+metric);
  }
}
export function computeDistanceMatrix(X: Matrix, metric: DistanceMetric = "euclidean"): Matrix {
  const n=X.rows,D=Matrix.zeros(n,n); for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){const d=pairwiseDistance(X.row(i),X.row(j),metric);D.set(i,j,d);D.set(j,i,d);} return D;
}
export function cdist(X:Matrix,Y:Matrix,metric:DistanceMetric="euclidean"):Matrix {const m=X.rows,n=Y.rows,D=Matrix.zeros(m,n);for(let i=0;i<m;i++)for(let j=0;j<n;j++)D.set(i,j,pairwiseDistance(X.row(i),Y.row(j),metric));return D;}
export function pdist(X:Matrix,metric:DistanceMetric="euclidean"):number[] {const n=X.rows,r:number[]=[];for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)r.push(pairwiseDistance(X.row(i),X.row(j),metric));return r;}
export function mantelTest(D1:Matrix,D2:Matrix,nPerm=999):{r:number;pValue:number} {const n=D1.rows;const u1:number[]=[],u2:number[]=[];for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){u1.push(D1.get(i,j));u2.push(D2.get(i,j));}const m=u1.length;const mx=u1.reduce((a,b)=>a+b,0)/m;const my=u2.reduce((a,b)=>a+b,0)/m;let num=0,dx2=0,dy2=0;for(let i=0;i<m;i++){const dx=u1[i]-mx,dy=u2[i]-my;num+=dx*dy;dx2+=dx*dx;dy2+=dy*dy;}const r=Math.sqrt(dx2*dy2)>0?num/Math.sqrt(dx2*dy2):0;let cnt=0;for(let p=0;p<nPerm;p++){const perm=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}const u2p:number[]=[];for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)u2p.push(D2.get(perm[i],perm[j]));const myp=u2p.reduce((a,b)=>a+b,0)/m;let np=0,dy2p=0;for(let i=0;i<m;i++){const dx=u1[i]-mx,dy=u2p[i]-myp;np+=dx*dy;dy2p+=dy*dy;}const rp=Math.sqrt(dx2*dy2p)>0?np/Math.sqrt(dx2*dy2p):0;if(rp>=r)cnt++;}return{r,pValue:cnt/nPerm};}
export function normalizeMatrix(X:Matrix):Matrix {const mins=new Float64Array(X.cols),maxs=new Float64Array(X.cols);for(let j=0;j<X.cols;j++){mins[j]=Infinity;maxs[j]=-Infinity;for(let i=0;i<X.rows;i++){mins[j]=Math.min(mins[j],X.get(i,j));maxs[j]=Math.max(maxs[j],X.get(i,j));}}const d=new Float64Array(X.length);for(let i=0;i<X.rows;i++)for(let j=0;j<X.cols;j++)d[i*X.cols+j]=maxs[j]>mins[j]?(X.get(i,j)-mins[j])/(maxs[j]-mins[j]):0;return new Matrix(d,X.rows,X.cols);}
export function countNaN(X:Matrix):number{let c=0;for(let i=0;i<X.length;i++)if(isNaN(X.data[i]))c++;return c;}
export function rowSums(X:Matrix):number[]{return X.sumAxis(1).toArray();}
export function colSums(X:Matrix):number[]{return X.sumAxis(0).toArray();}

// ─── Ported from Python utils/matrix_ops.py ───────────────────────────────────
export function ensureMatrix(x: unknown, minDim: number = 2): Matrix {
  if (x instanceof Matrix) return x;
  if (Array.isArray(x)) {
    if (x.length === 0) throw new Error('ensureMatrix: empty array');
    if (Array.isArray(x[0])) {
      const nr = x.length, nc = (x[0] as number[]).length;
      const d = new Float64Array(nr * nc);
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) d[i * nc + j] = Number((x as number[][])[i][j]);
      return new Matrix(d, nr, nc);
    }
    const d = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) d[i] = Number((x as number[])[i]);
    return new Matrix(d, x.length, 1);
  }
  if (minDim < 1) throw new Error('ensureMatrix: minDim');
  throw new Error('ensureMatrix: unsupported type');
}

export function validateMatrixShape(X: Matrix, expectedRows?: number, expectedCols?: number, name: string = 'matrix'): void {
  if (!X || X.rows < 1 || X.cols < 1) throw new Error(name + ': empty/invalid');
  if (expectedRows !== undefined && X.rows !== expectedRows) throw new Error(name + ': expected ' + expectedRows + ' rows, got ' + X.rows);
  if (expectedCols !== undefined && X.cols !== expectedCols) throw new Error(name + ': expected ' + expectedCols + ' cols, got ' + X.cols);
}

export function centerMatrix(X: Matrix, axis: number = 0): Matrix {
  const mean = X.meanAxis(axis);
  const r = X.clone();
  if (axis === 0) for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) r.data[i * r.cols + j] = X.get(i, j) - mean.get(0, j);
  else for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) r.data[i * r.cols + j] = X.get(i, j) - mean.get(i, 0);
  return r;
}

export function standardizeMatrix(X: Matrix, axis: number = 0, ddof: number = 1): Matrix {
  // ddof parameter accepted for API parity with scipy.stats.zscore; ddof is honoured
  // implicitly via Matrix.stdAxis default (ddof=1).
  const mean = X.meanAxis(axis);
  const std = X.stdAxis(axis, ddof);
  const r = X.clone();
  if (axis === 0) {
    for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) {
      const s = std.get(0, j) || 1;
      r.data[i * r.cols + j] = (X.get(i, j) - mean.get(0, j)) / s;
    }
  } else {
    for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) {
      const s = std.get(i, 0) || 1;
      r.data[i * r.cols + j] = (X.get(i, j) - mean.get(i, 0)) / s;
    }
  }
  return r;
}

export function covarianceMatrix(X: Matrix, rowvar: boolean = false, ddof: number = 1): Matrix {
  // When rowvar=false (default), each column is a variable and each row an observation.
  const data = rowvar ? X : X.transpose();
  const n = data.rows;
  const c = centerMatrix(data, 0);
  // C = (c.T @ c) / (n - ddof)
  const ct = c.transpose();
  const num = (ct).matmul(c);
  const d = new Float64Array(num.rows * num.cols);
  const denom = Math.max(1, n - ddof);
  for (let i = 0; i < d.length; i++) d[i] = num.data[i] / denom;
  return new Matrix(d, num.rows, num.cols);
}

export function correlationMatrix(X: Matrix, method: 'pearson' | 'spearman' = 'pearson'): Matrix {
  // Each column is a variable. Returns square symmetric matrix.
  let data = X;
  if (method === 'spearman') {
    // rank each column
    const ranked = X.clone();
    for (let j = 0; j < X.cols; j++) {
      const col = X.col(j);
      const pairs = col.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const ranks = new Float64Array(col.length);
      // average-rank ties
      let i = 0;
      while (i < pairs.length) {
        let j = i;
        while (j + 1 < pairs.length && pairs[j + 1].v === pairs[i].v) j++;
        const r = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[pairs[k].i] = r;
        i = j + 1;
      }
      for (let r = 0; r < X.rows; r++) ranked.data[r * X.cols + j] = ranks[r];
    }
    data = ranked;
  }
  const cov = covarianceMatrix(data, false, 1);
  const d = new Float64Array(cov.length);
  const std = new Float64Array(cov.rows);
  for (let i = 0; i < cov.rows; i++) std[i] = Math.sqrt(Math.max(cov.get(i, i), 1e-300));
  for (let i = 0; i < cov.rows; i++)
    for (let j = 0; j < cov.cols; j++)
      d[i * cov.cols + j] = cov.get(i, j) / (std[i] * std[j]);
  return new Matrix(d, cov.rows, cov.cols);
}

export function euclideanDistanceMatrix(X: Matrix, squared: boolean = false): Matrix {
  const n = X.rows;
  const D = Matrix.zeros(n, n);
  const rowCache: number[][] = X.to2D();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let s = 0;
    const a = rowCache[i], b = rowCache[j];
    for (let k = 0; k < a.length; k++) { const dx = a[k] - b[k]; s += dx * dx; }
    const v = squared ? s : Math.sqrt(s);
    D.set(i, j, v); D.set(j, i, v);
  }
  return D;
}

export function mahalanobisDistance(x: Matrix | number[], meanVec: Matrix | number[], cov: Matrix, inverted: boolean = false): number {
  const xm = x instanceof Matrix ? x : ensureMatrix(x);
  const mv = meanVec instanceof Matrix ? meanVec : ensureMatrix(meanVec);
  const diff = xm.sub(mv);
  const inv = inverted ? cov : linalg.inv(cov);
  // d^2 = (x-µ)^T Σ^-1 (x-µ)
  let s = 0;
  const d2 = diff.to2D()[0];
  const invData = inv.to2D();
  for (let i = 0; i < d2.length; i++) {
    let rowSum = 0;
    for (let j = 0; j < d2.length; j++) rowSum += invData[i][j] * d2[j];
    s += d2[i] * rowSum;
  }
  return Math.sqrt(Math.max(0, s));
}

export function pairwiseDistances(X: Matrix, Y?: Matrix, metric: DistanceMetric = 'euclidean'): Matrix {
  return Y ? cdist(X, Y, metric) : computeDistanceMatrix(X, metric);
}
