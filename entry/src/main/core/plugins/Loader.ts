import{Plugin}from"./Base";import{PluginRegistry}from"./Registry";
export function loadPlugin(p:Plugin):void{PluginRegistry.register(p);}
export function loadPlugins(ps:Plugin[]):void{for(const p of ps)loadPlugin(p);}
export function unloadPlugin(n:string):boolean{return PluginRegistry.remove(n);}
export function getPlugin(n:string):Plugin|undefined{return PluginRegistry.get(n);}
export function listPlugins():Plugin[]{return PluginRegistry.list();}
