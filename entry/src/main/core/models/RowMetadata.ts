import type { ColumnDataType } from './ColumnMetadata';

export interface RowMeta{group?:string;color?:string;weight?:number;excluded?:boolean;type?:ColumnDataType;}

/**
 * Per-specimen metadata. `group` is a NAME (the spreadsheet offers
 * Group_A/Group_B/.../"Ungrouped"), never a number -- `DataMatrix.getGroups`
 * is what turns names into the integer codes the statistics take.
 * `type` is only populated on a matrix produced by `transpose()`, where a
 * former *variable* became a row and its column data type has to come with it.
 */
export class RowMetadata{
  private _m:Map<number,RowMeta>=new Map();
  get(i:number):RowMeta|undefined{return this._m.get(i);}
  set(i:number,m:RowMeta):void{this._m.set(i,m);}
  getGroup(i:number):string|undefined{return this._m.get(i)?.group;}
  setGroup(i:number,g:string):void{const m=this._m.get(i)??{};m.group=g;this._m.set(i,m);}
  /** Drop the entry entirely (used when a row's grouping is cleared). */
  unset(i:number):void{this._m.delete(i);}
  isExcluded(i:number):boolean{return this._m.get(i)?.excluded??false;}
  exclude(i:number):void{const m=this._m.get(i)??{};m.excluded=true;this._m.set(i,m);}
  getGroups():Record<number,string|undefined>{const r:Record<number,string|undefined>={};for(const[k,v]of this._m)r[k]=v.group;return r;}
  clear():void{this._m.clear();}
}
