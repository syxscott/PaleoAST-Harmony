import os
base = "D:/GIthub/PaleoAST-Harmony/entry/src/main/ets/components/dialogs"
def md(n, t, ps):
  sl,il,cp = [],[],[]
  for pn,pt,pd,pl in ps:
    if pt=="int": sl.append("  @State "+pn+": number = "+str(pd)+";"); il.append("      Row() { Text(""+pl+"").width(140).fontSize(13); TextInput({ text: String(this."+pn+") }).width(100).type(InputType.Number).onChange((v:string) => { this."+pn+" = parseInt(v) || "+str(pd)+"; }) }.width("100%").margin({ bottom: 8 })"); cp.append("'"+pn+"': this."+pn)
    elif pt=="float": sl.append("  @State "+pn+": number = "+str(pd)+";"); il.append("      Row() { Text(""+pl+"").width(140).fontSize(13); TextInput({ text: String(this."+pn+") }).width(100).onChange((v:string) => { this."+pn+" = parseFloat(v) || "+str(pd)+"; }) }.width("100%").margin({ bottom: 8 })"); cp.append("'"+pn+"': this."+pn)
    elif pt=="select":
      opts = ", ".join(["'"+o+"'" for o in pd])
      sl.append("  @State "+pn+"Idx: number = 0;")
      sl.append("  "+pn+"Opts: string[] = ["+opts+"];")
      il.append("      Row() { Text(""+pl+"").width(140).fontSize(13); Select(this."+pn+"Opts.map((v,i) => ({value:v}))).selected(this."+pn+"Idx).onSelect((idx:number) => { this."+pn+"Idx = idx; }) }.width("100%").margin({ bottom: 8 })")
      cp.append("'"+pn+"': this."+pn+"Opts[this."+pn+"Idx]")
  sc = ", ".join(cp)
  sb = chr(10).join(sl)
  ib = chr(10).join(il)
  r = "@Component
export struct "+n+" {
  @Link visible: boolean;
"+sb+"
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text(""+t+"").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
"+ib+"
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({"+sc+"}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}"
  return r
ds = {"PCoADialog":("PCoA",[("n_components","int",10,"Components"),("metric","select",["bray_curtis","euclidean","jaccard"],"Metric")]),"NMDSDialog":("NMDS",[("n_dimensions","int",2,"Dimensions"),("n_restarts","int",10,"Restarts"),("max_iterations","int",300,"Max iterations"),("metric","select",["bray_curtis","euclidean"],"Metric")]),"LDADialog":("LDA",[("n_components","int",2,"Components")]),"CCADialog":("CCA",[("n_components","int",3,"Components"),("method","select",["cca","rda"],"Method")])}
c = 0
for fn,(t,ps) in ds.items():
  p = os.path.join(base, fn+".ets")
  with open(p,"w",encoding="utf-8") as f: f.write(md(fn,t,ps))
  c += 1
print("Filled "+str(c)+" dialogs")