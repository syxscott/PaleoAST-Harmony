@Component
export struct UnivariateDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State test_typeIdx: number = 0;
  test_typeOpts: string[] = ["Summary", "Normality", "t-test", "ANOVA", "Kruskal-Wallis"];
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
    this.test_typeIdx = 0;
    this.showTips = false;
  }

  build() {
    Column() {
      Text("Univariate").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Test:").width(140).fontSize(13); Select(this.test_typeOpts.map((v, i) => ({ value: v }))).selected(this.test_typeIdx).onSelect((idx: number) => { this.test_typeIdx = idx; }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Summary: mean/std").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
          Text("ANOVA: >= 2 groups").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'test_type': this.test_typeOpts[this.test_typeIdx]}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}