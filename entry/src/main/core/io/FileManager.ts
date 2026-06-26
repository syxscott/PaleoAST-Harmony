export class FileManager { static getExtension(p:string):string { return p.split(".").pop()?.toLowerCase()||""; } }
