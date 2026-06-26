@Component
export struct NullModelDialog {
  @Link visible: boolean;
  @State metricIdx: number = 0;
  metricOpts: string[] = ["c_score", "checkerboard"];
  @State n_permutations: number = 999;
  @State n_workers: number = 4;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Null Model").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Metric:").width(140).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Permutations:").width(140).fontSize(13); TextInput({ text: String(this.n_permutations) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_permutations = parseInt(v) || 999; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Workers:").width(140).fontSize(13); TextInput({ text: String(this.n_workers) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_workers = parseInt(v) || 4; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'metric': this.metricOpts[this.metricIdx], 'n_permutations': this.n_permutations, 'n_workers': this.n_workers}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}