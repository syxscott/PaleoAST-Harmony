export function plugin(name:string,version:string,desc:string){return function<T extends{new(...a:any[]):{}}>(c:T){return class extends c{static pluginName=name;static pluginVersion=version;static pluginDescription=desc;};};}
export function analysis(name:string){return function(t:any,k:string,d:PropertyDescriptor){d.value.analysisName=name;return d;};}
