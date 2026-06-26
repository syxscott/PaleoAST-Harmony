@Component
export struct CCADialog {
  @Link visible: boolean;
  @State n_components: number = 3;
  @State methodIdx: number = 0;
  methodOpts: string[] = ["cca", "rda"];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("CCA").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Components:").width(140).fontSize(13); TextInput({ text: String(this.n_components) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_components = parseInt(v) || 3; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Method:").width(140).fontSize(13); Select(this.methodOpts.map((v, i) => ({ value: v }))).selected(this.methodIdx).onSelect((idx: number) => { this.methodIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_components': this.n_components, 'method': this.methodOpts[this.methodIdx]}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}