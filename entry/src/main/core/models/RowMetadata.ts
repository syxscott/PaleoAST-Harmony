export interface RowMeta{group?:string;color?:string;weight?:number;excluded?:boolean;}
export class RowMetadata{
  private _m:Map<number,RowMeta>=new Map();
  get(i:number):RowMeta|undefined{return this._m.get(i);}
  set(i:number,m:RowMeta):void{this._m.set(i,m);}
  getGroup(i:number):string|undefined{return this._m.get(i)?.group;}
  setGroup(i:number,g:string):void{const m=this._m.get(i)??{};m.group=g;this._m.set(i,m);}
  isExcluded(i:number):boolean{return this._m.get(i)?.excluded??false;}
  exclude(i:number):void{const m=this._m.get(i)??{};m.excluded=true;this._m.set(i,m);}
  getGroups():Record<number,string|undefined>{const r:Record<number,string|undefined>={};for(const[k,v]of this._m)r[k]=v.group;return r;}
  clear():void{this._m.clear();}
}
