import {Matrix} from "../math/Matrix";
import {RowMetadata} from "./RowMetadata";
import {ColumnMetadata} from "./ColumnMetadata";
import { Observed } from '@kit.ArkUI';

/** Lightweight non-copying view over a DataMatrix (data_matrix.py DataMatrixView). */
export class DataMatrixView {
  readonly source: DataMatrix;
  readonly rowIndices: number[];
  readonly colIndices: number[];

  constructor(source: DataMatrix, rowIndices?: number[], colIndices?: number[]) {
    this.source = source;
    this.rowIndices = rowIndices ?? Array.from({length: source.nSamples}, (_, i) => i);
    this.colIndices = colIndices ?? Array.from({length: source.nVariables}, (_, i) => i);
  }

  get nSamples(): number { return this.rowIndices.length; }
  get nVariables(): number { return this.colIndices.length; }

  get(row: number, col: number): number {
    return this.source.data.get(this.rowIndices[row], this.colIndices[col]);
  }

  toDataMatrix(): DataMatrix {
    return this.source.subset(this.rowIndices, this.colIndices);
  }
}

@Observed
export class DataMatrix{
  readonly data:Matrix; readonly rowLabels:string[]; readonly colLabels:string[]; readonly nSamples:number; readonly nVariables:number;
  rowMeta:RowMetadata=new RowMetadata(); colMeta:ColumnMetadata=new ColumnMetadata();
  currentFile:string='';
  constructor(d:Matrix,rl:string[]=[],cl:string[]=[]){this.data=d;this.nSamples=d.rows;this.nVariables=d.cols;this.rowLabels=rl.length===d.rows?rl:Array.from({length:d.rows},(_,i)=>"Sample_"+(i+1));this.colLabels=cl.length===d.cols?cl:Array.from({length:d.cols},(_,i)=>"Var_"+(i+1));}
  getRow(i:number):number[]{return this.data.row(i);}
  getCol(j:number):number[]{return this.data.col(j);}
  getColumn(n:string):number[]|null{const i=this.colLabels.indexOf(n);return i>=0?this.data.col(i):null;}
  getColumnIndex(n:string):number{return this.colLabels.indexOf(n);}
  getRowIndex(n:string):number{return this.rowLabels.indexOf(n);}
  getRowByLabel(n:string):number[]|null{const i=this.rowLabels.indexOf(n);return i>=0?this.data.row(i):null;}
  transpose():DataMatrix{
    const out=new DataMatrix(this.data.transpose(),[...this.colLabels],[...this.rowLabels]);
    // carry metadata across the row↔col swap where indices exist
    for(let i=0;i<Math.min(this.nSamples,out.nVariables);i++){const m=this.rowMeta.get(i);if(m)out.colMeta.set(i,{name:out.colLabels[i],type:'numeric'});}
    for(let j=0;j<Math.min(this.nVariables,out.nSamples);j++){const g=this.colMeta.getName(j);if(g!==undefined)out.rowMeta.setGroup(j,g);}
    return out;
  }
  /** Subset by index lists; non-continuous indices are handled correctly. */
  subset(rows:number[],cols?:number[]):DataMatrix{
    const c=cols??Array.from({length:this.data.cols},(_,i)=>i);
    const d=new Float64Array(rows.length*c.length);
    for(let i=0;i<rows.length;i++)for(let j=0;j<c.length;j++)d[i*c.length+j]=this.data.get(rows[i],c[j]);
    const out=new DataMatrix(new Matrix(d,rows.length,c.length),rows.map(i=>this.rowLabels[i]),c.map(j=>this.colLabels[j]));
    for(let i=0;i<rows.length;i++){const m=this.rowMeta.get(rows[i]);if(m)out.rowMeta.set(i,{...m});}
    for(let j=0;j<c.length;j++){const m=this.colMeta.get(c[j]);if(m)out.colMeta.set(j,{...m});}
    return out;
  }

  // ─── Missing-data handling (data_matrix.py) ─────────────────────────

  countMissing():number{let n=0;for(let i=0;i<this.nSamples;i++)for(let j=0;j<this.nVariables;j++)if(isNaN(this.data.get(i,j)))n++;return n;}

