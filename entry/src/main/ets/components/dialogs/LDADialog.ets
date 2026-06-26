@Component
export struct LDADialog {
  @Link visible: boolean;
  @State n_components: number = 2;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("LDA").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Components:").width(140).fontSize(13); TextInput({ text: String(this.n_components) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_components = parseInt(v) || 2; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_components': this.n_components}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}