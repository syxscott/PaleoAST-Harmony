@Component
export struct DiversityDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State sample_index: number = 0;
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
    this.sample_index = 0;
    this.showTips = false;
  }

  build() {
    Column() {
      Text("Diversity").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Sample index:").width(140).fontSize(13); TextInput({ text: String(this.sample_index) }).width(100).type(InputType.Number).onChange((v: string) => { this.sample_index = Math.max(0, parseInt(v) || 0); }) }.width("100%").margin({ bottom: 8 })
      if (this.sample_index < 0) { Text("sample_index must be >= 0").fontSize(10).fontColor("#E74C3C").margin({ bottom: 4 }) }
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("H > 3: diverse").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
          Text("S > 0.7: even").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'sample_index': this.sample_index}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}