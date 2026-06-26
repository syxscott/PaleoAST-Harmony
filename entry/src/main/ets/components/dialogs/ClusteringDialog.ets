@Component
export struct ClusteringDialog {
  @Link visible: boolean;
  @State n_clusters: number = 3;
  @State methodIdx: number = 0;
  methodOpts: string[] = ["ward", "complete", "average", "single"];
  @State metricIdx: number = 0;
  metricOpts: string[] = ["euclidean", "bray_curtis", "cosine"];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Clustering").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Clusters:").width(140).fontSize(13); TextInput({ text: String(this.n_clusters) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_clusters = parseInt(v) || 3; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Linkage:").width(140).fontSize(13); Select(this.methodOpts.map((v, i) => ({ value: v }))).selected(this.methodIdx).onSelect((idx: number) => { this.methodIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Metric:").width(140).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_clusters': this.n_clusters, 'method': this.methodOpts[this.methodIdx], 'metric': this.metricOpts[this.metricIdx]}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}