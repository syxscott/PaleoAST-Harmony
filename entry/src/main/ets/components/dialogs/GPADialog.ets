@Component
export struct GPADialog {
  @Link visible: boolean;
  @State max_iterations: number = 100;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("GPA").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Max iterations:").width(140).fontSize(13); TextInput({ text: String(this.max_iterations) }).width(100).type(InputType.Number).onChange((v: string) => { this.max_iterations = parseInt(v) || 100; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'max_iterations': this.max_iterations}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}