@Component
export struct ExtinctionDialog {
  @Link visible: boolean;
  @State methodIdx: number = 0;
  methodOpts: string[] = ["marshall", "strauss_sadler"];
  @State confidence_level: number = 0.95;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Extinction CI").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Method:").width(140).fontSize(13); Select(this.methodOpts.map((v, i) => ({ value: v }))).selected(this.methodIdx).onSelect((idx: number) => { this.methodIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Confidence:").width(140).fontSize(13); TextInput({ text: String(this.confidence_level) }).width(100).onChange((v: string) => { this.confidence_level = parseFloat(v) || 0.95; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'method': this.methodOpts[this.methodIdx], 'confidence_level': this.confidence_level}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}