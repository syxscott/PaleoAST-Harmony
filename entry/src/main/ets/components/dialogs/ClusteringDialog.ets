@Component
export struct ClusteringDialog {
  @Link visible: boolean;
@State nClusters: number = 3;
  @State methodIdx: number = 0;
  methodOpts: string[] = ["ward","complete","average","single"];
  @State metricIdx: number = 0;
  metricOpts2: string[] = ["euclidean","bray_curtis","cosine"];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('Hierarchical Clustering').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.doRun(); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
  doRun(): void { this.onConfirm({}); }
}
