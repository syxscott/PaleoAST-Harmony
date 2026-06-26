export interface Plugin { name:string; version:string; description:string; analyze:(data:number[][],params:Record<string,unknown>)=>unknown; }
