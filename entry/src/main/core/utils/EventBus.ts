export type EventCallback=(...a:unknown[])=>void;
export class EventBus{
  private static _i:EventBus|null=null;
  private _l:Map<string,Set<EventCallback>>=new Map();
  private _h:{e:string;a:unknown[];t:number}[]=[];
  static getInstance():EventBus{if(!EventBus._i)EventBus._i=new EventBus();return EventBus._i;}
  on(e:string,c:EventCallback):void{if(!this._l.has(e))this._l.set(e,new Set());this._l.get(e)!.add(c);}
  off(e:string,c:EventCallback):void{this._l.get(e)?.delete(c);}
  once(e:string,c:EventCallback):void{const w=(...a:unknown[])=>{c(...a);this.off(e,w);};this.on(e,w);}
  emit(e:string,...a:unknown[]):void{this._h.push({e,a,t:Date.now()});if(this._h.length>100)this._h.shift();const l=this._l.get(e);if(l)for(const c of l)try{c(...a);}catch(x){console.error(x);}}
  emitDataChanged(d:unknown):void{this.emit("data_changed",d);}
  emitMetadataChanged(s:string,i:number,m:unknown):void{this.emit("metadata_changed",s,i,m);}
  emitUndoStackChanged():void{this.emit("undo_stack_changed");}
  getHistory(){return[...this._h];}
}
