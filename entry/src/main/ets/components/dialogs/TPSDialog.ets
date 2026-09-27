@Component
export struct TPSDialog {
  @Link visible: boolean;
  // The "Grid size" field is gone. This dialog dispatches to
  // `tpsAnalyze(source, target)`, which has no grid parameter. The separate
  // `tpsDeformation(source, target, gridSize)` helper does take one, but routing
  // this dialog to it would silently swap which TPS algorithm runs — a change of
  // analysis, not a fix of a dropped parameter. Index.ets never passed the
  // value on anyway, so the recorded grid size was pure fiction.
  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("TPS").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Energy > 0.1: localized").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}