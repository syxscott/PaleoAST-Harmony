@Component
export struct NMDSDialog {
  @Link visible: boolean;
  @State n_dimensions: number = 2;
  @State n_restarts: number = 10;
  @State max_iterations: number = 300;
  @State metricIdx: number = 0;
  metricOpts: string[] = ["bray_curtis", "euclidean"];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("NMDS").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Dimensions:").width(140).fontSize(13); TextInput({ text: String(this.n_dimensions) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_dimensions = parseInt(v) || 2; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Restarts:").width(140).fontSize(13); TextInput({ text: String(this.n_restarts) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_restarts = parseInt(v) || 10; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Max iterations:").width(140).fontSize(13); TextInput({ text: String(this.max_iterations) }).width(100).type(InputType.Number).onChange((v: string) => { this.max_iterations = parseInt(v) || 300; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Metric:").width(140).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_dimensions': this.n_dimensions, 'n_restarts': this.n_restarts, 'max_iterations': this.max_iterations, 'metric': this.metricOpts[this.metricIdx]}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}