  /** Replace NaN with the column mean. */
  imputeMean():DataMatrix{return this._imputeBy('mean');}
  /** Replace NaN with the column median. */
  imputeMedian():DataMatrix{return this._imputeBy('median');}
  /** K-nearest-neighbour imputation over rows (default k=5). */
  imputeKNN(k:number=5):DataMatrix{
    const d=new Float64Array(this.data.length);
    for(let i=0;i<this.data.length;i++)d[i]=this.data.data[i];
    for(let i=0;i<this.nSamples;i++){
      for(let j=0;j<this.nVariables;j++){
        if(!isNaN(d[i*this.nVariables+j]))continue;
        const dists:{idx:number;dist:number}[]=[];
        for(let r=0;r<this.nSamples;r++){
          if(r===i)continue;
          let sum=0,cnt=0;
          for(let c=0;c<this.nVariables;c++){
            const a=d[i*this.nVariables+c],b=d[r*this.nVariables+c];
            if(!isNaN(a)&&!isNaN(b)){sum+=(a-b)*(a-b);cnt++;}
          }
          if(cnt>0)dists.push({idx:r,dist:Math.sqrt(sum/cnt)});
        }
        dists.sort((a,b)=>a.dist-b.dist);
        let acc=0,n=0;
        for(let t=0;t<Math.min(k,dists.length);t++){
          const v=d[dists[t].idx*this.nVariables+j];
          if(!isNaN(v)){acc+=v;n++;}
        }
        if(n>0)d[i*this.nVariables+j]=acc/n;
      }
    }
    return new DataMatrix(new Matrix(d,this.nSamples,this.nVariables),[...this.rowLabels],[...this.colLabels]);
  }
  private _imputeBy(stat:'mean'|'median'):DataMatrix{
    const d=new Float64Array(this.data.length);
    for(let i=0;i<this.data.length;i++)d[i]=this.data.data[i];
    for(let j=0;j<this.nVariables;j++){
      const col:number[]=[];
      for(let i=0;i<this.nSamples;i++)if(!isNaN(d[i*this.nVariables+j]))col.push(d[i*this.nVariables+j]);
      if(col.length===0)continue;
      let fill:number;
      if(stat==='mean')fill=col.reduce((a,b)=>a+b,0)/col.length;
      else{col.sort((a,b)=>a-b);const m=Math.floor(col.length/2);fill=col.length%2===1?col[m]:(col[m-1]+col[m])/2;}
      for(let i=0;i<this.nSamples;i++)if(isNaN(d[i*this.nVariables+j]))d[i*this.nVariables+j]=fill;
    }
    return new DataMatrix(new Matrix(d,this.nSamples,this.nVariables),[...this.rowLabels],[...this.colLabels]);
  }

  /** Drop columns whose values never vary (data_matrix.py remove_constant_columns). */
  removeConstantColumns():DataMatrix{
    const keep:number[]=[];
    for(let j=0;j<this.nVariables;j++){
      let first=NaN,constant=true;
      for(let i=0;i<this.nSamples;i++){
        const v=this.data.get(i,j);
        if(isNaN(v))continue;
        if(isNaN(first))first=v;
        else if(v!==first){constant=false;break;}
      }
      if(!constant)keep.push(j);
    }
    if(keep.length===this.nVariables)return this;
    return this.subset(Array.from({length:this.nSamples},(_,i)=>i),keep);
  }

  /** Drop rows containing any NaN (data_matrix.py remove_rows_with_missing). */
  removeRowsWithMissing():DataMatrix{
    const keep:number[]=[];
    for(let i=0;i<this.nSamples;i++){
      let ok=true;
      for(let j=0;j<this.nVariables;j++)if(isNaN(this.data.get(i,j))){ok=false;break;}
      if(ok)keep.push(i);
    }
    if(keep.length===this.nSamples)return this;
    return this.subset(keep);
  }

  // ─── Serialisation (data_matrix.py to_dict / from_dict) ─────────────

  toDict():Record<string,unknown>{
    return {
      rowLabels:[...this.rowLabels], colLabels:[...this.colLabels],
      data:this.data.to2D(), currentFile:this.currentFile,
    };
  }

  static fromDict(d:Record<string,unknown>):DataMatrix{
    const data=d['data'] as number[][];
    const mat=Matrix.from2D(data);
    const dm=new DataMatrix(mat,d['rowLabels'] as string[],d['colLabels'] as string[]);
    dm.currentFile=(d['currentFile'] as string)??'';
    return dm;
  }

  getGroups():number[]|null{const g:number[]=[];let has=false;for(let i=0;i<this.nSamples;i++){const gr=this.rowMeta.getGroup(i);if(gr!==undefined){g.push(parseInt(gr)||0);has=true;}else g.push(0);}return has?g:null;}
  summary():string{return"DataMatrix("+this.nSamples+"x"+this.nVariables+")";}
}
