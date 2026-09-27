@Component
export struct LDADialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State n_components: number = 2;
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
    this.n_components = 2;
    this.showTips = false;
  }

  build() {
    Column() {
      Text("LDA").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Components:").width(140).fontSize(13); TextInput({ text: String(this.n_components) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_components = Math.max(1, parseInt(v) || 2); }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Needs >= 2 groups").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
          Text("Acc > 0.8: good").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_components': this.n_components}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}