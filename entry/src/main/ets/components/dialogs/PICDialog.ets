@Component
export struct PICDialog {
  @Link visible: boolean;

  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("PIC").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}