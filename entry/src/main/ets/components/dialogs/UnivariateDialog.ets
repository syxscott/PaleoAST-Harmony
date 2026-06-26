@Component
export struct UnivariateDialog {
  @Link visible: boolean;
  @State test_typeIdx: number = 0;
  test_typeOpts: string[] = ["Summary", "Normality", "t-test", "ANOVA", "Kruskal-Wallis"];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Univariate").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Test:").width(140).fontSize(13); Select(this.test_typeOpts.map((v, i) => ({ value: v }))).selected(this.test_typeIdx).onSelect((idx: number) => { this.test_typeIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'test_type': this.test_typeOpts[this.test_typeIdx]}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}