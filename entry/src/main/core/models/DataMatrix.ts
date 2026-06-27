import {Matrix} from "../math/Matrix";
import {RowMetadata} from "./RowMetadata";
import {ColumnMetadata} from "./ColumnMetadata";
export class DataMatrix{
  readonly data:Matrix; readonly rowLabels:string[]; readonly colLabels:string[]; readonly nSamples:number; readonly nVariables:number;
  rowMeta:RowMetadata=new RowMetadata(); colMeta:ColumnMetadata=new ColumnMetadata();
  constructor(d:Matrix,rl:string[]=[],cl:string[]=[]){this.data=d;this.nSamples=d.rows;this.nVariables=d.cols;this.rowLabels=rl.length===d.rows?rl:Array.from({length:d.rows},(_,i)=>"Sample_"+(i+1));this.colLabels=cl.length===d.cols?cl:Array.from({length:d.cols},(_,i)=>"Var_"+(i+1));}
  getRow(i:number):number[]{return this.data.row(i);}
  getCol(j:number):number[]{return this.data.col(j);}
  getColumn(n:string):number[]|null{const i=this.colLabels.indexOf(n);return i>=0?this.data.col(i):null;}
  getColumnIndex(n:string):number{return this.colLabels.indexOf(n);}
  getRowIndex(n:string):number{return this.rowLabels.indexOf(n);}
  transpose():DataMatrix{return new DataMatrix(this.data.transpose(),[...this.colLabels],[...this.rowLabels]);}
  subset(rows:number[],cols?:number[]):DataMatrix{const c=cols??Array.from({length:this.data.cols},(_,i)=>i);const d=new Float64Array(rows.length*c.length);for(let i=0;i<rows.length;i++)for(let j=0;j<c.length;j++)d[i*c.length+j]=this.data.get(rows[i],c[j]);return new DataMatrix(new Matrix(d,rows.length,c.length),rows.map(i=>this.rowLabels[i]),c.map(j=>this.colLabels[j]));}
  getGroups():number[]|null{const g:number[]=[];let has=false;for(let i=0;i<this.nSamples;i++){const gr=this.rowMeta.getGroup(i);if(gr!==undefined){g.push(parseInt(gr)||0);has=true;}else g.push(0);}return has?g:null;}
  summary():string{return"DataMatrix("+this.nSamples+"x"+this.nVariables+")";}
}
