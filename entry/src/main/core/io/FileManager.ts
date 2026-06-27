export class FileManager {
  static getExtension(p:string):string{return p.split(".").pop()?.toLowerCase()||"";}
  static getBaseName(p:string):string{return p.split("/").pop()?.split("\\").pop()||p;}
  static isTextFile(p:string):boolean{return ["csv","tsv","txt","tps","nxs","nex","tre","newick","dat"].includes(FileManager.getExtension(p));}
  static getFileType(p:string):string{const e=FileManager.getExtension(p);const m:Record<string,string>={csv:"csv",tsv:"csv",tps:"tps",nxs:"nexus",nex:"nexus",tre:"newick",dat:"dat",xlsx:"excel"};return m[e]||"unknown";}
  static async readText(path:string):Promise<string>{return"";}
  static async writeText(path:string,content:string):Promise<void>{}
}
