@Component
export struct RarefactionDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  // Which sample row (species abundances) to rarefy; clamped on confirm by the
  // page, which knows the matrix dimensions.
  @State sample_index: number = 0;
  @State max_n: number = 100;
  @State n_points: number = 50;
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
    this.max_n = 100;
    this.n_points = 50;
    this.showTips = false;
  }

  build() {
    Column() {
      Text("Rarefaction").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text("Expected richness at sizes.").fontSize(11).fontColor("#7F8C8D").margin({ bottom: 16 })
      Row() { Text("Sample row:").width(140).fontSize(13); TextInput({ text: String(this.sample_index) }).width(100).type(InputType.Number).onChange((v: string) => { this.sample_index = Math.max(0, parseInt(v) || 0); }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Max size:").width(140).fontSize(13); TextInput({ text: String(this.max_n) }).width(100).type(InputType.Number).onChange((v: string) => { this.max_n = Math.max(2, Math.min(10000, parseInt(v) || 100)); }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Points:").width(140).fontSize(13); TextInput({ text: String(this.n_points) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_points = Math.max(5, Math.min(500, parseInt(v) || 50)); }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Plateau: captured").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
          Text("Rising: need more").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'sample_index': this.sample_index, 'max_n': this.max_n, 'n_points': this.n_points}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}