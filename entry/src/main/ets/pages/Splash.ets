
@Entry
@Component
struct Splash {
  build() {
    Column() {
      Text("PaleoAST-Harmony").fontSize(32).fontWeight(FontWeight.Bold)
      Text("Loading...").fontSize(14).margin({top: 16})
    }.width("100%").height("100%").justifyContent(FlexAlign.Center)
  }
}
