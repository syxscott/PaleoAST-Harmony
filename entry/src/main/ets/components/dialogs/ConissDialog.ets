@Component
export struct ConissDialog {
  @Link visible: boolean;
  @State n_zones: number = 4;
  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("CONISS").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text("Stratigraphic zonation.").fontSize(11).fontColor("#7F8C8D").margin({ bottom: 16 })
      Row() { Text("Zones:").width(140).fontSize(13); TextInput({ text: String(this.n_zones) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_zones = parseInt(v) || 4; }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Validate with data").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_zones': this.n_zones}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}