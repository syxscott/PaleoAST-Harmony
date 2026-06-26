@Component
export struct TPSDialog {
  @Link visible: boolean;
  @State grid_size: number = 15;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("TPS").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Grid size:").width(140).fontSize(13); TextInput({ text: String(this.grid_size) }).width(100).type(InputType.Number).onChange((v: string) => { this.grid_size = parseInt(v) || 15; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'grid_size': this.grid_size}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}