export interface Plugin { name:string; version:string; description:string; analyze:(data:number[][],params:Record<string,unknown>)=>unknown; }
export class PluginRegistry { private static _p=new Map(); static register(p:Plugin){PluginRegistry._p.set(p.name,p);} static get(n:string){return PluginRegistry._p.get(n);} static list(){return Array.from(PluginRegistry._p.values());} }
