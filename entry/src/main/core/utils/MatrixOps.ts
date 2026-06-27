import { Matrix } from "../math/Matrix";
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
