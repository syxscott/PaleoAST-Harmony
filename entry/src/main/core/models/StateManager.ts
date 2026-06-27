import {DataMatrix} from "./DataMatrix";
export class StateManager{
  private static _i:StateManager|null=null;
  private _d:DataMatrix|null=null;
  private _c:Map<string,unknown>=new Map();
  private _m:boolean=false;
  private _u:DataMatrix[]=[];
  private _r:DataMatrix[]=[];
  private _max=20;
  static getInstance():StateManager{if(!StateManager._i)StateManager._i=new StateManager();return StateManager._i;}
  get hasData():boolean{return this._d!==null;}
  get dataMatrix():DataMatrix|null{return this._d;}
  get isModified():boolean{return this._m;}
  setData(d:DataMatrix):void{if(this._d){this._u.push(this._d);if(this._u.length>this._max)this._u.shift();this._r=[];}this._d=d;this._m=false;}
  clearData():void{this._d=null;this._c.clear();this._m=false;this._u=[];this._r=[];}
  markModified():void{this._m=true;}
  undo():boolean{if(!this._u.length)return false;if(this._d)this._r.push(this._d);this._d=this._u.pop()!;this._m=true;return true;}
  redo():boolean{if(!this._r.length)return false;if(this._d)this._u.push(this._d);this._d=this._r.pop()!;this._m=true;return true;}
  canUndo():boolean{return this._u.length>0;}
  canRedo():boolean{return this._r.length>0;}
  cacheResult(k:string,r:unknown):void{this._c.set(k,r);}
  getCachedResult<T>(k:string):T|null{return(this._c.get(k)as T)??null;}
  hasCachedResult(k:string):boolean{return this._c.has(k);}
  clearCache():void{this._c.clear();}
}
