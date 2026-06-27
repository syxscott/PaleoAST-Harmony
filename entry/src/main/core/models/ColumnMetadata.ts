export type ColumnDataType="numeric"|"categorical"|"ordinal"|"binary";
export interface ColumnMeta{name:string;type:ColumnDataType;unit?:string;min?:number;max?:number;mean?:number;missingCount?:number;}
export class ColumnMetadata{
  private _m:Map<number,ColumnMeta>=new Map();
  get(i:number):ColumnMeta|undefined{return this._m.get(i);}
  set(i:number,m:ColumnMeta):void{this._m.set(i,m);}
  getName(i:number):string|undefined{return this._m.get(i)?.name;}
  getType(i:number):ColumnDataType|undefined{return this._m.get(i)?.type;}
  getAll():ColumnMeta[]{return Array.from(this._m.values());}
  getNames():string[]{return this.getAll().map(m=>m.name);}
  getNumericIndices():number[]{const r:number[]=[];for(const[k,v]of this._m)if(v.type==="numeric")r.push(k);return r;}
  clear():void{this._m.clear();}
}
