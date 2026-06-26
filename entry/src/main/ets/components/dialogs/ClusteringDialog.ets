/**
 * Hierarchical Clustering Dialog
 * Agglomerative clustering with multiple linkage methods.
 */
@Component
export struct ClusteringDialog {
  @Link visible: boolean;
  @State n_clusters: number = 3;
  @State methodIdx: number = 0;
  @State metricIdx: number = 0;
  @State errorMsg: string = '';
  @State showAdvanced: boolean = false;
  methodOpts: string[] = ['ward', 'complete', 'average', 'single'];
  methodDesc: string[] = [
    'Ward: minimizes within-cluster variance (most balanced)',
    'Complete: furthest neighbor (compact clusters)',
    'Average: average distance (UPGMA, balanced)',
    'Single: nearest neighbor (chaining effect)',
  ];
  metricOpts: string[] = ['euclidean', 'bray_curtis', 'cosine', 'jaccard', 'canberra'];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('Hierarchical Clustering').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text('Groups samples based on distance similarity.').fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 })

      Row() { Text('Number of clusters:').width(160).fontSize(13); TextInput({ text: String(this.n_clusters) }).width(80).type(InputType.Number).onChange((v: string) => { const n = parseInt(v) || 3; if (n < 2) { this.errorMsg = 'Need at least 2 clusters'; } else if (n > 20) { this.errorMsg = 'Maximum 20 clusters'; } else { this.n_clusters = n; this.errorMsg = ''; } }) }.width('100%').margin({ bottom: 4 })
      if (this.errorMsg) { Text(this.errorMsg).fontSize(10).fontColor('#E74C3C').margin({ bottom: 8 }) }

      Row() { Text('Linkage method:').width(160).fontSize(13); Select(this.methodOpts.map((v, i) => ({ value: v }))).selected(this.methodIdx).onSelect((idx: number) => { this.methodIdx = idx; }) }.width('100%').margin({ bottom: 4 })
      Text(this.methodDesc[this.methodIdx]).fontSize(10).fontColor('#95A5A6').margin({ bottom: 8 })

      Row() { Text('Distance metric:').width(160).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width('100%').margin({ bottom: 8 })

      Row() { Text(this.showAdvanced ? '[-] Tips' : '[+] Tips').fontSize(11).fontColor('#3498DB').onClick(() => { this.showAdvanced = !this.showAdvanced; }) }.width('100%').margin({ bottom: 8 })
      if (this.showAdvanced) {
        Column() {
          Text('Ward method requires Euclidean distance for correct results.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('Cophenetic correlation > 0.75 indicates good fit.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('Compare multiple linkage methods for robustness.').fontSize(10).fontColor('#7F8C8D')
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF').onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF').enabled(this.errorMsg === '').onClick(() => { this.onConfirm({ n_clusters: this.n_clusters, method: this.methodOpts[this.methodIdx], metric: this.metricOpts[this.metricIdx] }); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(480).borderRadius(12)
  }
}