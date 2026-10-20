@Component
export struct StratCorrDialog {
  @Link visible: boolean;

  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Correlation").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Text("No parameters required for stratigraphic correlation.").fontSize(11).fontColor($r('app.color.text_secondary')).margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor($r('app.color.bg_muted')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor($r('app.color.primary')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.onConfirm({}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}