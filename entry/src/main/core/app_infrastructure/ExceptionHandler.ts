export class ExceptionHandler { static formatUserError(e:unknown,op=""):string { const m=e instanceof Error?e.message:String(e); return op?op+": "+m:m; } }
