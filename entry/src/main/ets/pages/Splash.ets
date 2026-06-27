@Entry
@Component
struct Splash {
  @State progress: number = 0;
  build() {
    Column() {
      Text("PaleoAST").fontSize(36).fontWeight(FontWeight.Bold).fontColor("#3498DB").margin({bottom:8})
      LoadingProgress().width(56).height(56).color("#3498DB").margin({bottom:16})
      Progress({value:this.progress, total:100, type:ProgressType.Linear}).width("60%").color("#3498DB")
      Text("v1.0.0 HarmonyOS").fontSize(9).fontColor("#BDC3C7").margin({top:16})
    }.width("100%").height("100%").justifyContent(FlexAlign.Center)
  }
}
