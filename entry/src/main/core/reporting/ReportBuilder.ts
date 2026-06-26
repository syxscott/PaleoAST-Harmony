export class ReportBuilder { private _s:string[]=[]; addTitle(t:string){this._s.push("# "+t);} addSection(t:string,c:string){this._s.push("## "+t+"
"+c);} addTable(h:string[],r:string[][]){let t="| "+h.join(" | ")+" |
| "+h.map(()=>"---").join(" | ")+" |"; for(const row of r)t+="
| "+row.join(" | ")+" |"; this._s.push(t);} toMarkdown(){return this._s.join("

");} clear(){this._s=[];} }
