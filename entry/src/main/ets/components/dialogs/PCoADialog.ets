/**
 * PCoA Configuration Dialog — replaces Python PCoADialog
 * Principal Coordinate Analysis with parameter validation and description.
 */
@Component
export struct PCoADialog {
  @Link visible: boolean;
  @State n_components: number = 10;
  @State metricIdx: number = 0;
  @State errorMsg: string = '';
  @State showAdvanced: boolean = false;
  metricOpts: string[] = ['bray_curtis', 'euclidean', 'jaccard', 'canberra', 'cosine'];
  metricDesc: string[] = [
    'Bray-Curtis: abundance-weighted, good for ecological data',
    'Euclidean: straight-line distance, good for morphometric data',
    'Jaccard: presence/absence, good for occurrence data',
    'Canberra: weighted by abundance, good for heterogeneous data',
    'Cosine: angular distance, good for compositional data',
  ];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      // Title
      Text('PCoA — Principal Coordinate Analysis').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })

      // Description
      Text('Ordination method that preserves pairwise distances between samples.').fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 })

      // n_components
      Row() {
        Text('Number of coordinates:').width(160).fontSize(13)
        TextInput({ text: String(this.n_components) }).width(80).type(InputType.Number)
          .onChange((v: string) => {
            const n = parseInt(v) || 10;
            if (n < 1) { this.errorMsg = 'Must be >= 1'; }
            else if (n > 100) { this.errorMsg = 'Maximum 100'; }
            else { this.n_components = n; this.errorMsg = ''; }
          })
      }.width('100%').margin({ bottom: 4 })

      // Error message
      if (this.errorMsg) {
        Text(this.errorMsg).fontSize(10).fontColor('#E74C3C').margin({ bottom: 8 })
      }

      // Metric selector
      Row() {
        Text('Distance metric:').width(160).fontSize(13)
        Select(this.metricOpts.map((v, i) => ({ value: v })))
          .selected(this.metricIdx)
          .onSelect((idx: number) => { this.metricIdx = idx; })
      }.width('100%').margin({ bottom: 4 })

      // Metric description
      Text(this.metricDesc[this.metricIdx]).fontSize(10).fontColor('#95A5A6').margin({ bottom: 8 })

      // Advanced section toggle
      Row() {
        Text(this.showAdvanced ? '[-] Advanced' : '[+] Advanced').fontSize(11).fontColor('#3498DB')
          .onClick(() => { this.showAdvanced = !this.showAdvanced; })
      }.width('100%').margin({ bottom: 8 })

      // Advanced options
      if (this.showAdvanced) {
        Column() {
          Text('PCoA computes eigenvectors of the double-centered distance matrix.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 8 })
          Text('Negative eigenvalues may occur with non-Euclidean metrics.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 8 })
          Text('The first 2-3 axes typically capture most variance.').fontSize(10).fontColor('#7F8C8D')
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })

      // Buttons
      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF')
          .onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF')
          .enabled(this.errorMsg === '')
          .onClick(() => {
            this.onConfirm({ n_components: this.n_components, metric: this.metricOpts[this.metricIdx] });
            this.visible = false;
          })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(480).borderRadius(12)
  }
}