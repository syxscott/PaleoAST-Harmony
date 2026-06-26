@Component
export struct BetaDivDialog {
  @Link visible: boolean;
  @State metricIdx: number = 0;
  metricOpts: string[] = ["jaccard", "sorensen"];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Beta Diversity").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Metric:").width(140).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'metric': this.metricOpts[this.metricIdx]}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}