@Component
export struct PICDialog {
  @Link @Watch('onVisibleChange') visible: boolean;

  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  /**
   * Reset every parameter when the dialog is reopened.
   *
   * ArkUI keeps @State values across a visibility toggle, so before this the
   * numbers typed in an earlier session silently reappeared the next time the
   * dialog was opened — and a user who forgets they changed something reads the
   * stale value as the default. For a research tool that means silently wrong
   * results, so the state is restored to its declared defaults on every open.
   */
  onVisibleChange(): void {
    if (!this.visible) return;
    this.showTips = false;
  }

  build() {
    Column() {
      Text("PIC").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

            Row() { Text("[+] Tips").fontSize(11).fontColor($r('app.color.primary')).onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Uncorrelated with SE").fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Text("No parameters required for PIC analysis.").fontSize(11).fontColor($r('app.color.text_secondary')).margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor($r('app.color.bg_muted')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor($r('app.color.primary')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.onConfirm({}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}