@Component
export struct RarefactionDialog {
  @Link visible: boolean;
  @State max_n: number = 100;
  @State n_points: number = 50;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Rarefaction").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Max size:").width(140).fontSize(13); TextInput({ text: String(this.max_n) }).width(100).type(InputType.Number).onChange((v: string) => { this.max_n = parseInt(v) || 100; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Points:").width(140).fontSize(13); TextInput({ text: String(this.n_points) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_points = parseInt(v) || 50; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'max_n': this.max_n, 'n_points': this.n_points}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}