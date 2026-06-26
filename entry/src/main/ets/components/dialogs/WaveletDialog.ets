@Component
export struct WaveletDialog {
  @Link visible: boolean;
  @State min_scale: number = 2;
  @State max_scale: number = 50;
  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Wavelet").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Min:").width(140).fontSize(13); TextInput({ text: String(this.min_scale) }).width(100).type(InputType.Number).onChange((v: string) => { this.min_scale = parseInt(v) || 2; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Max:").width(140).fontSize(13); TextInput({ text: String(this.max_scale) }).width(100).type(InputType.Number).onChange((v: string) => { this.max_scale = parseInt(v) || 50; }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Higher scales: longer periods").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'min_scale': this.min_scale, 'max_scale': this.max_scale}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}