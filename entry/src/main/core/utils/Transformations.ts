import { Matrix } from "../math/Matrix";
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
export function boxcoxTransform(arr: number[], lambda: number | null = null): { result: number[]; lambda: number } {
  const valid = arr.filter(v => v > 0); if(valid.length < 2) return { result: [...arr], lambda: 1 };
  if(lambda === null){ let bestL=1, bestLL=-Infinity; for(let l=-2;l<=2;l+=0.1){let ll=0;for(const v of valid){ll+=l===0?Math.log(v):((Math.pow(v,l)-1)/l);}if(ll>bestLL){bestLL=ll;bestL=l;}}lambda=bestL;}
  const result = arr.map(v => v>0 ? (lambda===0?Math.log(v):((Math.pow(v,lambda)-1)/lambda)) : NaN);
  return { result, lambda };
}
export function imputeKNN(data: number[][], k: number = 5): number[][] {
  const r=data.map(r=>[...r]); const nR=data.length, nC=data[0]?.length??0;
  for(let i=0;i<nR;i++){const miss:number[]=[];for(let j=0;j<nC;j++)if(isNaN(r[i][j]))miss.push(j);if(!miss.length)continue;
   const obs:number[]=[];for(let j=0;j<nC;j++)if(!isNaN(r[i][j]))obs.push(j);
   if(!obs.length){for(const j of miss){let s=0,c=0;for(let r2=0;r2<nR;r2++)if(!isNaN(data[r2][j])){s+=data[r2][j];c++;}r[i][j]=c>0?s/c:0;}continue;}
   const dists:{idx:number,d:number}[]=[];for(let r2=0;r2<nR;r2++){if(r2===i)continue;let d=0,c=0;for(const j of obs)if(!isNaN(data[r2][j])){d+=(data[i][j]-data[r2][j])**2;c++;}dists.push({idx:r2,d:c>0?Math.sqrt(d):Infinity});}
   dists.sort((a,b)=>a.d-b.d); const nbrs=dists.slice(0,k).map(d=>d.idx);
   for(const j of miss){const vals=nbrs.map(n=>data[n][j]).filter(v=>!isNaN(v));r[i][j]=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;}}
  return r;
}
export function imputeMean(data: number[][]): number[][] {
  const r=data.map(r=>[...r]); const nC=data[0]?.length??0;
  for(let j=0;j<nC;j++){let s=0,c=0;for(let i=0;i<data.length;i++)if(!isNaN(data[i][j])){s+=data[i][j];c++;}const m=c>0?s/c:0;for(let i=0;i<data.length;i++)if(isNaN(r[i][j]))r[i][j]=m;}
  return r;
}
